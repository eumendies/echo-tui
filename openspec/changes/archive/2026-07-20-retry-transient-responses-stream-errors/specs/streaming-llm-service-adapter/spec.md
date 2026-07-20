## MODIFIED Requirements

### Requirement: SDK 流式文本增量处理
真实 LLM adapter SHALL 消费 OpenAI SDK 提供的流式文本增量，累积最终 assistant draft，并把未知或暂不支持的非文本事件限制在 adapter 内部处理。已知错误、服务端 incomplete 或无效 stream SHALL 显式结束为对应语义，而不是被误报为未知本地 stream 未完成。adapter SHALL 在收到完成事件时捕获其携带的 `usage` 信息（如存在），用于上下文长度的真值校准。OpenAI Responses 与 Codex adapter SHALL 对正文输出前发生的指定服务端临时处理错误最多额外重试一次；该重试 SHALL NOT 适用于 compaction、用户取消、非目标错误或已经产生文本增量的 attempt。

#### Scenario: 处理文本增量
- **WHEN** SDK stream 产生新的文本增量
- **THEN** adapter SHALL 读取该增量文本
- **THEN** adapter SHALL 将该增量追加到当前 draft
- **THEN** adapter SHALL 通过文本增量回调把增量和完整 draft 交给 app 层

#### Scenario: 处理完成事件
- **WHEN** SDK stream 表示本次文本响应完成
- **THEN** adapter SHALL 以累积出的完整 assistant 文本完成本次 agent 调用
- **THEN** adapter SHALL 在完成事件携带 `usage` 时捕获其 `input_tokens` 供长度校准使用

#### Scenario: 完成事件缺少 usage 时不阻断
- **WHEN** SDK stream 完成事件未携带 `usage`
- **THEN** adapter SHALL 正常以累积文本完成本次调用
- **THEN** adapter SHALL NOT 因缺少 `usage` 而报错

#### Scenario: 处理服务端 incomplete 事件
- **WHEN** SDK stream 产生 `response.incomplete` 事件
- **THEN** adapter SHALL 将其识别为服务端未完整结束
- **THEN** adapter SHALL 使用事件中的 incomplete details 生成明确错误摘要（如存在）
- **THEN** adapter SHALL NOT 将其误报为本地“模型响应流未完成”兜底错误

#### Scenario: 忽略暂不支持的非文本事件
- **WHEN** SDK stream 产生首版不支持的非文本事件
- **THEN** adapter SHALL 不把该事件暴露给 app 层
- **THEN** adapter SHALL 处理后续 stream 事件

#### Scenario: OpenAI Responses 临时 stream 错误重试成功
- **WHEN** OpenAI Responses 普通 provider turn 的首次 stream 在产生文本增量前以 `server_error` 或明确提示可重试的临时处理错误失败
- **AND** turn 未被取消
- **THEN** adapter SHALL 重新创建并消费一个新的 stream
- **AND** adapter SHALL 在第二次 stream 成功时正常返回其结果

#### Scenario: Codex 临时 stream 错误重试成功
- **WHEN** Codex 普通 provider turn 的首次 Responses-compatible stream 在产生文本增量前以 `server_error` 或明确提示可重试的临时处理错误失败
- **AND** turn 未被取消
- **THEN** adapter SHALL 使用同一 turn 已解析的 OAuth runtime client 和请求快照重新创建 stream
- **AND** adapter SHALL 在第二次 stream 成功时正常返回其结果

#### Scenario: 临时 stream 错误最多额外重试一次
- **WHEN** OpenAI Responses 或 Codex 的首次 attempt 符合临时 stream 错误重试条件
- **AND** 第二次 attempt 仍然失败
- **THEN** adapter SHALL 以第二次 attempt 的脱敏错误结束本次调用
- **AND** adapter SHALL NOT 创建第三次 stream
- **AND** 最终错误 SHALL 保留可用的服务端 request ID

#### Scenario: 已产生 partial text 时不重试
- **WHEN** OpenAI Responses 或 Codex stream 已经向 app 发出至少一个非空文本增量
- **AND** 当前 stream 随后发生指定服务端临时处理错误
- **THEN** adapter SHALL NOT 自动创建新的 stream
- **AND** adapter SHALL 以明确 stream 错误结束本次调用
- **AND** adapter SHALL NOT 把 partial draft 伪装成成功完成的 assistant 回复

#### Scenario: 非目标错误不重试
- **WHEN** OpenAI Responses 或 Codex stream 因 rate limit、invalid prompt、incomplete、无完成事件或其他非目标错误失败
- **THEN** adapter SHALL NOT 因本要求创建额外 stream
- **AND** adapter SHALL 保持该错误的既有失败语义

#### Scenario: compaction 请求不重试
- **WHEN** OpenAI Responses 或 Codex compaction stream 发生指定服务端临时处理错误
- **THEN** adapter SHALL NOT 创建额外 stream
- **AND** compaction SHALL 按现有失败路径结束

#### Scenario: stream 异常失败
- **WHEN** SDK stream 在完成前抛出不符合重试条件的错误或中断
- **OR** 指定临时处理错误的重试机会已经用尽
- **THEN** adapter SHALL 以明确 stream 错误结束本次调用
- **THEN** adapter SHALL NOT 把部分 draft 伪装成成功完成的 assistant 回复

#### Scenario: OpenAI stream 被取消时不作为服务失败
- **WHEN** OpenAI streaming 请求因调用方取消信号触发而中断
- **THEN** OpenAI provider agent SHALL 以可识别的中断结果结束当前 turn
- **THEN** provider SHALL NOT 将该用户主动中断包装为普通模型服务失败或 stream incomplete 失败
- **THEN** provider SHALL NOT 在取消后创建重试 stream
