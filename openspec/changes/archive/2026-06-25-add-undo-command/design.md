## Context

当前 TUI 的 transcript 是 append-only 模型：`runAssistantTurn()` 先追加 user record，然后 agent loop 通过 callback 逐步追加 reasoning、assistant segment、tool call/result 和最终 assistant/error records；`TranscriptContext.appendRecord()` 每次追加都会立即持久化当前 session。文件修改目前主要来自受控工具 `apply_patch`，该工具在写盘前已经能通过 parser/simulator 得到目标文件列表和 post-image 内容，但没有保存 before-image。

用户希望 `/undo` 以“上一轮 loop”为粒度撤销，不依赖 Git。这个能力必须同时恢复文件系统和 transcript，否则会出现文件已经恢复但对话仍保留工具结果，或对话回退但磁盘仍保留修改的不一致状态。

## Goals / Non-Goals

**Goals:**

- 提供 `/undo` slash command，回退上一轮 assistant loop 的受控文件修改和对应 transcript records。
- 不依赖 Git 仓库、commit 或 index 状态。
- 支持当前进程内连续多次 undo，按 assistant loop 从新到旧逐轮恢复。
- 对 `apply_patch` 这类受控文件编辑工具提供可靠回滚。
- 对不可追踪写入型 `run_bash_command` 拒绝回退，因为系统无法证明完整文件集合；对受控文件工具记录的文件，用户确认后直接恢复到 loop 开始前状态。
- 回退 transcript 时恢复 loop 前的 compaction 状态，并重绘当前 app snapshot。

**Non-Goals:**

- 不支持任意 bash 命令的完整文件系统回滚。
- 不支持跨进程 undo 或把完整文件备份持久化到 transcript session。
- 不支持二进制文件、目录树快照、rename/chmod/symlink/binary patch 的回滚扩展。
- 不修改 provider-facing tool result 文本语义；undo metadata 只服务本地 app。

## Decisions

### 1. 使用短生命周期 UndoContext + checkpoint stack

新增 `UndoContext` 持有当前 recording checkpoint 和历史 checkpoint 栈。assistant turn 开始时记录：

- `transcriptStartIndex`
- loop 前 `compaction` 快照
- 当前 cwd
- 文件 snapshot 和写入状态 entries

turn 正常结束、失败或中断后，如果 checkpoint 没有被标记 invalid，则进入 `ready` 并入栈。`/undo` 总是读取栈顶 checkpoint：ready 时确认恢复，成功后弹出栈顶；invalid 时直接提示不可回退。

如果本轮 checkpoint 被标记 invalid，系统保留该 invalid checkpoint 作为历史边界，并丢弃它之前的 checkpoint。后续新的 ready checkpoint 可以继续入栈；用户连续 undo 回到 invalid 边界后，`/undo` SHALL 停止并展示不可回退原因。

选择该方案的原因：

- 与现有 event/turn 生命周期一致，不需要把 class instance 放入 transcript session。
- 支持按 loop 粒度连续回退，同时保留 invalid 写入型 bash 的安全边界。
- 避免把文件内容备份写入 `~/.echo/echo_tui` 持久化 session，降低体积和敏感信息风险。

备选方案是把 checkpoint 持久化到 transcript session。该方案支持重启后 undo，但会带来文件内容备份泄漏、session 膨胀和迁移复杂度，第一版不采用。

### 2. 只回退受控文件工具，bash 写入使 checkpoint 失效

`apply_patch` 在写盘前通过 undo recorder 捕获目标文件 snapshot，每成功写入一个文件后立即把该文件标记为 `created` 或 `updated`。解析、校验或模拟失败不记录可回滚文件修改；写盘阶段失败时不使 checkpoint invalid，已经写入成功的文件仍可在 `/undo` 中恢复，尚未成功写入的文件保持 `pending`。

`run_bash_command` 不具备可靠的文件改动声明能力。normal mode 下执行非只读或高风险 bash 时，本轮 checkpoint SHALL 被标记为 invalid；`/undo` 之后拒绝执行并说明本轮包含不可追踪命令。

选择该方案的原因：

- 不依赖 Git，也不需要昂贵的全目录前后扫描。
- 语义诚实：只承诺能证明可恢复的修改。
- 把不可追踪写入和受控文件恢复分开处理，避免用过宽的保守策略阻断明确确认的 `/undo`。

备选方案是用 fs watcher 或全 workspace hash 扫描追踪 bash 文件变化。该方案跨平台可靠性弱，对大仓库成本高，且仍可能漏掉 rename/delete/临时文件模式，第一版不采用。

### 3. 用户确认后恢复 snapshot

每个 `UndoFileEntry` 记录：

- absolute path
- snapshot exists / snapshot content / snapshot mode
- state: `pending` / `created` / `updated`

`pending` 表示已记录 snapshot，但受控工具还没有报告成功写入；它不进入 `/undo` 摘要，也不参与文件恢复。`/undo` 执行时不校验当前文件是否仍匹配工具结束后的状态。用户已经在确认面板明确选择回退，因此系统 SHALL 将每个 `created` / `updated` 文件恢复为 snapshot：

- loop 前已存在的文件：写回 snapshot content 和 mode。
- loop 中新增的文件：删除该文件。

选择 all-or-nothing 恢复，是为了保持 transcript 和文件系统一致。部分恢复会让用户难以判断哪些文件已经回退。

### 4. transcript 回退使用明确边界，不扫描猜测

`runAssistantTurn()` 在追加 user record 前创建 checkpoint，记录 `transcriptStartIndex = records.length`。`/undo` 成功恢复文件后，`TranscriptContext` 截断 records 到该 index，并恢复 `compactionBefore`。

这样不需要从 transcript 中猜测上一轮起点，也能处理 loop 中发生的 compaction notice、reasoning summary、assistant segment 和多个 tool call/result。

### 5. `/undo` 走 confirm/info command surface

`/undo` 启动时读取 undo 状态：

- checkpoint 栈为空：打开 info surface。
- 栈顶 checkpoint invalid：打开 info surface，说明不可回退原因。
- checkpoint ready：打开 confirm surface，用三行短文案展示“回退这轮对话与文件变更”、文件修改/新增文件数量，以及会覆盖期间手动修改的风险。

确认后执行恢复。成功时追加一条 local notice 或显示 transient info 需要谨慎：如果 transcript 已截断，追加成功 notice 会让 transcript 不再等于 loop 前状态。第一版建议只通过 command surface / redraw 告知成功，不追加 transcript record。

## Risks / Trade-offs

- [Risk] 用户期望任意 bash 修改都能 undo，但第一版拒绝不可追踪写入。→ 在 `/undo` 不可用说明和 tool 文档中明确“只支持受控文件工具”。
- [Risk] checkpoint 只在内存中，重启后不可 undo。→ 第一版只承诺当前进程内多轮 undo；后续若要持久化需单独设计文件备份安全策略。
- [Risk] 文件内容可能包含敏感信息，内存中会暂存 before-image。→ 不持久化 checkpoint；turn 被覆盖或 undo 后清除备份。
- [Risk] loop 后用户手工修改了同一文件。→ `/undo` 确认语义就是恢复上一轮开始前状态，确认面板用“注意：会覆盖期间的手动修改”提示风险。
- [Risk] transcript 截断和文件恢复任一步失败会产生不一致。→ 执行顺序先恢复全部文件，最后截断 transcript；恢复文件阶段若失败则尽力还原本次 undo 前的文件状态、不截断 transcript，并报告错误。

## Migration Plan

1. 新增 `UndoContext`，默认空状态，不影响现有会话。
2. 在 assistant turn 生命周期中接入 begin/finalize/invalidate。
3. 扩展 `apply_patch` 执行路径，写盘前后记录 undo 文件 entry。
4. 增加 `/undo` command handler 和 host 能力。
5. 补充单元测试和 command/runtime 集成测试。

不需要数据迁移。现有 transcript session 不包含 undo checkpoint，启动后 `/undo` 应显示“暂无可回退操作”。
