# theme-selection-command Specification

## Purpose
TBD - created by archiving change add-themes-command. Update Purpose after archive.
## Requirements
### Requirement: Themes command switches builtin render themes
系统 SHALL 提供纯 `/themes` slash command，用于查看并切换内置 render theme。该命令 SHALL 使用现有 command runtime 和 footer command surface；打开、确认、取消或失败时 SHALL NOT 写入 transcript，SHALL NOT 启动 agent loop，SHALL NOT 进入 tool approval flow。

#### Scenario: 默认命令集合包含 themes
- **WHEN** 系统创建默认 slash command handlers 和 descriptors
- **THEN** handlers SHALL 包含 `/themes` command
- **THEN** slash suggestion SHALL 展示 `/themes` 及其中文说明

#### Scenario: 打开 theme 选择 surface
- **WHEN** 用户在主 UI composer 中提交 `/themes`
- **THEN** 系统 SHALL 清空 composer 并打开 active command session
- **THEN** surface SHALL 列出可用内置 theme 的 id、label 和 description
- **THEN** surface SHALL 将当前有效 base theme 标记为当前选中项
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: 带参数 themes 不命中本地命令
- **WHEN** 用户在主 UI composer 中提交 `/themes default`、`/themes amber` 或任何其他带参数文本
- **THEN** `/themes` command handler SHALL NOT 匹配该输入
- **THEN** 系统 SHALL 按普通用户消息提交该文本
- **THEN** 系统 SHALL NOT 打开 command surface 或 info surface

#### Scenario: 从 surface 选择 theme
- **WHEN** `/themes` 选择 surface 处于活跃状态且用户按 Up 或 Down
- **THEN** 系统 SHALL 移动当前选中项
- **WHEN** 用户按 Enter
- **THEN** 系统 SHALL 保存所选内置 theme id
- **THEN** 系统 SHALL 关闭 command session 并清空 composer
- **THEN** 当前可见 TUI SHALL 立即使用新归一化 render theme 完整重绘

#### Scenario: 取消 theme 选择
- **WHEN** `/themes` 选择 surface 处于活跃状态且用户按 Esc
- **THEN** 系统 SHALL 关闭 command session 并清空 composer
- **THEN** 系统 SHALL NOT 修改 `~/.echo/theme.json`
- **THEN** 系统 SHALL NOT 改变当前进程 render theme

### Requirement: Themes command handles unavailable lists and save errors
系统 SHALL 对 `/themes` 的内置 theme 列表不可用和配置保存失败展示可理解的 info surface。失败路径 SHALL NOT 修改当前进程 render theme，SHALL NOT 破坏已有 `theme.json` 内容。

#### Scenario: theme 列表为空时显示错误
- **WHEN** 用户提交 `/themes`
- **AND** 系统无法列出任何可用内置 theme
- **THEN** 系统 SHALL 打开 info surface 说明当前没有可用内置 theme
- **THEN** 系统 SHALL NOT 修改 `~/.echo/theme.json`

#### Scenario: 保存失败时保留当前 theme
- **WHEN** 用户选择某个可用 theme
- **AND** 系统无法安全写入 `~/.echo/theme.json`
- **THEN** 系统 SHALL 打开错误 info surface
- **THEN** 系统 SHALL 保持当前进程 render theme 不变
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

