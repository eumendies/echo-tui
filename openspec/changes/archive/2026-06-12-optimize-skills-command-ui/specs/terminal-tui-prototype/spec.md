## ADDED Requirements

### Requirement: skills command surface
系统 SHALL 支持专用 skills command surface，用于在 footer command surface 区域展示和管理 discovered skills。该 surface SHALL 使用 cyan card 风格，展示 enabled 计数、skill 开关状态、来源、描述、当前选中项和操作提示，并 SHALL 遵守现有 footer 安全宽度和局部重绘约束。

#### Scenario: 渲染 skills manager card
- **WHEN** footer 当前 command surface kind 为 skills
- **THEN** renderer SHALL 显示 cyan 风格边框和 `SKILLS` 或等价标题
- **THEN** renderer SHALL 显示当前 enabled skill 数量和总 skill 数量
- **THEN** renderer SHALL NOT 显示搜索框、搜索 placeholder 或搜索光标
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示

#### Scenario: 渲染 skill 行
- **WHEN** skills command surface 包含 discovered skills
- **THEN** renderer SHALL 为每个可见 skill 显示 on/off pill 或等价开关状态
- **THEN** renderer SHALL 显示 skill 名称
- **THEN** renderer SHALL 显示 skill 来源和描述，且长文本 SHALL 在安全宽度内截断
- **THEN** disabled skill SHALL 使用区别于 enabled skill 的弱化样式

#### Scenario: 渲染当前选中行
- **WHEN** skills command surface 有 selectedIndex
- **THEN** renderer SHALL 高亮当前选中 skill 行
- **THEN** renderer SHALL 在当前选中行显示左侧 accent 或等价视觉标记
- **THEN** footer renderer SHALL NOT 在该不可编辑 surface 上显示可编辑光标

#### Scenario: skills manager 行数超出可见窗口
- **WHEN** discovered skills 数量超过 skills surface 的可见行数预算
- **THEN** renderer SHALL 只显示包含当前 selectedIndex 的一段连续窗口
- **THEN** renderer SHALL 在窗口上方或下方显示剩余数量提示
- **THEN** 当前 selectedIndex SHALL 始终在可见窗口内

#### Scenario: skills manager 提示按键
- **WHEN** skills command surface 处于活跃状态
- **THEN** surface SHALL 显示 Up/Down 移动、Space 切换、Enter 保存和 Esc 取消的提示
- **THEN** surface SHALL NOT 显示 `/` 搜索、`a` 全选、`n` 全不选、`j/k` 或 home/end 提示

#### Scenario: skills manager 空状态
- **WHEN** skills command surface 不包含任何 skill
- **THEN** renderer SHALL 显示没有发现可用 skill 的可读提示
- **THEN** renderer SHALL 允许用户通过 Esc 关闭该 command surface
