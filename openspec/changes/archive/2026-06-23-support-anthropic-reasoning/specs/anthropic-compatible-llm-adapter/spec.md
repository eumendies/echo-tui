## ADDED Requirements

### Requirement: Anthropic reasoning effort 请求
系统 SHALL 在 `anthropic` provider 边界内支持 model profile 的 `reasoning.effort`。当 effort 非 `none` 时，adapter SHALL 启用 Anthropic adaptive thinking，并 SHALL 将 Echo TUI 的 effort 等级映射为 Anthropic `output_config.effort` 后发送；请求 SHALL NOT 使用 OpenAI Responses-only `reasoning` 字段。

#### Scenario: 启用 Anthropic adaptive thinking
- **WHEN** 当前 provider agent type 为 `anthropic` 且当前模型配置包含非 `none` 的 `reasoning.effort`
- **THEN** Anthropic request SHALL 包含 `thinking` 配置，且 `thinking.type` 为 `adaptive`
- **THEN** `thinking.display` SHALL 为 `summarized` 或等价的可展示默认行为
- **THEN** Anthropic request SHALL 包含 `output_config.effort`

#### Scenario: 映射 Echo effort 到 Anthropic effort
- **WHEN** Anthropic request 根据 Echo TUI `reasoning.effort` 构造 `output_config.effort`
- **THEN** `minimal` SHALL 映射为 `low`
- **THEN** `low` SHALL 映射为 `medium`
- **THEN** `medium` SHALL 映射为 `high`
- **THEN** `high` SHALL 映射为 `xhigh`
- **THEN** `xhigh` SHALL 映射为 `max`

#### Scenario: none effort 不启用 Anthropic reasoning
- **WHEN** 当前 Anthropic 模型配置未设置 `reasoning.effort` 或设置为 `none`
- **THEN** Anthropic request SHALL NOT 包含 `output_config.effort`
- **THEN** Anthropic request SHALL NOT 为该配置主动启用 adaptive thinking

#### Scenario: Anthropic 请求仍不发送 OpenAI reasoning 字段
- **WHEN** Anthropic adapter 构造包含 reasoning effort 的 request
- **THEN** 请求参数 SHALL NOT 包含 OpenAI Responses API 的 `reasoning` 字段
- **THEN** 请求参数 SHALL NOT 包含 OpenAI private reasoning item

### Requirement: Anthropic thinking stream 展示与续传
系统 SHALL 处理 Anthropic stream 返回的 thinking 相关 content blocks。adapter SHALL 将可展示 thinking 内容聚合为 `reasoning_summary`，并 SHALL 保存 Anthropic signed thinking 或 redacted thinking 为 provider-only transcript record，以便后续 Anthropic request 可以按 Messages API content block 续传。

#### Scenario: 聚合 thinking delta 为 reasoning summary
- **WHEN** Anthropic stream 返回 `thinking_delta` 内容
- **THEN** adapter SHALL 按 content block index 聚合 thinking 文本
- **THEN** provider turn 完成时 SHALL 将聚合后的 thinking 文本作为 `AgentTurnResult.reasoningSummary` 返回
- **THEN** app 层 SHALL 通过既有 reasoning summary 展示链路显示该内容

#### Scenario: 保存 signed thinking block 供 continuation 使用
- **WHEN** Anthropic stream 返回包含 thinking 文本和 signature 的 thinking content block
- **THEN** adapter SHALL 生成 provider-only Anthropic thinking transcript record
- **THEN** 该 record SHALL 保留 Anthropic content block 的 `type`、`thinking` 和 `signature`
- **THEN** 有 tool call continuation 时，agent loop SHALL 能将该 provider-only record 与同轮 tool call 一起保存在 active transcript region

#### Scenario: 保存 redacted thinking block 供 continuation 使用
- **WHEN** Anthropic stream 返回 `redacted_thinking` content block
- **THEN** adapter SHALL 生成 provider-only Anthropic thinking transcript record
- **THEN** 该 record SHALL 保留 `type: redacted_thinking` 和 provider 返回的 redacted data
- **THEN** 系统 SHALL NOT 将 redacted data 渲染为用户可见文本

#### Scenario: Anthropic converter 回放 provider-only thinking block
- **WHEN** transcript records 包含 provider-only Anthropic thinking record，且后续 records 包含同轮 `tool_call`
- **THEN** Anthropic transcript converter SHALL 将 thinking 或 redacted thinking block 放入 assistant message content
- **THEN** 后续 `tool_call` SHALL 继续转换为同一 assistant message content 中的 `tool_use` block
- **THEN** converter SHALL NOT 把 provider-only thinking record 转换为普通 text block

#### Scenario: 其他 provider 不消费 Anthropic thinking record
- **WHEN** transcript records 包含 provider-only Anthropic thinking record 且当前 provider 不是 `anthropic`
- **THEN** 非 Anthropic provider converter SHALL NOT 将该 record 放入 provider request
- **THEN** 普通 transcript 渲染 SHALL NOT 为该 provider-only record 生成可见消息块

### Requirement: Anthropic reasoning 配置读取
系统 SHALL 在读取 LLM model profile 时保留 Anthropic provider 的 `reasoning.effort`，并 SHALL 继续忽略 Anthropic provider 的 OpenAI-only `reasoning.summary`。

#### Scenario: Anthropic profile 保留 reasoning effort
- **WHEN** 配置文件中的 Anthropic model profile 包含合法 `reasoning.effort`
- **THEN** `readLlmConfig` SHALL 在返回的 `LlmConfig` 中保留该 `reasoningEffort`
- **THEN** `/effort` 和状态栏 SHALL 能基于该值展示当前 effort

#### Scenario: Anthropic profile 忽略 reasoning summary
- **WHEN** 配置文件中的 Anthropic model profile 包含 `reasoning.summary`
- **THEN** `readLlmConfig` SHALL NOT 将该字段作为 `reasoningSummary` 返回
- **THEN** Anthropic adapter SHALL NOT 根据该字段构造 OpenAI Responses-style summary 请求
