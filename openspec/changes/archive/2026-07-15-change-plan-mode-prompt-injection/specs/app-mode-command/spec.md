## ADDED Requirements

### Requirement: Mode transitions are injected through user messages
系统 SHALL 将模型可见的 normal/plan mode 切换说明注入到切换后第一条提交给 agent 的 user message，而不是在每次 provider 请求中动态追加 mode suffix。进入 plan 和退出 plan SHALL 都生成对应方向的切换说明；同一模型可见 mode 下的后续 user message SHALL NOT 重复注入 mode prompt。

#### Scenario: First agent message enters plan mode
- **WHEN** 上一条提交给 agent 的 user message 使用 normal mode
- **AND** 用户通过 Tab 或 `/mode plan` 切换到 plan 后提交下一条 agent user message
- **THEN** 该 user record 的 provider-facing text SHALL 包含 normal 到 plan 的模式切换说明
- **AND** 该 text SHALL 包含只读规划约束和用户本次请求原文
- **AND** provider runtime context SHALL NOT 另外追加 plan mode suffix

#### Scenario: First agent message returns to normal mode
- **WHEN** 上一条提交给 agent 的 user message 使用 plan mode
- **AND** 用户切换到 normal 后提交下一条 agent user message
- **THEN** 该 user record 的 provider-facing text SHALL 包含 plan 到 normal 的模式切换说明
- **AND** 该说明 SHALL 明确此前 Plan Mode 限制已解除
- **AND** 该说明 SHALL 允许模型在正常工具审批和风险策略内实施修改

#### Scenario: Same mode does not repeat mode prompt
- **WHEN** 当前提交给 agent 的 user message 与上一条 agent user message 都使用 plan mode或都使用 normal mode
- **THEN** 系统 SHALL NOT 向该 user record 重复注入 mode transition 或 mode instructions
- **AND** user record 的 provider-facing text SHALL 沿用普通用户请求内容

#### Scenario: Multiple UI switches collapse to the effective model-visible mode
- **WHEN** 用户在两次 agent user message 之间多次切换 interaction mode
- **AND** 提交时的 normal/plan mode 与上一条 agent user message 的 mode 相同
- **THEN** 系统 SHALL NOT 因中间未发送给模型的 mode 变化生成 transition prompt

#### Scenario: Shell commands do not advance the model-visible mode
- **WHEN** 用户在 shell 或 shell-local mode 执行本地命令但未提交 agent user message
- **THEN** 系统 SHALL NOT 更新上一条模型可见 normal/plan mode
- **AND** 后续 agent user message SHALL 继续相对最后一条真实 agent user message 判断是否发生 mode 切换

### Requirement: Mode prompt is hidden from normal transcript rendering
系统 SHALL 使用同一 user record 分别保存 provider-facing mode prompt 和用户可见原文。发生 mode 切换时，record text SHALL 包含模式说明和用户请求，`displayText` SHALL 保留用户原文，输入历史 SHALL 保留原始 composer 输入；系统 SHALL NOT 为模式切换追加独立可见 transcript record。

#### Scenario: Render switched-mode user message
- **WHEN** mode 切换后的 user record 包含内部 mode prompt 和 `displayText`
- **THEN** transcript renderer SHALL 只展示 `displayText` 中的用户原文
- **AND** renderer SHALL NOT 展示 mode transition 或 mode instructions 正文

#### Scenario: Browse input history after switched-mode submission
- **WHEN** 用户提交了一条携带隐藏 mode prompt 的 user message后浏览输入历史
- **THEN** composer SHALL 恢复用户原始输入
- **AND** composer SHALL NOT 恢复内部 mode prompt

#### Scenario: Resume preserves provider and display projections
- **WHEN** 用户恢复包含 mode transition user record 的 session
- **THEN** 后续 provider 请求 SHALL 使用该 record 的完整 provider-facing text
- **AND** transcript 重绘 SHALL 继续只展示该 record 的 `displayText`

### Requirement: Todo runtime suffix remains independent from mode injection
系统 SHALL 继续通过 runtime context suffix 向 provider 提供当前 open todo 状态。移除动态 plan suffix SHALL NOT 移除、持久化或并入 user message 的 todo runtime context。

#### Scenario: Plan transition and open todos coexist
- **WHEN** 一条 user message 携带 normal 到 plan 的 mode transition
- **AND** 当前存在 open todo items
- **THEN** provider input SHALL 从该 user record 获得 mode transition 和 Plan Mode instructions
- **AND** provider input SHALL 继续从 runtime suffix 获得当前 open todo 状态
- **AND** runtime suffix SHALL NOT 包含额外 mode section

#### Scenario: No mode transition with open todos
- **WHEN** 当前 user message 未发生模型可见 mode 切换
- **AND** 当前存在 open todo items
- **THEN** provider input SHALL 继续包含 todo runtime suffix
- **AND** 系统 SHALL NOT 因 todo suffix 重复注入 mode prompt

### Requirement: Plan tool restrictions remain runtime-enforced
系统 SHALL 继续根据当前 agent session 的 interaction mode 对工具调用执行风险分类。把 Plan Mode prompt 移入 user message SHALL NOT 允许 plan mode 下执行文件写入、变更命令或受限 MCP 工具。

#### Scenario: Reject write tool after plan transition
- **WHEN** 当前 agent session 为 plan mode
- **AND** 模型调用 `apply_patch` 或其他被 plan mode 禁止的写工具
- **THEN** runtime SHALL 拒绝该工具调用
- **AND** runtime SHALL NOT 因 mode prompt 已进入 transcript 而请求普通写入审批或执行变更

#### Scenario: Allow normal tool policy after returning to normal
- **WHEN** 当前 agent session 已切回 normal mode
- **AND** 模型调用正常模式下可用的写工具
- **THEN** runtime SHALL 按正常风险分类和审批规则处理该工具调用
- **AND** runtime SHALL NOT 沿用上一轮 plan mode 的工具拒绝策略
