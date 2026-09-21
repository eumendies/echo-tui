## ADDED Requirements

### Requirement: `/status` 提供会话状态页面导航
系统 SHALL 将 `/status` 作为包含“概览”“压缩摘要”和“Todo”三个页面的只读 command surface 打开。系统 SHALL 在打开时进入概览页面；概览 SHALL 继续展示既有运行状态和适用的账户用量，并 SHALL 展示当前 compaction 与 todo 的简要状态。页面切换、滚动和刷新 SHALL 只更新 status command session，SHALL NOT 提交 user message、调用 agent、追加 transcript record 或修改 session 持久化状态。

#### Scenario: 打开 status 概览页面
- **WHEN** 用户提交精确匹配的 `/status`
- **THEN** 系统 SHALL 打开 status command surface 并选中概览页面
- **AND** 概览 SHALL 保留现有运行状态和适用的账户用量展示
- **AND** 概览 SHALL 展示 compaction 是否存在及 todo 的待办/完成计数摘要

#### Scenario: 切换会话状态页面
- **WHEN** status surface 正在显示
- **AND** 用户按下 `←` 或 `→`
- **THEN** 系统 SHALL 在概览、压缩摘要和 Todo 页面间循环切换
- **AND** 系统 SHALL 保留其他页面已有的正文滚动位置
- **AND** 系统 SHALL NOT 修改 transcript records 或会话状态

#### Scenario: 关闭行为保持不变
- **WHEN** status surface 正在显示
- **AND** 用户按下 Esc、Enter 或 `q`
- **THEN** 系统 SHALL 关闭 surface 并回到普通 composer footer
- **AND** 系统 SHALL NOT 修改 transcript records 或会话状态

#### Scenario: 手动刷新本地会话快照
- **WHEN** status surface 正在显示
- **AND** 用户按下 `r`
- **THEN** 系统 SHALL 重新读取当前本地运行状态、compaction 状态和 todo 状态
- **AND** 系统 SHALL 保留当前选中的页面，并将各正文滚动位置钳制到刷新后的有效范围
- **AND** 系统 SHALL NOT 因该刷新重新请求 Codex、DeepSeek 或 OpenCode Go 账户接口
- **AND** 系统 SHALL NOT 修改 transcript records 或会话状态

### Requirement: `/status` 展示当前生效的 compaction 摘要
压缩摘要页面 SHALL 展示打开或刷新 status 时当前 session 的 `CompactionState` 快照。存在压缩状态时，页面 SHALL 展示摘要创建时间、`activeStartIndex` 所表示的压缩边界，以及完整 `summaryText` 的可读投影；页面 SHALL 明确该内容是当前生效的滚动摘要，不得将其描述为完整活动 transcript、压缩次数或对话轮数。不存在压缩状态时，页面 SHALL 展示稳定的未压缩空状态。

#### Scenario: 展示当前压缩摘要
- **WHEN** 当前 session 存在 compaction 状态
- **AND** 用户打开或刷新 `/status` 后进入压缩摘要页面
- **THEN** 系统 SHALL 展示 compaction 的创建时间和压缩边界前已纳入摘要的记录数
- **AND** 系统 SHALL 展示当前 `summaryText` 的完整内容，使所有视觉行可通过滚动到达
- **AND** 系统 SHALL 保留摘要中的换行、列表或标题等可读结构

#### Scenario: 当前 session 尚未压缩
- **WHEN** 当前 session 不存在 compaction 状态
- **AND** 用户进入压缩摘要页面
- **THEN** 系统 SHALL 展示当前会话尚未生成压缩摘要的空状态
- **AND** 系统 SHALL NOT 从 transcript records、compaction notice 或 provider 输入反推或生成摘要

### Requirement: `/status` 展示当前会话 Todo 状态
Todo 页面 SHALL 展示打开或刷新 status 时当前 session 的完整 `TodoState` 快照。页面 SHALL 展示更新时间、总数、待办数和完成数，并 SHALL 按 `TodoState.items` 的原有顺序展示每个任务的文本与状态；系统 SHALL 同时使用文字或符号状态标识和主题语义区分待办与完成项，且 SHALL NOT 仅依赖颜色。Todo 页面 SHALL 保持只读。

#### Scenario: 展示待办与完成项
- **WHEN** 当前 session 的 todo 状态包含待办或完成项
- **AND** 用户打开或刷新 `/status` 后进入 Todo 页面
- **THEN** 系统 SHALL 展示 todo 更新时间、总数、待办数和完成数
- **AND** 系统 SHALL 按原有顺序展示每一个 todo 的文本和 `open` 或 `completed` 状态
- **AND** 已完成项 SHALL 保持在列表中且以弱化主题和非颜色状态标识表达已完成

#### Scenario: Todo 为空
- **WHEN** 当前 session 的 todo 状态没有 items
- **AND** 用户进入 Todo 页面
- **THEN** 系统 SHALL 展示当前会话暂无待办的空状态
- **AND** 系统 SHALL NOT 从历史 todo tool call 或 tool result 重建 todo 列表

#### Scenario: status 不编辑 Todo
- **WHEN** 用户在 Todo 页面按下非导航、非滚动、非刷新和非关闭按键
- **THEN** 系统 SHALL NOT 创建、完成、删除、重排或持久化 todo
- **AND** 系统 SHALL NOT 将该输入提交给 agent

### Requirement: `/status` 详情页面支持安全的长内容阅读
压缩摘要和 Todo 页面 SHALL 在固定页签、元信息和操作提示之间以视觉行窗口展示正文。系统 SHALL 支持 `↑`、`↓`、`Page Up`、`Page Down`、`Home` 和 `End` 对当前详情页正文滚动；长摘要和长 todo 文本 SHALL 按可用卡片宽度换行，所有正文视觉行 SHALL 可达。布局 SHALL 继续遵守 footer 的安全宽度和高度预算，且不得写满终端末列而产生额外自动换行。

#### Scenario: 滚动长摘要或 Todo 列表
- **WHEN** 当前压缩摘要或 Todo 正文的视觉行数超过可用正文行数
- **AND** 用户在对应详情页按下 `↑`、`↓`、`Page Up`、`Page Down`、`Home` 或 `End`
- **THEN** 系统 SHALL 在正文的有效视觉行范围内调整当前页面的滚动位置
- **AND** 页面 SHALL 持续显示页签、必要元信息和操作提示
- **AND** 系统 SHALL 让所有正文视觉行可通过滚动到达

#### Scenario: 窄终端或有限 footer 高度
- **WHEN** status surface 在窄终端或有限 footer 高度下渲染
- **THEN** 系统 SHALL 对路径、摘要和 todo 文本使用安全宽度与换行或窗口化策略
- **AND** 系统 SHALL 将滚动位置钳制在实际可见正文范围内
- **AND** 系统 SHALL NOT 因详情页面导致额外自动换行、越界 cursor 或破坏 footer 重绘区域

### Requirement: `/status` 概览运行信息保持 key/value 对齐
概览页面 SHALL 保留目录、模型、Provider、Session、Instructions、Memory、沙箱、压缩摘要和 Todo 的既有顺序与单行信息布局。系统 SHALL 使用共享的可见宽度标签列格式化这些字段，使 value 在正常终端宽度下从同一终端列开始；系统 SHALL NOT 为对齐而改变字段语义、隐藏字段或把运行信息改为多栏卡片。

#### Scenario: 正常宽度下对齐概览字段值
- **WHEN** 用户在有足够内容宽度的终端打开 `/status` 概览页
- **THEN** 目录、模型、Provider、Session、Instructions、Memory、沙箱、压缩摘要和 Todo 的 value SHALL 从同一可见列开始
- **AND** 系统 SHALL 以终端可见宽度而非 JavaScript 字符长度计算中英文标签的补白
- **AND** 账户用量区块 SHALL 保持既有顺序和展示行为

#### Scenario: 窄终端下安全收窄标签列
- **WHEN** `/status` 概览页在不足以容纳默认标签列和完整 value 的终端宽度下渲染
- **THEN** 系统 SHALL 将标签列收敛到适合可用内容宽度的安全范围
- **AND** value SHALL 继续使用既有安全裁剪规则
- **AND** 每一行 SHALL NOT 写满终端末列或触发额外自动换行
