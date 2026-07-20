## MODIFIED Requirements

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
