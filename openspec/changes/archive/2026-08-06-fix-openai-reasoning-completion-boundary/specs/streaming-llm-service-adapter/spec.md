## MODIFIED Requirements

### Requirement: 可读 reasoning draft/complete 事件
真实 LLM adapter SHALL 在 provider stream 返回可读 reasoning、reasoning summary 或 thinking 增量时，通过 provider-neutral reasoning 更新回调提供当前 provider turn 的最新可见 reasoning draft。adapter 在各自协议能够确认当前 provider turn 的可读 reasoning 已完成时 SHALL 通过同一回调提供且只提供一次 complete 事件及权威全文；OpenAI Responses SHALL 仅将 `response.completed` 视为该 provider turn 的完成边界。该回调 SHALL 与 assistant 正文文本增量回调分离，SHALL NOT 将 reasoning 内容混入 assistant draft，且 SHALL NOT 暴露 encrypted、redacted、raw 或 provider-private reasoning 数据。`AgentTurnResult` SHALL NOT 重复返回同一可见 reasoning summary。

#### Scenario: OpenAI Responses reasoning summary delta 实时回调
- **WHEN** OpenAI Responses stream 产生 `response.reasoning_summary_text.delta` 事件
- **THEN** adapter SHALL 将该 delta 合并到对应 summary part
- **THEN** adapter SHALL 通过 reasoning 更新回调提供当前稳定合并后的 reasoning draft
- **THEN** adapter SHALL NOT 将该 delta 追加到 assistant draft

#### Scenario: OpenAI Responses done 事件刷新 reasoning draft
- **WHEN** OpenAI Responses stream 产生 `response.reasoning_summary_text.done` 事件
- **THEN** adapter SHALL 使用事件中的完整 `text` 作为对应 summary part 的权威内容
- **THEN** adapter SHALL 通过 reasoning 更新回调提供重新合并后的 reasoning draft

#### Scenario: OpenAI Responses reasoning item 完成时校正预览
- **WHEN** OpenAI Responses stream 产生 `response.output_item.done`
- **AND** 完成 item 的 `type` 为 `reasoning`
- **THEN** adapter SHALL 使用 item 的完整可读 summary 校正对应 output item 的 reasoning draft
- **THEN** adapter SHALL 通过 reasoning 更新回调提供重新合并后的 draft
- **THEN** adapter SHALL NOT 因单个 reasoning item 完成而触发 reasoning complete
- **THEN** encrypted content SHALL 继续只作为 provider continuation record 保存

#### Scenario: OpenAI Responses 完成后唯一提交累计摘要
- **WHEN** OpenAI Responses stream 产生 `response.completed`
- **AND** 当前 provider turn 已累计非空可读 reasoning summary
- **THEN** adapter SHALL 按 output index 和 summary index 合并当前 provider turn 的完整 reasoning summary
- **THEN** adapter SHALL 触发且只触发一次 reasoning complete
- **THEN** 重复的 `response.output_item.done` SHALL NOT 导致重复 complete

#### Scenario: OpenAI Responses 完成前失败不提交 reasoning
- **WHEN** OpenAI Responses stream 已产生 reasoning draft
- **AND** stream 在 `response.completed` 前失败、取消、不完整结束或异常终止
- **THEN** adapter SHALL NOT 触发 reasoning complete
- **THEN** 已提供的 reasoning draft SHALL 保持 transient，且 SHALL NOT 写入 transcript

#### Scenario: OpenAI Chat compatible reasoning_content 实时回调
- **WHEN** Chat compatible stream 返回 `choices[].delta.reasoning_content` 字符串增量
- **THEN** adapter SHALL 将该增量合并到当前 reasoning draft
- **THEN** adapter SHALL 通过 reasoning 更新回调提供最新 reasoning draft
- **THEN** adapter SHALL NOT 因该增量触发 assistant 正文文本增量回调

#### Scenario: Chat provider 进入非 reasoning 输出
- **WHEN** Chat compatible stream 已返回非空 reasoning draft
- **AND** stream 首次产生 assistant 正文或 tool call 增量
- **THEN** adapter SHALL 在转发该非 reasoning 输出前触发 reasoning complete
- **THEN** 后续正文或 tool call SHALL 继续按原有回调处理

#### Scenario: Anthropic thinking_delta 实时回调
- **WHEN** Anthropic stream 返回明文 `thinking_delta`
- **THEN** adapter SHALL 将该增量合并到对应 thinking block
- **THEN** adapter SHALL 通过 reasoning 更新回调提供当前可见 thinking summary draft
- **THEN** adapter SHALL NOT 将该 thinking delta 追加到 assistant draft

#### Scenario: Anthropic thinking block 完成
- **WHEN** Anthropic stream 为可读 thinking block 产生 `content_block_stop`
- **THEN** adapter SHALL 使用该 block 的完整 thinking 文本触发 reasoning complete
- **THEN** 后续 text 或 tool block SHALL 继续正常处理

#### Scenario: provider-private reasoning 不触发可见回调
- **WHEN** provider stream 返回 encrypted reasoning item、redacted thinking、raw reasoning text 或其他不可读 provider-private reasoning 数据
- **THEN** adapter SHALL NOT 通过 reasoning 更新回调暴露该内容
- **THEN** adapter SHALL 保持既有 provider continuation 或过滤语义
- **THEN** 后续可读 reasoning summary、assistant 文本和 tool call 事件 SHALL 继续正常处理

#### Scenario: 阶段边界后的 reasoning 不回退 UI
- **WHEN** Chat compatible stream 已经产生正文或 tool call 输出
- **AND** 后续异常 chunk 又携带 reasoning_content
- **THEN** adapter SHALL NOT 再触发 reasoning draft 或 complete
- **THEN** 已提交 reasoning summary 与当前正文/tool 阶段 SHALL 保持不变
