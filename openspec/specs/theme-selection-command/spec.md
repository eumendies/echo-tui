# theme-selection-command Specification

## Purpose
定义内置 render theme 的选择能力，包括 `/config` 配置中心“外观”Tab 中的主题列举、即时应用、错误处理和与旧 `/themes` 命令解绑后的外部行为。
## Requirements
### Requirement: Appearance tab switches builtin render themes
系统 SHALL 通过 `/config` 配置中心的“外观”Tab 查看并切换内置 render theme。系统 SHALL NOT 注册独立 `/themes` slash command；主题选择 SHALL 使用 config footer surface，打开、确认、取消或失败时 SHALL NOT 写入 transcript，SHALL NOT 启动 agent loop，SHALL NOT 进入 tool approval flow。

#### Scenario: 默认命令集合不包含 themes
- **WHEN** 系统创建默认 slash command handlers 和 descriptors
- **THEN** handlers SHALL NOT 包含 `/themes` command
- **THEN** slash suggestion SHALL NOT 展示 `/themes`

#### Scenario: 打开配置中心外观 Tab
- **WHEN** 用户在 `/config` 配置中心切换到“外观”Tab
- **THEN** config surface SHALL 激活“外观”Tab并列出可用内置 theme 的 id、label 和 description
- **THEN** surface SHALL 将当前有效 base theme 标记为当前选中项
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: themes 文本不命中本地命令
- **WHEN** 用户在主 UI composer 中提交 `/themes default`、`/themes amber` 或任何其他带参数文本
- **THEN** 系统 SHALL NOT 将该输入匹配为本地 command handler
- **THEN** 系统 SHALL 走普通 direct skill fallback；若无可用 skill 则按未命中 slash 继续普通提交
- **THEN** 系统 SHALL NOT 打开 command surface 或 info surface

#### Scenario: 从外观 Tab 选择 theme
- **WHEN** “外观”Tab处于活跃状态且用户按 Up 或 Down
- **THEN** 系统 SHALL 移动当前选中项
- **WHEN** 用户按 Enter
- **THEN** 系统 SHALL 保存所选内置 theme id 并更新选中 marker
- **THEN** active command session SHALL 保持打开以允许继续比较主题
- **THEN** 当前可见 TUI SHALL 立即使用新归一化 render theme 完整重绘

#### Scenario: 关闭外观 Tab
- **WHEN** “外观”Tab处于活跃状态且其他 Tab没有未保存草稿
- **AND** 用户按 Esc
- **THEN** 系统 SHALL 关闭 command session 并清空 composer
- **THEN** 系统 SHALL 保留最近一次已经确认保存的 theme

### Requirement: Appearance tab handles unavailable lists and save errors
系统 SHALL 在配置中心“外观”Tab对内置 theme 列表不可用和配置保存失败展示可理解错误。失败路径 SHALL NOT 修改当前进程 render theme，SHALL NOT 破坏已有 `theme.json` 内容，且 SHALL 保持配置中心可关闭或可继续操作。

#### Scenario: theme 列表为空时显示错误
- **WHEN** 用户通过 `/config` 打开“外观”Tab
- **AND** 系统无法列出任何可用内置 theme
- **THEN** 外观 Tab SHALL 说明当前没有可用内置 theme
- **THEN** 系统 SHALL NOT 修改 `~/.echo/theme.json`

#### Scenario: 保存失败时保留当前 theme
- **WHEN** 用户选择某个可用 theme
- **AND** 系统无法安全写入 `~/.echo/theme.json`
- **THEN** 外观 Tab SHALL 显示可理解错误
- **THEN** 系统 SHALL 保持当前进程 render theme 和选中 marker 不变
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

