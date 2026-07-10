## ADDED Requirements

### Requirement: CommandHost 暴露 MCP 管理能力
系统 SHALL 通过 `CommandHost` 向 `/mcp` command handler 暴露受控 MCP 管理能力。handler SHALL 通过该能力列出 MCP 全局/server 草稿状态、保存 enabled 状态并触发 MCP reload；handler SHALL NOT 直接访问完整 `AppContext`、renderer、terminal 或裸 `McpManager` 内部状态。

#### Scenario: handler 通过 host 读取 MCP 状态
- **WHEN** `/mcp` command handler 需要展示 MCP 管理面板
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 MCP 领域能力获取全局和 server 状态
- **THEN** handler SHALL NOT 直接读取 `~/.echo/config.json`

#### Scenario: handler 通过 host 保存 MCP 状态
- **WHEN** `/mcp` command handler 确认保存 enabled 草稿状态
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 MCP 领域能力保存状态
- **THEN** host SHALL 负责执行配置写回、MCP manager reload 和 context usage 清理
- **THEN** handler SHALL NOT 直接操作 renderer、terminal 或完整 app 内部状态

#### Scenario: command runtime 不解释 MCP 业务 effect
- **WHEN** `/mcp` command 保存或取消
- **THEN** command handler SHALL 直接调用 `CommandHost` 或关闭 command session
- **THEN** `CommandRuntime` SHALL NOT 为 MCP 保存新增业务 effect interpreter 分支
