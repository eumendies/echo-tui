## MODIFIED Requirements

### Requirement: /mcp command 展示 MCP 管理面板
系统 SHALL 提供 `/mcp` slash command，用 transient command surface 展示 MCP 全局开关与用户配置中的 MCP servers。面板 SHALL 以总览视图作为入口：除全局开关与每个 server 的 enabled 草稿状态外，SHALL 展示 transport、配置有效性诊断，以及已初始化 server 的 tools/resources/prompts 计数摘要；SHALL 提供进入单个 server 编辑视图的入口，以及在草稿存在未保存改动时的显式保存行。

#### Scenario: 打开 MCP 管理面板
- **WHEN** 用户提交 `/mcp`
- **THEN** 系统 SHALL 打开 MCP command session 的 `overview` 视图
- **THEN** composer SHALL 被清空并离开历史浏览状态
- **THEN** footer SHALL 显示 MCP 面板而不是普通 composer

#### Scenario: 显示全局和 server 状态
- **WHEN** MCP 面板打开且用户配置包含 MCP 配置
- **THEN** 面板 SHALL 显示 `mcp.enabled` 的全局开关状态
- **THEN** 面板 SHALL 显示每个 `mcp.servers.<name>` 的 enabled 草稿状态
- **THEN** 面板 SHALL 为每个 server 显示 transport 或配置错误摘要
- **THEN** 已初始化 server SHALL 显示 tools/resources/prompts 计数摘要

#### Scenario: 无 MCP server 的空状态
- **WHEN** MCP 面板打开且用户配置没有任何 MCP server
- **THEN** 面板 SHALL 显示空状态说明
- **THEN** 空状态 SHALL 指向 `~/.echo/config.json` 的 MCP 配置位置或等价提示
- **THEN** 面板 SHALL 仍提供新增 server 与全局开关入口

### Requirement: /mcp command 支持键盘启停和保存
MCP 面板 SHALL 支持 Up/Down 移动选择、Space 切换当前行 enabled 草稿状态、Enter 进入选中目标的下一层视图或在字段行进入编辑、Esc 返回上一层或在总览丢弃草稿，以及通过显式保存行保存。保存前的所有修改 SHALL 只作用于当前 command session 草稿，SHALL NOT 立即写入配置或重载 MCP manager；存在未保存改动时离开面板 SHALL 先经过丢弃确认。

#### Scenario: 移动选择项
- **WHEN** MCP 面板处于活跃状态
- **AND** 用户按 Up 或 Down
- **THEN** 系统 SHALL 在当前视图的可选行之间移动 selected index
- **THEN** 面板 SHALL 重新渲染当前选中项

#### Scenario: 切换 enabled 草稿状态
- **WHEN** MCP 面板处于活跃状态且选中 enabled 行
- **AND** 用户按 Space
- **THEN** 系统 SHALL 切换该行的 enabled 草稿状态
- **THEN** 系统 SHALL NOT 立即写入 `~/.echo/config.json`
- **THEN** 系统 SHALL NOT 立即重载 MCP manager

#### Scenario: 进入下一层视图
- **WHEN** 用户在总览选中 server 行按 Enter，或在 server 视图选中清单入口按 Enter
- **THEN** 系统 SHALL 切换到对应的 server 或 inventory 视图
- **THEN** 系统 SHALL NOT 写盘

#### Scenario: 保存 MCP 草稿状态
- **WHEN** 用户在显式保存行按 Enter 且草稿通过校验
- **THEN** 系统 SHALL 保存当前 MCP 草稿状态
- **THEN** 系统 SHALL 重载 MCP manager 并清理 context usage
- **THEN** 后续 assistant request SHALL 使用保存后的 MCP 工具与资源状态

#### Scenario: 取消 MCP 草稿状态
- **WHEN** MCP 面板在总览且草稿无未保存改动
- **AND** 用户按 Esc
- **THEN** 系统 SHALL NOT 写入 `~/.echo/config.json`
- **THEN** 系统 SHALL 关闭 MCP command session 并清空 composer

## REMOVED Requirements

### Requirement: /mcp command 不编辑 server 细节
**Reason**: 该 requirement 描述的是"第一版仅编辑 enabled"的边界，本次变更把 `/mcp` 升级为可编辑面板，边界被有意反转；其"保存时保留 server 未展示字段"的约束由 `mcp-config-panel` 的显式保存与字段级写回要求承接。
**Migration**: 原先需要手工编辑 `~/.echo/config.json` 才能完成的 transport、url、command、args、cwd、env、headers、timeoutMs 与新增/删除 server 操作，改由 `/mcp` 面板完成；配置文件 schema 与字段语义不变，已有配置无需迁移，面板保存仍保留未知字段。
