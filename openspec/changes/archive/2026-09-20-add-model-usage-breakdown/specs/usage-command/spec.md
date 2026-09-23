## MODIFIED Requirements

### Requirement: `/usage` command 展示每日 token 用量
系统 SHALL 提供 `/usage` slash command，用于展示本地持久化的 token usage 聚合。该 command SHALL 是本地只读命令，不触发 agent 请求，不追加 transcript record；打开时 SHALL 默认显示全部记录的按日聚合，并允许用户选择一个日期后查看该日按配置 provider ID 和模型标识聚合的 token 用量。

#### Scenario: 打开 usage surface
- **WHEN** 用户提交 `/usage`
- **AND** 本地存在 token usage 记录
- **THEN** 系统 SHALL 打开 usage command surface
- **AND** surface SHALL 默认显示按日聚合的 token 用量和选中日期
- **AND** 系统 SHALL NOT 将 `/usage` 作为 user message 提交给 agent

#### Scenario: 无 usage 记录时提示空状态
- **WHEN** 用户提交 `/usage`
- **AND** 本地不存在 token usage 记录
- **THEN** 系统 SHALL 显示暂无 token usage 记录的提示
- **AND** 系统 SHALL NOT 启动 provider request
- **AND** 系统 SHALL NOT 追加 transcript record

#### Scenario: usage command 拒绝额外参数
- **WHEN** 用户提交带额外参数的 `/usage` 输入
- **THEN** 系统 SHALL NOT 将其匹配为 `/usage` command
- **AND** slash command 解析 SHALL 保持与其他纯命令一致的精确匹配语义

### Requirement: usage surface 支持日期选择、下钻和导航
系统 SHALL 允许用户在 `/usage` 的按日视图中选择日期并移动可见日期窗口，进入当日模型明细后移动可见模型窗口；所有这些交互 SHALL 不修改 transcript records。

#### Scenario: 选择日期并保持可见
- **WHEN** `/usage` 的按日视图正在显示且存在多个日期
- **AND** 用户按下 Up、Down、PageUp、PageDown、Home 或 End
- **THEN** 系统 SHALL 按对应列表语义更新选中日期
- **AND** 系统 SHALL 调整可见日期窗口以保持选中日期可见
- **AND** 系统 SHALL 重绘 usage surface
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 进入当日模型明细
- **WHEN** `/usage` 的按日视图正在显示且存在选中日期
- **AND** 用户按下 Enter
- **THEN** 系统 SHALL 打开该本地日期的模型用量明细
- **AND** 明细 SHALL 仅包含 `localDay` 等于选中日期的 usage events
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 导航当日模型明细
- **WHEN** `/usage` 的当日模型明细正在显示且存在隐藏模型行
- **AND** 用户按下 Up、Down、Left、Right、PageUp、PageDown、Home 或 End
- **THEN** 系统 SHALL 按对应列表滚动语义移动可见模型窗口
- **AND** 系统 SHALL 重绘 usage surface
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 返回日期列表
- **WHEN** `/usage` 的当日模型明细正在显示
- **AND** 用户按下 Esc 或 Backspace
- **THEN** 系统 SHALL 返回此前的按日视图
- **AND** 系统 SHALL 保留此前的选中日期和日期窗口

#### Scenario: 关闭 usage surface
- **WHEN** `/usage` 的按日视图正在显示
- **AND** 用户按下 Esc 或 `q`
- **THEN** 系统 SHALL 关闭该 surface 并回到普通 composer footer
- **AND** 系统 SHALL NOT 修改 transcript records
- **WHEN** `/usage` 的当日模型明细正在显示
- **AND** 用户按下 `q`
- **THEN** 系统 SHALL 关闭该 surface 并回到普通 composer footer

### Requirement: usage surface 展示每日 token 用量列表
系统 SHALL 使用 footer command surface 展示 usage 数据。按日视图 SHALL 采用列表/表格信息架构，包括累计 header、可见日期跨度、每日数值行和关闭提示；并 SHALL 使用项目现有主题、footer 布局、安全宽度和 command event 处理。每日行 SHALL 可见地区分当前选中日期。

#### Scenario: 展示累计 header
- **WHEN** `/usage` 的按日视图打开
- **THEN** surface SHALL 显示累计输入 token、输出 token、缓存命中输入 token、缓存命中率和总 token
- **AND** token 数 SHALL 使用紧凑格式显示

#### Scenario: 展示日期窗口和隐藏天数
- **WHEN** usage 数据天数多于当前 surface 可见窗口
- **THEN** surface SHALL 显示当前可见日期范围
- **AND** surface SHALL 表达更早和更新方向隐藏的天数

#### Scenario: 展示可选择的每日数值列表
- **WHEN** `/usage` 的按日视图有可见日期数据
- **THEN** surface SHALL 按日期从旧到新渲染每日用量行
- **AND** 每行 SHALL 显示日期、输入 token、输出 token、缓存 token 和缓存命中率
- **AND** 当前选中日期 SHALL 使用稳定可见标记
- **AND** token 数 SHALL 使用紧凑格式显示
- **AND** 最新日期 SHALL 位于默认可见窗口底部并成为默认选中日期

#### Scenario: 展示可选趋势提示
- **WHEN** `/usage` surface 的可用宽度足够容纳趋势列
- **THEN** surface MAY 为每日行显示紧凑趋势提示
- **AND** 趋势提示 SHALL 按每日总 token 相对当前可见窗口峰值缩放
- **AND** 趋势提示 SHALL NOT 取代每日数值列

#### Scenario: 展示中文按键提示
- **WHEN** `/usage` 的按日视图打开
- **THEN** surface SHALL 显示中文选择、下钻和关闭提示
- **AND** 当数据可滚动时 surface SHALL 显示中文翻页和跳转提示

#### Scenario: 小终端下保持布局安全
- **WHEN** `/usage` 的按日视图在较小 terminal rows 或 columns 下渲染
- **THEN** surface SHALL 遵循 footer 的安全宽度和最大行数约束
- **AND** surface SHALL NOT 因写满最后一列触发额外自动换行
- **AND** surface MAY 减少可见日期数量、隐藏趋势列或裁剪次要标签以保持布局稳定

## ADDED Requirements

### Requirement: usage event 记录配置 provider ID
系统 SHALL 在可解析的 LLM provider 配置中取得非敏感 provider ID，并 SHALL 将它作为可选 `providerId` 字段写入新的 usage event。该字段 SHALL NOT 包含 API key、Base URL、headers 或其他凭据；缺少该字段的历史 event SHALL 保持可读和可聚合。

#### Scenario: 使用配置 provider ID 记录 usage
- **WHEN** 主 agent、subagent、引用总结或自动审批 reviewer 使用解析后的 LLM 配置完成带 usage 的 provider request
- **THEN** 系统 SHALL 在写入 usage event 时携带该配置的 provider ID
- **AND** event SHALL 继续包含 provider 类型和模型标识

#### Scenario: 兼容历史 usage event
- **WHEN** 有效的历史 usage event 不含 `providerId`
- **THEN** 系统 SHALL 接受并读取该 event
- **AND** 系统 SHALL NOT 迁移或重写历史 JSONL 文件

### Requirement: usage store 支持按单日 provider/模型聚合
系统 SHALL 从既有 usage events 按 `(providerId, model)` 组合聚合模型 usage；若 event 缺少 provider ID，系统 SHALL 使用 `(providerType, model)` 作为其回退身份。模型聚合 SHALL 至少输出可见 provider 标识、模型标识、输入 token、缓存命中输入 token、缓存创建输入 token、未命中输入 token、输出 token、总 token、缓存命中率、event 数和同一查询范围内的总 token 占比。

#### Scenario: 聚合单日不同 provider 配置的 usage
- **WHEN** 同一日期内存在 provider ID 不同但模型标识相同的 usage events
- **THEN** 系统 SHALL 为每个不同的 `(providerId, model)` 组合返回一个模型聚合项
- **AND** 系统 SHALL 不将这些 events 合并
- **AND** 系统 SHALL 分别累加每个组合的输入、缓存命中输入、缓存创建输入、未命中输入、输出、总 token 和 event 数

#### Scenario: 查询选中日期的模型 usage
- **WHEN** 调用方使用相同 `fromDay` 和 `toDay` 查询模型 usage
- **THEN** 系统 SHALL 仅聚合该日期的 usage events
- **AND** 系统 SHALL 保持现有项目和返回天数筛选语义

#### Scenario: 计算模型缓存命中率与用量占比
- **WHEN** 一个模型聚合项的输入 token 大于 0
- **THEN** 系统 SHALL 将其缓存命中率计算为缓存命中输入 token 除以输入 token
- **WHEN** 一个模型聚合项的输入 token 等于 0
- **THEN** 系统 SHALL 将其缓存命中率设为 0
- **AND** 系统 SHALL 将其总 token 占比计算为该项总 token 除以同一查询范围所有模型总 token

### Requirement: usage surface 展示当日 provider/模型 token 用量
系统 SHALL 从选中日期提供当日模型用量明细。明细 SHALL 显示该日累计信息和按模型行；每行 SHALL 以 `provider_id/model` 表达 provider 标识与模型标识，并显示输入 token、输出 token、总 token、缓存相关统计、缓存命中率、event 数及相对用量。模型行 SHALL 按总 token 从高到低排序，且总 token 相等时 SHALL 以稳定的 provider 标识和模型标识顺序排序。

#### Scenario: 展示当日模型明细
- **WHEN** 用户从 `/usage` 按日视图进入选中日期
- **THEN** surface SHALL 在标题或上下文中表达该日期
- **AND** surface SHALL 显示仅属于该日期的累计 token 信息和模型列表
- **AND** 每个模型行 SHALL 以 `providerId/model` 显示新 event 的 provider 标识和模型标识
- **AND** 缺少 provider ID 的历史 event 行 SHALL 以 `providerType/model` 显示回退身份
- **AND** token 数 SHALL 使用紧凑格式显示

#### Scenario: 展示模型相对用量
- **WHEN** 当日模型明细的可用宽度足以容纳相对用量提示
- **THEN** surface SHALL 为每个模型行显示相对于该日所有模型总 token 的紧凑占比或条形提示
- **AND** 该提示 SHALL NOT 取代模型身份或关键 token 数值

#### Scenario: 使用更宽的 surface 并在小终端保持安全
- **WHEN** 当日模型明细在具有足够宽度的 terminal 中渲染
- **THEN** surface SHALL 使用不小于 112 列的最大卡片宽度上限，以容纳较长的 `provider_id/model` 身份和完整指标列
- **WHEN** 当日模型明细在较小 terminal rows 或 columns 下渲染
- **THEN** surface SHALL 遵循 footer 的安全宽度和最大行数约束
- **AND** surface SHALL NOT 因写满最后一列触发额外自动换行
- **AND** surface SHALL 优先保留 provider/模型身份、总 token、输入 token 和输出 token
- **AND** surface SHALL 在必要时隐藏相对用量提示、event 数、缓存统计或缓存命中率
