## MODIFIED Requirements

### Requirement: local tool registry and execution boundary
系统 SHALL 提供 provider-neutral 的本地工具执行边界。该边界 SHALL 支持工具定义、工具 handler、工具 registry 和工具 executor，并 SHALL 让 agent adapter 可以按工具名称执行已注册工具而不依赖具体工具实现细节。该边界 SHALL 支持合并内置工具 registry 与启动期成功初始化的 MCP tool registry；未注册或初始化失败的工具 SHALL 继续返回失败结果而不是中断 app。

#### Scenario: 注册工具定义和 handler
- **WHEN** 系统创建本地 tool registry
- **THEN** registry SHALL 能按工具名称保存 tool definition 和对应 handler
- **THEN** registry SHALL 能向 agent adapter 暴露可发送给 provider 的工具定义列表

#### Scenario: 合并 MCP tool registry
- **WHEN** MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** normal mode 默认 tool registry SHALL 包含内置工具和这些 MCP tools
- **THEN** registry SHALL 能按 MCP namespace tool name 找到对应 MCP handler

#### Scenario: 按名称执行已注册工具
- **WHEN** tool executor 收到一个已注册工具名称和 JSON arguments 字符串
- **THEN** executor SHALL 找到对应 handler
- **THEN** executor SHALL 把解析后的参数交给 handler 执行
- **THEN** executor SHALL 返回结构化 tool execution result

#### Scenario: 未注册工具返回失败结果
- **WHEN** tool executor 收到未注册工具名称
- **THEN** executor SHALL 返回失败的 tool execution result
- **THEN** executor SHALL NOT 抛出未捕获异常中断 app

#### Scenario: arguments JSON 无效返回失败结果
- **WHEN** tool executor 收到无法解析为 JSON object 的 arguments 字符串
- **THEN** executor SHALL 返回失败的 tool execution result
- **THEN** 失败结果 SHALL 包含可回传模型的简洁错误说明

## ADDED Requirements

### Requirement: MCP tool handler
系统 SHALL 提供 MCP tool handler，用于把 provider-visible MCP namespace tool call 代理到对应 MCP server 的原始 tool。handler SHALL 接收现有 tool executor 解析出的 JSON object arguments，并 SHALL 返回现有 `ToolExecutionResult` 结构。

#### Scenario: MCP handler 调用对应 server tool
- **WHEN** MCP handler 收到 provider-visible tool name `mcp__server__tool`
- **THEN** handler SHALL 反查对应 MCP server 和原始 MCP tool name
- **THEN** handler SHALL 通过 MCP manager 调用该 server tool

#### Scenario: MCP handler 保留 call id 和 tool name
- **WHEN** MCP handler 返回 tool execution result
- **THEN** result SHALL 保留原始 provider tool call id
- **THEN** result SHALL 使用 provider-visible MCP namespace tool name 作为 `toolName`

#### Scenario: MCP handler 异常转失败结果
- **WHEN** MCP manager 调用抛出异常或返回不可用状态
- **THEN** handler SHALL 返回 `ok: false` 的 tool execution result
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app
