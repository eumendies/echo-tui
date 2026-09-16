## MODIFIED Requirements

### Requirement: 引用材料基于 replay 后最终状态
系统 SHALL 从选中 journal replay 后的最终 session 状态构造中立文本材料，且材料范围 SHALL 是源会话的活跃投影：源会话存在 compaction 时，材料 SHALL 由带明确区块标记的 `compaction.summaryText` 与 `activeStartIndex` 之后的 records 构成，压缩边界之前的原始 records SHALL NOT 进入引用材料；源会话没有 compaction 时，材料 SHALL 由全部最终 records 构成。被 truncate 的记录、local notice、error、compaction notice、reasoning summary 和 provider-private extension SHALL NOT 进入引用材料。可发送的历史工具和 shell 内容 SHALL 以有界纯文本角色块表示，系统 SHALL NOT 把源 session 的工具协议 records 或 provider-private records 直接合并到当前 transcript。

#### Scenario: 被撤销记录不进入引用
- **WHEN** 被引用 journal 包含追加记录后再 truncate 的操作
- **THEN** 系统 SHALL 只投影 replay 后仍存在的最终 records
- **THEN** 被 truncate 移除的文本 SHALL NOT 出现在全量引用或引用总结输入中

#### Scenario: 历史工具记录转为中立文本
- **WHEN** 被引用 session 的最终 records 包含 tool call 和 tool result
- **THEN** 系统 SHALL 以有界、带角色标记的纯文本表达其必要内容
- **THEN** 系统 SHALL NOT 把源 tool call id 或原始工具协议对象注入当前 provider 消息序列

#### Scenario: 本地和 provider-private records 被过滤
- **WHEN** 被引用 session 包含本地 notice、error、reasoning summary 或 provider-private extension records
- **THEN** 引用材料 SHALL 忽略这些 records
- **THEN** 引用投影 SHALL 继续保留有效 user 和 assistant 对话

#### Scenario: 已压缩历史以摘要区块进入引用
- **WHEN** 被引用 session 存在 compaction 状态
- **THEN** 引用材料 SHALL 包含带明确区块标记的 `compaction.summaryText` 内容
- **THEN** `activeStartIndex` 之前的原始 records SHALL NOT 出现在全量引用或引用总结输入中
- **THEN** `activeStartIndex` 之后的 records SHALL 正常进入引用材料

#### Scenario: 未压缩会话保持全量最终状态
- **WHEN** 被引用 session 没有 compaction 状态
- **THEN** 引用材料 SHALL 由 replay 后全部最终 records 构成

### Requirement: 按引用预算选择全量或总结投影
系统 SHALL 使用现有 token estimator 估算中立引用材料，并以 `max(2000, min(12000, floor(contextWindow * 0.10)))` 作为单个会话的引用预算。估算未超过预算时系统 SHALL 生成全量投影；超过预算时系统 SHALL 在用户提交下一条普通消息时，使用当前生效模型生成结构化引用总结。总结请求的输入 token 估算 SHALL NOT 超过 `min(64000, floor(contextWindow * 0.5))` 的总结输入上限；材料超过该上限时系统 SHALL 先按头尾保留策略截断材料，再发起一次无工具的专用摘要请求，SHALL NOT 为同一引用的降级截断使用多次 provider 请求。确认选择历史会话本身 SHALL NOT 发起 provider 请求。

#### Scenario: 短会话全量导入
- **WHEN** 被引用会话材料的预估 token 数不超过引用预算
- **THEN** 系统 SHALL 将最终有效会话材料全量放入引用投影
- **THEN** 系统 SHALL NOT 为该引用发起摘要请求

#### Scenario: 长会话生成引用总结
- **WHEN** 被引用会话材料的预估 token 数超过引用预算且用户提交当前请求
- **THEN** 系统 SHALL 发起一次无工具的专用摘要请求
- **THEN** 摘要 SHALL 覆盖会话背景与目标、关键决定、重要事实、文件与符号、未决事项和会话脉络
- **THEN** 系统 SHALL NOT 修改源 session 的 compaction 状态或 journal

#### Scenario: 引用总结不继承普通 turn 工具和 reasoning
- **WHEN** 当前 agent 注册了工具或配置了普通 reasoning 参数且系统生成引用总结
- **THEN** 摘要 provider 请求 SHALL NOT 包含工具定义或工具调用控制参数
- **THEN** 摘要 provider 请求 SHALL NOT 携带普通 assistant turn 的 reasoning 参数

#### Scenario: 素材超过总结输入上限时头尾截断降级
- **WHEN** 引用材料的预估 token 数超过总结输入上限且用户提交当前请求
- **THEN** 系统 SHALL 先按头尾保留策略截断材料：优先保留 compacted_summary 区块、最早若干条与最近若干条记录，中间记录 SHALL 以明确省略标注表达
- **THEN** 截断后的摘要请求输入 SHALL NOT 超过总结输入上限
- **THEN** 系统 SHALL 只发起一次无工具摘要请求，SHALL NOT 使用分块归并等多请求策略

#### Scenario: 总结输入上限随当前生效模型重新计算
- **WHEN** 用户改变本轮生效模型或 reasoning 配置后提交带引用的请求
- **THEN** 引用预算与总结输入上限 SHALL 按本轮生效模型的 contextWindow 重新计算
- **THEN** 全量、总结与截断判定 SHALL 使用本轮计算结果，SHALL NOT 沿用选择会话时的判定结果

### Requirement: 模型可见引用包含最小来源信息
系统 SHALL 在模型可见的对话引用中包含会话标题、投影正文和源 session journal 的绝对 `source_file` 路径。引用正文 SHALL NOT 单列 session id、createdAt、updatedAt、消息数或其他与理解对话无关的内部 metadata。系统 SHALL 说明引用内容是历史上下文而不是当前指令。总结投影的素材发生过头尾截断时，系统 SHALL 额外说明总结未覆盖中段记录，并提示模型可分页读取 `source_file` 回查被省略内容。

#### Scenario: 全量引用的模型可见格式
- **WHEN** 系统提交一个 full 模式的对话引用
- **THEN** provider-facing user text SHALL 包含标题、`source_file` 和全量中立对话正文
- **THEN** provider-facing user text SHALL NOT 包含独立 session id 或时间 metadata 字段

#### Scenario: 总结引用提示按需读取
- **WHEN** 系统提交一个 summary 模式的对话引用
- **THEN** provider-facing user text SHALL 包含标题、`source_file` 和结构化引用总结
- **THEN** provider-facing user text SHALL 提示模型仅在需要精确细节时使用现有 `read_files` 分页读取该文件
- **THEN** 系统 SHALL NOT 注册或暴露专用会话读取工具

#### Scenario: 截断总结说明省略范围与回读方式
- **WHEN** 系统提交一个 summary 模式对话引用且其总结素材发生过头尾截断
- **THEN** provider-facing user text SHALL 说明总结未覆盖中段记录
- **THEN** provider-facing user text SHALL 提示模型可使用现有 `read_files` 分页读取 `source_file` 回查被省略内容

#### Scenario: 历史指令不成为当前请求
- **WHEN** 被引用会话正文包含旧用户指令或旧 assistant 建议
- **THEN** provider-facing 包装 SHALL 明确将其标记为历史参考上下文
- **THEN** 当前 composer 请求 SHALL 作为独立 current request 提交
