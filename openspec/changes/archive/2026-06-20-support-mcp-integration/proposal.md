## Why

当前 echo_tui 只能使用内置工具集合，无法复用用户已有的 MCP server 生态能力。支持 MCP 后，用户可以通过配置接入本地或远端工具服务，让模型在保持现有 TUI、审批和 transcript 语义的基础上使用更多外部工具。

## What Changes

- 新增 MCP client 能力，支持从用户配置读取 MCP servers 并在 TUI 启动后统一初始化。
- 支持 `stdio` 和 `http` 两类 MCP transport；成功初始化的 server 会把 MCP tools 暴露为 provider-visible tools。
- MCP tool 名称使用 server namespace，避免不同 server 的 tool 名冲突。
- MCP server 初始化失败时展示错误诊断，但不注册该 server 的 tools，用户仍可正常问答。
- MCP tools 默认需要用户审批；配置可显式信任 server 以跳过审批。
- plan mode 默认不暴露 MCP tools，避免绕过只读边界。
- 新增 MCP 启动期初始化状态：TUI 可见、可退出和 resize，但初始化完成前不能提交问答。
- 引入官方 MCP SDK 作为协议客户端依赖。

## Capabilities

### New Capabilities
- `mcp-tool-integration`: 定义 MCP server 配置、启动期初始化、tool discovery、tool 调用代理、安全审批和 plan mode 边界。

### Modified Capabilities
- `streaming-llm-service-adapter`: agent loop 的 provider-visible tool registry 将包含成功初始化的 MCP tools，且 tool call continuation 需要支持 MCP tool result。
- `local-tool-execution`: 工具执行与风险分类需要识别 MCP tools，默认走审批策略并代理到 MCP server。
- `terminal-tui-prototype`: TUI 启动后需要展示 MCP 初始化状态，并在初始化完成前阻止用户提交问答；初始化失败诊断应可见但不污染 transcript。
- `tool-approval`: 工具授权 surface 需要覆盖 MCP tool 调用，并展示可读的 MCP server/tool 预览。
- `typescript-build-test-pipeline`: 项目需要新增 MCP SDK 依赖并保持 typecheck、build、test 和 JavaScript 语法检查通过。

## Impact

- 配置读取：扩展用户级配置解析，新增 `mcp.servers` 配置 schema。
- App 编排：新增启动期 MCP bootstrap 状态和输入 gate，初始化完成后将成功 server 的 tools 提供给 agent runtime。
- 工具系统：新增 MCP manager/client/tool adapter，合并内置 registry 与 MCP registry。
- Provider adapter：复用现有 tool definition 转换路径，无需为每个 provider 单独实现 MCP 协议。
- 安全：扩展 tool risk classifier 和 approval preview，MCP tools 默认需要审批。
- 依赖：新增官方 MCP SDK。
- 测试：新增配置解析、MCP bootstrap、registry 合并、tool 调用代理、初始化失败降级、approval 和 plan mode 边界测试。
