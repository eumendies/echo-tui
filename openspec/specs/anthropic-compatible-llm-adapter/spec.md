# anthropic-compatible-llm-adapter Specification

## Purpose
定义 `echo_tui` 的 Anthropic Messages API 兼容 LLM adapter 行为，包括 transcript/tool schema 转换、SDK 流式请求、stream event 处理、工具调用聚合、usage 统计和错误脱敏。

## Requirements

### Requirement: Anthropic Messages transcript 转换
系统 SHALL 在 `anthropic` provider 边界内把本地 `TranscriptRecord[]` 转换为 Anthropic Messages API 所需的 `system` 和 `messages`。转换器 SHALL 保留内置 system prompt、AGENTS 指令、skill catalog、user、assistant、tool_call 和 tool_result 的多轮语义，并 SHALL 过滤本地错误、local notice、reasoning summary 和 OpenAI-private records。

#### Scenario: 转换 system records 为顶层 system
- **WHEN** transcript records 包含一个或多个 `system` record
- **THEN** Anthropic 转换器 SHALL 将这些 records 的文本按顺序合并到顶层 `system`
- **THEN** 转换器 SHALL NOT 把 `system` record 放入 Anthropic `messages`

#### Scenario: 转换普通 user assistant records
- **WHEN** transcript records 包含普通 `user` 或 `assistant` record
- **THEN** Anthropic 转换器 SHALL 生成对应 role 的 message
- **THEN** message content SHALL 包含来自 transcript record `text` 的文本 block

#### Scenario: 转换工具调用为 tool_use block
- **WHEN** transcript records 包含具备 tool call id、tool name 和 arguments JSON object 文本的 `tool_call` record
- **THEN** Anthropic 转换器 SHALL 将该 record 投影为 assistant message content 中的 `tool_use` block
- **THEN** `tool_use` block SHALL 保留 id、name 和解析后的 input object

#### Scenario: 转换工具结果为 tool_result block
- **WHEN** transcript records 包含具备 tool call id 和 output text 的 `tool_result` record
- **THEN** Anthropic 转换器 SHALL 将该 record 投影为 user message content 中的 `tool_result` block
- **THEN** `tool_result` block SHALL 保留 `tool_use_id` 并把 record text 映射为 content

#### Scenario: 跳过无法安全续传的工具记录
- **WHEN** 历史 `tool_call` 或 `tool_result` record 缺少 Anthropic 续传所需的 call id、tool name、arguments 或 output
- **THEN** Anthropic 转换器 SHALL 跳过该不完整记录
- **THEN** 转换器 SHALL NOT 构造缺少必要字段的 content block

#### Scenario: 过滤本地和 OpenAI-only records
- **WHEN** transcript records 包含 `error`、`local_notice`、`reasoning_summary` 或 `openai_reasoning` record
- **THEN** Anthropic 转换器 SHALL NOT 把该 record 放入 Anthropic request
- **THEN** 后续可发送 records SHALL 继续按顺序参与转换

### Requirement: Anthropic 图片工具结果转换
系统 SHALL 在 Anthropic provider 边界内把带图片附件的 `tool_result` transcript record 转换为 Anthropic Messages API 可接收的 `tool_result` 内容。转换 SHALL 保留原有工具结果文本，并 SHALL 将每个受支持图片附件作为 `image` content block 发送给模型。

#### Scenario: 转换带图片附件的 read_files tool result
- **WHEN** transcript records 包含具备 tool use id、output text 和图片附件的 `read_files` `tool_result` record
- **THEN** Anthropic 转换器 SHALL 生成对应 `tool_result` block 并保留 `tool_use_id`
- **THEN** `tool_result` 内容 SHALL 包含来自 record text 的文本内容
- **THEN** `tool_result` 内容 SHALL 为每个图片附件包含 Anthropic `image` block
- **THEN** image block SHALL 使用附件的 media type 和 base64 数据

#### Scenario: 多图片附件按顺序转换
- **WHEN** 一个或多个 Anthropic `tool_result` records 携带多个图片附件
- **THEN** Anthropic 转换器 SHALL 按 transcript 顺序和附件顺序转换图片 block
- **THEN** 转换器 SHALL NOT 丢弃同一工具结果中的后续图片附件

#### Scenario: 没有图片附件时保持纯文本转换
- **WHEN** transcript records 中的 `tool_result` record 不包含图片附件
- **THEN** Anthropic 转换器 SHALL 保持既有纯文本 `tool_result` 转换行为
- **THEN** 转换器 SHALL NOT 额外生成 image block

#### Scenario: 图片附件格式无效时降级为文本 metadata
- **WHEN** `tool_result` record 携带缺少 media type、缺少 base64 数据或 Anthropic 不支持格式的图片附件
- **THEN** Anthropic 转换器 SHALL NOT 构造无效 image block
- **THEN** 转换器 SHALL 保留该 tool result 的文本 metadata
- **THEN** 转换器 SHALL NOT 因单个无效附件中断整个请求构造

### Requirement: Anthropic tool schema 转换
系统 SHALL 在 `anthropic` provider 边界内把 provider-neutral tool definitions 转换为 Anthropic Messages API 的 `tools`。转换器 SHALL 保留工具名称、描述和语义 JSON Schema，并 SHALL NOT 使用 OpenAI Responses 的 strict schema 投影规则。

#### Scenario: 转换本地工具定义
- **WHEN** 本地 tool registry 包含已启用工具定义
- **THEN** Anthropic tool 转换器 SHALL 为每个工具生成包含 `name`、`description` 和 `input_schema` 的工具定义
- **THEN** `input_schema` SHALL 来自 provider-neutral `ToolDefinition.parameters`

#### Scenario: 保留语义 optional schema
- **WHEN** provider-neutral schema 中某个字段不在 `required` 中
- **THEN** Anthropic tool 转换器 SHALL 保持该字段不在 `required` 中
- **THEN** 转换器 SHALL NOT 为该字段追加 `null` 类型或把所有 properties 强制设为 required

### Requirement: Anthropic SDK 流式请求
`anthropic` adapter SHALL 使用官方 Anthropic SDK 发起 Messages API 流式请求。请求 SHALL 包含当前模型名、转换后的 system/messages、`stream: true` 或 SDK 等价流式调用、协议要求的 `max_tokens`、以及在工具 registry 非空时包含 Anthropic tools。请求 SHALL NOT 发送 OpenAI Responses-only `input`、`reasoning`、private reasoning item、Chat Completions `tool_calls` 或 OpenAI `max_output_tokens`。

#### Scenario: 构造 Anthropic stream 请求
- **WHEN** 当前 provider agent type 为 `anthropic` 且用户提交普通消息
- **THEN** adapter SHALL 调用官方 Anthropic SDK 的 Messages API 流式接口
- **THEN** 请求 SHALL 包含配置中的模型名、转换后的 `system`、转换后的 `messages` 和协议要求的 `max_tokens`

#### Scenario: SDK client 使用 provider 配置
- **WHEN** `anthropic` adapter 初始化 SDK client
- **THEN** SDK client SHALL 使用 provider profile 的 `apiKey`
- **THEN** SDK client SHALL 使用可选 `baseURL` 和可选 `headers` 以支持 Anthropic-compatible 网关
- **THEN** 敏感配置值 SHALL NOT 被写入 transcript、日志、错误消息或持久化 session

#### Scenario: Anthropic 请求携带取消信号
- **WHEN** `anthropic` provider agent 执行 provider turn 且调用方提供取消信号
- **THEN** provider SHALL 将该取消信号传递给 Anthropic SDK 流式请求
- **THEN** SDK 请求 SHALL 能响应该取消信号

#### Scenario: 启用工具时发送 Anthropic tools
- **WHEN** `anthropic` adapter 构造请求且本地 tool registry 包含已启用工具
- **THEN** 请求参数 SHALL 包含这些工具对应的 Anthropic tools schema
- **THEN** 请求参数 SHALL NOT 包含本次未注册或未启用的工具定义

#### Scenario: 未启用工具时不发送 Anthropic tools
- **WHEN** `anthropic` adapter 构造请求且本地 tool registry 为空
- **THEN** 请求参数 SHALL NOT 包含 `tools`
- **THEN** 请求参数 SHALL 保持纯文本 Anthropic Messages 行为

#### Scenario: Anthropic 请求不发送其他 provider 字段
- **WHEN** `anthropic` adapter 构造请求
- **THEN** 请求参数 SHALL NOT 包含 OpenAI Responses API 的 `input` 字段
- **THEN** 请求参数 SHALL NOT 包含 OpenAI `reasoning`、private reasoning item、Chat Completions `tool_calls` 或 `max_output_tokens`

### Requirement: Anthropic stream 处理
`anthropic` adapter SHALL 消费 Anthropic SDK streaming events，累积 assistant 文本 draft，聚合完整 tool calls，并在完成时返回 provider-neutral `AgentTurnResult`。adapter SHALL 处理服务端错误、SDK create 错误、stream 异常和用户主动取消，且错误消息 SHALL 做敏感信息脱敏。

#### Scenario: 处理 Anthropic 文本增量
- **WHEN** Anthropic stream 产生文本 delta 事件
- **THEN** adapter SHALL 将该文本增量追加到当前 draft
- **THEN** adapter SHALL 通过文本增量回调把增量和完整 draft 交给 app 层

#### Scenario: 聚合 Anthropic tool_use 分片
- **WHEN** Anthropic stream 通过 content block start/delta/stop 事件返回 tool_use id、name 或 input JSON 分片
- **THEN** adapter SHALL 按 content block index 聚合同一工具调用的字段
- **THEN** adapter SHALL 在工具调用完成后返回完整的 provider-neutral `ToolCall`

#### Scenario: Anthropic stream 完成且无工具调用
- **WHEN** Anthropic stream 以完成状态结束且未产生工具调用
- **THEN** adapter SHALL 返回累积出的完整 assistant draft
- **THEN** `toolCalls` SHALL 为空数组

#### Scenario: Anthropic stream 完成且有工具调用
- **WHEN** Anthropic stream 以 tool use 完成状态结束且产生了完整工具调用
- **THEN** adapter SHALL 返回当前 assistant draft 和完整 `toolCalls`
- **THEN** 工具执行和 continuation SHALL 继续由 agent loop runtime 编排

#### Scenario: 捕获 Anthropic input token usage
- **WHEN** Anthropic stream completion、message start 或 message delta 事件携带 input token usage
- **THEN** adapter SHALL 将 `input_tokens`、`cache_creation_input_tokens` 和 `cache_read_input_tokens` 的总和作为 `usageInputTokens` 返回
- **THEN** adapter SHALL NOT 把 `output_tokens` 计入 provider context usage
- **THEN** 缺少 usage 或缺少 input token 时 SHALL NOT 阻断本次响应完成

#### Scenario: Anthropic stream 异常失败
- **WHEN** Anthropic SDK create 调用失败、stream 抛错、服务端返回错误或 stream 未完成
- **THEN** adapter SHALL reject 一个明确错误
- **THEN** 错误消息 SHALL NOT 包含 API key、Bearer token、x-api-key 或其他敏感凭据

#### Scenario: Anthropic stream 被取消时不作为服务失败
- **WHEN** Anthropic streaming 请求因调用方取消信号触发而中断
- **THEN** `anthropic` provider agent SHALL 以可识别的中断结果结束当前 turn
- **THEN** provider SHALL NOT 将该用户主动中断包装为普通模型服务失败或 stream incomplete 失败

### Requirement: Anthropic reasoning effort 请求
系统 SHALL 在 `anthropic` provider 边界内支持 model profile 的 `reasoning.effort`。当 effort 非 `none` 时，adapter SHALL 启用 Anthropic adaptive thinking，并 SHALL 将 Echo TUI 的 effort 等级原样作为 Anthropic `output_config.effort` 发送；请求 SHALL NOT 使用 OpenAI Responses-only `reasoning` 字段。

#### Scenario: 启用 Anthropic adaptive thinking
- **WHEN** 当前 provider agent type 为 `anthropic` 且当前模型配置包含非 `none` 的 `reasoning.effort`
- **THEN** Anthropic request SHALL 包含 `thinking` 配置，且 `thinking.type` 为 `adaptive`
- **THEN** `thinking.display` SHALL 为 `summarized` 或等价的可展示默认行为
- **THEN** Anthropic request SHALL 包含 `output_config.effort`

#### Scenario: 原样发送 Echo effort 到 Anthropic effort
- **WHEN** Anthropic request 根据 Echo TUI `reasoning.effort` 构造 `output_config.effort`
- **THEN** `low`、`medium`、`high`、`xhigh` 与 `max` SHALL 原样发送

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
