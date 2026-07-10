## ADDED Requirements

### Requirement: reasoning summary 配置与请求
真实 LLM adapter SHALL 支持在当前生效模型 profile 的 `reasoning.summary` 中配置 OpenAI reasoning summary。有效取值 SHALL 为 `auto`、`concise` 或 `detailed`。当配置了有效 summary 时，OpenAI Responses request SHALL 在 `reasoning` 对象中发送该 summary；当同时配置 `reasoning.effort` 时，request SHALL 同时携带 effort 和 summary。当未配置 summary 时，系统 SHALL NOT 发送 `reasoning.summary`。

#### Scenario: 读取模型 profile 的 reasoning summary 配置
- **WHEN** 当前生效模型 profile 配置了有效的 `reasoning.summary`
- **THEN** 系统 SHALL 在解析生效配置时携带该 summary 设置
- **THEN** 后续 OpenAI Responses 请求 SHALL 发送 `reasoning.summary`

#### Scenario: 同时发送 effort 和 summary
- **WHEN** 当前生效模型 profile 同时配置了 `reasoning.effort` 和 `reasoning.summary`
- **THEN** OpenAI Responses 请求 SHALL 在同一个 `reasoning` 对象中携带两者
- **THEN** 系统 SHALL NOT 因新增 summary 覆盖或丢失既有 effort 配置

#### Scenario: 未配置 summary 时不发送 summary
- **WHEN** 当前生效模型 profile 没有配置 `reasoning.summary`
- **THEN** OpenAI Responses 请求 SHALL NOT 发送 `reasoning.summary`
- **THEN** 只配置 `reasoning.effort` 的既有请求形态 SHALL 保持兼容

#### Scenario: 无效 reasoning summary 明确失败
- **WHEN** 当前生效模型 profile 的 `reasoning.summary` 不是 `auto`、`concise` 或 `detailed`
- **THEN** 系统 SHALL 明确提示 reasoning summary 配置无效
- **THEN** 系统 SHALL NOT 发起真实模型请求

### Requirement: OpenAI reasoning summary stream 处理
真实 LLM adapter SHALL 解析 OpenAI Responses stream 中的 reasoning summary 事件，累积本次 provider turn 的 summary 文本，并在 provider turn 完成结果中返回该 summary。adapter SHALL 只处理 reasoning summary，不展示或返回 raw reasoning text。

#### Scenario: 累积 reasoning summary delta
- **WHEN** SDK stream 产生 `response.reasoning_summary_text.delta` 事件
- **THEN** adapter SHALL 将该 delta 追加到对应 summary part
- **THEN** adapter SHALL NOT 将该 delta 混入 assistant draft 文本

#### Scenario: done 事件覆盖 summary part 全文
- **WHEN** SDK stream 产生 `response.reasoning_summary_text.done` 事件
- **THEN** adapter SHALL 使用事件中的完整 `text` 作为对应 summary part 的权威内容
- **THEN** 后续 provider turn result SHALL 包含该 summary part 文本

#### Scenario: 多段 summary 保持稳定顺序
- **WHEN** 同一次 provider turn 返回多个 reasoning summary part
- **THEN** adapter SHALL 按 `output_index` 与 `summary_index` 的稳定顺序合并非空 summary 文本
- **THEN** 合并结果 SHALL 作为本次 provider turn 的 reasoning summary 返回

#### Scenario: raw reasoning text 不暴露
- **WHEN** SDK stream 产生 raw reasoning text 相关事件
- **THEN** adapter SHALL NOT 将其作为可见 summary、assistant draft 或 transcript 内容返回
- **THEN** adapter SHALL 继续处理后续 stream 事件

### Requirement: agent loop 提交 reasoning summary
agent loop runtime SHALL 在每个 provider turn 完成后处理 provider 返回的 reasoning summary。若 summary 非空，runtime SHALL 在执行 tool call 或提交最终 assistant 回复前通知 app 层追加 `reasoning_summary` record，并在 runtime continuation 中保留该可见顺序事实但不把它作为 provider-facing assistant/user 内容发送。

#### Scenario: 工具调用前提交 summary
- **WHEN** provider turn 返回非空 reasoning summary 且同时返回 tool call
- **THEN** agent loop runtime SHALL 在通知 tool call 前先调用 reasoning summary callback 或等价 app callback
- **THEN** app 层 SHALL 能在对应 tool_call/tool_result 前看到 `reasoning_summary` transcript record

#### Scenario: 最终回复前提交 summary
- **WHEN** provider turn 返回非空 reasoning summary 且没有 tool call
- **THEN** agent loop runtime SHALL 在 complete callback 前提交 reasoning summary
- **THEN** 最终 assistant record SHALL NOT 合并该 reasoning summary 文本

#### Scenario: 空 summary 不产生记录
- **WHEN** provider turn 没有返回 reasoning summary 或 summary 仅为空白
- **THEN** agent loop runtime SHALL NOT 追加 `reasoning_summary` record
- **THEN** 既有 assistant/tool loop 行为 SHALL 保持不变

### Requirement: OpenAI reasoning item continuation
OpenAI provider SHALL 在 tool continuation 中保留服务端返回的 `type: "reasoning"` output item，并在下一次 Responses input 中回传该 item。该 provider-private continuation item SHALL NOT 进入 app 可见 transcript，SHALL NOT 被持久化为 session record，且 SHALL 仅由 OpenAI provider input 转换器解释。

#### Scenario: reasoning item 随工具结果回传
- **WHEN** OpenAI stream 完成的 output item 包含 `type: "reasoning"`
- **AND** 同一 provider turn 返回 function tool call
- **THEN** agent loop continuation SHALL 在下一次 OpenAI Responses input 中包含该 reasoning item
- **THEN** 该 reasoning item SHALL 位于对应 function call output 之前的 provider input 顺序中

#### Scenario: provider-private item 不触发可见回调
- **WHEN** OpenAI provider 返回 reasoning item continuation state
- **THEN** app 层 SHALL NOT 收到用于渲染该原始 reasoning item 的 transcript append callback
- **THEN** session persistence SHALL NOT 保存该原始 reasoning item

#### Scenario: 非 OpenAI provider 忽略 provider-private item
- **WHEN** 非 OpenAI provider 或 fake provider 执行 agent turn
- **THEN** 系统 SHALL NOT 要求其理解 OpenAI reasoning item
- **THEN** 既有 provider-neutral agent contract SHALL 保持可用

### Requirement: reasoning summary 不进入 OpenAI transcript input
OpenAI transcript input 转换器 SHALL 过滤 `reasoning_summary` transcript record，不将其转换为 user、assistant、system、function_call 或 function_call_output input item。该过滤 SHALL 不影响后续普通 records 的顺序转换。

#### Scenario: 过滤 reasoning summary record
- **WHEN** transcript records 包含 `reasoning_summary` role
- **THEN** OpenAI 转换器 SHALL NOT 把该 record 放入 OpenAI input
- **THEN** 后续 user、assistant、tool_call 和 tool_result records SHALL 继续按顺序参与转换
