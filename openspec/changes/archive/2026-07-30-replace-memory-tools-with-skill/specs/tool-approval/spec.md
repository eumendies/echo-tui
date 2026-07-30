## MODIFIED Requirements

### Requirement: apply_patch 执行前授权
在交互式 TUI 或默认单轮模式下，系统 SHALL 在执行本地 `apply_patch` 工具前请求用户授权。授权发生在 tool executor 调用具体 handler 之前；用户允许时 SHALL 执行本次工具调用，用户拒绝或提交反馈文本时 SHALL NOT 执行工具，并 SHALL 生成可回传模型的 tool result。MCP tools SHALL 根据 server 审批策略复用同一授权流程：默认执行前授权，显式信任的 server 可跳过授权。通过 `run_bash_command` 执行的 agent memory skill 脚本 SHALL NOT 获得 memory 专属审批分类，只按现有通用 bash 风险规则处理。`echo-tui --once --full-access` 是显式非交互例外：对当前单轮中被风险分类为 approval-required 的已注册工具 SHALL 自动允许，不得等待 UI。

#### Scenario: apply_patch 执行前请求授权
- **WHEN** 交互式 TUI 或默认单轮 agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 系统 SHALL 在调用 tool executor 执行该 tool call 前请求用户授权
- **THEN** 交互式 TUI SHALL 使用通用 choice surface 显示该授权请求
- **THEN** 默认单轮模式 SHALL 返回非交互失败结果而不是等待 surface 输入

#### Scenario: Memory skill 脚本不触发专属授权
- **WHEN** normal mode 下 `run_bash_command` 执行未命中通用高风险规则的 `agent-memory` 脚本命令
- **THEN** classifier SHALL 按普通安全 bash 命令处理
- **THEN** 系统 SHALL NOT 因命令读取或修改 memory 而打开专属审批 surface

#### Scenario: MCP tool 默认执行前请求授权
- **WHEN** 交互式 TUI 或默认单轮 agent loop runtime 收到未显式信任 server 的 MCP tool call
- **THEN** 交互式 TUI SHALL 在调用 MCP server 前请求用户授权
- **THEN** 默认单轮模式 SHALL 生成失败 tool result 而不是等待用户选择

#### Scenario: 用户允许本次执行
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户选择 `Allow once`
- **THEN** 系统 SHALL 执行该次 tool call
- **THEN** 系统 SHALL 将真实工具执行结果作为对应的 tool result 回传给模型

#### Scenario: 用户拒绝本次执行
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户选择 `Deny` 或按下 Esc
- **THEN** 系统 SHALL NOT 执行该次 tool call
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 tool result SHALL 保留原始 tool call id 和 tool name
- **THEN** 该 tool result 文本 SHALL 明确说明用户拒绝执行该工具

#### Scenario: 用户提供反馈文本
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户通过 `Tell model what to do` 提交非空文本
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
- **THEN** 系统 SHALL NOT 因 apply_patch 或 MCP 授权能力而请求用户选择

#### Scenario: 非 bash 授权选项保持简洁
- **WHEN** `apply_patch` 授权请求显示 choice surface
- **THEN** 选项列表 SHALL 包含 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`
- **THEN** 系统 SHALL NOT 为 `Allow once` 或 `Deny` 生成冗长的 option description

#### Scenario: full-access 自动允许 approval-required 工具
- **WHEN** 用户使用 `echo-tui --once --full-access <prompt>` 且 agent 请求 approval-required 的已注册工具
- **THEN** 系统 SHALL NOT 打开 TUI approval surface 或等待 stdin
- **THEN** 系统 SHALL 直接执行该工具并把真实结果回传给模型
- **THEN** 该自动允许策略 SHALL 只影响当前单轮运行

#### Scenario: full-access 不改变普通 TUI 授权
- **WHEN** 用户未使用 `echo-tui --once --full-access` 而在普通 TUI 中请求 approval-required 工具
- **THEN** 系统 SHALL 继续使用现有 choice surface、结构化授权决策和会话授权缓存
