## MODIFIED Requirements

### Requirement: apply_patch 执行前授权
系统 SHALL 在执行本地 `apply_patch`、`add_memory`、`update_memory` 和 `remove_memory` 工具前请求用户授权。授权发生在 tool executor 调用具体 handler 之前；用户允许时 SHALL 执行本次工具调用，用户拒绝或提交反馈文本时 SHALL NOT 执行工具，并 SHALL 生成可回传模型的 tool result。授权请求的可见 UI SHALL 使用通用 choice surface 呈现，而不是普通 select command surface。MCP tools SHALL 根据 server 审批策略复用同一授权流程：默认执行前授权，显式信任的 server 可跳过授权。只读 `read_memory` SHALL 不因 memory mutation 审批规则触发授权。

#### Scenario: apply_patch 执行前请求授权
- **WHEN** agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 系统 SHALL 在调用 tool executor 执行该 tool call 前请求用户授权
- **THEN** 系统 SHALL 在用户作出授权决策前暂停该 tool call 的执行
- **THEN** TUI SHALL 使用通用 choice surface 显示该授权请求

#### Scenario: Memory mutation 执行前请求授权
- **WHEN** agent loop runtime 收到 `add_memory`、`update_memory` 或 `remove_memory` tool call
- **THEN** 系统 SHALL 在执行持久 memory mutation 前请求用户授权
- **THEN** 授权 preview SHALL 显示 user/agent 类型、目标 catalog/item 和将写入或删除的内容摘要
- **THEN** global scope agent memory mutation SHALL 明确显示其全局影响

#### Scenario: read_memory 不请求 mutation 授权
- **WHEN** agent loop runtime 收到有效 `read_memory` tool call
- **THEN** 系统 SHALL 按普通只读工具流程执行
- **THEN** 系统 SHALL NOT 因 memory mutation 审批规则请求用户选择

#### Scenario: MCP tool 默认执行前请求授权
- **WHEN** agent loop runtime 收到未显式信任 server 的 MCP tool call
- **THEN** 系统 SHALL 在调用 MCP server 前请求用户授权
- **THEN** 系统 SHALL 在用户作出授权决策前暂停该 tool call 的执行
- **THEN** TUI SHALL 使用通用 choice surface 显示该授权请求

#### Scenario: 用户允许本次执行
- **WHEN** `apply_patch`、memory mutation 或 MCP tool 授权请求处于活跃状态且用户选择 `Allow once`
- **THEN** 系统 SHALL 执行该次 tool call
- **THEN** 系统 SHALL 将真实工具执行结果作为对应的 tool result 回传给模型

#### Scenario: 用户拒绝本次执行
- **WHEN** `apply_patch`、memory mutation 或 MCP tool 授权请求处于活跃状态且用户选择 `Deny` 或按下 Esc
- **THEN** 系统 SHALL NOT 执行该次 tool call
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 tool result SHALL 保留原始 tool call id 和 tool name
- **THEN** 该 tool result 文本 SHALL 明确说明用户拒绝执行该工具

#### Scenario: 用户提供反馈文本
- **WHEN** `apply_patch`、memory mutation 或 MCP tool 授权请求处于活跃状态且用户通过 `Tell model what to do` 提交非空文本
- **THEN** 系统 SHALL NOT 执行该次 tool call
- **THEN** 系统 SHALL 生成可回传模型的失败 tool result
- **THEN** 该 tool result 文本 SHALL 包含用户输入的反馈文本

#### Scenario: 受信任 MCP tool 不触发授权
- **WHEN** agent loop runtime 收到显式信任 server 的 MCP tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 为该 MCP tool call 请求用户选择

#### Scenario: 不需要风险分类授权的工具不触发授权
- **WHEN** agent loop runtime 收到不需要风险分类授权的 tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 因 apply_patch、memory mutation 或 MCP 授权能力而请求用户选择

#### Scenario: 非 bash 授权选项保持简洁
- **WHEN** `apply_patch` 或 memory mutation 授权请求显示 choice surface
- **THEN** 选项列表 SHALL 包含 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`
- **THEN** 系统 SHALL NOT 为 `Allow once` 或 `Deny` 生成冗长的 option description

