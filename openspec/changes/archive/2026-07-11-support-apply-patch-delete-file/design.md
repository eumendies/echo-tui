## Context

`apply_patch` 当前的内部模型只有 `add` 和 `update` 两类文件操作。parser 在遇到 `*** Delete File:`、`+++ /dev/null` 或 `deleted file mode` 时会直接返回不支持；simulator 和写盘阶段也只会生成新内容并调用 `writeFileSync`。这让模型需要删除文件时只能绕行 bash/rm，而 bash 删除虽然会触发高风险审批，却无法像 apply_patch 一样提供结构化 diff metadata、all-or-nothing 语义和 change history。

现在 apply_patch 已经有执行前授权 UI，且 change history 已能通过 before snapshot 恢复受控文件变更。本变更把“删除普通 UTF-8 文本文件”纳入 apply_patch 的受控编辑能力，让删除与新增、更新共享同一审批、展示和 undo 路径。

## Goals / Non-Goals

**Goals:**

- 支持 `*** Begin Patch` 的 `*** Delete File: <path>` 删除语法。
- 支持 unified diff 删除文件语法，包括 `--- a/<path>` / `+++ /dev/null` 和常见 `deleted file mode` 元数据。
- 删除文件继续遵守路径安全、普通文本文件校验、文件大小限制、文件数量限制、all-or-nothing 写入和 change history。
- 为删除结果生成 display metadata，使 TUI 可展示完整 removed 行和删除文件摘要。
- 在 apply_patch 授权 preview 中突出删除文件，避免用户只看到普通路径摘要。

**Non-Goals:**

- 不支持重命名、移动、复制、chmod/mode change、binary patch 或 symlink patch。
- 不删除目录、symlink、设备文件或其他非普通文件。
- 不改变 MCP、bash、hooks 的审批或执行模型。
- 不引入新的 diff/patch 第三方依赖，也不委托系统 `patch` 或 Git 命令执行。
- 不在 provider-facing tool result text 中输出完整删除文件内容；完整展示仍仅通过 display-only metadata 给 TUI 使用。

## Decisions

### 1. 将 delete 建模为第三类 PatchOperation

内部 `PatchOperation` 从 `add | update` 扩展为 `add | update | delete`。删除操作保留 `filePath`，unified diff 删除可携带解析出的 hunks 用于校验和展示；Begin Patch 删除没有 hunk body。

替代方案是把 unified diff 删除建模为“更新为空文件”再在写盘阶段根据目标路径删除。这个方案会混淆“清空文件”和“删除文件”，也会让 result summary、metadata 和 undo 语义难以区分，因此不采用。

### 2. Begin Patch 删除只依赖显式 Delete File 指令

`*** Delete File: <path>` 是明确的文件级操作，不需要 hunk body。handler SHALL 在模拟阶段确认目标存在、是普通 UTF-8 文本文件、不是 symlink、大小不超过限制，然后在写盘阶段删除。

替代方案是要求 Begin Patch 删除也携带原文件内容作为 removed 行。这样安全性更强，但会让模型删除大文件时生成冗长 patch，并偏离 Begin Patch 常见语法。当前已有用户审批，因此采用显式指令加目标文件校验。

### 3. unified diff 删除需要用 hunk 校验当前文件内容

unified diff 删除通常包含 `+++ /dev/null` 和 removed hunks。为了避免陈旧 patch 误删当前文件，simulator SHALL 使用解析出的 delete hunks 校验目标文件内容：delete hunks 必须表示把当前文本文件删除为空内容。校验失败时整个 patch 失败且不写盘。

替代方案是只要看到 `+++ /dev/null` 就删除目标文件。该方案实现简单，但比现有 update hunk 的“精确匹配”语义弱，容易接受过期 diff，因此不采用。

### 4. 删除写盘复用 change history recorder

写盘阶段仍先对所有模拟结果做 `captureFileBefore`，再按文件操作执行：`add/update` 写入内容，`delete` 调用 `unlinkSync`。删除成功后调用 `captureFileAfter`，现有 change history 会把“删除已有文件”作为可恢复的既有文件变更记录；`/undo` 使用 before snapshot 重新写回内容和 mode。

替代方案是为 change history 增加新的 `deleted` state。它更语义化，但会扩大持久化迁移和 undo summary 范围。当前需求只要求可恢复删除，现有 `updated` 恢复模型足够，因此不引入新状态。

### 5. display metadata 使用 deleted 文件类型和 removed 行

`ApplyPatchDisplayFile.kind` 扩展为 `deleted`。删除文件的 metadata SHALL 把原文件每一行记录为 `removed`，`postLine` 为 `null`；renderer 继续使用现有红色 removed 行样式，文件标题显示 `+0 -N`。

替代方案是不给删除结果 metadata，让 TUI fallback 到普通 tool result。这样用户无法在 transcript 中看到被删除内容，也不利于 review，因此不采用。

### 6. 授权 preview 对删除使用显式动作摘要

apply_patch approval preview 继续保持轻量 header 扫描，但输出中删除文件 SHALL 显示为 `delete <path>` 或等价破坏性标记，而不是只显示 `<path>`。新增和更新可以继续使用既有简洁路径摘要，避免扩大 UI 噪音。

替代方案是完整解析 patch 并渲染 diff preview 到审批面板。那会在 approval gate 中重复 apply_patch handler 的解析/模拟逻辑，也可能受 footer 高度限制影响用户选择；本次只做轻量但明确的删除标记。

## Risks / Trade-offs

- 删除文件是破坏性操作 → 保持 apply_patch 必经审批，preview 显式标记删除，并保留 undo snapshot。
- unified diff 删除 hunk 校验实现可能比 add/update 更复杂 → 复用现有 hunk parsing 和文本拆分逻辑，增加覆盖过期 diff、缺失 hunk、多文件 all-or-nothing 的测试。
- 删除大文件会扩大 transcript display metadata 和 undo snapshot → 继续使用 `maxFileBytes` 和 apply_patch display budget；超限文件拒绝删除。
- symlink 删除容易破坏 undo 语义 → 删除目标必须是普通文件，并显式拒绝 symlink 和非普通文件。
- approval preview 只是轻量扫描，不能代替 handler 校验 → preview 仅用于用户识别风险；最终安全语义仍由 parser/simulator/write 阶段保证。
