## ADDED Requirements

### Requirement: 自动审批脱敏性能观测
系统 SHALL 在 debug 模式下为每次进入自动审批路径的 approval-required 调用记录有界结构化摘要，用于观察审批输入规模、provider 时延、上下文形态、动作投影类型和回退原因。事件 SHALL NOT 包含用户消息、前序 exchange、澄清答案、pending action、tool arguments 或 reviewer 响应的原始文本，并 SHALL NOT 因 debug 写入失败改变审批决策或执行流程。

#### Scenario: 记录成功审批的规模与时延
- **WHEN** 自动 reviewer 返回可解析的 `yes` 或 `no`
- **THEN** debug 事件 SHALL 包含 tool name、model、结果、latency milliseconds、prompt character count、action character count 和 arguments hash
- **THEN** 事件 SHALL 包含是否使用前序 exchange、是否包含可信澄清答案以及动作投影为 exact 或 summarized 的枚举摘要

#### Scenario: 记录未调用 reviewer 的超限回退
- **WHEN** pending action 因无法安全有界投影而直接回退人工审批
- **THEN** debug 事件 SHALL 把结果或回退原因记录为 `manual_only` 或等价稳定枚举
- **THEN** 事件 SHALL NOT 包含导致超限的原始参数

#### Scenario: 区分 timeout 和 provider error
- **WHEN** 自动审批因独立 deadline 到期或 provider/config 错误回退人工
- **THEN** debug 事件 SHALL 使用不同的 `timeout` 和 `error` 稳定结果
- **THEN** error 事件 MAY 包含错误类型名称但 SHALL NOT 包含可能携带凭据或内容的完整错误消息

#### Scenario: Debug 关闭不增加持久化内容
- **WHEN** debug 模式未启用
- **THEN** 系统 SHALL NOT 写入自动审批观测事件
- **THEN** 审批 prompt、响应和性能元数据 SHALL NOT 进入 transcript 或 session journal
