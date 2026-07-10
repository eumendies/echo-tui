## ADDED Requirements

### Requirement: checkbox command surface
系统 SHALL 支持 checkbox command surface，用于在 footer command surface 区域展示可多选的列表项。每个列表项 SHALL 显示当前 checked 状态，用户 SHALL 能移动选择、切换当前项并确认或取消。

#### Scenario: 渲染 checkbox 列表
- **WHEN** footer 当前 command surface kind 为 checkbox
- **THEN** renderer SHALL 显示 surface title
- **THEN** renderer SHALL 为每个 option 显示 `[x]` 或 `[ ]` 状态标记
- **THEN** renderer SHALL 高亮当前 selectedIndex 对应的行
- **THEN** renderer SHALL 显示 surface 自身的 dismissHint 或等价操作提示

#### Scenario: checkbox surface 使用 Space 切换
- **WHEN** checkbox command session 处于活跃状态且用户按 Space
- **THEN** 系统 SHALL 切换当前 selectedIndex 对应 option 的 checked 状态
- **THEN** 系统 SHALL 保持 command session 活跃并重绘 footer

#### Scenario: checkbox surface 使用 Enter 确认
- **WHEN** checkbox command session 处于活跃状态且用户按 Enter
- **THEN** 对应 command handler SHALL 确认当前 checked 状态
- **THEN** command session SHALL 关闭

#### Scenario: checkbox surface 使用 Esc 取消
- **WHEN** checkbox command session 处于活跃状态且用户按 Esc
- **THEN** 对应 command handler SHALL 取消当前草稿状态
- **THEN** command session SHALL 关闭

#### Scenario: command surfaces 保留自身提示
- **WHEN** footer 当前显示 checkbox command surface
- **THEN** 该 surface SHALL 使用自身的 `dismissHint` 或等价 surface 内提示
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示
