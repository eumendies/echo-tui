## ADDED Requirements

### Requirement: 可读 reasoning draft/complete 事件
真实 LLM adapter SHALL 在 provider stream 返回可读 reasoning、reasoning summary 或 thinking 增量时，通过 provider-neutral reasoning 更新回调提供当前 provider turn 的最新可见 reasoning draft。adapter 在协议能够确认可读 reasoning 已完成时 SHALL 通过同一回调提供且只提供一次 complete 事件及权威全文。该回调 SHALL 与 assistant 正文文本增量回调分离，SHALL NOT 将 reasoning 内容混入 assistant draft，且 SHALL NOT 暴露 encrypted、redacted、raw 或 provider-private reasoning 数据。`AgentTurnResult` SHALL NOT 重复返回同一可见 reasoning summary。

#### Scenario: OpenAI Responses reasoning summary delta 实时回调
- **WHEN** OpenAI Responses stream 产生 `response.reasoning_summary_text.delta` 事件
- **THEN** adapter SHALL 将该 delta 合并到对应 summary part
- **THEN** adapter SHALL 通过 reasoning 更新回调提供当前稳定合并后的 reasoning draft
- **THEN** adapter SHALL NOT 将该 delta 追加到 assistant draft

#### Scenario: OpenAI Responses done 事件刷新 reasoning draft
- **WHEN** OpenAI Responses stream 产生 `response.reasoning_summary_text.done` 事件
- **THEN** adapter SHALL 使用事件中的完整 `text` 作为对应 summary part 的权威内容
- **THEN** adapter SHALL 通过 reasoning 更新回调提供重新合并后的 reasoning draft

#### Scenario: OpenAI Responses reasoning item 完成
- **WHEN** OpenAI Responses stream 产生 `response.output_item.done`
- **AND** 完成 item 的 `type` 为 `reasoning`
- **THEN** adapter SHALL 使用 item 的完整可读 summary 触发 reasoning complete
- **THEN** encrypted content SHALL 继续只作为 provider continuation record 保存

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

### Requirement: reasoning 更新转发与提前提交
provider、agent loop runtime 与 app SHALL 共用同一个结构化 reasoning 更新回调。agent loop runtime SHALL 将 provider turn 的 reasoning draft 事件原样转发给 app，用于 transient pending preview；draft 事件 SHALL NOT 追加 transcript record。reasoning complete 事件 SHALL 在 runtime 记录内部上下文后原样转发给 app，由 app 立即提交 `reasoning_summary`。runtime SHALL NOT 在 provider turn 返回后从第二个字段补发 summary，也 SHALL NOT 为相同语义保留去重标记或单独 callback。

#### Scenario: provider reasoning 更新转发到 app pending
- **WHEN** provider agent 在一次 active provider turn 中触发 reasoning 更新回调
- **THEN** agent loop runtime SHALL 将最新 reasoning draft 转发给 app 层
- **THEN** runtime SHALL NOT 因该转发向 transcript 追加 `reasoning_summary` record

#### Scenario: provider reasoning complete 立即提交
- **WHEN** provider agent 在 active provider turn 中触发 reasoning complete
- **THEN** agent loop runtime SHALL 立即提交一条 `reasoning_summary` record
- **THEN** 同一 provider turn 的最终 assistant record 或 tool call SHALL 位于该 summary 之后
- **THEN** provider turn 返回值 SHALL NOT 再携带相同 summary

#### Scenario: 无可读 reasoning 时不影响正文 streaming
- **WHEN** provider turn 未返回可读 reasoning 增量
- **THEN** agent loop runtime SHALL NOT 触发 app reasoning pending 更新
- **THEN** assistant 正文 streaming、tool call、completion 和失败路径 SHALL 保持既有行为
