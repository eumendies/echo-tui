## Why

当前 MCP server 只能通过手动编辑 `~/.echo/config.json` 启停，用户无法在 TUI 内像 `/skills` 一样直观看到已配置 server 的状态并快速切换。新增 `/mcp` 命令可以把 MCP enablement 管理纳入现有 slash command 体系，降低配置试错成本，并让启停在当前会话内立即影响后续 agent tool 暴露。

## What Changes

- 新增 `/mcp` slash command，用类似 `/skills` 的交互面板展示 MCP 全局开关和已配置 servers。
- 支持通过键盘移动选择、Space 切换 enabled 状态、Enter 保存、Esc 取消。
- 保存时更新 `~/.echo/config.json` 中的 `mcp.enabled` 和 `mcp.servers.<name>.enabled`，并保留其它配置字段。
- 保存后重载 MCP manager，使启用/禁用结果对下一轮 assistant request 的 MCP tools 暴露立即生效。
- 在 `/mcp` 面板中展示 server transport、配置有效性、已加载 tool 数或诊断摘要。
- 不在第一版中支持新增、删除或编辑 MCP server 的 command/url/env/header/approval/timeout 等配置细节。

## Capabilities

### New Capabilities
- `interactive-mcp-command`: 定义 `/mcp` 交互式 MCP 管理命令的外部行为，包括展示、启停、保存、取消和诊断反馈。

### Modified Capabilities
- `mcp-tool-integration`: 增加运行时 MCP reload 行为，确保 `/mcp` 保存后的 enabled 状态影响后续 MCP tool 暴露和生命周期。
- `command-host-runtime`: 增加 command handler 通过受控 CommandHost MCP facade 读取和保存 MCP 状态的要求。
- `terminal-tui-prototype`: 增加 `/mcp` command surface 的终端交互与 transient UI 要求。

## Impact

- 影响 MCP 配置读取/保存模块：需要提供面向 UI 的 raw MCP 配置视图和安全写回能力。
- 影响 `McpManager`：需要支持保存后 reload，关闭旧 clients 并按最新配置重新初始化。
- 影响 slash command 架构：新增 `/mcp` handler、surface 类型、footer renderer 和默认命令注册。
- 影响 command host：新增受控 MCP 领域能力，不把完整 app 或 manager 直接暴露给 handler。
- 影响测试：需要覆盖配置保留、命令状态机、manager reload 和渲染/交互关键路径。
