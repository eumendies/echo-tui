## 1. MCP 配置草稿与保存

- [x] 1.1 在 MCP 配置模块中新增面向 UI 的草稿读取能力，返回全局 enabled、所有 server enabled 状态、transport 摘要、valid/invalid 诊断，并保留 disabled server。
- [x] 1.2 新增 MCP enabled 状态保存能力，原子写回 `~/.echo/config.json`，只修改 `mcp.enabled` 和 `mcp.servers.<name>.enabled`，保留其它字段。
- [x] 1.3 为 MCP 草稿读取、invalid/disabled server 保留、未知字段保留和原子写回补充单元测试。

## 2. MCP manager reload

- [x] 2.1 为 `McpManager` 新增 reload 能力，按最新配置关闭当前 active clients、清空 tool name 状态并重新 bootstrap enabled servers。
- [x] 2.2 确保 reload diagnostics 反映最近一次 reload/bootstrap 结果，且 `listTools()` 基于 reload 后 server 集合。
- [x] 2.3 为禁用 server、启用 server、全局关闭和 reload 失败诊断补充 manager 级单元测试。

## 3. CommandHost MCP facade

- [x] 3.1 扩展 command 类型，定义 MCP server info、MCP save result、MCP command surface 和 `CommandHost.mcp` 能力。
- [x] 3.2 在 `createCommandHost` 中实现 `listServers()` 与 `saveServerStates()`，通过配置模块和 `McpManager.reload()` 完成保存与重载，并清理 context usage。
- [x] 3.3 将 app 装配根中的 `mcpManager` 传入 command host，同时保持 command runtime 不新增 MCP 业务 effect 分支。

## 4. /mcp command 与 surface

- [x] 4.1 新增 `/mcp` command handler，支持 start、Up/Down、Space、Enter 保存和 Esc 取消，并注册到默认 slash command handlers。
- [x] 4.2 新增 MCP footer surface renderer，展示全局行、server 行、on/off pill、enabled 计数、transport/tool/diagnostic 摘要和操作提示。
- [x] 4.3 将 MCP surface 接入 command surface renderer，保证 resize、footer 裁剪和 transient UI 语义与现有 command surfaces 一致。
- [x] 4.4 为 `/mcp` handler 状态机、默认命令注册和 renderer 关键输出补充测试。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck` 并修复类型错误。
- [x] 5.2 运行 `npm test` 并修复失败测试。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;` 并修复语法问题。
- [ ] 5.4 手动验证 `/mcp` 打开、移动、切换、保存、取消、reload 诊断、resize 和普通问答后续 MCP tool 生效路径。
