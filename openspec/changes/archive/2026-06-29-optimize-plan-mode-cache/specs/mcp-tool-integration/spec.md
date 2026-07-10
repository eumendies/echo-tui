## MODIFIED Requirements

### Requirement: MCP tools 暴露为 provider tools
系统 SHALL 将成功初始化的 MCP server 返回的 tools 转换为 provider-neutral `ToolDefinition` 并加入 provider-visible tool registry。MCP tool 名称 SHALL 包含 server namespace，以避免不同 MCP servers 之间或与内置工具之间发生名称冲突。Plan mode SHALL 保持 MCP tool definitions 的 provider 可见性以稳定 tools schema，但 SHALL 在执行前拒绝 MCP tool call。

#### Scenario: MCP tool 使用 namespace 名称
- **WHEN** MCP server `docs` 返回名为 `search` 的 tool
- **THEN** provider-visible tool name SHALL 使用 `mcp__docs__search` 或等价 namespace 格式
- **THEN** 系统 SHALL 能根据 provider-visible name 反查原始 server 和 MCP tool 名

#### Scenario: MCP tool schema 转换为 ToolDefinition
- **WHEN** MCP server 成功返回 tool 的名称、描述和 input schema
- **THEN** 系统 SHALL 创建对应的 provider-neutral `ToolDefinition`
- **THEN** 该 definition SHALL 保留 MCP tool 的描述和参数 schema 语义

#### Scenario: 只注册成功初始化 server 的 tools
- **WHEN** MCP bootstrap 中部分 servers 成功、部分 servers 失败
- **THEN** registry SHALL 只包含成功 servers 的 MCP tools
- **THEN** provider request SHALL NOT 包含失败 servers 的 MCP tool definitions

#### Scenario: plan mode 保持 MCP tools schema 可见
- **WHEN** 当前 interaction mode 为 plan
- **AND** MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** provider-visible tool registry SHALL 包含这些 MCP tool definitions
- **THEN** provider-visible MCP tool definitions SHALL 与 normal mode 在相同 MCP 状态下保持一致

#### Scenario: plan mode 拒绝 MCP tool 执行
- **WHEN** 当前 interaction mode 为 plan
- **AND** provider 调用任意 MCP namespace tool
- **THEN** classifier SHALL 将该 MCP tool call 判定为 rejected
- **AND** 系统 SHALL NOT 调用对应 MCP server
- **AND** runtime SHALL 返回 `ok: false` 的 tool result，说明 MCP tools 在 plan mode 不可执行
