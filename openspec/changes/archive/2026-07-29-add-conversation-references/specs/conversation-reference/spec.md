## ADDED Requirements

### Requirement: 用户显式选择整个历史会话
系统 SHALL 提供 `/reference` 命令，让用户从当前 cwd 下可恢复的历史 session 中显式选择一个会话作为当前 composer 的对话引用。选择粒度 SHALL 是完整会话，系统 SHALL NOT 要求或允许用户在该流程中逐条选择消息。当前持久化 session SHALL NOT 作为可引用候选。

#### Scenario: 打开历史会话引用选择器
- **WHEN** 用户在无活跃响应或 modal 流程时提交 `/reference`
- **THEN** 系统 SHALL 打开历史会话引用选择 surface
- **THEN** surface SHALL 列出当前 cwd 下除当前 session 外的有效历史会话
- **THEN** surface SHALL NOT 显示消息勾选或逐消息多选控件

#### Scenario: 确认一个历史会话
- **WHEN** 用户在引用选择器中选中一个有效历史会话并确认
- **THEN** 系统 SHALL 加载该 session journal 的 replay 后最终状态
- **THEN** 系统 SHALL 为该完整会话准备一个 composer 对话附件
- **THEN** 系统 SHALL NOT 替换或恢复当前 transcript

#### Scenario: 当前目录没有可引用会话
- **WHEN** 用户打开 `/reference` 且当前 cwd 下除当前 session 外没有有效历史会话
- **THEN** 系统 SHALL 显示可关闭的空状态
- **THEN** 系统 SHALL NOT 创建 pending 对话引用

### Requirement: 会话候选具有可辨识标题和预览
系统 SHALL 从 replay 后 session 的第一条有效 user 消息派生有界标题，优先使用 `displayText` 并回退 `text`。引用选择 surface SHALL 使用标题、时间和有界预览帮助用户区分会话；composer 附件和已提交引用卡片 SHALL 使用标题而不展示 session id 或更新时间。

#### Scenario: 从第一条用户消息派生标题
- **WHEN** 一个历史 session 至少包含一条有效 user record
- **THEN** 系统 SHALL 从第一条 user record 的 `displayText` 或 `text` 派生单行有界标题
- **THEN** 引用选择器 SHALL 使用该标题标识候选会话

#### Scenario: 引用卡片隐藏内部 metadata
- **WHEN** composer 或 transcript 渲染一个对话引用卡片
- **THEN** 卡片 SHALL 显示被引用会话标题和投影模式的必要提示
- **THEN** 卡片 SHALL NOT 显示 session id、updatedAt 或等价内部时间字段

### Requirement: 引用附件独立于 composer 文本
系统 SHALL 将待提交对话引用保存为独立 transient attachment，而不是把全量历史或总结插入 composer 字符数组。首版每个 composer 草稿 SHALL 最多持有一个对话引用；再次选择 SHALL 替换旧引用。

#### Scenario: 确认引用后返回 composer
- **WHEN** 一个历史会话的 replay 材料准备完成
- **THEN** 系统 SHALL 关闭引用选择或准备 surface
- **THEN** composer SHALL 显示独立引用卡片
- **THEN** composer 文本和光标 SHALL 保持可正常编辑

#### Scenario: 替换已有引用
- **WHEN** composer 已有 pending 对话引用且用户通过 `/reference` 确认另一个会话
- **THEN** 系统 SHALL 用新引用替换旧引用
- **THEN** 下一次提交 SHALL NOT 同时展开两个历史会话

### Requirement: 引用材料基于 replay 后最终状态
系统 SHALL 从选中 journal replay 后的最终 session records 构造中立文本材料。被 truncate 的记录、local notice、error、compaction notice、reasoning summary 和 provider-private extension SHALL NOT 进入引用材料。可发送的历史工具和 shell 内容 SHALL 以有界纯文本角色块表示，系统 SHALL NOT 把源 session 的工具协议 records 或 provider-private records 直接合并到当前 transcript。

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

### Requirement: 按引用预算选择全量或总结投影
系统 SHALL 使用现有 token estimator 估算中立引用材料，并以 `max(2000, min(12000, floor(contextWindow * 0.10)))` 作为单个会话的引用预算。估算未超过预算时系统 SHALL 生成全量投影；超过预算时系统 SHALL 在用户提交下一条普通消息时，使用当前生效模型生成覆盖完整有效会话的结构化引用总结。确认选择历史会话本身 SHALL NOT 发起 provider 请求。

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

### Requirement: 模型可见引用包含最小来源信息
系统 SHALL 在模型可见的对话引用中包含会话标题、投影正文和源 session journal 的绝对 `source_file` 路径。引用正文 SHALL NOT 单列 session id、createdAt、updatedAt、消息数或其他与理解对话无关的内部 metadata。系统 SHALL 说明引用内容是历史上下文而不是当前指令。

#### Scenario: 全量引用的模型可见格式
- **WHEN** 系统提交一个 full 模式的对话引用
- **THEN** provider-facing user text SHALL 包含标题、`source_file` 和全量中立对话正文
- **THEN** provider-facing user text SHALL NOT 包含独立 session id 或时间 metadata 字段

#### Scenario: 总结引用提示按需读取
- **WHEN** 系统提交一个 summary 模式的对话引用
- **THEN** provider-facing user text SHALL 包含标题、`source_file` 和结构化引用总结
- **THEN** provider-facing user text SHALL 提示模型仅在需要精确细节时使用现有 `read_files` 分页读取该文件
- **THEN** 系统 SHALL NOT 注册或暴露专用会话读取工具

#### Scenario: 历史指令不成为当前请求
- **WHEN** 被引用会话正文包含旧用户指令或旧 assistant 建议
- **THEN** provider-facing 包装 SHALL 明确将其标记为历史参考上下文
- **THEN** 当前 composer 请求 SHALL 作为独立 current request 提交

### Requirement: 提交时固化并持久化引用投影
系统 SHALL 在下一次普通 user submit 时固化 pending 引用投影，并与当前 composer 请求组合为 provider-facing user `text`，同时保持 `displayText` 为用户当前输入。长会话总结属于该提交阶段。user metadata SHALL 保存渲染引用卡片和追踪本地来源所需的信息。实际全量正文或总结 SHALL 随 user record 持久化，使源 journal 后续变化不改写已提交引用。

#### Scenario: 提交带引用的当前请求
- **WHEN** composer 有准备完成的对话引用且用户提交非空普通请求
- **THEN** user record 的 provider-facing `text` SHALL 同时包含引用投影和当前请求
- **THEN** user record 的 `displayText` SHALL 保持用户当前请求而不展开历史全文
- **THEN** user metadata SHALL 允许 replay 后重新渲染引用卡片

#### Scenario: 源会话后续更新不改写引用
- **WHEN** 带引用的 user record 已持久化且源 session 后续追加新 records
- **THEN** 当前 transcript 中已保存的引用投影 SHALL 保持不变
- **THEN** replay 当前 transcript SHALL 得到当时提交给模型的相同引用正文或总结

#### Scenario: 后续 turn 自然继承引用
- **WHEN** 带引用的 user record 已提交且用户继续普通对话
- **THEN** 后续 provider 请求 SHALL 通过当前 transcript 继承已提交引用
- **THEN** 系统 SHALL NOT 再次把同一 pending attachment 重复展开到下一条 user record

### Requirement: 引用准备和 transient 生命周期可控
系统 SHALL 在长会话总结期间显示工作状态、阻止重复提交并支持 Esc 取消。准备失败或取消 SHALL NOT 写入 user/assistant transcript，也 SHALL NOT 修改源 session。pending 引用 SHALL 在成功提交、`/clear`、加载其他 session 或显式取消时清理。

#### Scenario: 取消长会话引用总结
- **WHEN** 系统正在为长会话生成引用总结且用户按 Esc
- **THEN** 系统 SHALL 中断摘要请求并退出准备状态
- **THEN** 系统 SHALL NOT 追加引用、user 或 assistant transcript records
- **THEN** 源 session SHALL 保持不变
- **THEN** 系统 SHALL 保留待提交引用和 composer 请求，允许用户再次提交重试

#### Scenario: 引用准备失败
- **WHEN** journal 无法 replay、引用材料为空、模型摘要失败或返回空文本
- **THEN** 系统 SHALL 显示可关闭的失败反馈
- **THEN** journal replay 或材料构造失败时系统 SHALL NOT 创建 pending 引用；提交阶段的摘要失败时 SHALL 保留已有 pending 引用供重试
- **THEN** 当前 transcript 和源 session SHALL 保持不变

#### Scenario: 成功提交后清理附件
- **WHEN** 带 pending 引用的普通 user submit 成功开始 assistant turn
- **THEN** 系统 SHALL 清理 composer 的 pending 引用附件
- **THEN** footer SHALL 不再把该引用显示为待提交附件

#### Scenario: 会话切换和清空清理附件
- **WHEN** 用户执行 `/clear` 或通过 `/resume` 成功加载其他 session
- **THEN** 系统 SHALL 清理任何 pending 对话引用
- **THEN** 清理 SHALL NOT 删除已持久化 user records 中的历史引用 metadata 或正文
