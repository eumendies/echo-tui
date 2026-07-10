## 1. MCP 配置与依赖

- [x] 1.1 在 `package.json` 中新增官方 MCP SDK 依赖，并确认 CommonJS 编译输出可加载。
- [x] 1.2 新增 MCP 配置类型，覆盖全局 enabled、stdio/http server、timeout、headers/env/cwd 和 approval 策略。
- [x] 1.3 扩展用户级配置读取，解析 `mcp.servers`，未配置时返回空 MCP 配置。
- [x] 1.4 对单个 server 配置错误生成 server 级诊断，不影响其他 server 和 LLM 配置读取。

## 2. MCP client 与 manager

- [x] 2.1 新增 MCP client 封装，支持 stdio transport 的 initialize、tools/list、tools/call 和 close。
- [x] 2.2 新增 MCP client 封装，支持 http transport 的 initialize、tools/list、tools/call 和 close。
- [x] 2.3 实现 timeout、错误归一化和敏感 headers/token 脱敏。
- [x] 2.4 实现 McpManager，统一 bootstrap enabled servers，保存成功 clients、tool 映射和失败诊断。
- [x] 2.5 实现 app 退出时关闭所有 MCP clients/transports，关闭失败不阻止 terminal cleanup。

## 3. MCP tool registry adapter

- [x] 3.1 实现 MCP tool name namespace 与反查映射，例如 `mcp__server__tool`。
- [x] 3.2 将 MCP `tools/list` 结果转换为 provider-neutral `ToolDefinition`。
- [x] 3.3 实现 MCP `ToolHandler`，把 executor 参数代理到对应 server 的原始 MCP tool。
- [x] 3.4 将 MCP text/rich/error result 转换为现有 `ToolExecutionResult` 文本结果。
- [x] 3.5 实现内置 registry 与已初始化 MCP registry 的合并，normal mode 暴露 MCP tools，plan mode 默认不暴露。

## 4. App 启动期初始化与 UI gate

- [x] 4.1 在 app runtime 中新增独立 MCP/bootstrap readiness 状态，不复用 assistant responding lock。
- [x] 4.2 在 TUI 首屏渲染后启动 MCP bootstrap，并在初始化期间显示 initializing 状态。
- [x] 4.3 初始化期间允许 composer 编辑、退出和 resize，但阻止 Enter 提交、slash command 启动和 Tab mode 切换。
- [x] 4.4 初始化完成后进入 ready 状态，允许提交初始化期间已输入的内容。
- [x] 4.5 初始化存在失败 server 时显示 transient 诊断 surface，且不追加或持久化 transcript record。

## 5. Agent loop 与 provider 工具暴露

- [x] 5.1 将已 bootstrap 的 McpManager 注入 agent loop 的 registry 创建路径。
- [x] 5.2 确保 OpenAI Responses、OpenAI Chat 和 Anthropic 请求在 normal mode 中包含已初始化 MCP tool schema。
- [x] 5.3 确保 provider 请求不包含初始化失败 server 的 MCP tools。
- [x] 5.4 确保 `/context` 的 Tools breakdown 自然计入 MCP tool definitions 和 MCP tool 历史。

## 6. MCP tool 审批与安全边界

- [x] 6.1 扩展 tool risk classifier，识别 MCP namespace tool 并按 server approval 策略分类。
- [x] 6.2 MCP tools 默认触发授权；`approval: "never"` 的 server 跳过授权。
- [x] 6.3 扩展 approval preview，展示 MCP server 名、原始 tool 名和参数摘要。
- [x] 6.4 用户拒绝 MCP tool 时不调用 MCP server，并返回可 continuation 的拒绝 tool result。
- [x] 6.5 确保 plan mode 下 MCP tools 不进入 registry，也不能绕过只读边界。

## 7. 测试与验证

- [x] 7.1 添加 MCP 配置解析测试，覆盖 stdio、http、disabled、无效配置和默认值。
- [x] 7.2 添加 MCP manager/client adapter 测试，使用 fake transport/client 覆盖成功初始化、失败降级、tools/list 和 tools/call。
- [x] 7.3 添加 registry 合并和 MCP tool handler 测试，覆盖 namespace、result 转换和未注册失败。
- [x] 7.4 添加 app 启动期 bootstrap 测试，覆盖 initializing gate、初始化完成后提交、失败诊断不进 transcript。
- [x] 7.5 添加 agent loop/provider 请求测试，覆盖 normal mode 暴露 MCP tools、plan mode 不暴露 MCP tools。
- [x] 7.6 添加 approval 测试，覆盖 MCP 默认审批、trusted server 跳过审批和拒绝不执行。
- [x] 7.7 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
