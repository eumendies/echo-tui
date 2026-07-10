## ADDED Requirements

### Requirement: usage surface 展示每日 token 用量列表
系统 SHALL 使用 footer command surface 展示 usage 数据。该 surface SHALL 采用列表/表格信息架构，包括累计 header、可见日期跨度、每日数值行和关闭提示；并 SHALL 使用项目现有主题、footer 布局、安全宽度和 command event 处理。

#### Scenario: 展示累计 header
- **WHEN** `/usage` surface 打开
- **THEN** surface SHALL 显示累计输入 token、输出 token、缓存命中输入 token、缓存命中率和总 token
- **AND** token 数 SHALL 使用紧凑格式显示

#### Scenario: 展示日期窗口和隐藏天数
- **WHEN** usage 数据天数多于当前 surface 可见窗口
- **THEN** surface SHALL 显示当前可见日期范围
- **AND** surface SHALL 表达更早和更新方向隐藏的天数

#### Scenario: 展示每日数值列表
- **WHEN** `/usage` surface 有可见日期数据
- **THEN** surface SHALL 按日期从旧到新渲染每日用量行
- **AND** 每行 SHALL 显示日期、输入 token、输出 token、缓存 token 和缓存命中率
- **AND** token 数 SHALL 使用紧凑格式显示
- **AND** 最新日期 SHALL 位于默认可见窗口底部

#### Scenario: 展示可选趋势提示
- **WHEN** `/usage` surface 的可用宽度足够容纳趋势列
- **THEN** surface MAY 为每日行显示紧凑趋势提示
- **AND** 趋势提示 SHALL 按每日总 token 相对当前可见窗口峰值缩放
- **AND** 趋势提示 SHALL NOT 取代每日数值列

#### Scenario: 展示中文按键提示
- **WHEN** `/usage` surface 打开
- **THEN** surface SHALL 显示中文关闭提示
- **AND** 当数据可滚动时 surface SHALL 显示中文滚动、翻页和跳转提示
- **AND** surface SHALL NOT 显示 `newest at bottom · trend = daily total`

#### Scenario: 小终端下保持布局安全
- **WHEN** `/usage` surface 在较小 terminal rows 或 columns 下渲染
- **THEN** surface SHALL 遵循 footer 的安全宽度和最大行数约束
- **AND** surface SHALL NOT 因写满最后一列触发额外自动换行
- **AND** surface MAY 减少可见日期数量、隐藏趋势列或裁剪次要标签以保持布局稳定

## MODIFIED Requirements

### Requirement: usage surface 支持日期窗口导航
系统 SHALL 允许用户在 `/usage` surface 中按列表滚动语义移动可见日期窗口，并 SHALL 保持该交互不修改 transcript records。

#### Scenario: 上下滚动日期窗口
- **WHEN** `/usage` surface 正在显示且存在隐藏日期
- **AND** 用户按下 Up 或 Down
- **THEN** 系统 SHALL 将可见日期窗口向更早或更新方向移动一天
- **AND** 系统 SHALL 重绘 usage surface
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 翻页移动日期窗口
- **WHEN** `/usage` surface 正在显示且存在隐藏日期
- **AND** 用户按下 PageUp 或 PageDown
- **THEN** 系统 SHALL 将可见日期窗口向更早或更新方向移动一个窗口大小
- **AND** 系统 SHALL 重绘 usage surface
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 兼容左右移动日期窗口
- **WHEN** `/usage` surface 正在显示且存在隐藏日期
- **AND** 用户按下 Left 或 Right
- **THEN** 系统 SHALL 将可见日期窗口向更早或更新方向移动一天
- **AND** 系统 SHALL 重绘 usage surface
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 跳到最早或最新日期窗口
- **WHEN** `/usage` surface 正在显示
- **AND** 用户按下 Home 或 End
- **THEN** 系统 SHALL 将可见日期窗口移动到最早或最新可用位置
- **AND** 系统 SHALL 重绘 usage surface

#### Scenario: 关闭 usage surface
- **WHEN** `/usage` surface 正在显示
- **AND** 用户按下 Esc、Enter 或 `q`
- **THEN** 系统 SHALL 关闭该 surface 并回到普通 composer footer
- **AND** 系统 SHALL NOT 修改 transcript records

## REMOVED Requirements

### Requirement: usage surface 展示 demo 风格每日柱状图
**Reason**: 每日柱状图无法直接表达精确 token 数值，已被每日 token 用量列表替代。

**Migration**: 使用 `usage surface 展示每日 token 用量列表` requirement 覆盖 `/usage` surface 的展示行为；保留累计 header、日期窗口和小终端安全约束。
