## ADDED Requirements

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
系统 SHALL 在发起请求前比较当前预估 token 数与上下文窗口阈值。阈值 SHALL 为上下文窗口上限乘以一个小于 1 的安全比例。当预估值超过阈值时，系统 SHALL 触发上下文压缩；未超过时 SHALL 直接按现有流程发送请求。

#### Scenario: 预估超过阈值触发压缩
- **WHEN** 发请求前的预估 token 数超过上下文窗口阈值
- **THEN** 系统 SHALL 在发送本次 provider 请求前触发上下文压缩

#### Scenario: 预估未超过阈值不压缩
- **WHEN** 发请求前的预估 token 数未超过上下文窗口阈值
- **THEN** 系统 SHALL NOT 触发压缩
- **THEN** 系统 SHALL 按现有流程发送请求

### Requirement: 压缩边界计算
系统 SHALL 按「保留最近 K 条记录」计算压缩边界，K 为可配置条数并具备默认值。初始边界 SHALL 为 `records.length - K`。系统 SHALL 把边界向前吸附到一个干净的 turn 起点，使活跃区间不以孤立 `tool_result` 开头、不切断任何 `tool_call`/`tool_result` 配对。

#### Scenario: 保留最近 K 条
- **WHEN** 触发压缩且记录总数大于 K
- **THEN** 系统 SHALL 以 `records.length - K` 作为初始压缩边界

#### Scenario: 边界吸附避免切断工具配对
- **WHEN** 初始压缩边界落在某个 `tool_call`/`tool_result` 配对中间或使活跃区间以孤立 `tool_result` 开头
- **THEN** 系统 SHALL 把边界向前移动到最近的 `user` 或 `assistant` turn 起点
- **THEN** 压缩后的活跃区间 SHALL NOT 以孤立 `tool_result` 开头

#### Scenario: 记录不足以压缩时不压缩
- **WHEN** 触发压缩但记录总数不大于 K
- **THEN** 系统 SHALL NOT 产生新的压缩边界
- **THEN** 系统 SHALL 按现有流程发送请求

### Requirement: 结构化摘要生成
系统 SHALL 复用当前生效的 LLM 发起一次专门的摘要请求，把压缩边界之前的历史压缩为结构化摘要文本。摘要 SHALL 指示模型保留关键决策、涉及的文件路径、待办事项和重要工具结果结论。当已存在上一版摘要时，系统 SHALL 把旧摘要连同新增被压缩记录一起作为摘要输入，产出单条滚动更新的摘要，而不是堆叠多条摘要。

#### Scenario: 首次压缩生成摘要
- **WHEN** session 尚无压缩摘要且触发压缩
- **THEN** 系统 SHALL 用边界之前的历史记录发起一次摘要请求
- **THEN** 系统 SHALL 把返回的结构化文本作为 session 的压缩摘要

#### Scenario: 再次压缩滚动更新摘要
- **WHEN** session 已存在压缩摘要且再次触发压缩
- **THEN** 系统 SHALL 把旧摘要与新增被压缩记录一起作为摘要输入
- **THEN** 系统 SHALL 用新返回文本替换旧摘要，保持单条摘要

### Requirement: 压缩状态存储
系统 SHALL 把压缩状态作为 session 级元数据持久化，包含摘要文本、活跃区间起点索引和创建时间。完整 `records[]` SHALL 保持全量 append-only，不因压缩而删除任何记录。活跃区间起点索引 `activeStartIndex` SHALL 以条数表示，使 `records[activeStartIndex:]` 唯一确定活跃区间。

#### Scenario: 压缩后保存压缩元数据
- **WHEN** 一次压缩完成
- **THEN** 系统 SHALL 在当前 session 中保存摘要文本和活跃区间起点索引
- **THEN** 系统 SHALL 保留完整的 `records[]`，不删除被压缩区间的任何记录

#### Scenario: 完整历史不因压缩丢失
- **WHEN** session 已发生压缩
- **THEN** 持久化的 `records[]` SHALL 仍包含被压缩区间的全部原始记录

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
