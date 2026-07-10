## ADDED Requirements

### Requirement: /mcp command 展示 MCP 管理面板
系统 SHALL 提供 `/mcp` slash command，用 transient command surface 展示 MCP 全局开关和用户配置中的 MCP servers。该面板 SHALL 使用与 `/skills` 等价的键盘管理心智，并 SHALL 展示 server 的 enabled 状态、名称、transport、配置有效性以及可用 tool 数或诊断摘要。

#### Scenario: 打开 MCP 管理面板
- **WHEN** 用户提交 `/mcp`
- **THEN** 系统 SHALL 打开 MCP command session
- **THEN** composer SHALL 被清空并离开历史浏览状态
- **THEN** footer SHALL 显示 MCP 管理面板而不是普通 composer

#### Scenario: 显示全局和 server 状态
- **WHEN** MCP 管理面板打开且用户配置包含 MCP 配置
- **THEN** 面板 SHALL 显示 `mcp.enabled` 的全局开关状态
- **THEN** 面板 SHALL 显示每个 `mcp.servers.<name>` 的 enabled 草稿状态
- **THEN** 面板 SHALL 为每个 server 显示 transport 或配置错误摘要

#### Scenario: 无 MCP server 的空状态
- **WHEN** MCP 管理面板打开且用户配置没有任何 MCP server
- **THEN** 面板 SHALL 显示空状态说明
- **THEN** 空状态 SHALL 指向 `~/.echo/config.json` 的 MCP 配置位置或等价提示

### Requirement: /mcp command 支持键盘启停和保存
MCP 管理面板 SHALL 支持 Up/Down 移动选择、Space 切换当前行 enabled 草稿状态、Enter 保存、Esc 取消。保存前的切换 SHALL 只修改当前 command session 草稿，不应立即写入配置或重载 MCP manager。

#### Scenario: 移动选择项
- **WHEN** MCP 管理面板处于活跃状态
- **AND** 用户按 Up 或 Down
- **THEN** 系统 SHALL 在可选 MCP 行之间移动 selected index
- **THEN** 面板 SHALL 重新渲染当前选中项

#### Scenario: 切换 enabled 草稿状态
- **WHEN** MCP 管理面板处于活跃状态且存在可选行
- **AND** 用户按 Space
- **THEN** 系统 SHALL 切换当前选中行的 enabled 草稿状态
- **THEN** 系统 SHALL NOT 立即写入 `~/.echo/config.json`
- **THEN** 系统 SHALL NOT 立即重载 MCP manager

#### Scenario: 保存 MCP 草稿状态
- **WHEN** MCP 管理面板处于活跃状态
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 保存当前 MCP enabled 草稿状态
- **THEN** 系统 SHALL 关闭 MCP command session 并清空 composer
- **THEN** 后续 assistant request SHALL 使用保存后的 MCP tool 暴露状态

#### Scenario: 取消 MCP 草稿状态
- **WHEN** MCP 管理面板处于活跃状态
- **AND** 用户按 Esc
- **THEN** 系统 SHALL 丢弃当前 command session 中的 MCP 草稿状态
- **THEN** 系统 SHALL NOT 写入 `~/.echo/config.json`
- **THEN** 系统 SHALL 关闭 MCP command session 并清空 composer

### Requirement: /mcp command 不编辑 server 细节
第一版 `/mcp` SHALL 只管理 `mcp.enabled` 和 `mcp.servers.<name>.enabled`。系统 SHALL NOT 在该面板中新增、删除或编辑 MCP server 的 transport、command、url、args、env、headers、approval 或 timeout 配置字段。

#### Scenario: 保存时保留 server 细节
- **WHEN** 用户在 `/mcp` 面板中保存 enabled 状态
- **THEN** 系统 SHALL 只更新全局和 server enabled 字段
- **THEN** 系统 SHALL 保留所有 MCP server 的 transport、command、url、args、env、headers、approval、timeout 和未知字段

#### Scenario: invalid server 只展示诊断
- **WHEN** 用户配置中存在无效 MCP server
- **THEN** `/mcp` 面板 SHALL 展示该 server 的名称和配置诊断
- **THEN** `/mcp` 面板 SHALL NOT 尝试自动修复该 server 的缺失 command、url 或其它配置字段
