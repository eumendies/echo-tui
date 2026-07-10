## ADDED Requirements

### Requirement: 工具授权文本反馈选项
工具授权 choice surface SHALL 提供 `Tell model what to do` 选项，允许用户在同一个授权面板内输入反馈文本并回传给模型。该反馈 SHALL 使用结构化 `provide_feedback` 决策表达。

#### Scenario: 显示文本反馈选项
- **WHEN** tool approval 请求处于活跃状态
- **THEN** choice surface SHALL 显示 `Allow once`、`Deny` 和 `Tell model what to do` 三个选项
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

## MODIFIED Requirements

### Requirement: apply_patch 执行前授权
系统 SHALL 在执行本地 `apply_patch` 工具前请求用户授权。授权发生在 tool executor 调用具体 handler 之前；用户允许时 SHALL 执行本次工具调用，用户拒绝或提交反馈文本时 SHALL NOT 执行工具，并 SHALL 生成可回传模型的 tool result。授权请求的可见 UI SHALL 使用通用 choice surface 呈现，而不是普通 select command surface。

#### Scenario: apply_patch 执行前请求授权
- **WHEN** agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 系统 SHALL 在调用 tool executor 执行该 tool call 前请求用户授权
- **THEN** 系统 SHALL 在用户作出授权决策前暂停该 tool call 的执行
- **THEN** TUI SHALL 使用通用 choice surface 显示该授权请求

#### Scenario: 用户允许本次执行
- **WHEN** `apply_patch` 授权请求处于活跃状态且用户选择 `Allow once`
- **THEN** 系统 SHALL 执行该次 `apply_patch` tool call
- **THEN** 系统 SHALL 将真实工具执行结果作为对应的 tool result 回传给模型

#### Scenario: 用户拒绝本次执行
- **WHEN** `apply_patch` 授权请求处于活跃状态且用户选择 `Deny` 或按下 Esc
- **THEN** 系统 SHALL NOT 执行该次 `apply_patch` tool call
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 tool result SHALL 保留原始 tool call id 和 tool name
- **THEN** 该 tool result 文本 SHALL 明确说明用户拒绝执行该工具

#### Scenario: 用户提供反馈文本
- **WHEN** `apply_patch` 授权请求处于活跃状态且用户通过 `Tell model what to do` 提交非空文本
- **THEN** 系统 SHALL NOT 执行该次 `apply_patch` tool call
- **THEN** 系统 SHALL 生成可回传模型的失败 tool result
- **THEN** 该 tool result 文本 SHALL 包含用户输入的反馈文本

#### Scenario: 非 apply_patch 工具不触发第一版授权
- **WHEN** agent loop runtime 收到不需要风险分类授权的 tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 因 apply_patch 授权能力而请求用户选择

#### Scenario: apply_patch 授权选项保持简洁
- **WHEN** `apply_patch` 授权请求显示 choice surface
- **THEN** 选项列表 SHALL 包含 `Allow once`、`Deny` 和 `Tell model what to do`
- **THEN** 系统 SHALL NOT 为 `Allow once` 或 `Deny` 生成冗长的 option description
