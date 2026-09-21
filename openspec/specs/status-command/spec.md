# status-command Specification

## Purpose
TBD - created by archiving change add-status-codex-usage. Update Purpose after archive.
## Requirements
### Requirement: `/status` command 展示当前运行状态
系统 SHALL 提供精确匹配的 `/status` slash command，并 SHALL 在只读 command surface 中展示当前目录、生效的 AGENTS.md 来源、有效 memory 摘要、当前 model/provider 和 session id。该命令 SHALL NOT 展示 context token 占用。

#### Scenario: 展示当前运行状态
- **WHEN** 用户提交 `/status`
- **THEN** 系统 SHALL 打开 status command surface
- **AND** surface SHALL 展示当前工作目录
- **AND** surface SHALL 展示当前请求会采用的 AGENTS.md 文件来源
- **AND** surface SHALL 展示启用的用户 memory 数量和有效 agent memory catalog 摘要
- **AND** surface SHALL 展示当前 model 和 provider
- **AND** surface SHALL 展示当前 session id，尚未创建持久化 session 时 SHALL 显示稳定的未创建状态
- **AND** surface SHALL NOT 展示 context used tokens、context window 或 context 分类占用

#### Scenario: status command 保持本地只读语义
- **WHEN** 用户提交 `/status`
- **THEN** command runtime SHALL 将输入作为本地命令消费
- **AND** 系统 SHALL NOT 将 `/status` 作为 user message 提交给 agent
- **AND** 系统 SHALL NOT 追加 transcript record

#### Scenario: 拒绝额外参数
- **WHEN** 用户提交带额外参数的 `/status` 输入
- **THEN** 系统 SHALL NOT 将其匹配为 `/status` command
- **AND** slash command 解析 SHALL 保持与其他纯命令一致的精确匹配语义

### Requirement: 查询 Codex OAuth 限额用量
当当前 provider 为 Codex OAuth 时，系统 SHALL 使用现有 Codex OAuth 凭据解析与刷新能力查询 Codex usage endpoint，并 SHALL 将响应归一化为 5 小时主窗口和每周次窗口的已用百分比与重置时间。查询与解析过程 MUST NOT 暴露 access token、refresh token、账号标识或原始敏感响应。

#### Scenario: 成功查询两个限额窗口
- **WHEN** 当前 provider 为 Codex OAuth
- **AND** usage endpoint 返回有效的主窗口与次窗口数据
- **THEN** 系统 SHALL 使用 Bearer access token 发起请求
- **AND** 存在 account id 时请求 SHALL 携带 Codex 账号 header
- **AND** 查询结果 SHALL 包含 5 小时窗口和每周窗口的已用百分比与重置时间
- **AND** 已用百分比 SHALL 被规范到 0 至 100 的闭区间

#### Scenario: 服务未提供每周窗口
- **WHEN** 当前 provider 为 Codex OAuth
- **AND** usage endpoint 返回有效主窗口但 `secondary_window` 为 null 或缺失
- **THEN** 系统 SHALL 保留 5 小时窗口的可用进度
- **AND** status surface SHALL 将每周窗口显示为暂无数据
- **AND** 系统 SHALL NOT 将整个 Codex 用量区域判为查询失败

#### Scenario: 查询前刷新过期凭据
- **WHEN** 当前 Codex OAuth access token 已过期且存在 refresh token
- **AND** 用户提交 `/status`
- **THEN** 系统 SHALL 复用现有凭据刷新流程取得可用 access token
- **AND** 系统 SHALL 使用刷新后的凭据查询用量

#### Scenario: 非 Codex provider 不发起用量请求
- **WHEN** 当前 provider 不是 Codex OAuth
- **AND** 用户提交 `/status`
- **THEN** 系统 SHALL NOT 请求 Codex usage endpoint
- **AND** status surface SHALL NOT 显示 Codex 用量区域

#### Scenario: 用量查询失败时降级
- **WHEN** Codex 凭据不可用、网络请求失败、服务返回非成功状态或响应缺少有效窗口数据
- **THEN** status surface SHALL 保留其他运行状态信息
- **AND** Codex 用量区域 SHALL 显示经过脱敏的不可用摘要
- **AND** 系统 SHALL NOT 追加 transcript error
- **AND** 系统 SHALL NOT 因查询失败退出 TUI 或修改 transcript records

### Requirement: status surface 以进度条展示 Codex 用量
系统 SHALL 使用 footer command surface 展示 status 数据。Codex 用量可用时，surface SHALL 分别使用带填充轨道的进度条展示 5 小时和每周窗口，并 SHALL 同时展示数值百分比与重置时间；查询期间和不可用时 SHALL 展示对应状态文本。

#### Scenario: 渲染 Codex 用量进度条
- **WHEN** Codex 用量查询成功
- **THEN** surface SHALL 为 5 小时窗口渲染一条按已用百分比缩放的进度条
- **AND** surface SHALL 为每周窗口渲染一条按已用百分比缩放的进度条
- **AND** 每个窗口 SHALL 显示数值百分比和重置时间
- **AND** 进度条 SHALL 使用当前主题颜色并区分填充部分与剩余轨道

#### Scenario: 查询期间显示加载状态
- **WHEN** `/status` surface 已打开且 Codex 用量查询尚未结束
- **THEN** surface SHALL 立即显示已取得的本地运行状态
- **AND** Codex 用量区域 SHALL 显示查询中状态
- **AND** 查询完成后仍处于同一个 status session 时 surface SHALL 更新为成功或不可用状态

#### Scenario: 忽略已关闭 surface 的迟到结果
- **WHEN** 用户在 Codex 用量查询完成前关闭或替换 status surface
- **THEN** 迟到的查询结果 SHALL NOT 重新打开或覆盖当前 command surface
- **AND** 迟到结果 SHALL NOT 修改 transcript records

#### Scenario: 关闭 status surface
- **WHEN** status surface 正在显示
- **AND** 用户按下 Esc、Enter 或 `q`
- **THEN** 系统 SHALL 关闭该 surface 并回到普通 composer footer
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 小终端下保持布局安全
- **WHEN** status surface 在较小 terminal rows 或 columns 下渲染
- **THEN** surface SHALL 遵循 footer 的安全宽度和最大行数约束
- **AND** surface SHALL NOT 因写满最后一列触发额外自动换行
- **AND** surface MAY 裁剪路径、memory 摘要或重置时间，但 MUST 保留两个可用窗口的标签、进度和百分比

### Requirement: 查询 OpenCode Go 订阅用量
当活动 provider 的 baseURL 命中 OpenCode Go 服务(hostname 为 `opencode.ai` 且路径以 `/zen/go/` 开头，覆盖 `opencode-go`、`opencode-go-responses`、`opencode-go-anthropic` 三个预设)时，系统 SHALL 使用活动 config 的 API key 以 Bearer 方式查询 `GET https://opencode.ai/zen/go/v1/usage`，并 SHALL 把响应归一化为 5 小时、每周、每月三个配额窗口的窗口名、状态、百分比与重置时间。查询与解析过程 MUST NOT 在错误信息中暴露 API key 或原始敏感响应。baseURL 未命中时系统 SHALL NOT 发起该请求。

#### Scenario: 成功查询三个配额窗口
- **WHEN** 活动 provider baseURL 命中 OpenCode Go 且 usage endpoint 返回有效数据
- **THEN** 系统 SHALL 使用 Bearer API key 发起请求
- **AND** 查询结果 SHALL 包含各窗口的窗口名、状态、百分比与重置时间
- **AND** 窗口顺序 SHALL 固定为 rolling、weekly、monthly，未知窗口键排在已知键之后

#### Scenario: 非 OpenCode Go provider 不发起用量请求
- **WHEN** 活动 provider baseURL 未命中 OpenCode Go
- **AND** 用户提交 `/status`
- **THEN** 系统 SHALL NOT 请求 usage endpoint
- **AND** status surface SHALL NOT 显示 OpenCode Go 用量区域

#### Scenario: 响应残缺时整块降级
- **WHEN** usage endpoint 返回非成功状态、响应不是有效 JSON，usage 对象缺失，或任一窗口缺少有效的 status、percent、resetsAt
- **THEN** 该用量查询 SHALL 判为不可用并向 status surface 提供经过脱敏的错误摘要
- **AND** 系统 SHALL NOT 追加 transcript error
- **AND** status surface SHALL 保留其余运行状态信息

#### Scenario: 百分比规范到闭区间
- **WHEN** 某窗口的 percent 数值超出 0 至 100 的范围
- **THEN** 系统 SHALL 把百分比规范到 0 至 100 的闭区间后再进入展示层

### Requirement: status surface 展示 OpenCode Go 用量
OpenCode Go 用量可用时，status surface SHALL 分别以进度条展示 5 小时、每周、每月三个配额窗口，并 SHALL 同时展示数值百分比与重置时间；已用达到或超过 100% 的窗口 SHALL 以警示色呈现。查询期间和不可用时 SHALL 展示对应状态文本，行为与 Codex 用量区域一致。

#### Scenario: 渲染三个配额窗口
- **WHEN** OpenCode Go 用量查询成功
- **THEN** surface SHALL 为每个窗口渲染一条按已用百分比缩放的进度条
- **AND** 每个窗口 SHALL 显示数值百分比和重置时间
- **AND** 未知的窗口名 SHALL 以原始名称展示

#### Scenario: 查询期间与不可用状态
- **WHEN** `/status` surface 已打开且 OpenCode Go 用量查询尚未结束，或查询失败
- **THEN** surface SHALL 立即显示已取得的本地运行状态
- **AND** OpenCode Go 用量区域 SHALL 展示查询中或经过脱敏的不可用状态文本
- **AND** 查询完成仍处于同一个 status session 时 surface SHALL 更新为成功或不可用状态

#### Scenario: 忽略已关闭 surface 的迟到结果
- **WHEN** 用户在 OpenCode Go 用量查询完成前关闭或替换 status surface
- **THEN** 迟到的查询结果 SHALL NOT 重新打开或覆盖当前 command surface
- **AND** 迟到结果 SHALL NOT 修改 transcript records

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
