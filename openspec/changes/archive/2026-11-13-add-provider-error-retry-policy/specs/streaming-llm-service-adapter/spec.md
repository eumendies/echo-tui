## MODIFIED Requirements

### Requirement: SDK 流式文本增量处理
真实 LLM adapter SHALL 消费 OpenAI SDK 提供的流式文本增量，累积最终 assistant draft，并把未知或暂不支持的非文本事件限制在 adapter 内部处理。已知错误、服务端 incomplete 或无效 stream SHALL 显式结束为对应语义，而不是被误报为未知本地 stream 未完成。adapter SHALL 在收到完成事件时捕获其携带的 `usage` 信息（如存在），用于上下文长度的真值校准。OpenAI Responses 与 Codex adapter SHALL 通过共享的 provider-neutral 重试执行器处理流级失败，并 SHALL 依据 `provider-error-retry-policy` 定义的失败分类与重试决策判断是否创建新的 stream。该重试 SHALL NOT 适用于 compaction 请求、用户取消、`never` 决策的失败类别、已产生 assistant 正文增量的 attempt、已产生工具调用的 attempt。

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
- **THEN** adapter SHALL 将其归类为不可重试的服务端终止语义
- **THEN** adapter SHALL NOT 将其误报为本地“模型响应流未完成”兜底错误

#### Scenario: 忽略暂不支持的非文本事件
- **WHEN** SDK stream 产生首版不支持的非文本事件
- **THEN** adapter SHALL 不把该事件暴露给 app 层
- **THEN** adapter SHALL 处理后续 stream 事件

#### Scenario: OpenAI Responses 瞬时 stream 失败后重试成功
- **WHEN** OpenAI Responses 普通 provider turn 的某个 attempt 以可重试类别失败
- **AND** 该 attempt 尚未产生 assistant 正文增量
- **AND** turn 未被取消
- **THEN** adapter SHALL 通过共享执行器创建并消费一个新的 stream
- **AND** adapter SHALL 在新 attempt 成功时正常返回其结果

#### Scenario: Codex 瞬时 stream 失败后重试成功
- **WHEN** Codex 普通 provider turn 的某个 attempt 以可重试类别失败
- **AND** 该 attempt 尚未产生 assistant 正文增量
- **AND** turn 未被取消
- **THEN** adapter SHALL 使用同一 turn 已解析的 OAuth runtime client 和请求快照创建新的 stream
- **AND** adapter SHALL 在新 attempt 成功时正常返回其结果

#### Scenario: 可重试类别耗尽预算后失败
- **WHEN** OpenAI Responses 或 Codex 的某个 attempt 以可重试类别失败
- **AND** 该 provider turn 的重试预算已经耗尽
- **THEN** adapter SHALL 以最后一次 attempt 的脱敏错误结束本次调用
- **AND** adapter SHALL NOT 创建预算之外的新 stream
- **AND** 最终错误 SHALL 保留可用的服务端 request ID 与已重试次数

#### Scenario: 已产生 assistant 正文时不重试
- **WHEN** OpenAI Responses 或 Codex stream 已经向 app 发出至少一个非空 assistant 正文增量
- **AND** 当前 attempt 随后以可重试类别失败
- **THEN** adapter SHALL NOT 自动创建新的 stream
- **THEN** adapter SHALL 以明确 stream 错误结束本次调用
- **THEN** adapter SHALL NOT 把 partial draft 伪装成成功完成的 assistant 回复

#### Scenario: 仅 reasoning 预览已输出时仍可重试
- **WHEN** OpenAI Responses 或 Codex stream 已经向 app 发出非空 reasoning 预览但尚未发出正文增量
- **AND** 当前 attempt 以可重试类别失败
- **THEN** adapter SHALL 允许创建新的 stream
- **THEN** adapter SHALL 在重试前使 app 丢弃该 attempt 的 reasoning 预览

#### Scenario: 不可重试类别保持既有失败语义
- **WHEN** OpenAI Responses 或 Codex stream 因 `invalid_request`、`context_overflow`、`auth`、`quota`、`provider_incomplete`、`content_filter` 或 `unknown` 类别失败
- **THEN** adapter SHALL NOT 因本要求创建额外 stream
- **THEN** adapter SHALL 保持该错误的既有失败语义

#### Scenario: compaction 请求不重试
- **WHEN** OpenAI Responses 或 Codex compaction stream 以可重试类别失败
- **THEN** adapter SHALL NOT 创建额外 stream
- **AND** compaction SHALL 按现有失败路径结束

#### Scenario: stream 异常失败
- **WHEN** SDK stream 在完成前抛出不符合重试条件的错误或中断
- **OR** 可重试类别的重试预算已经用尽
- **THEN** adapter SHALL 以明确 stream 错误结束本次调用
- **THEN** adapter SHALL NOT 把部分 draft 伪装成成功完成的 assistant 回复

#### Scenario: OpenAI stream 被取消时不作为服务失败
- **WHEN** OpenAI streaming 请求因调用方取消信号触发而中断
- **THEN** OpenAI provider agent SHALL 以可识别的中断结果结束当前 turn
- **THEN** provider SHALL NOT 将该用户主动中断包装为普通模型服务失败或 stream incomplete 失败
- **THEN** provider SHALL NOT 在取消后创建重试 stream

### Requirement: OpenAI Chat Completions stream 处理
`openai-chat` adapter SHALL 消费 Chat Completions streaming chunks，累积 assistant 文本 draft，聚合完整 tool calls，并在完成时返回 provider-neutral `AgentTurnResult`。adapter SHALL 处理服务端错误、SDK create 错误、stream 异常和用户主动取消，且错误消息 SHALL 做敏感信息脱敏。adapter SHALL 通过共享的 provider-neutral 重试执行器处理流级失败，并 SHALL 依据 `provider-error-retry-policy` 判断是否可以重试；Chat 特有的失败事件形态 SHALL 只影响分类映射，不影响重试决策与退避参数。

#### Scenario: 处理 Chat 文本增量
- **WHEN** Chat stream chunk 产生 `choices[].delta.content`
- **THEN** adapter SHALL 将该文本增量追加到当前 draft
- **THEN** adapter SHALL 通过文本增量回调把增量和完整 draft 交给 app 层

#### Scenario: 聚合 Chat 工具调用分片
- **WHEN** Chat stream chunk 通过 `choices[].delta.tool_calls` 分片返回工具调用 id、function name 或 function arguments
- **THEN** adapter SHALL 按 choice/tool index 聚合同一工具调用的字段
- **THEN** adapter SHALL 在工具调用完成后返回完整的 provider-neutral `ToolCall`

#### Scenario: Chat stream 完成且无工具调用
- **WHEN** Chat stream 以完成状态结束且未产生工具调用
- **THEN** adapter SHALL 返回累积出的完整 assistant draft
- **THEN** `toolCalls` SHALL 为空数组

#### Scenario: Chat stream 完成且有工具调用
- **WHEN** Chat stream 以 tool call 完成状态结束且产生了完整工具调用
- **THEN** adapter SHALL 返回当前 assistant draft 和完整 `toolCalls`
- **THEN** 工具执行和 continuation SHALL 继续由 agent loop runtime 编排

#### Scenario: 捕获 Chat prompt token usage
- **WHEN** Chat stream completion chunk 携带 `usage.prompt_tokens`
- **THEN** adapter SHALL 将该数值作为 `usageInputTokens` 返回
- **THEN** 缺少 usage 或缺少 prompt token 时 SHALL NOT 阻断本次响应完成

#### Scenario: Chat stream 未产生 finish_reason 即结束
- **WHEN** Chat stream 在未产生 `finish_reason` 的情况下结束
- **THEN** adapter SHALL 把该 attempt 归类为 `stream_incomplete`
- **THEN** adapter SHALL 按共享重试决策判断是否创建新的 stream

#### Scenario: Chat stream 错误 chunk 按错误码分类
- **WHEN** Chat stream chunk 携带 `error` 对象
- **THEN** adapter SHALL 依据该对象的错误码或类型确定失败类别
- **THEN** adapter SHALL 依据失败类别决定是否重试

#### Scenario: Chat stream 异常失败
- **WHEN** Chat SDK create 调用失败、stream 抛错且不符合重试条件或重试预算已耗尽
- **THEN** adapter SHALL reject 一个明确错误
- **THEN** 错误消息 SHALL NOT 包含 API key、Bearer token 或其他敏感凭据

#### Scenario: Chat stream 被取消时不作为服务失败
- **WHEN** Chat streaming 请求因调用方取消信号触发而中断
- **THEN** `openai-chat` provider agent SHALL 以可识别的中断结果结束当前 turn
- **THEN** provider SHALL NOT 将该用户主动中断包装为普通模型服务失败或 stream incomplete 失败

### Requirement: Anthropic Messages stream 处理
`anthropic` adapter SHALL 使用官方 Anthropic SDK 的 Messages API 发起流式请求，消费 Anthropic streaming events，累积 assistant 文本 draft，聚合完整 tool calls，并在完成时返回 provider-neutral `AgentTurnResult`。请求 SHALL 包含当前模型名、转换后的顶层 `system`、转换后的 `messages`、协议要求的 `max_tokens`，并在工具 registry 非空时包含 Anthropic `tools`。已成功初始化的 MCP tools SHALL 作为已注册 tools 的一部分随 normal mode provider request 暴露。请求 SHALL NOT 发送 OpenAI Responses-only `input`、`reasoning`、private reasoning item、Chat Completions `tool_calls` 或 OpenAI `max_output_tokens`。adapter SHALL 处理服务端错误、SDK create 错误、stream 异常和用户主动取消，且错误消息 SHALL 做敏感信息脱敏。adapter SHALL 通过共享的 provider-neutral 重试执行器处理流级失败，并 SHALL 依据 `provider-error-retry-policy` 判断是否可以重试；Anthropic 特有的失败事件形态 SHALL 只影响分类映射，不影响重试决策与退避参数。

#### Scenario: 构造 Anthropic stream 请求
- **WHEN** 当前 provider preset 解析出的 agent type 为 `anthropic` 且用户提交普通消息
- **THEN** adapter SHALL 调用官方 Anthropic SDK 的 Messages API 流式接口
- **THEN** 请求 SHALL 包含配置中的模型名、转换后的 `system`、转换后的 `messages` 和协议要求的 `max_tokens`

#### Scenario: Anthropic 请求携带取消信号
- **WHEN** `anthropic` provider agent 执行 provider turn 且调用方提供取消信号
- **THEN** provider SHALL 将该取消信号传递给 Anthropic SDK 流式请求
- **THEN** SDK 请求 SHALL 能响应该取消信号

#### Scenario: 启用工具时发送 Anthropic tools
- **WHEN** `anthropic` adapter 构造请求且本地 tool registry 包含已启用工具
- **THEN** 请求参数 SHALL 包含这些工具对应的 Anthropic tool schema
- **THEN** 请求参数 SHALL NOT 包含本次未注册或未启用的工具定义

#### Scenario: normal mode 发送已初始化 MCP Anthropic tools
- **WHEN** 当前 interaction mode 为 normal，且 MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** Anthropic 请求 SHALL 包含这些 MCP tools 转换后的 tool schema
- **THEN** Anthropic 请求 SHALL NOT 包含初始化失败的 MCP server tools

#### Scenario: 处理 Anthropic 文本增量
- **WHEN** Anthropic stream 产生文本 delta 事件
- **THEN** adapter SHALL 将该文本增量追加到当前 draft
- **THEN** adapter SHALL 通过文本增量回调把增量和完整 draft 交给 app 层

#### Scenario: 聚合 Anthropic tool_use 分片
- **WHEN** Anthropic stream 通过 content block start/delta 事件返回 tool_use id、name 或 input JSON 分片
- **THEN** adapter SHALL 按 content block index 聚合同一工具调用的字段
- **THEN** adapter SHALL 在工具调用完成后返回完整的 provider-neutral `ToolCall`

#### Scenario: 捕获 Anthropic input token usage
- **WHEN** Anthropic stream completion、message start 或 message delta 事件携带 input token usage
- **THEN** adapter SHALL 将 `input_tokens`、`cache_creation_input_tokens` 和 `cache_read_input_tokens` 的总和作为 `usageInputTokens` 返回
- **THEN** adapter SHALL NOT 把 `output_tokens` 计入 provider context usage
- **THEN** 缺少 usage 或缺少 input token 时 SHALL NOT 阻断本次响应完成

#### Scenario: Anthropic reasoning 完成通知在 provider turn 完成后统一发出
- **WHEN** Anthropic stream 产生多个 thinking content block
- **THEN** adapter SHALL 在单个 thinking block 结束时只更新 reasoning 预览
- **THEN** adapter SHALL 在整个 provider turn 确认完成之后统一发出一次 reasoning 完成通知
- **THEN** adapter SHALL NOT 在单个 thinking block 结束时发出 reasoning 完成通知

#### Scenario: Anthropic 缺少完成事件时可重试
- **WHEN** Anthropic stream 在未收到 `message_stop` 事件的情况下结束
- **THEN** adapter SHALL 把该 attempt 归类为 `stream_incomplete`
- **THEN** adapter SHALL 按共享重试决策判断是否创建新的 stream

#### Scenario: Anthropic 有完成事件但缺少停止原因时不重试
- **WHEN** Anthropic stream 已收到 `message_stop` 事件但未收到 `stop_reason`
- **THEN** adapter SHALL 以协议异常结束本次 provider turn
- **THEN** adapter SHALL NOT 创建新的 stream

#### Scenario: Anthropic 过载事件重试
- **WHEN** Anthropic stream 返回 `overloaded_error` 类型的错误事件
- **AND** 该 attempt 尚未产生 assistant 正文增量
- **THEN** adapter SHALL 把该事件归类为 `overloaded`
- **THEN** adapter SHALL 在该事件携带服务端重试建议时按建议等待后创建新的 stream
- **THEN** adapter SHALL 在该事件不携带服务端重试建议时按 `overloaded` 的保守退避等待后创建新的 stream

#### Scenario: Anthropic 停止原因失败不重试
- **WHEN** Anthropic stream 以 `max_tokens`、`refusal` 或 `pause_turn` 停止原因结束
- **THEN** adapter SHALL 保持既有失败语义
- **THEN** adapter SHALL NOT 创建新的 stream

#### Scenario: Anthropic stream 异常失败
- **WHEN** Anthropic SDK create 调用失败、stream 抛错且不符合重试条件或重试预算已耗尽
- **THEN** adapter SHALL reject 一个明确错误
- **THEN** 错误消息 SHALL NOT 包含 API key、Bearer token、x-api-key 或其他敏感凭据

#### Scenario: Anthropic stream 被取消时不作为服务失败
- **WHEN** Anthropic streaming 请求因调用方取消信号触发而中断
- **THEN** `anthropic` provider agent SHALL 以可识别的中断结果结束当前 turn
- **THEN** provider SHALL NOT 将该用户主动中断包装为普通模型服务失败或 stream incomplete 失败

### Requirement: 失败反馈
系统 SHALL 对真实服务接入中的失败提供可见、可测试且不泄密的反馈。失败后应用 SHALL 停止 pending 状态、释放响应锁，并避免把敏感配置值暴露给用户。本地失败反馈 SHALL 记录为 `error` transcript record，而不是伪装成 assistant 回复。若失败前已经生成 partial assistant draft，系统 SHALL 先保留该 partial assistant 内容，再追加本地 error record 表示失败事实。若失败前发生过自动重试，最终错误 SHALL 说明已重试次数。

#### Scenario: 服务错误失败
- **WHEN** 模型服务返回错误或 SDK 抛出服务错误
- **THEN** adapter SHALL 产生包含错误类别或状态摘要的错误
- **THEN** 错误内容 SHALL NOT 包含敏感配置值

#### Scenario: stream 中断失败且没有 partial draft
- **WHEN** stream 在完成前中断、且重试预算已耗尽或该失败类别不可重试，并且尚未产生文本增量
- **THEN** adapter SHALL 产生明确的 stream incomplete 错误
- **THEN** 应用 SHALL 释放 response lock，使用户可以继续输入

#### Scenario: stream 中断失败且已有 partial draft
- **WHEN** stream 在完成前中断或返回 incomplete，且本次响应已经产生 partial draft
- **THEN** 应用 SHALL 先追加一条 assistant transcript record 保存 partial draft
- **THEN** 应用 SHALL 再追加一条本地 error record 表示响应未完整结束
- **THEN** 应用 SHALL 释放 response lock，使用户可以继续输入

#### Scenario: 重试后成功时不追加错误记录
- **WHEN** 某个 provider turn 在自动重试后成功完成
- **THEN** 应用 SHALL NOT 追加本地 error record
- **THEN** 应用 SHALL 保留已持久化的本地重试 notice

#### Scenario: 重试耗尽的最终失败说明重试次数
- **WHEN** 一个 provider turn 在自动重试后仍然失败
- **THEN** 本地 error record SHALL 包含已重试次数
- **THEN** 本地 error record SHALL 保留最后一次 attempt 可用的 request ID
- **THEN** 本地 error record SHALL NOT 包含敏感配置值

#### Scenario: app 层展示本地错误
- **WHEN** 真实 adapter reject 且用户消息已经提交到 transcript
- **THEN** 应用 SHALL 清空 pending preview 并停止 spinner
- **THEN** 应用 SHALL 追加一条本地 `error` transcript record 作为可见反馈
- **THEN** 该错误 record SHALL 被持久化到当前 transcript session
- **THEN** 该错误 record SHALL NOT 进入后续 OpenAI input
