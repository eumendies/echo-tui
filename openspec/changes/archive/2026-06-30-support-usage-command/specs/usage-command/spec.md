## ADDED Requirements

### Requirement: `/usage` command 展示每日 token 用量
系统 SHALL 提供 `/usage` slash command，用于展示本地持久化的每日 token usage 聚合。该 command SHALL 是本地只读命令，不触发 agent 请求，不追加 transcript record。

#### Scenario: 打开 usage surface
- **WHEN** 用户提交 `/usage`
- **AND** 本地存在 token usage 记录
- **THEN** 系统 SHALL 打开 usage command surface
- **AND** surface SHALL 显示按日聚合的 token 用量
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

### Requirement: token usage 持久化账本
系统 SHALL 在每次真实 provider request 返回可用 usage 后，把该 usage 作为 append-only 事件写入本地 usage 账本。账本 SHALL 只保存用量统计和非敏感运行上下文，不得保存 prompt、assistant 输出文本、工具参数、API key、headers 或 provider 请求体。

#### Scenario: 记录 provider usage event
- **WHEN** provider turn 成功返回 usage
- **THEN** 系统 SHALL 追加一条 usage event
- **AND** event SHALL 包含时间戳、本地日期、模型标识、provider 类型、interaction mode 和 token usage 字段
- **AND** event SHALL NOT 包含 prompt、响应正文、工具参数或敏感凭据

#### Scenario: provider 没有返回 usage 时不写账本
- **WHEN** provider turn 完成但没有返回任何可用 usage token 字段
- **THEN** 系统 SHALL NOT 追加 usage event
- **AND** assistant turn SHALL 继续按原响应结果完成

#### Scenario: usage 写入失败不影响响应
- **WHEN** usage store 写入失败
- **THEN** 系统 SHALL 隔离该失败
- **AND** 系统 SHALL NOT 因 usage 写入失败中断 assistant turn
- **AND** 系统 SHALL NOT 把写入失败作为 transcript error 追加到对话历史

#### Scenario: 多次 provider continuation 分别记录
- **WHEN** 一个 assistant turn 因工具调用产生多次 provider request
- **AND** 多次 provider request 均返回 usage
- **THEN** 系统 SHALL 为每次 provider request 分别追加 usage event
- **AND** `/usage` 的每日聚合 SHALL 包含这些 event 的合计值

### Requirement: 每日 usage 聚合分类
系统 SHALL 按本地日期聚合 usage events，并 SHALL 至少输出输入 token、缓存命中输入 token、缓存创建输入 token、未命中输入 token、输出 token、总 token 和缓存命中率。

#### Scenario: 聚合单日 usage
- **WHEN** 同一天存在多条 usage events
- **THEN** 系统 SHALL 将这些 events 的输入、缓存命中输入、缓存创建输入、未命中输入和输出 token 分别求和
- **AND** 系统 SHALL 将总 token 计算为输入 token 与输出 token 之和

#### Scenario: 计算未命中输入
- **WHEN** usage event 包含输入 token 和缓存命中输入 token
- **THEN** 系统 SHALL 将未命中输入 token 计算为输入 token 减去缓存命中输入 token 后不小于 0 的值
- **AND** 缓存创建输入 token SHALL 保留为独立字段

#### Scenario: 计算缓存命中率
- **WHEN** 聚合日的输入 token 大于 0
- **THEN** 系统 SHALL 将缓存命中率计算为缓存命中输入 token 除以输入 token
- **WHEN** 聚合日的输入 token 等于 0
- **THEN** 缓存命中率 SHALL 为 0

### Requirement: usage surface 展示 demo 风格每日柱状图
系统 SHALL 使用 footer command surface 展示 usage 数据。该 surface SHALL 采用 demo 风格的信息架构，包括累计 header、可见日期跨度、每日堆叠柱状图、图例和关闭提示；但 SHALL 使用项目现有主题、footer 布局、安全宽度和 command event 处理。

#### Scenario: 展示累计 header
- **WHEN** `/usage` surface 打开
- **THEN** surface SHALL 显示累计输入 token、输出 token、缓存命中输入 token、缓存命中率和总 token
- **AND** token 数 SHALL 使用紧凑格式显示

#### Scenario: 展示日期窗口和隐藏天数
- **WHEN** usage 数据天数多于当前 surface 可见窗口
- **THEN** surface SHALL 显示当前可见日期范围
- **AND** surface SHALL 表达左侧和右侧隐藏的天数

#### Scenario: 展示每日堆叠柱状图
- **WHEN** `/usage` surface 有可见日期数据
- **THEN** surface SHALL 为每个可见日期渲染一根堆叠柱
- **AND** 柱状图 SHALL 用不同颜色或等价 theme token 区分缓存命中输入、未命中输入和输出 token
- **AND** 柱状图 SHALL 按当前聚合数据中的峰值日期缩放

#### Scenario: 展示图例和按键提示
- **WHEN** `/usage` surface 打开
- **THEN** surface SHALL 显示缓存命中输入、未命中输入和输出 token 的图例
- **AND** surface SHALL 显示关闭提示
- **AND** 当数据可平移时 surface SHALL 显示平移提示

#### Scenario: 小终端下保持布局安全
- **WHEN** `/usage` surface 在较小 terminal rows 或 columns 下渲染
- **THEN** surface SHALL 遵循 footer 的安全宽度和最大行数约束
- **AND** surface SHALL NOT 因写满最后一列触发额外自动换行
- **AND** surface MAY 减少可见日期数量或裁剪次要标签以保持布局稳定

### Requirement: usage surface 支持日期窗口导航
系统 SHALL 允许用户在 `/usage` surface 中横向移动可见日期窗口，并 SHALL 保持该交互不修改 transcript records。

#### Scenario: 左右移动日期窗口
- **WHEN** `/usage` surface 正在显示且存在隐藏日期
- **AND** 用户按下 Left 或 Right
- **THEN** 系统 SHALL 将可见日期窗口向对应方向移动
- **AND** 系统 SHALL 重绘 usage surface
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 跳到最早或最新日期窗口
- **WHEN** `/usage` surface 正在显示
- **AND** 用户按下 Home 或 End
- **THEN** 系统 SHALL 将可见日期窗口移动到最早或最新可用位置
- **AND** 系统 SHALL 重绘 usage surface

#### Scenario: 关闭 usage surface
- **WHEN** `/usage` surface 正在显示
- **AND** 用户按下 Esc 或 Enter
- **THEN** 系统 SHALL 关闭该 surface 并回到普通 composer footer
- **AND** 系统 SHALL NOT 修改 transcript records
