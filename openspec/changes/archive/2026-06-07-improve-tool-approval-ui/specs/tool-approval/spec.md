## MODIFIED Requirements

### Requirement: apply_patch 执行前授权
系统 SHALL 在执行本地 `apply_patch` 工具前请求用户授权。授权发生在 tool executor 调用具体 handler 之前；用户允许时 SHALL 执行本次工具调用，用户拒绝时 SHALL NOT 执行工具，并 SHALL 生成可回传模型的 tool result。授权请求的可见 UI SHALL 使用通用 choice surface 呈现，而不是普通 select command surface。

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

#### Scenario: 非 apply_patch 工具不触发第一版授权
- **WHEN** agent loop runtime 收到工具名不是 `apply_patch` 的 tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 因第一版授权拦截而请求用户选择

#### Scenario: apply_patch 授权选项保持简洁
- **WHEN** `apply_patch` 授权请求显示 choice surface
- **THEN** 选项列表 SHALL 包含 `Allow once` 和 `Deny`
- **THEN** 系统 SHALL NOT 为 `Allow once` 或 `Deny` 生成冗长的 option description
