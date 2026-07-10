## Context

当前 `apply_patch` handler 支持 unified diff 和 `*** Begin Patch` 两类输入，并把两者归一为文件级 update hunk 后执行精确唯一匹配。这个实现保持了安全性，但 Begin Patch 方言覆盖较窄：每个 `@@` hunk 都必须自身包含新增或删除行，无法表达“先定位到某段上下文，再在其后寻找更小的修改块”。

模型常生成的 Begin Patch 更接近 Codex apply_patch 方言：`@@` 可以是仅包含上下文行的 chunk，也可以写成 `@@ <context>` 表示单行锚点。此类 patch 不一定是错误语法，当前失败主要来自本地 parser 和 simulator 缺少顺序定位语义。

## Goals / Non-Goals

**Goals:**

- 让 Begin Patch update 支持 context-only chunk，并把它作为后续 chunk 的定位锚点。
- 支持 `@@ <context>` 形式的单行锚点，降低插入类 patch 的失败率。
- 保持现有安全策略：不猜测无上下文插入位置，匹配失败或歧义时拒绝，所有文件仍按 all-or-nothing 应用。
- 保持 display metadata 的事实性：成功时基于实际匹配位置生成，失败时不伪造位置。

**Non-Goals:**

- 不改变 unified diff 的解析和匹配语义。
- 不支持删除文件、移动/重命名、mode change、symlink 或 binary patch。
- 不引入模糊匹配、自动修复 patch、行号定位或外部 `patch`/`git apply` 委托。
- 不改变 tool schema、审批、undo/change history 或渲染层 metadata contract。

## Decisions

### 1. Begin Patch update 使用顺序 chunk 模型

Begin Patch update 应解析为有序 chunk 序列，而不是一组彼此独立的全文件 hunk。每个 chunk 仍保留 `oldLines`、`newLines` 和 display lines；额外记录它是否包含真实改动，以及可选的 inline anchor。

执行时维护一个搜索游标。context-only chunk 成功匹配后推进游标，后续 chunk 只在该位置之后继续匹配。这样可以表达“先找到目标测试块，再在该测试块之后插入新内容”，避免后续小上下文在文件其他位置重复匹配造成歧义。

备选方案是简单允许 context-only hunk 通过 parser，但继续让 simulator 对每个 hunk 全文件唯一匹配。该方案不能解决用户样例：后续 `});` / `});` 这类小上下文仍可能在测试文件中重复出现。

### 2. context-only chunk 不单独产生写入

context-only chunk 只作为定位锚点，不改变文件内容，也不应导致无变更 patch 被视为成功。一个 Begin Patch update 文件操作至少需要包含一个新增或删除行；如果整段 update 只有 context-only chunk，handler 应返回无有效修改的失败。

备选方案是把 context-only chunk 当作 no-op 修改写入相同内容。该方案会污染 change history 和 display metadata，也会让模型误以为一次没有改动的 patch 已成功完成任务。

### 3. `@@ <context>` 作为单行锚点

当 Begin Patch chunk header 是 `@@ <context>` 时，handler 应把 `<context>` 作为目标文件中的单行上下文锚点。若该 chunk 后续只有新增行，则这些新增行插入到锚点之后；若后续还有 context/removed lines，则从锚点之后继续做顺序匹配。

没有 inline anchor、没有 context lines、也没有 removed lines 的纯新增 chunk 仍应拒绝，除非后续单独设计 EOF 插入语义。本次不引入 `*** End of File`。

### 4. display metadata 继续从最终文件事实生成

成功应用后，display metadata 继续覆盖完整 post-image 文件行并插入 removed 行。context-only chunk 本身不需要作为修改行突出显示；它的价值体现在帮助定位真实修改 chunk。修改 chunk 的 added/removed 标记必须基于实际应用位置计算。

失败发生在解析之后、匹配或写入之前时，可以继续返回解析得到的尝试编辑内容；无法确认位置的行必须保持 `postLine: null`。

## Risks / Trade-offs

- [Risk] 顺序定位语义可能让 Begin Patch 和 unified diff 行为不完全一致 -> Mitigation: 仅对 Begin Patch update 启用，unified diff 保持现有精确唯一匹配。
- [Risk] context-only anchor 本身可能匹配多处 -> Mitigation: 在当前搜索范围内仍要求唯一匹配，歧义时拒绝并提示增加上下文。
- [Risk] 多个 chunk 应用后位置推进和 display metadata 更复杂 -> Mitigation: 用目标测试覆盖“前序 anchor 后插入”“多个顺序插入”“删除先前新增行”等位置推进边界。
- [Risk] 放宽语法可能接受更多模型输出 -> Mitigation: 只接受有明确上下文锚点的形式，不接受无上下文纯新增。
