## ADDED Requirements

### Requirement: 回合完成后的独立评估
goal `active` 时，系统 SHALL 在每个主会话 assistant 回合成功完成后发起一次目标评估。评估 SHALL 由独立模型判断器执行：使用无工具的 provider 调用，以评估时刻当前配置严格解析 goal 评估模型 profile，输入为有界证据投影（目标激活后的 transcript 可见内容：assistant 文本、工具结果与本地通知，条数与字符双上限），并按严格判定协议解析响应（首个判定为 yes/no 加简短理由）。评估请求的 prompt 与原始响应 SHALL NOT 进入 transcript；评估结果 SHALL 只经由 GoalState 的最近评估字段与 local notice 呈现。评估请求 SHALL 设有 30 秒超时上限。

#### Scenario: 回合完成后触发评估
- **WHEN** goal 为 `active` 且一个主会话 assistant 回合成功完成（用户回合或自动推进回合）
- **THEN** 系统 SHALL 发起一次目标评估请求
- **AND** 评估 SHALL 只消费 transcript 中已可见的证据
- **AND** 评估 SHALL NOT 自行运行测试、执行工具或修改工作区

#### Scenario: 证据投影有界
- **WHEN** 目标激活后的 transcript 记录数或总体积超过投影上限
- **THEN** 证据投影 SHALL 截断为最近的有界窗口
- **AND** 截断 SHALL NOT 影响 goal 状态或 transcript 本身

#### Scenario: 严格判定协议
- **WHEN** 评估模型返回响应
- **THEN** 系统 SHALL 按「首个判定 yes 或 no + 简短理由」协议解析
- **AND** 响应无法解析为合法判定时 SHALL 判为 unavailable

#### Scenario: 评估不污染 transcript
- **WHEN** 评估请求完成、失败或超时
- **THEN** 系统 SHALL NOT 把评估 prompt 或原始响应追加为 transcript record
- **AND** 结果 SHALL 只更新 GoalState 的最近评估字段并写入 local notice

### Requirement: 自动续跑循环
评估判定未达成且已发起推进回合数低于回合上限时，系统 SHALL 自动发起下一个推进回合：该回合 SHALL 以普通 assistant turn 语义执行（完整工具能力与既有审批、交互边界不变），SHALL 递增轮次计数，并 SHALL 在回合完成后再次触发评估。达到回合上限且仍未达成时，系统 SHALL 暂停目标并通知，不得再自动发起推进回合。

#### Scenario: 未达成自动续跑
- **WHEN** 评估判定未达成且已发起推进回合数小于回合上限
- **THEN** 系统 SHALL 递增轮次计数并自动发起下一个推进回合
- **AND** 该回合 SHALL 使用与用户回合相同的工具、审批与交互语义
- **AND** 该回合成功完成后 SHALL 再次触发评估

#### Scenario: 达到回合上限暂停
- **WHEN** 已发起推进回合数达到回合上限且最近评估仍未达成
- **THEN** 系统 SHALL 将目标置为 `paused` 并写入含上限原因的 local notice
- **AND** 系统 SHALL NOT 再自动发起推进回合，直到用户 `/goal resume`

#### Scenario: 推进回合的 transcript 呈现
- **WHEN** 系统自动发起推进回合
- **THEN** transcript SHALL 追加标明 goal 自动推进与轮次（`[goal] 自动继续 N/M` 或等价形式）的 user record 展示
- **AND** 内部续跑指令细节 SHALL NOT 泄漏到用户可见展示文本

### Requirement: 自动续跑的让位与隔离
系统 SHALL 在发起评估或推进回合前检查用户输入通道：存在进行中的 assistant turn、pending 消息或 active command session 时 SHALL NOT 发起，目标 SHALL 保持 `active` 并等待后续回合完成通知恢复推进；用户消息 SHALL 始终优先于自动推进。目标被替换、恢复、暂停或清除后，revision 不匹配或状态非 `active` 的迟到评估结果与回合 outcome SHALL 被丢弃。

#### Scenario: pending 消息优先
- **WHEN** 评估判定未达成且 pending 单槽存在用户消息
- **THEN** 系统 SHALL NOT 发起推进回合
- **AND** 用户消息 SHALL 按既有 pending 派发语义执行
- **AND** 目标 SHALL 保持 `active`，并在后续回合完成后恢复评估流程

#### Scenario: 占用时让位
- **WHEN** 发起条件被 active command session 或 response lock 占用
- **THEN** 系统 SHALL 让位且不报错、不打断当前流程
- **AND** 目标 SHALL 保持 `active`

#### Scenario: 迟到评估结果隔离
- **WHEN** 评估请求进行期间目标被替换、暂停或清除
- **THEN** 迟到的评估结果 SHALL 被丢弃
- **AND** 系统 SHALL NOT 因迟到结果发起推进回合或修改当前 goal 状态

#### Scenario: 迟到回合 outcome 隔离
- **WHEN** 推进回合进行期间目标被替换或清除，随后该回合结束
- **THEN** 该回合 outcome SHALL NOT 驱动新目标或已清除目标的状态变更

### Requirement: 失败关闭与完成语义
系统 SHALL 在以下情况将目标置为 `paused` 并写入含原因的 local notice，且 SHALL NOT 自动继续推进：推进回合被用户中断（Esc）、推进回合以错误结束、评估超时、评估响应无法解析或评估模型配置解析失败。评估判定达成时系统 SHALL 清除 goal 状态并写入含总轮次的完成通知。

#### Scenario: Esc 中断推进回合
- **WHEN** 推进回合被用户 Esc 中断
- **THEN** 系统 SHALL 将目标置为 `paused`
- **AND** local notice SHALL 说明需要 `/goal resume` 才能继续
- **AND** 系统 SHALL NOT 自动重试该回合

#### Scenario: 回合失败暂停
- **WHEN** 推进回合以错误结束（非用户中断）
- **THEN** 系统 SHALL 将目标置为 `paused` 并写入含错误原因的 local notice

#### Scenario: 评估不可用时暂停
- **WHEN** 评估请求超时、响应无法解析或评估模型 profile 在评估时刻解析失败
- **THEN** 系统 SHALL 将目标置为 `paused`
- **AND** local notice SHALL 说明评估不可用原因

#### Scenario: 评估判定达成
- **WHEN** 一次评估判定达成
- **THEN** 系统 SHALL 清除当前 goal 状态并写入完成 local notice
- **AND** 系统 SHALL NOT 再发起推进回合

### Requirement: 评估请求的配置与用量边界
评估请求 SHALL 使用评估时刻当前配置 revision 中严格解析的 goal 评估模型 profile。进行中的评估 SHALL 不受此后配置变化影响；此后发起的评估 SHALL 使用刷新后的配置。评估产生的 provider usage SHALL 记入当前项目 usage 账本；usage 记账失败 SHALL NOT 影响目标状态或 transcript。

#### Scenario: 评估模型解析失败
- **WHEN** 评估时 goal 评估模型 profile 缺失或不在当前 `llm.models`
- **THEN** 评估 SHALL 判为 unavailable 并按失败关闭语义暂停目标

#### Scenario: usage 记账
- **WHEN** 评估请求完成且产生 provider usage
- **THEN** 系统 SHALL 将 usage 记入当前项目的 usage 账本
- **AND** 记账失败 SHALL NOT 影响目标状态、评估判定或 transcript

#### Scenario: 配置变化对后续评估生效
- **WHEN** 配置中心保存或 config watcher 检测到 goal 评估模型变化
- **THEN** 进行中的评估 SHALL 继续使用其启动时解析的配置
- **AND** 此后发起的评估 SHALL 使用刷新后的配置

### Requirement: goal transient 上下文注入
系统 SHALL 在构造 provider records 时，将当前 goal（条件、状态、轮次进度与最近评估理由）作为 transient suffix 注入。该 suffix SHALL NOT 写入 transcript records 或 session 持久化，SHALL NOT 改变 system prompt 文本与 provider-visible tools schema。系统 SHALL NOT 提供模型可见的 goal 管理工具；目标只能由用户命令变更。

#### Scenario: active 目标注入 suffix
- **WHEN** 当前 goal 为 `active` 且 agent loop 构造 provider records
- **THEN** provider records SHALL 在 active transcript records 之后包含 goal suffix
- **AND** goal suffix SHALL 包含条件、状态、轮次进度与最近评估理由

#### Scenario: paused 目标注入暂停状态
- **WHEN** 当前 goal 为 `paused` 且 agent loop 构造 provider records
- **THEN** goal suffix SHALL 标明暂停状态与等待用户恢复的语义

#### Scenario: 无目标不注入
- **WHEN** 当前不存在 goal 且 agent loop 构造 provider records
- **THEN** provider records SHALL NOT 包含 goal suffix

#### Scenario: suffix 不持久化且提示词稳定
- **WHEN** provider request 完成
- **THEN** 本地 transcript 与 session 持久化 SHALL NOT 包含 goal suffix
- **AND** 仅 goal 内容变化时 system prompt 文本与 provider-visible tools schema SHALL 保持不变

#### Scenario: 模型不可管理 goal
- **WHEN** agent loop 构造 provider-visible tools schema
- **THEN** tools schema SHALL NOT 包含创建、完成、修改或清除 goal 的工具
- **AND** 模型标记目标状态的请求 SHALL NOT 改变 GoalState
