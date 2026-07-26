# context-compression Specification

## Purpose
定义 `echo_tui` 上下文压缩能力的外部行为，包括上下文窗口大小解析、上下文长度估算、压缩阈值判定、压缩边界计算、结构化摘要生成、压缩状态存储和压缩后的请求投影，使长会话在接近模型上下文窗口上限时能够通过滚动摘要保持可持续对话。

## Requirements

### Requirement: 上下文窗口大小解析
系统 SHALL 为当前生效模型解析一个上下文窗口 token 上限，用于压缩阈值判定。解析 SHALL 按以下优先级回退：用户在模型 profile 中显式配置的 `contextWindow`、内置常见模型映射表按模型名匹配出的窗口、系统默认值。系统 SHALL NOT 因无法识别模型而中断请求。

#### Scenario: 使用用户显式配置的上下文窗口
- **WHEN** 当前生效模型 profile 显式配置了有效的 `contextWindow`
- **THEN** 系统 SHALL 使用该配置值作为上下文窗口上限
- **THEN** 系统 SHALL NOT 回退到内置映射表或默认值

#### Scenario: 回退到内置模型映射表
- **WHEN** 当前生效模型 profile 未配置 `contextWindow`，且模型名命中内置映射表
- **THEN** 系统 SHALL 使用映射表中对应模型的上下文窗口上限

#### Scenario: 回退到默认值
- **WHEN** 当前生效模型既未配置 `contextWindow`，模型名也未命中内置映射表
- **THEN** 系统 SHALL 使用系统默认上下文窗口上限
- **THEN** 系统 SHALL NOT 因模型未知而阻止请求

### Requirement: 上下文长度估算
系统 SHALL 在发起每次 provider 请求前估算即将发送的上下文 token 长度。估算 SHALL 结合字符启发式与上一次请求返回的 `usage` 真值：当存在上一轮 `input_tokens` 真值时，系统 SHALL 以该真值为基线并叠加此后新增活跃记录的字符估算增量；当不存在真值时，系统 SHALL 对完整投影内容做字符估算。

#### Scenario: 首轮无 usage 真值时纯字符估算
- **WHEN** 当前 session 尚未取得任何 `usage` 真值且即将发起请求
- **THEN** 系统 SHALL 对即将投影发送的全部内容做字符估算得到预估 token 数

#### Scenario: 有 usage 真值时按增量校准
- **WHEN** 上一次请求返回了 `input_tokens` 真值，且其后追加了新的活跃记录
- **THEN** 系统 SHALL 以上一轮 `input_tokens` 为基线
- **THEN** 系统 SHALL 叠加新增活跃记录的字符估算增量得到当前预估 token 数

### Requirement: 压缩阈值判定
系统 SHALL 在发起请求前比较当前预估 token 数与上下文窗口阈值。阈值 SHALL 为上下文窗口上限乘以当前 assistant run 初始化时取得的用户级安全比例；有效比例 SHALL 为 0.5 至 0.95，缺失或无效配置 SHALL 回退 0.8。系统 SHALL 在单次 assistant run 及其 tool continuation 内保持该比例快照。当预估值超过阈值时，系统 SHALL 触发自动上下文压缩；未超过时 SHALL 直接按现有流程发送请求。强制压缩 SHALL 继续绕过阈值判定。

#### Scenario: 使用用户配置阈值
- **WHEN** assistant run 初始化时 `compaction.thresholdRatio` 为有效比例
- **THEN** 系统 SHALL 使用该比例乘以上下文窗口上限得到本次 run 的自动压缩阈值

#### Scenario: 缺失或无效阈值回退默认值
- **WHEN** `compaction.thresholdRatio` 缺失、类型错误、不是有限数值或不在 0.5 至 0.95 范围内
- **THEN** 系统 SHALL 使用 0.8 作为自动压缩安全比例
- **THEN** 系统 SHALL NOT 因可选阈值无效阻断 assistant run

#### Scenario: 单次 run 保持阈值快照
- **WHEN** assistant run 已初始化且外部进程随后修改压缩阈值配置
- **THEN** 当前 run 的后续 tool continuation 和 provider 请求 SHALL 继续使用初始化时的比例
- **THEN** 下一次新 assistant run SHALL 读取修改后的有效比例

#### Scenario: 预估超过阈值触发压缩
- **WHEN** 发请求前的预估 token 数超过本次 run 的上下文窗口阈值
- **THEN** 系统 SHALL 在发送本次 provider 请求前触发上下文压缩

#### Scenario: 预估未超过阈值不压缩
- **WHEN** 发请求前的预估 token 数未超过本次 run 的上下文窗口阈值
- **THEN** 系统 SHALL NOT 触发压缩
- **THEN** 系统 SHALL 按现有流程发送请求

#### Scenario: 强制压缩不受用户阈值影响
- **WHEN** 用户通过 `/compact` 或等价调用以强制模式执行压缩
- **THEN** 系统 SHALL 跳过用户级安全比例的阈值判定
- **THEN** 系统 SHALL 继续执行既有边界计算和摘要生成规则

### Requirement: 压缩边界计算
系统 SHALL 按「保留最近 K 条记录」计算压缩边界，K 为可配置条数并具备默认值。初始边界 SHALL 为 `records.length - K`。系统 SHALL 把边界向前吸附到一个干净的 turn 起点，使活跃区间不以孤立 `tool_result` 开头、不切断任何 `tool_call`/`tool_result` 配对。

#### Scenario: 保留最近 K 条
- **WHEN** 触发压缩且记录总数大于 K
- **THEN** 系统 SHALL 以 `records.length - K` 作为初始压缩边界

#### Scenario: 边界吸附避免切断工具配对
- **WHEN** 初始压缩边界落在某个 `tool_call`/`tool_result` 配对中间或使活跃区间以孤立 `tool_result` 开头
- **THEN** 系统 SHALL 把边界向前移动到最近的 `user` 或 `assistant` turn 起点
- **THEN** 压缩后的活跃区间 SHALL NOT 以孤立 `tool_result` 开头

#### Scenario: 压缩边界继续保护 use_skill 工具配对
- **WHEN** 压缩边界落在 `use_skill` 的 tool_call/tool_result 配对中间
- **THEN** 系统 SHALL 沿用普通工具配对保护，把边界吸附到干净 turn 起点
- **THEN** 活跃区间 SHALL NOT 以孤立 `use_skill` tool_result 开头

#### Scenario: 记录不足以压缩时不压缩
- **WHEN** 触发压缩但记录总数不大于 K
- **THEN** 系统 SHALL NOT 产生新的压缩边界
- **THEN** 系统 SHALL 按现有流程发送请求

### Requirement: 结构化摘要生成
系统 SHALL 复用当前生效的 LLM 发起一次专门的摘要请求，把压缩边界之前的历史压缩为结构化摘要文本。摘要请求 SHALL NOT 暴露任何已注册工具定义，且 SHALL NOT 携带普通 agent turn 配置的 reasoning 参数。摘要 SHALL 指示模型保留关键决策、涉及的文件路径、待办事项和重要工具结果结论。当已存在上一版摘要时，系统 SHALL 把旧摘要连同新增被压缩记录一起作为摘要输入，产出单条滚动更新的摘要，而不是堆叠多条摘要。

#### Scenario: 首次压缩生成摘要
- **WHEN** session 尚无压缩摘要且触发压缩
- **THEN** 系统 SHALL 用边界之前的历史记录发起一次摘要请求
- **THEN** 系统 SHALL 把返回的结构化文本作为 session 的压缩摘要

#### Scenario: 再次压缩滚动更新摘要
- **WHEN** session 已存在压缩摘要且再次触发压缩
- **THEN** 系统 SHALL 把旧摘要与新增被压缩记录一起作为摘要输入
- **THEN** 系统 SHALL 用新返回文本替换旧摘要，保持单条摘要

#### Scenario: 摘要请求不继承普通 turn 能力
- **WHEN** 当前 agent 注册了本地或 MCP 工具，或当前模型配置了 reasoning 参数
- **THEN** 摘要 provider 请求 SHALL NOT 包含工具定义或工具调用控制参数
- **THEN** 摘要 provider 请求 SHALL NOT 包含普通 agent turn 配置的 reasoning 参数
- **THEN** 后续普通 agent turn SHALL 继续按原配置发送工具定义和 reasoning 参数

### Requirement: 压缩状态存储
系统 SHALL 把压缩状态作为 session 级元数据持久化，包含摘要文本、活跃区间起点索引和创建时间。完整 `records[]` SHALL 保持全量 append-only，不因压缩而删除任何记录。活跃区间起点索引 `activeStartIndex` SHALL 以条数表示，使 `records[activeStartIndex:]` 唯一确定活跃区间。自动压缩追加可见提示记录时，runtime record region 与持久化 transcript SHALL 保持相同的记录坐标系，使同一 agent run 内后续压缩返回的索引仍直接对应持久化 `records[]`。

#### Scenario: 压缩后保存压缩元数据
- **WHEN** 一次压缩完成
- **THEN** 系统 SHALL 在当前 session 中保存摘要文本和活跃区间起点索引
- **THEN** 系统 SHALL 保留完整的 `records[]`，不删除被压缩区间的任何记录

#### Scenario: 完整历史不因压缩丢失
- **WHEN** session 已发生压缩
- **THEN** 持久化的 `records[]` SHALL 仍包含被压缩区间的全部原始记录

#### Scenario: 同一 agent run 连续压缩保持索引一致
- **WHEN** 自动压缩追加了可见提示记录，且同一 agent run 随后再次触发压缩
- **THEN** runtime record region 与持久化 transcript SHALL 在提示记录位置保持一致
- **THEN** 第二次压缩返回的 `activeStartIndex` SHALL 指向两侧同一条业务记录
- **THEN** 已纳入摘要的记录 SHALL NOT 因索引偏移再次出现在活跃区间

### Requirement: 压缩后的请求投影
系统 SHALL 在存在压缩状态时按「system prompt + 摘要消息 + 活跃区间」投影 provider 请求。摘要 SHALL 作为一条 `user` 消息置于内置 system prompt 之后、活跃区间之前。活跃区间 SHALL 为 `records[activeStartIndex:]`，按现有转换规则投影。无压缩状态时 SHALL 退化为现有「system prompt + 全部记录」投影。

#### Scenario: 存在压缩状态时注入摘要并切片
- **WHEN** session 存在压缩状态且发起 provider 请求
- **THEN** provider input SHALL 在 system prompt 之后包含一条携带摘要文本的 `user` 消息
- **THEN** provider input SHALL 只包含 `records[activeStartIndex:]` 投影出的记录，而不是全部记录

#### Scenario: 无压缩状态时退化为全量投影
- **WHEN** session 不存在压缩状态且发起 provider 请求
- **THEN** provider input SHALL 包含全部可发送记录
- **THEN** provider input SHALL NOT 包含摘要消息

### Requirement: skill 工具结果随普通上下文压缩
系统 SHALL 将 `use_skill` 的 tool_call/tool_result 记录视为普通工具记录参与上下文压缩。系统 SHALL NOT 为 skill 内容实现独立 active 生命周期、手动逐出或特殊重挂机制。

#### Scenario: skill result 保留在活跃区间时继续投影
- **WHEN** `use_skill` 的 tool_result 位于压缩状态的活跃区间内
- **THEN** provider input SHALL 按普通 tool_result 转换规则包含该 skill 内容
- **THEN** 系统 SHALL NOT 额外注入另一份 skill 正文

#### Scenario: skill result 进入被压缩区间时由摘要承载
- **WHEN** 历史中的 `use_skill` tool_result 位于新的压缩边界之前
- **THEN** 压缩摘要请求 SHALL 可把该 skill 使用事实和必要结论纳入结构化摘要
- **THEN** 后续 provider input SHALL 不再包含该旧 tool_result 原文，除非它仍在活跃区间内

### Requirement: 可复用压缩操作
系统 SHALL 提供一个可复用的异步压缩操作 `runCompaction`，封装「估算（可选）→ 阈值判定（可选）→ 边界计算 → 摘要生成」的完整编排，供自动触发与手动触发共享。该操作 SHALL 为纯函数式：仅依据入参计算并返回结果，SHALL NOT 直接修改外部状态或触发回调。返回结果 SHALL 包含是否发生压缩、原因，以及压缩发生时的新压缩状态。

#### Scenario: 压缩成功返回新状态
- **WHEN** 调用 `runCompaction` 且边界计算得到有效活跃区间起点
- **THEN** 该操作 SHALL 生成结构化摘要并返回「已压缩」结果，携带新的压缩状态（摘要文本 + 活跃区间起点索引）
- **THEN** 该操作 SHALL NOT 直接修改调用方的状态或触发回调

#### Scenario: 自动模式未超阈值时不压缩
- **WHEN** 以非强制模式调用 `runCompaction` 且预估上下文长度未超过窗口阈值
- **THEN** 该操作 SHALL 返回「未压缩」结果并标明原因为未达阈值
- **THEN** 该操作 SHALL NOT 发起摘要请求

#### Scenario: 边界不足以压缩
- **WHEN** 调用 `runCompaction` 但边界吸附后无法得到比当前活跃区间起点更靠前的有效边界
- **THEN** 该操作 SHALL 返回「未压缩」结果并标明原因为无有效边界
- **THEN** 该操作 SHALL NOT 发起摘要请求

### Requirement: 强制触发压缩
系统 SHALL 支持以强制模式调用压缩操作：强制模式 SHALL 跳过上下文长度阈值判定，直接进入边界计算与摘要生成。强制模式 SHALL 仍执行压缩边界吸附，确保不切断 tool_call/tool_result 配对、活跃区间不以孤立 tool_result 开头。

#### Scenario: 强制模式绕过阈值直接压缩
- **WHEN** 以强制模式调用压缩操作且存在可前移的有效边界
- **THEN** 该操作 SHALL 跳过阈值判定直接生成摘要并返回「已压缩」结果
- **THEN** 该操作 SHALL NOT 因当前长度未超阈值而拒绝压缩

#### Scenario: 强制模式仍保护工具配对
- **WHEN** 以强制模式调用压缩操作且初始边界会切断 tool_call/tool_result 配对
- **THEN** 该操作 SHALL 把边界向前吸附到干净 turn 起点
- **THEN** 压缩后的活跃区间 SHALL NOT 以孤立 tool_result 开头

### Requirement: reasoning summary 不参与上下文压缩输入
系统 SHALL 将 `reasoning_summary` 视为本地可见、非 provider-facing 的 transcript role。上下文长度估算、压缩摘要输入和压缩后的 provider request 投影 SHALL 忽略 `reasoning_summary` records。

#### Scenario: token 估算跳过 reasoning summary
- **WHEN** 当前活跃 transcript records 包含 `reasoning_summary` record
- **THEN** 上下文长度估算 SHALL 不把该 record 的文本计入 provider input token 预估
- **THEN** 估算 SHALL 继续计入后续可发送的 user、assistant、tool_call 和 tool_result records

#### Scenario: 压缩摘要输入跳过 reasoning summary
- **WHEN** 系统生成结构化压缩摘要，且被压缩区间包含 `reasoning_summary` record
- **THEN** 摘要请求输入 SHALL 不包含该 reasoning summary 原文
- **THEN** 摘要请求 SHALL 继续包含被压缩区间内可发送 records 的必要内容

#### Scenario: 压缩后 provider input 不包含 reasoning summary
- **WHEN** session 存在压缩状态且活跃区间包含 `reasoning_summary` record
- **THEN** provider input SHALL 不包含该 reasoning summary record
- **THEN** provider input SHALL 继续包含压缩摘要消息和活跃区间内其他可发送 records

#### Scenario: reasoning summary 不影响压缩边界保护
- **WHEN** 压缩边界附近存在 `reasoning_summary` record
- **THEN** 系统 SHALL 继续保护 tool_call/tool_result 配对不被切断
- **THEN** 系统 SHALL NOT 因 reasoning summary record 破坏已有边界吸附规则
