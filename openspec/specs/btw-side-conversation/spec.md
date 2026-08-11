# btw-side-conversation Specification

## Purpose
TBD - created by archiving change add-btw-command. Update Purpose after archive.
## Requirements
### Requirement: BTW 命令进入临时多轮旁路会话
系统 SHALL 注册 `/btw [问题]` 命令，并允许用户在主会话空闲或 active assistant turn 期间打开至多一个 BTW 会话。带参数的命令 SHALL 将参数作为首条 BTW 问题立即提交；不带参数的命令 SHALL 打开空 BTW composer。BTW 输入 SHALL 使用独立 composer，并 SHALL 支持多轮 side user/assistant 交互和至多一条 side pending message。

#### Scenario: 带问题进入 BTW
- **WHEN** 用户提交 `/btw 为什么需要单独的 turn identity？`
- **THEN** 系统 SHALL 打开 BTW 会话并立即提交“为什么需要单独的 turn identity？”作为首条 side user message
- **THEN** 主 transcript SHALL NOT 追加 `/btw` 命令或该 side user message

#### Scenario: 空参数进入 BTW
- **WHEN** 用户提交 `/btw`
- **THEN** 系统 SHALL 打开空 BTW composer 并等待用户输入
- **THEN** 系统 SHALL NOT 在用户提交问题前启动 side agent turn

#### Scenario: BTW 内继续追问
- **WHEN** 一个 side turn 已完成且 BTW 仍活跃
- **AND** 用户在 BTW composer 提交追问
- **THEN** 系统 SHALL 使用同一 BTW 会话的冻结父上下文和既有 side records 启动下一次 side turn

#### Scenario: Side turn 期间暂存下一条消息
- **WHEN** side assistant turn 正在运行
- **AND** 用户提交另一条 BTW 消息
- **THEN** 系统 SHALL 至多保存一条 BTW pending message
- **THEN** 当前 side turn 完成后系统 SHALL 原子 claim 该消息并启动下一次 side turn

#### Scenario: BTW 内 slash 前缀不启动嵌套命令
- **WHEN** BTW 活跃期间用户提交以 `/` 开头的文本
- **THEN** BTW command session SHALL 将该文本作为 side user message 处理
- **THEN** 全局 command runtime SHALL NOT 启动另一个 slash command session

### Requirement: BTW provider 上下文冻结且边界明确
系统 SHALL 在打开 BTW 时冻结主 transcript records 和适用的 compaction 状态，并 SHALL 在每次 side run 中使用该冻结父上下文与已累积 side records。系统 SHALL NOT 把打开后新增的主 records、主 todo state、主 change history 或持续变化的主 session journal 注入 BTW。第一条 BTW user record 的 provider-facing 文本 SHALL 明确声明此前主会话仅为冻结参考，且模型不得继续主任务、未完成计划、todo 或预期工具调用；其可见文本 SHALL 保持用户原始问题。

#### Scenario: 后台主记录不改变 BTW 上下文
- **WHEN** BTW 已打开
- **AND** 后台主 turn 追加新的 assistant 或 tool records
- **AND** 用户随后提交 BTW 追问
- **THEN** 新的 side provider 请求 SHALL NOT 包含 BTW 打开后新增的主 records
- **THEN** 请求 SHALL 继续包含 BTW 打开时的父快照和此前 side records

#### Scenario: 第一条问题建立 provider 边界
- **WHEN** 用户在新 BTW 会话提交第一条问题
- **THEN** provider-visible user text SHALL 包含 BTW 临时旁路、冻结参考和禁止继续主任务的边界说明
- **THEN** TUI user block SHALL 仅显示用户原始问题

#### Scenario: 主 todo 不进入 BTW runtime suffix
- **WHEN** 主会话在打开 BTW 时存在未完成 todo
- **THEN** side agent session SHALL 从独立空 todo state 开始
- **THEN** provider context SHALL NOT 因 BTW session input 自动追加主 todo 状态

### Requirement: BTW 不改变 system prompt 与 tools cache 材料
系统 MUST NOT 因 BTW conversation kind 修改 built-in system prompt，也 MUST NOT 因 readonly policy 裁剪 provider-visible tool definitions。在 model、配置、agent instructions、memory、skill catalog 和 MCP 状态相同的前提下，BTW 与主会话 SHALL 使用相同的 system prompt 文本、tool definitions 和 prompt cache key；BTW 语义 SHALL 仅通过 user-message boundary 与本地执行策略表达。

#### Scenario: BTW 与主会话 cache key 稳定
- **WHEN** 主 run 与 BTW side run 使用相同 model、运行配置和 MCP 状态
- **THEN** 两次请求的 built-in system prompt SHALL 完全相同
- **THEN** 两次请求的 provider-visible tool definitions SHALL 完全相同
- **THEN** `createPromptCacheKey` SHALL 为两次请求生成相同 key

#### Scenario: Conversation kind 不进入 system prompt
- **WHEN** side agent session 标记为 BTW conversation kind
- **THEN** 该标记 SHALL 仅用于本地执行、调试和渲染
- **THEN** system prompt SHALL NOT 添加 BTW 标题、规则或其他模式文本

### Requirement: BTW 状态完全临时且与主状态隔离
系统 SHALL 在内存中维护 BTW records、composer、pending、working、todo、compaction 和 turn identity。BTW user、assistant、reasoning、tool、notice、todo 和 compaction 变化 SHALL NOT 写入主 transcript、主 session journal、主 todo、主 change history 或主 compaction；BTW SHALL NOT 创建 change checkpoint。

#### Scenario: BTW 工具与回答不持久化
- **WHEN** BTW side turn 产生 reasoning、tool call/result 和 assistant answer
- **THEN** 这些 records SHALL 仅存在于当前 BTW 内存状态和可见投影
- **THEN** 主 transcript store 与 session journal SHALL 不包含这些 records

#### Scenario: BTW todo 与 compaction 独立演进
- **WHEN** side agent 更新 todo 或触发自动 compaction
- **THEN** 系统 SHALL 只更新 BTW 临时 todo 或 compaction
- **THEN** 主会话对应状态 SHALL 保持不变

#### Scenario: 关闭后不参与恢复
- **WHEN** 用户关闭 BTW 后打开 `/resume`、`/fork` 或重新启动 echo-tui
- **THEN** 系统 SHALL NOT 列出或恢复已丢弃的 BTW records 和状态

### Requirement: BTW 替换当前可见 transcript 投影
系统 SHALL 在进入 BTW 时 destructive repaint 为紧凑 BTW banner、side-only records 和 BTW footer，在退出时 destructive repaint 为最新主 banner、主 records、主 in-flight streaming projection 和主 footer。BTW 活跃期间 terminal projection owner SHALL 为 BTW；side 正文与 reasoning SHALL 使用与主会话相同的 Markdown/纯文本边界、per-segment cursor 和 activity drain 语义。系统 SHALL NOT 为每个 token destructive repaint，也 SHALL NOT 切换 alternate screen。

#### Scenario: 进入 BTW 切换全视图
- **WHEN** `/btw` 成功打开
- **THEN** renderer SHALL destructive repaint BTW 投影
- **THEN** 当前可见 transcript SHALL 不包含主 records 或主 in-flight streaming 行
- **THEN** BTW banner 或状态栏 SHALL 表明会话临时、readonly 且 Esc 返回主会话

#### Scenario: BTW 内稳定记录使用 append
- **WHEN** 活跃 BTW side turn 产生稳定 user、assistant、reasoning 或 tool record
- **THEN** renderer SHALL 清理 footer、append 对应现有 transcript block 并重绘 BTW footer
- **THEN** renderer SHALL NOT 因该稳定 record 清除全部 scrollback

#### Scenario: BTW streaming 增量确定并只在 footer 保留尾部
- **WHEN** 活跃 side turn 产生满足 Markdown 或 reasoning 视觉行边界的 source 前缀
- **THEN** 系统 SHALL 在 activity drain 时把新增投影 append 到 BTW scrollback
- **THEN** footer SHALL 从 side visible cursor 开始展示尚未成功 drain 的尾部
- **THEN** 系统 SHALL NOT 把未确定尾部提前提交为稳定 record

#### Scenario: BTW resize 恢复当前投影
- **WHEN** BTW 活跃期间终端列宽变化或行数缩小
- **THEN** renderer SHALL destructive replay BTW banner、全部 side records、当前 side in-flight source 至选定 replay boundary 的投影和最新 BTW footer
- **THEN** renderer SHALL 按新宽度重新投影 source
- **THEN** renderer SHALL NOT 错误重放主 transcript 或主 in-flight streaming 行

#### Scenario: BTW 活跃时后台主 streaming 不污染 side 投影
- **WHEN** BTW 活跃且后台主 turn 跨越新的稳定边界
- **THEN** 主 turn MAY 更新自身 in-flight state
- **THEN** renderer SHALL NOT 把主 turn 增量写入 BTW scrollback
- **WHEN** BTW 随后关闭
- **THEN** renderer SHALL destructive replay 最新主 records、主 in-flight source 至选定 replay boundary 的投影和主 pending tail

### Requirement: 主 turn 在 BTW 后台继续且记录不丢失
BTW 活跃期间，主 assistant thinking、streaming、tool continuation、稳定 record 提交、journal 持久化和普通 pending message claim SHALL 继续运行。主稳定 records SHALL 更新主状态但 SHALL NOT append 到 BTW transcript；BTW footer SHALL 提供有界 MAIN activity 摘要。退出 BTW 后，主投影 SHALL 包含 BTW 期间产生的全部最新主 records 和 pending 状态。

#### Scenario: 后台主 tool continuation 不污染 BTW 视图
- **WHEN** BTW 可见时后台主 turn 完成 tool call/result 并继续回答
- **THEN** 主 transcript 和 journal SHALL 正常追加对应 records
- **THEN** 当前 BTW transcript SHALL NOT 显示这些主 records
- **THEN** BTW footer SHALL 更新 MAIN tool 或 streaming activity 摘要

#### Scenario: 返回后补回后台内容
- **WHEN** BTW 打开期间主 turn 追加了稳定 records
- **AND** 用户关闭 BTW
- **THEN** renderer SHALL 从最新主状态完整重放主 transcript
- **THEN** 所有 BTW 期间隐藏的主 records SHALL 可见且顺序不变

### Requirement: Esc 原子丢弃 BTW 并隔离迟到 callback
BTW command session 接收 Esc 时 SHALL 立即使当前 BTW conversation 和 side turn identity 失效，abort 仍运行的 side turn，丢弃全部 BTW records、draft、queued commit 与 committed source state，关闭 command session并恢复主投影。迟到的 side callback、activity tick、catch 或 finally SHALL NOT 追加 records、推进 cursor、重绘 BTW 或修改主状态；关闭 BTW SHALL NOT abort 后台主 turn。

#### Scenario: Side streaming 时 Esc
- **WHEN** side assistant 正在 streaming
- **AND** 用户按下 Esc且没有更高优先级 surface
- **THEN** 系统 SHALL abort side run并关闭整个 BTW 会话
- **THEN** 系统 SHALL 丢弃 partial side draft、queued commit、committed source state 和全部 BTW records
- **THEN** destructive repaint SHALL 移除已经写入 BTW scrollback 的 side 行并恢复主投影
- **THEN** 后台主 turn SHALL 继续运行

#### Scenario: 退出后的迟到 token 或 tick 被忽略
- **WHEN** BTW 已关闭并恢复主视图
- **AND** 旧 side provider callback 或 activity tick 随后到达
- **THEN** callback SHALL 因 conversation 或 turn identity 不匹配而被忽略
- **THEN** 主 transcript、主 cursor、主 footer 和 terminal 输出 SHALL 不包含该 callback 内容

### Requirement: 高优先级主交互暂时覆盖 BTW
主 turn 在 BTW 活跃期间发起 tool approval 或 user question 等既有高优先级交互时，对应 modal SHALL 暂时接管显示和输入。Modal 结束后，若 BTW 仍活跃，系统 SHALL 恢复 BTW 投影；modal 活跃时的 Esc SHALL 先遵循 modal 语义，不得直接关闭 BTW 或中断主 turn。

#### Scenario: 主 approval 覆盖 BTW
- **WHEN** BTW 活跃且后台主 turn 请求 tool approval
- **THEN** approval surface SHALL 接管显示和输入
- **THEN** 用户作出决定后系统 SHALL 恢复仍活跃的 BTW 视图

#### Scenario: Modal 活跃时 Esc
- **WHEN** 主 user question 或 approval surface 覆盖 BTW
- **AND** 用户按下 Esc
- **THEN** 当前 modal SHALL 先处理该按键
- **THEN** BTW SHALL 保持活跃，除非用户在 modal 关闭后再次按 Esc

