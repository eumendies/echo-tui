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
系统 SHALL 按「保留最近 K 条记录」计算压缩边界，K 为可配置条数并具备默认值。初始边界 SHALL 为 `records.length - K`。系统 SHALL 把边界向前吸附到一个干净的 turn 起点，使活跃区间不以孤立 `tool_result` 开头、不切断任何 `tool_call`/`tool_result` 配对，也不使被压缩区间以孤立 `extension`（provider reasoning 回传）记录结尾；`extension` 记录与其后续记录 SHALL 保持同侧，吸附规则 SHALL 迭代到稳定。

#### Scenario: 保留最近 K 条
- **WHEN** 触发压缩且记录总数大于 K
- **THEN** 系统 SHALL 以 `records.length - K` 作为初始压缩边界

#### Scenario: 边界吸附避免切断工具配对
- **WHEN** 初始压缩边界落在某个 `tool_call`/`tool_result` 配对中间或使活跃区间以孤立 `tool_result` 开头
- **THEN** 系统 SHALL 把边界向前移动到最近的 `user` 或 `assistant` turn 起点
- **THEN** 压缩后的活跃区间 SHALL NOT 以孤立 `tool_result` 开头

#### Scenario: 边界吸附保持 extension 与其后续记录同侧
- **WHEN** 初始边界使被压缩区间以 `extension` 记录结尾、其后续记录会落入活跃区间
- **THEN** 系统 SHALL 把边界继续向前吸附，直到被压缩区间不以 `extension` 记录结尾
- **THEN** 该 `extension` 记录与其后续记录 SHALL 同处活跃区间
- **THEN** 摘要请求输入 SHALL NOT 包含与其后续记录分离的 `extension` 记录

#### Scenario: 压缩边界继续保护 use_skill 工具配对
- **WHEN** 压缩边界落在 `use_skill` 的 tool_call/tool_result 配对中间
- **THEN** 系统 SHALL 沿用普通工具配对保护，把边界吸附到干净 turn 起点
- **THEN** 活跃区间 SHALL NOT 以孤立 `use_skill` tool_result 开头

#### Scenario: 记录不足以压缩时不压缩
- **WHEN** 触发压缩但记录总数不大于 K
- **THEN** 系统 SHALL NOT 产生新的压缩边界
- **THEN** 系统 SHALL 按现有流程发送请求

### Requirement: 结构化摘要生成
系统 SHALL 复用当前生效的 LLM 发起一次专门的摘要请求，把压缩边界之前的历史压缩为结构化摘要文本。摘要请求输入 SHALL 由「与同一会话普通请求同源构造的请求前导」「被压缩记录的原生 provider 转换投影」「末尾一条携带摘要指令的 user 消息」组成：请求前导 SHALL 复用普通请求的前导构造（内置 system prompt，以及存在压缩状态时位置与普通请求一致的摘要消息），材料口径一致时 SHALL 与普通请求逐字一致，使压缩请求与普通请求共享最长 token 前缀；被压缩记录 SHALL 按各 provider adapter 的既有 transcript 转换规则投影（保留 user、assistant、tool、shell、extension 等原始形态与配对关系），SHALL NOT 拍平为 `[role] text` 形式的纯文本，SHALL NOT 额外过滤 `extension`（provider reasoning 回传）记录；摘要指令 SHALL 作为输入中的最后一条 user 消息贴近生成点。摘要请求 SHALL 复用同一会话普通请求的缓存路由身份：会话身份可用时 SHALL 透传会话身份；使用显式 prompt cache key 的 provider SHALL 保持键材料口径与普通请求一致（含工具目录材料），SHALL NOT 因压缩语义改变键材料。摘要请求 SHALL 携带与普通请求同源的工具定义（同一 registry 与转换口径），使工具定义段与请求前导共同构成与普通请求的最长共享 token 前缀；摘要请求 SHALL NOT 携带工具调用控制参数（`tool_choice`、`parallel_tool_calls` 维持不发送），使摘要请求不触发工具调用。摘要 SHALL 指示模型保留关键决策、涉及的文件路径、待办事项和重要工具结果结论。当会话配置了 reasoning effort 时，摘要请求 SHALL 按与普通 turn 相同的规则携带该 effort 配置（含显式 `none` 的禁用语义），且 SHALL NOT 携带仅供展示的 reasoning summary 配置或 reasoning 加密回传请求。摘要请求 SHALL NOT 固定低输出详细度（verbosity）；普通 turn 的详细度行为 SHALL 保持不变。摘要请求 SHALL 把其 provider usage（含缓存命中输入 token）透出给调用方用于 usage 记账，SHALL NOT 因压缩语义丢弃 usage。系统 SHALL NOT 对摘要输出做小节模板校验：非空输出即采纳，中文小节标题或其他非模板措辞同样被接受。当已存在上一版摘要时，系统 SHALL 保持该摘要在请求前导中的原位，摘要指令 SHALL 引用该既有摘要并要求把新增被压缩记录合并为单条滚动更新摘要，且 SHALL NOT 重复嵌入旧摘要正文。

#### Scenario: 首次压缩生成摘要
- **WHEN** session 尚无压缩摘要且触发压缩
- **THEN** 系统 SHALL 用边界之前的历史记录发起一次摘要请求
- **THEN** 摘要请求前导 SHALL 以与普通请求同源构造的内置 system prompt 开头
- **THEN** 系统 SHALL 把返回的结构化文本作为 session 的压缩摘要

#### Scenario: 再次压缩滚动更新摘要
- **WHEN** session 已存在压缩摘要且再次触发压缩
- **THEN** 摘要请求前导 SHALL 在 system 记录之后原位携带既有摘要消息
- **THEN** 摘要指令 SHALL 要求把新增被压缩记录合并进既有摘要并产出单条更新摘要
- **THEN** 摘要指令 SHALL NOT 重复嵌入既有摘要正文
- **THEN** 系统 SHALL 用新返回文本替换旧摘要，保持单条摘要

#### Scenario: 摘要请求复用普通请求前导与原生投影
- **WHEN** 触发压缩并发起摘要请求
- **THEN** 摘要请求输入 SHALL 复用与同一会话普通请求相同的前导构造来源
- **THEN** 会话材料口径一致时，摘要请求输入的前导 SHALL 与普通请求逐字一致
- **THEN** 摘要请求输入 SHALL 包含被压缩记录的原生 provider 转换投影，而不是拍平的 `[role] text` 文本
- **THEN** 摘要请求输入的最后一条 SHALL 是携带摘要指令（含模板要求）的 user 消息

#### Scenario: extension 记录随原生投影进入摘要输入
- **WHEN** 被压缩区间包含 `extension` 记录
- **THEN** 摘要请求输入 SHALL 按普通请求同款转换规则投影该 `extension` 记录，SHALL NOT 额外过滤
- **THEN** 摘要请求 SHALL 继续包含被压缩区间内其他可发送记录

#### Scenario: 摘要请求复用普通请求缓存身份
- **WHEN** 触发压缩
- **THEN** 摘要请求 SHALL 复用与同一会话普通请求相同的 prompt cache key 身份
- **THEN** 会话身份可用时，摘要请求 SHALL 透传与普通请求相同的会话身份
- **THEN** prompt cache key 材料口径 SHALL 与普通请求一致（含工具目录材料），SHALL NOT 因压缩语义改变
- **THEN** 摘要请求 SHALL 携带与普通请求同源的工具定义，使工具定义段与请求前导共同构成共享 token 前缀
- **THEN** 普通请求自身的缓存身份与键材料 SHALL 保持不变

#### Scenario: 中文标题等非模板措辞同样被采纳
- **WHEN** 摘要生成返回非空文本，且其小节标题使用中文或其他非模板措辞
- **THEN** 系统 SHALL 采纳该文本作为 session 的压缩摘要
- **THEN** 系统 SHALL NOT 因小节标题语言或措辞与模板不一致而拒绝输出或判定压缩失败

#### Scenario: 摘要请求携带工具定义与会话 reasoning
- **WHEN** 当前 agent 注册了本地或 MCP 工具，且当前模型配置了 reasoning effort（含显式 `none`）
- **THEN** 摘要 provider 请求 SHALL 包含与普通请求同源的工具定义
- **THEN** 手动 `/compact` 路径 SHALL 使用与主会话相同的工具目录装配口径（含按运行条件注册的委派工具），SHALL NOT 因独立装配而缺失工具定义
- **THEN** 摘要 provider 请求 SHALL NOT 包含工具调用控制参数
- **THEN** 摘要 provider 请求 SHALL 按与普通 turn 相同的规则携带该 reasoning effort（`none` 保持显式禁用语义）
- **THEN** 摘要 provider 请求 SHALL NOT 包含仅供展示的 reasoning summary 配置或 reasoning 加密回传请求
- **THEN** 后续普通 agent turn SHALL 继续按原配置发送工具定义和 reasoning 参数

#### Scenario: codex 摘要请求不固定低 verbosity
- **WHEN** 使用 codex adapter 生成摘要，且普通 turn 发送固定 `low` verbosity
- **THEN** 摘要请求 SHALL NOT 携带 `verbosity: low`
- **THEN** 后续普通 turn SHALL 继续按既有行为发送固定 verbosity

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
系统 SHALL 在存在压缩状态时按「system prompt + 摘要消息 + 活跃区间」投影 provider 请求。摘要 SHALL 作为一条 `user` 消息置于内置 system prompt 之后、活跃区间之前。活跃区间 SHALL 为 `records[activeStartIndex:]`，按现有转换规则投影。无压缩状态时 SHALL 退化为现有「system prompt + 全部记录」投影。当当前 session 的 journal 源路径可用时，摘要消息 SHALL 附加该 `source_file` 绝对路径，并提示模型仅在需要精确细节时使用现有 `read_files` 工具分页读取该文件；路径不可用（如 headless 单轮运行）时 SHALL 只注入摘要本身。

#### Scenario: 存在压缩状态时注入摘要并切片
- **WHEN** session 存在压缩状态且发起 provider 请求
- **THEN** provider input SHALL 在 system prompt 之后包含一条携带摘要文本的 `user` 消息
- **THEN** provider input SHALL 只包含 `records[activeStartIndex:]` 投影出的记录，而不是全部记录

#### Scenario: 无压缩状态时退化为全量投影
- **WHEN** session 不存在压缩状态且发起 provider 请求
- **THEN** provider input SHALL 包含全部可发送记录
- **THEN** provider input SHALL NOT 包含摘要消息

#### Scenario: 存在源路径时注入回读提示
- **WHEN** session 存在压缩状态、发起 provider 请求且当前 session 的 journal 源路径可用
- **THEN** 摘要消息 SHALL 附带 `source_file: <绝对路径>` 行
- **THEN** 摘要消息 SHALL 提示模型仅在需要精确细节时使用现有 `read_files` 工具分页读取该文件
- **THEN** 系统 SHALL NOT 注册或暴露新的专用会话读取工具

#### Scenario: 源路径不可用时只注入摘要
- **WHEN** session 存在压缩状态、发起 provider 请求且当前 session 无 journal 源路径（如 headless 单轮运行）
- **THEN** 摘要消息 SHALL NOT 包含 `source_file` 行或回读提示
- **THEN** 摘要消息 SHALL 继续包含摘要文本本身

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
系统 SHALL 提供一个可复用的异步压缩操作 `runCompaction`，封装「估算（可选）→ 阈值判定（可选）→ 边界计算 → 摘要生成」的完整编排，供自动触发与手动触发共享。该操作 SHALL 为纯函数式：仅依据入参计算并返回结果，SHALL NOT 直接修改外部状态或触发回调。返回结果 SHALL 包含是否发生压缩、原因，以及压缩发生时的新压缩状态。只要发生过摘要 provider 请求，返回结果 SHALL 同时携带该次请求的 usage 与 usageInputTokens（含摘要为空未被采纳的路径）；未发起摘要请求的路径 SHALL NOT 携带 usage 字段。

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

#### Scenario: 摘要请求 usage 随结果返回
- **WHEN** `runCompaction` 完成了至少一次摘要 provider 请求
- **THEN** 返回结果 SHALL 携带该次请求的 usage 与 usageInputTokens
- **THEN** 摘要文本为空未被采纳时，usage SHALL 仍随结果返回
- **THEN** 调用方 SHALL 能将该 usage 写入 usage 账本

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

### Requirement: 路径解析收敛于 app 层
系统 SHALL 在 app 层根据当前 cwd 与 session id 实时计算当前 session journal 的绝对路径，并通过 `AgentSessionInput` 的可选字段传给 agent runtime。该路径 SHALL NOT 被持久化进 `CompactionState` 或任何 journal 操作；headless 单轮运行没有 transcript store，SHALL NOT 提供该字段。

#### Scenario: 交互式运行提供源路径
- **WHEN** 交互式 TUI 中当前 session 已创建且 app 组装 agent session
- **THEN** `AgentSessionInput` SHALL 携带指向当前 session journal 的绝对路径
- **THEN** 该路径 SHALL 由 transcript store 的 session 文件路径规则派生

#### Scenario: headless 单轮运行不提供源路径
- **WHEN** 通过 `--once` 以 headless 模式运行且没有 transcript store
- **THEN** `AgentSessionInput` SHALL NOT 携带源路径字段
- **THEN** 压缩行为 SHALL 不因路径缺失而改变摘要生成或边界计算

#### Scenario: 路径不写入持久化状态
- **WHEN** 任意压缩发生且 app 层已计算出源路径
- **THEN** journal 中的 `set_compaction` 操作与 `CompactionState` 结构 SHALL 保持不变
- **THEN** 源路径 SHALL 只出现在 provider-facing 摘要消息中
- **THEN** 可见的 `compaction_notice` 记录 SHALL 保持既有文本，不包含源路径

