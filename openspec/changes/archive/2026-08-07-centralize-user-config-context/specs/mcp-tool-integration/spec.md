## MODIFIED Requirements

### Requirement: MCP runtime 支持配置保存后的 reload
系统 SHALL 支持在 TUI 运行期间按用户配置上下文的最新 snapshot 重载 MCP manager。`/mcp` 保存 SHALL 基于磁盘最新根对象原子更新配置并立即安装新 snapshot，随后 reload SHALL 关闭不再保留的 active MCP clients，按该 snapshot 的 enabled MCP 配置初始化 servers，并更新后续 provider-visible MCP tools。独立 reload 入口 SHALL 在重载前确保用户配置上下文已刷新，但 MCP manager SHALL NOT 绕过上下文自行重复读取 `~/.echo/config.json`。

#### Scenario: 保存后禁用 MCP server
- **WHEN** 某个已初始化 MCP server 通过 `/mcp` 保存为 disabled
- **THEN** 用户配置上下文 SHALL 在保存成功后立即提供包含 disabled 状态的新 snapshot
- **THEN** MCP manager SHALL 关闭该 server 的 active client 或 transport
- **THEN** 后续 provider request SHALL NOT 包含该 server 的 MCP tools

#### Scenario: 保存后启用 MCP server
- **WHEN** 某个配置有效的 MCP server 通过 `/mcp` 保存为 enabled
- **THEN** MCP manager SHALL 从保存后安装的配置 snapshot 初始化该 server
- **THEN** 初始化成功后，后续 provider request SHALL 包含该 server 的 MCP tools

#### Scenario: 保存后全局关闭 MCP
- **WHEN** `/mcp` 保存后的配置为 `mcp.enabled: false`
- **THEN** MCP manager SHALL 关闭所有 active MCP clients 或 transports
- **THEN** 后续 provider request SHALL NOT 包含任何 MCP tools

#### Scenario: reload 诊断不阻止普通问答
- **WHEN** MCP reload 期间某个 enabled server 初始化失败
- **THEN** 系统 SHALL 记录该 server 的脱敏诊断
- **THEN** 系统 SHALL 不注册该 server 的 MCP tools
- **THEN** 其他成功初始化的 MCP servers 和普通问答 SHALL 继续可用

#### Scenario: reload 后 tool registry 使用最新状态
- **WHEN** MCP manager 完成 reload
- **THEN** `listTools` 或等价 provider-visible tool 枚举 SHALL 基于 reload 后的 active server 集合
- **THEN** 下一轮 assistant request SHALL 使用该最新 MCP tool 集合

#### Scenario: 保存后的 reload 不重复读取配置
- **WHEN** `/mcp` writer 已经成功安装新 snapshot 并立即请求 MCP reload
- **THEN** MCP manager SHALL 消费该 snapshot 的 MCP runtime 投影
- **THEN** MCP manager SHALL NOT 为同一次保存重新读取或重新 JSON 解析配置文件
