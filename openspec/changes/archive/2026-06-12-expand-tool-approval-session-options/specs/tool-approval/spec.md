## ADDED Requirements

### Requirement: 工具授权会话级允许选项
工具授权 choice surface SHALL 提供会话级允许选项。所有 allow 选项 SHALL 在选项列表中连续排列，并 SHALL 出现在 `Deny` 和 `Tell model what to do` 之前。`ToolApprovalContext` SHALL 持有当前 CLI 进程会话内的授权缓存；会话级允许选项 SHALL 只影响当前 CLI 进程会话，SHALL NOT 写入 transcript、持久化 session 或用户配置。

#### Scenario: 显示 allow 选项分组
- **WHEN** tool approval 请求处于活跃状态
- **THEN** choice surface SHALL 依次显示 `Allow once`、一个会话级 allow 选项、`Allow all tools for this session`
- **THEN** `Deny` SHALL 显示在所有 allow 选项之后
- **THEN** `Tell model what to do` SHALL 继续显示为支持内联文本输入的 option

#### Scenario: 非 bash 工具显示 tool 级授权
- **WHEN** `apply_patch` 或其他非 `run_bash_command` 的 tool approval 请求处于活跃状态
- **THEN** 会话级 allow 选项 SHALL 使用当前 tool name 表达 `Allow <toolName> for this session`
- **THEN** 用户选择该选项 SHALL 生成允许当前会话内同名工具的结构化授权决策

#### Scenario: bash 工具显示 command 级授权
- **WHEN** `run_bash_command` tool approval 请求处于活跃状态
- **THEN** 会话级 allow 选项 SHALL 显示为 `Allow this command for this session`
- **THEN** 用户选择该选项 SHALL 生成只允许当前 bash command 文本的结构化授权决策

#### Scenario: 允许所有工具的会话级授权
- **WHEN** tool approval 请求处于活跃状态
- **AND** 用户选择 `Allow all tools for this session`
- **THEN** 系统 SHALL 生成允许当前会话内所有后续需审批工具调用的结构化授权决策

#### Scenario: 命中会话授权时不打开 surface
- **WHEN** `ToolApprovalContext` 收到 tool approval 请求
- **AND** 该请求命中当前 CLI 进程会话内已有授权缓存
- **THEN** `ToolApprovalContext` SHALL 立即返回允许执行的结构化授权决策
- **THEN** TUI SHALL NOT 打开 tool approval choice surface

## MODIFIED Requirements

### Requirement: 工具授权决策模型
系统 SHALL 使用结构化工具授权决策表示用户选择。决策模型 SHALL 支持允许本次执行、拒绝本次执行、提供文本反馈、允许当前会话内同名非 bash 工具、允许当前会话内同一 bash command，以及允许当前会话内所有需审批工具调用。系统 SHALL NOT 依赖 boolean 作为唯一授权协议。

#### Scenario: 允许本次执行决策
- **WHEN** 用户选择允许当前工具调用
- **THEN** 系统 SHALL 将该选择表示为允许本次执行的结构化决策
- **THEN** agent loop runtime SHALL 根据该决策继续执行原始 tool call

#### Scenario: 拒绝本次执行决策
- **WHEN** 用户选择拒绝当前工具调用或按 Esc
- **THEN** 系统 SHALL 将该选择表示为拒绝执行的结构化决策
- **THEN** agent loop runtime SHALL 根据该决策跳过原始 tool call 执行并创建拒绝 tool result

#### Scenario: 提供文本反馈决策
- **WHEN** 用户在工具授权请求中提交非空反馈文本
- **THEN** 系统 SHALL 将该选择表示为 `provide_feedback` 结构化决策
- **THEN** 该决策 SHALL 包含用户输入的反馈 message
- **THEN** agent loop runtime SHALL 根据该决策跳过原始 tool call 执行并创建反馈 tool result

#### Scenario: 允许同名非 bash 工具的会话级决策
- **WHEN** 用户选择允许当前会话内同名非 bash 工具调用
- **THEN** 系统 SHALL 将该选择表示为包含 tool name 的结构化决策
- **THEN** `ToolApprovalContext` SHALL 能够基于该 tool name 复用本会话授权

#### Scenario: 允许同一 bash command 的会话级决策
- **WHEN** 用户选择允许当前会话内同一 bash command
- **THEN** 系统 SHALL 将该选择表示为包含 `run_bash_command` 和 command 文本的结构化决策
- **THEN** `ToolApprovalContext` SHALL 能够基于该 command 文本复用本会话授权

#### Scenario: 允许所有需审批工具的会话级决策
- **WHEN** 用户选择允许当前会话内所有需审批工具调用
- **THEN** 系统 SHALL 将该选择表示为允许所有工具的结构化决策
- **THEN** `ToolApprovalContext` SHALL 能够基于该决策复用本会话授权

### Requirement: 工具授权文本反馈选项
工具授权 choice surface SHALL 提供 `Tell model what to do` 选项，允许用户在同一个授权面板内输入反馈文本并回传给模型。该反馈 SHALL 使用结构化 `provide_feedback` 决策表达。

#### Scenario: 显示文本反馈选项
- **WHEN** tool approval 请求处于活跃状态
- **THEN** choice surface SHALL 显示 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do` 选项
- **THEN** `Tell model what to do` SHALL 是支持内联文本输入的 option

#### Scenario: 提交文本反馈
- **WHEN** tool approval 请求处于活跃状态
- **AND** 用户选中 `Tell model what to do`
- **AND** 用户输入非空文本并按 Enter
- **THEN** 系统 SHALL NOT 执行原始 tool call
- **THEN** 系统 SHALL 生成 `provide_feedback` 授权决策
- **THEN** 该决策的 message SHALL 等于用户输入文本

#### Scenario: 文本反馈不包含系统风险原因
- **WHEN** 高危工具授权 UI 显示了系统风险原因
- **AND** 用户通过 `Tell model what to do` 提交反馈文本
- **THEN** 回传给模型的反馈 SHALL 只包含用户输入文本
- **THEN** 回传给模型的反馈 SHALL NOT 自动包含系统风险分类原因
