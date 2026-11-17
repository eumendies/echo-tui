## MODIFIED Requirements

### Requirement: 子 Agent 工作过程作为结构化本地 transcript 事实
交互式 TUI SHALL 将每次子 Agent 运行的稳定工作过程追加为 `subagent` transcript records。每条记录 SHALL 包含稳定 `runId`、外层 `parentToolCallId`、`agentName` 和事件类型；事件 SHALL 能表达 start、可见 reasoning summary、assistant segment、内部 tool call、内部 tool result、completed、failed 与 cancelled。内部工具事件 SHALL 保留重放现有工具 renderer 所需的 call id、tool name、arguments、结果状态和专属 display metadata。worktree Worker 的 start/终态记录 SHALL 能以可选结构化字段保存工作区方式、固定基线、创建者归属、工作区位置与是否仍保留；共享目录回退 SHALL 可表达共享方式，旧记录缺少这些字段 SHALL 仍合法。新增字段 SHALL 经现有 append_records 协议保存，不新增 journal 操作。系统 SHALL NOT 为每个 token、spinner frame 或 provider 私有 reasoning extension 追加记录。

#### Scenario: 启动后立即保存 start 事实
- **WHEN** `run_subagent` 已通过参数和预算校验并启动 `explorer`
- **THEN** 主 transcript SHALL 立即追加包含 task 摘要、run id 和 parent tool call id 的 subagent start record
- **THEN** 该 record SHALL 在子 Agent 尚未完成时进入当前 session journal

#### Scenario: 内部工具完成后保存工具事实
- **WHEN** 子 Agent 的一个内部工具调用产生结果
- **THEN** 系统 SHALL 以匹配的 call id 保存 subagent tool call 和 tool result 事实
- **THEN** 记录 SHALL 保留专属 renderer 和恢复所需的结构化结果字段

#### Scenario: 流式草稿只在稳定边界持久化
- **WHEN** 子 Agent provider 连续产生 reasoning 或 assistant token
- **THEN** 系统 SHALL 使用 transient pending state 更新当前可见活动
- **THEN** 系统 SHALL 只在 reasoning complete、assistant segment 或最终完成边界追加稳定 subagent record

#### Scenario: 运行结束保存终态
- **WHEN** 子 Agent 成功、失败或因父级取消而结束
- **THEN** 系统 SHALL 追加对应 completed、failed 或 cancelled 终态 record
- **THEN** 终态 SHALL 包含可用的耗时；failed或cancelled MAY在 record正文携带简洁诊断
- **THEN** completed record正文 SHALL为空，最终报告 SHALL只保存在先行 assistant event和外层 tool result中

#### Scenario: 工作区事实不依赖模型报告
- **WHEN** worktree Worker 创建成功并最终完成或失败
- **THEN** start SHALL 保留系统确认的工作区方式和基线，终态 SHALL 保留系统确认的保留状态
- **THEN** completed record 正文 SHALL 继续为空，工作区事实 SHALL 位于结构化字段而非伪造 assistant 文本

#### Scenario: 旧记录仍可恢复
- **WHEN** session journal 中的 subagent 记录没有任何工作区可选字段
- **THEN** 校验与重放 SHALL 保持兼容并按既有运行事实展示
- **THEN** 系统 SHALL NOT 凭空推断该历史运行曾使用 worktree

### Requirement: 子 Agent 过程随主 session journal 恢复
稳定 subagent records SHALL 通过现有 `append_records` journal 操作增量持久化并随主 session replay、fork、undo transcript 截断和 destructive repaint 一起恢复。Journal 校验 SHALL 验证 subagent role 的必需身份字段和事件结构；未知、损坏或缺少身份字段的 subagent record SHALL 使对应 journal 操作按现有结构校验规则失败。恢复时 start 没有匹配终态且不带受管工作区元数据的旧运行 SHALL 继续投影为意外中断。带受管工作区元数据的 Worker SHALL NOT 单凭缺少终态判定已中断：恢复投影 SHALL 显示终态未确认/活动状态不明。renderer SHALL 只消费提供的状态，SHALL NOT 在纯渲染时探测进程或操作目录。所有情形 SHALL NOT 自动重启子 Agent。

#### Scenario: Resume 恢复完整工作过程
- **WHEN** session journal 包含一组有效 subagent start、tool、assistant 和 completed records
- **THEN** `/resume` replay SHALL 按原顺序恢复这些 records
- **THEN** transcript 重绘 SHALL 恢复对应子 Agent rail 和嵌套工具过程

#### Scenario: 恢复未完成运行
- **WHEN** journal replay 后存在 subagent start 和部分过程记录但没有 completed、failed 或 cancelled 终态
- **THEN** 旧记录或已确认原运行退出的 Worker SHALL 显示上次意外中断；带工作区元数据但活动状态无法确认的 Worker SHALL 显示终态未确认/活动状态不明
- **THEN** 系统 SHALL NOT 自动发起 provider 请求、执行工具或补造成功结果

#### Scenario: 外层工具协议保持成对落盘
- **WHEN** 子 Agent仍在运行或进程在其结束前退出
- **THEN** 系统 SHALL NOT 为了显示起始 rail 而提前持久化孤立的外层 `run_subagent` tool call
- **THEN** 外层 call/result SHALL 在结果到达后继续按现有成对方式落盘

#### Scenario: 其他实例的运行不能靠缺少终态判死
- **WHEN** 恢复含工作区元数据的 Worker start 且没有终态，但原实例是否活动尚未确认
- **THEN** 恢复投影 SHALL 显示活动状态不明而不是 interrupted 或已完成
- **THEN** 对应工作区 SHALL 保留，renderer SHALL NOT 探测进程、清理目录或启动该 Worker

### Requirement: run_subagent 外层工具对的专属展开渲染
主窗口对 `run_subagent` 外层 tool pair 的展开投影 SHALL 使用专属 renderer：以与单 subagent rail 同构的单条连续 rail 分三段展示——rail 标题段（Agent 原名 · 任务原文，专属 rail 色）、报告正文段（rail assistant 同款弱化正文与行数预算）与终态行，不渲染中间过程与原始 JSON 参数。外层参数无法解析出 agent 与 task 时 SHALL 回退通用工具消息投影以保留事实内容。已有本地子运行终态的单委派 SHALL 保持既有 compact 单行终态文案；worktree Worker SHALL 另在稳定过程投影或紧凑结果旁保留可见的工作区路径与保留状态摘要，SHALL NOT 因 compact 隐去仅有的工作区入口。

#### Scenario: 并行委派完成后的 rail 同构三段
- **WHEN** 并行只读段内的 `run_subagent` 委派完成并进入外层 pair 投影
- **THEN** 主窗口以单 subagent rail 同构的连续 rail 渲染标题段（agent · 任务）、报告正文段与终态行，不出现中间过程与原始 JSON 参数

#### Scenario: 参数解析失败回退通用投影
- **WHEN** 外层 `run_subagent` 参数无法解析出 agent 或 task 字段
- **THEN** 该 pair 回退通用工具消息投影，保留事实内容

#### Scenario: 单委派终态保持 compact 一行
- **WHEN** 单委派已有本地子运行终态且过程 rail 已完整展示
- **THEN** 外层 pair 保持既有 compact 单行终态文案

#### Scenario: 单 Worker 的 compact 结果不隐藏成果
- **WHEN** 单个 worktree Worker 的外层 pair 使用 compact 终态投影
- **THEN** 主窗口 SHALL 仍在该运行的稳定投影中显示工作区保留状态和可识别的工作区路径
- **THEN** 完整路径和基线 SHALL 能在子会话窗口或外层交接中取得

## ADDED Requirements

### Requirement: 工作区历史投影不改变成果所有权
受管 worktree 的方式、基线、工作区位置和待集成状态 SHALL 在稳定子运行事实和外层交接中表达，并在实时、resize、session replay 中保持一致；并行运行 SHALL 继续用现有 parallelSize 分叉而非在主窗口展开内部过程。渲染 SHALL NOT 因查看记录而探测/重启 Worker、转移工作区归属或自动删除成果。fork 继承的引用 SHALL 保持源创建者身份；路径已缺失或原运行活动状态无法确认时 SHALL 如实说明，SHALL NOT 伪造可恢复或已中断结论。

#### Scenario: 并行 Worker 成果随报告展示
- **WHEN** 多个 worktree Worker 带 parallelSize 完成并进入外层 pair 投影
- **THEN** 主窗口 SHALL 展示各自有界报告与工作区交接，内部过程 SHALL 留在子会话窗口
- **THEN** 各 run 的基线与工作区路径 SHALL 不交叉归属

#### Scenario: fork 引用仍指向源创建者
- **WHEN** 新 session 重绘从 fork 继承的工作区记录
- **THEN** 投影 SHALL 保留源 project/session/run 关联并表达历史引用，而非新 session 的活动 Worker
- **THEN** 单纯重绘 SHALL NOT 自动取得清理权或删除源工作区

#### Scenario: 只读回放不冒充实时文件存在性
- **WHEN** 只读回放仅有历史路径而没有当前可验证的工作区状态
- **THEN** 投影 SHALL 区分历史定位与已确认的现存状态，SHALL NOT 单凭历史路径声明成果仍存在
