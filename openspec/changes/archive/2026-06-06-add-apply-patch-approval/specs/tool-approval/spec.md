## ADDED Requirements

### Requirement: apply_patch 执行前授权
系统 SHALL 在执行本地 `apply_patch` 工具前请求用户授权。授权发生在 tool executor 调用具体 handler 之前；用户允许时 SHALL 执行本次工具调用，用户拒绝时 SHALL NOT 执行工具，并 SHALL 生成可回传模型的 tool result。

#### Scenario: apply_patch 执行前请求授权
- **WHEN** agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 系统 SHALL 在调用 tool executor 执行该 tool call 前请求用户授权
- **THEN** 系统 SHALL 在用户作出授权决策前暂停该 tool call 的执行

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

### Requirement: 工具授权决策模型
系统 SHALL 使用结构化工具授权决策表示用户选择。第一版 SHALL 支持允许本次执行和拒绝本次执行两种决策，并 SHALL 保留扩展到本会话授权、所有工具授权和用户反馈文本的协议空间。

#### Scenario: 允许本次执行决策
- **WHEN** 用户选择允许当前 `apply_patch` 工具调用
- **THEN** 系统 SHALL 将该选择表示为允许本次执行的结构化决策
- **THEN** agent loop runtime SHALL 根据该决策继续执行原始 tool call

#### Scenario: 拒绝本次执行决策
- **WHEN** 用户选择拒绝当前 `apply_patch` 工具调用或按 Esc
- **THEN** 系统 SHALL 将该选择表示为拒绝执行的结构化决策
- **THEN** agent loop runtime SHALL 根据该决策跳过原始 tool call 执行并创建拒绝 tool result

#### Scenario: 决策模型保留扩展空间
- **WHEN** 后续版本增加本会话允许某工具、本会话允许所有工具或输入反馈给模型
- **THEN** 系统 SHALL 能在工具授权决策模型中表达这些新增决策
- **THEN** 第一版实现 SHALL NOT 依赖 boolean 作为唯一授权协议

