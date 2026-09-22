## MODIFIED Requirements

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
