## ADDED Requirements

### Requirement: MCP runtime 支持配置保存后的 reload
系统 SHALL 支持在 TUI 运行期间按最新用户配置重载 MCP manager。reload SHALL 关闭不再保留的 active MCP clients，重新读取 `~/.echo/config.json`，按最新 enabled MCP 配置初始化 servers，并更新后续 provider-visible MCP tools。

#### Scenario: 保存后禁用 MCP server
- **WHEN** 某个已初始化 MCP server 通过 `/mcp` 保存为 disabled
- **THEN** MCP manager SHALL 关闭该 server 的 active client 或 transport
- **THEN** 后续 provider request SHALL NOT 包含该 server 的 MCP tools

#### Scenario: 保存后启用 MCP server
- **WHEN** 某个配置有效的 MCP server 通过 `/mcp` 保存为 enabled
- **THEN** MCP manager SHALL 按最新配置初始化该 server
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

### Requirement: MCP 配置提供 UI 草稿视图和安全写回
系统 SHALL 提供面向 `/mcp` command 的 MCP 配置草稿读取和保存能力。草稿读取 SHALL 保留 disabled server 与 invalid server；保存 SHALL 原子写回用户配置，并 SHALL 只修改 enabled 字段。

#### Scenario: 草稿读取保留 disabled server
- **WHEN** 用户配置中某个 MCP server 配置了 `enabled: false`
- **THEN** MCP UI 草稿读取 SHALL 返回该 server
- **THEN** 返回结果 SHALL 标记该 server 当前为 disabled

#### Scenario: 草稿读取保留 invalid server
- **WHEN** 用户配置中某个 MCP server 配置无效
- **THEN** MCP UI 草稿读取 SHALL 返回该 server 的名称和 enabled 草稿状态
- **THEN** 返回结果 SHALL 包含可展示的配置诊断

#### Scenario: 保存 enabled 状态保留未知字段
- **WHEN** `/mcp` 保存 MCP enabled 草稿状态
- **THEN** 系统 SHALL 保留用户配置根对象中的非 MCP 字段
- **THEN** 系统 SHALL 保留 MCP server 对象中的未知字段和非 enabled 字段
- **THEN** 系统 SHALL 使用临时文件和 rename 或等价机制避免部分写入
