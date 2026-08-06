# streaming-llm-service-adapter Specification

## Purpose
定义 `echo_tui` 真实流式 LLM service adapter 的外部行为，包括用户级配置读取、OpenAI/Anthropic SDK 请求、文本增量处理、回调契约兼容和失败反馈约束。
## Requirements
### Requirement: 真实 LLM 服务配置
系统 SHALL 通过用户级 JSON 配置文件创建真实 LLM adapter。配置 SHALL 从 `~/.echo/config.json` 读取，并包含创建 provider client 和发起文本响应所需的运行参数；敏感字段 SHALL 只驻留在运行时内存中，不得硬编码在源码、测试 fixture、文档示例或 OpenSpec artifacts 中。系统 SHALL NOT 要求用户为 OpenAI provider 配置客户端输出 token 上限；默认 OpenAI 请求 SHALL NOT 发送 `max_output_tokens`。系统 SHALL 支持包含多个 provider profile、多个模型 profile 与持久化当前模型选择的配置。模型 profile SHALL 通过 `provider` 引用 provider profile，并支持可选的 `contextWindow` 配置项，用于上下文压缩的窗口解析；缺省时由内置映射表或默认值回退。provider profile SHALL 使用 `preset` 引用 provider preset catalog，由 catalog 解析出运行时 `agentType`、可选固定 `baseURL` 和可选默认 headers；provider profile 也 MAY 包含手写字符串 `headers`，系统 SHALL 将其与 preset headers 合并为 provider client 默认请求 headers；用户级 real provider presets SHALL 至少包含 `openai-responses-api`、`openai-chat-compatible-api`、`anthropic-compatible-api` 和 `xiaomi-mimo-token-plan`。模型 profile SHALL 支持 OpenAI Responses、OpenAI Chat compatible 和 Anthropic-backed 模型使用可选的 `reasoning.effort` 配置项，用于控制推理等级；`reasoning.summary` SHALL 仅对 Responses-backed 模型生效，其他 provider SHALL 静默忽略该 summary 配置。系统 SHALL NOT 读取旧的顶层或 model profile 级 `agentType`、`apiKey`、`baseURL`、`headers` provider 字段作为 fallback。

#### Scenario: 从用户级配置文件创建配置
- **WHEN** CLI 启动默认真实 adapter
- **THEN** 系统 SHALL 从 `~/.echo/config.json` 读取 LLM 运行配置
- **THEN** 系统 SHALL 使用读取到的配置创建 provider client 和模型请求参数

#### Scenario: 从多 provider 多模型配置创建当前生效配置
- **WHEN** `~/.echo/config.json` 中的 `llm.providers` 包含多个有效 provider profile，`llm.models` 包含多个有效模型 profile，且 `llm.selectedModel` 指向其中一个 profile id
- **THEN** 系统 SHALL 使用被选中的模型 profile 解析当前生效模型名
- **THEN** 系统 SHALL 使用该模型 profile 的 `provider` 字段查找 provider profile
- **THEN** 系统 SHALL 使用 provider profile 的 `preset` 字段查找 provider preset 并解析运行时 `agentType`、`apiKey`、`baseURL` 和 headers

#### Scenario: preset 固定 headers 随请求发送
- **WHEN** 当前生效 provider profile 引用的 provider preset 配置了固定 headers
- **THEN** 系统 SHALL 在创建 provider SDK client 时将这些 headers 设置为默认请求 headers
- **THEN** 系统 SHALL NOT 把 headers 值输出到错误消息或文档示例中的真实配置

#### Scenario: provider profile headers 随请求发送
- **WHEN** 当前生效 provider profile 配置了字符串 `headers`
- **THEN** 系统 SHALL 在创建 provider SDK client 时将这些 headers 设置为默认请求 headers
- **THEN** provider profile headers SHALL 与 preset 固定 headers 合并
- **THEN** 系统 SHALL NOT 把 headers 值输出到错误消息或文档示例中的真实配置

#### Scenario: preset 固定 Base URL 优先生效
- **WHEN** 当前生效 provider profile 引用的 provider preset 定义了固定 `baseURL`
- **THEN** 系统 SHALL 使用 preset 固定 `baseURL` 创建 provider client
- **THEN** 系统 SHALL NOT 要求用户在 provider profile 中重复配置该 Base URL

#### Scenario: 读取 Responses 模型 profile 的 reasoning effort 配置
- **WHEN** 当前生效模型 profile 引用的 provider preset 解析为 `agentType: "openai"`，且模型 profile 配置了有效的 `reasoning.effort`
- **THEN** 系统 SHALL 在解析生效配置时携带该推理等级
- **THEN** 后续 OpenAI Responses 请求 SHALL 发送 `reasoning.effort`

#### Scenario: 未配置 reasoning effort 时不发送 reasoning
- **WHEN** 当前生效模型 profile 没有配置 `reasoning.effort`
- **THEN** 系统 SHALL NOT 在 provider 请求中发送 reasoning effort
- **THEN** 系统 SHALL 让模型服务端决定默认推理行为

#### Scenario: 无效 reasoning effort 明确失败
- **WHEN** 当前生效模型 profile 的 `reasoning.effort` 不是 `none`、`low`、`medium`、`high`、`xhigh` 或 `max`
- **THEN** 系统 SHALL 明确提示 reasoning effort 配置无效
- **THEN** 系统 SHALL NOT 发起真实模型请求

#### Scenario: 非 Responses provider 忽略 reasoning summary 配置
- **WHEN** 当前生效模型 profile 引用的 provider preset 解析为 `agentType: "openai-chat"` 或 `agentType: "anthropic"`，且模型 profile 配置了 `reasoning.summary`
- **THEN** 系统 SHALL 在解析生效配置时忽略该 summary 字段
- **THEN** 后续 provider 请求 SHALL NOT 发送 Responses-style `reasoning.summary`

#### Scenario: 多模型配置缺少 selectedModel 时使用安全默认
- **WHEN** `llm.models` 是非空有效数组，但 `llm.selectedModel` 缺失或为空
- **THEN** 系统 SHALL 使用第一个有效 profile 作为当前生效模型
- **THEN** 系统 SHALL NOT 因缺少 `selectedModel` 而阻止默认真实 adapter 启动

#### Scenario: selectedModel 指向已删除 profile 时使用安全默认
- **WHEN** `llm.models` 是非空有效数组，但 `llm.selectedModel` 指向不存在或无效的 profile
- **THEN** 系统 SHALL 使用第一个有效 profile 作为当前生效模型
- **THEN** 系统 SHALL NOT 因 stale `selectedModel` 阻止默认真实 adapter 启动

#### Scenario: 缺少必要配置时明确失败
- **WHEN** CLI 默认真实 adapter 缺少创建 client 或发起响应所需的必要配置
- **THEN** 系统 SHALL 明确提示缺少必要配置
- **THEN** 系统 SHALL NOT 发起真实模型请求
- **THEN** 错误提示 SHALL NOT 包含敏感字段值

#### Scenario: provider preset 不存在时明确失败
- **WHEN** 当前生效 provider profile 的 `preset` 指向 provider preset catalog 中不存在的 preset id
- **THEN** 系统 SHALL 明确提示 provider preset 不存在
- **THEN** 系统 SHALL NOT 发起真实模型请求
- **THEN** 错误提示 SHALL NOT 包含敏感字段值

#### Scenario: provider 引用不存在时明确失败
- **WHEN** `llm.providers` 存在，且当前生效模型 profile 的 `provider` 指向不存在的 provider id
- **THEN** 系统 SHALL 明确提示模型 profile 引用了不存在的 provider
- **THEN** 系统 SHALL NOT 发起真实模型请求
- **THEN** 错误提示 SHALL NOT 包含敏感字段值

#### Scenario: provider-backed 模型缺少 provider 字段时明确失败
- **WHEN** `llm.providers` 存在，且 `llm.models` 中的模型 profile 缺少 `provider` 字段
- **THEN** 系统 SHALL 明确提示模型 profile 缺少 `provider`
- **THEN** 系统 SHALL NOT 将该 profile 隐式绑定到顶层 provider 配置

#### Scenario: Chat Completions preset 读取配置
- **WHEN** 当前生效模型 profile 引用的 provider preset 解析为 `agentType: "openai-chat"`
- **THEN** 系统 SHALL 接受该 preset 并解析 `apiKey`、可选或固定 `baseURL`、可选 headers 和模型名
- **THEN** 后续 provider 装配 SHALL 创建 Chat Completions adapter，而不是 Responses adapter

#### Scenario: Anthropic preset 读取配置
- **WHEN** 当前生效模型 profile 引用的 provider preset 解析为 `agentType: "anthropic"`
- **THEN** 系统 SHALL 接受该 preset 并解析 `apiKey`、可选或固定 `baseURL`、可选 headers 和模型名
- **THEN** 后续 provider 装配 SHALL 创建 Anthropic adapter，而不是 OpenAI Responses 或 Chat Completions adapter

#### Scenario: 缺少 providers 时明确失败
- **WHEN** `~/.echo/config.json` 中不存在 `llm.providers`
- **THEN** 系统 SHALL 明确提示缺少 `providers`
- **THEN** 系统 SHALL NOT 读取 `llm` 顶层或 model profile 级 provider 字段作为隐式 fallback

#### Scenario: 默认不发送 OpenAI 客户端输出长度限制
- **WHEN** 用户级配置文件未提供服务端专有输出长度参数
- **THEN** 系统 SHALL NOT 在 OpenAI request 中发送 `max_output_tokens`
- **THEN** 系统 SHALL 让模型服务端决定本次响应的输出长度上限

#### Scenario: Anthropic provider 使用协议必需输出上限
- **WHEN** 当前 provider preset 解析为 `agentType: "anthropic"`
- **THEN** Anthropic adapter SHALL 在请求中发送协议要求的 `max_tokens`
- **THEN** 该默认值 SHALL 由 adapter 内部提供，用户不需要在 provider 或 model profile 中配置

#### Scenario: 选择持久化后后续请求使用新模型
- **WHEN** `/model` 或 `/config` 已将某个 profile id 写入 `llm.selectedModel`
- **THEN** 后续普通用户消息触发真实 adapter 时 SHALL 重新读取 `~/.echo/config.json`
- **THEN** 后续 provider 请求参数 SHALL 使用新选择的模型 profile 解析出的模型名和 provider 配置

#### Scenario: 读取模型 profile 的上下文窗口配置
- **WHEN** 当前生效模型 profile 配置了有效的 `contextWindow`
- **THEN** 系统 SHALL 在解析生效配置时携带该上下文窗口值
- **THEN** 该值 SHALL 可供上下文压缩的窗口解析使用

### Requirement: OpenAI transcript input 转换
真实 LLM adapter SHALL 在 OpenAI provider 边界内把本地 `TranscriptRecord[]` 转换为 OpenAI Responses API 的结构化 input。转换器 SHALL 发送本次模型请求支持的 transcript role，包括 user、assistant、system、tool_call 和 tool_result；转换器 SHALL NOT 把本地错误反馈、压缩提示或本地中断提示发送给模型。当存在压缩状态时，adapter SHALL 只投影活跃区间 `records[activeStartIndex:]`，并在内置 system prompt 之后、活跃区间之前注入一条携带摘要文本的 `user` 消息。

#### Scenario: 转换 user assistant system records
- **WHEN** transcript records 包含 `user`、`assistant` 或 `system` role
- **THEN** OpenAI 转换器 SHALL 将这些 records 转换为 OpenAI input message
- **THEN** 转换后的 message SHALL 保留原 role 语义并把 transcript `text` 映射为 OpenAI message `content`

#### Scenario: 转换 tool_call record
- **WHEN** transcript records 包含具备 tool call id、tool name 和 arguments 的 `tool_call` record
- **THEN** OpenAI 转换器 SHALL 将该 record 转换为 Responses API `function_call` input item
- **THEN** 转换后的 item SHALL 保留 call id、name 和 arguments

#### Scenario: 转换 tool_result record
- **WHEN** transcript records 包含具备 tool call id 和 output text 的 `tool_result` record
- **THEN** OpenAI 转换器 SHALL 将该 record 转换为 Responses API `function_call_output` input item
- **THEN** 转换后的 item SHALL 保留 call id 并把 record text 映射为 output

#### Scenario: 过滤 error records
- **WHEN** transcript records 包含 `error` role
- **THEN** OpenAI 转换器 SHALL NOT 把该 record 放入 OpenAI input
- **THEN** 后续普通 user / assistant / system / tool_call / tool_result records SHALL 继续按顺序参与转换

#### Scenario: 过滤本地中断提示 records
- **WHEN** transcript records 包含本地中断提示 role
- **THEN** OpenAI 转换器 SHALL NOT 把该 record 放入 OpenAI input
- **THEN** 后续普通 user / assistant / system / tool_call / tool_result records SHALL 继续按顺序参与转换

#### Scenario: 跳过暂不支持的 role
- **WHEN** transcript records 包含本次 change 未支持的 role
- **THEN** OpenAI 转换器 SHALL NOT 把该 record 放入 OpenAI input
- **THEN** 转换器 SHALL NOT 因未知 role 中断本次请求构造

#### Scenario: 存在压缩状态时只投影活跃区间并注入摘要
- **WHEN** 发起 provider 请求时存在压缩状态（含摘要文本和活跃区间起点索引 `activeStartIndex`）
- **THEN** adapter SHALL 只投影 `records[activeStartIndex:]` 的活跃区间记录
- **THEN** adapter SHALL 在内置 system prompt 之后、活跃区间之前注入一条携带摘要文本的 `user` 消息

#### Scenario: 无压缩状态时投影全部记录
- **WHEN** 转换时不存在压缩状态
- **THEN** 转换器 SHALL 按现有规则投影全部可发送记录
- **THEN** 转换器 SHALL NOT 注入摘要消息

### Requirement: OpenAI Responses 图片工具结果转换
系统 SHALL 在 OpenAI Responses provider 边界内把带图片附件的 `tool_result` transcript record 转换为模型可见的视觉输入。转换 SHALL 保留原有 function call output 的文本 metadata，并 SHALL 将每个受支持图片附件作为同一续传上下文中的图片输入发送给模型。

#### Scenario: 转换带图片附件的 read_files tool result
- **WHEN** transcript records 包含具备 call id、output text 和图片附件的 `read_files` `tool_result` record
- **THEN** OpenAI Responses 转换器 SHALL 继续生成对应 `function_call_output`，并把 record text 映射为 output
- **THEN** 转换器 SHALL 为图片附件生成 OpenAI Responses 可接收的图片输入内容
- **THEN** 图片输入 SHALL 保留附件 media type 和 base64 数据
- **THEN** 后续 provider request SHALL 让模型能够同时看到工具文本 metadata 和图片内容

#### Scenario: 多图片附件按顺序转换
- **WHEN** 一个或多个 `tool_result` records 携带多个图片附件
- **THEN** OpenAI Responses 转换器 SHALL 按 transcript 顺序和附件顺序转换图片输入
- **THEN** 转换器 SHALL NOT 丢弃同一工具结果中的后续图片附件

#### Scenario: 没有图片附件时保持纯文本转换
- **WHEN** transcript records 中的 `tool_result` record 不包含图片附件
- **THEN** OpenAI Responses 转换器 SHALL 保持既有纯文本 `function_call_output` 转换行为
- **THEN** 转换器 SHALL NOT 额外生成图片输入内容

#### Scenario: 图片附件格式无效时降级为文本 metadata
- **WHEN** `tool_result` record 携带缺少 media type、缺少 base64 数据或 provider 不支持格式的图片附件
- **THEN** OpenAI Responses 转换器 SHALL NOT 构造无效图片输入
- **THEN** 转换器 SHALL 保留该 tool result 的文本 metadata
- **THEN** 转换器 SHALL NOT 因单个无效附件中断整个请求构造

### Requirement: OpenAI Chat Completions transcript 转换
系统 SHALL 在 `openai-chat` provider 边界内把本地 `TranscriptRecord[]` 转换为 OpenAI Chat Completions API 的 `messages`。转换器 SHALL 保留 user、assistant、system 的多轮语义，SHALL 将本地 tool call/tool result 记录投影为 Chat Completions 所需的 assistant `tool_calls` 与后续 `tool` messages，并 SHALL 过滤本地错误、local notice、reasoning summary 和 Responses-only private reasoning records。转换器 SHALL 把 Chat reasoning content record 合并回对应 assistant message，用于兼容要求回传 `reasoning_content` 的 Chat Completions compatible provider。

#### Scenario: 转换普通消息 records
- **WHEN** transcript records 包含 `system`、`user` 或不带工具调用的 `assistant` record
- **THEN** Chat 转换器 SHALL 生成同 role 的 Chat message
- **THEN** Chat message 的 `content` SHALL 来自 transcript record 的 `text`

#### Scenario: 聚合 assistant 后续工具调用
- **WHEN** transcript records 中一个 assistant segment 后紧跟一个或多个具备 call id、tool name 和 arguments 的 `tool_call` record
- **THEN** Chat 转换器 SHALL 将这些工具调用放入同一个 assistant message 的 `tool_calls`
- **THEN** 每个 tool call SHALL 保留 id、function name 和 arguments JSON 文本

#### Scenario: 转换工具结果 messages
- **WHEN** transcript records 包含具备 tool call id 和 output text 的 `tool_result` record
- **THEN** Chat 转换器 SHALL 生成 role 为 `tool` 的 Chat message
- **THEN** Chat message SHALL 保留 `tool_call_id` 并把 record text 映射为 `content`

#### Scenario: 跳过无法安全续传的工具记录
- **WHEN** 历史 `tool_call` 或 `tool_result` record 缺少 Chat Completions 续传所需的 call id、tool name、arguments 或 output
- **THEN** Chat 转换器 SHALL 跳过该不完整记录
- **THEN** 转换器 SHALL NOT 构造缺少必要字段的 Chat message

#### Scenario: 过滤本地和 Responses-only records
- **WHEN** transcript records 包含 `error`、`local_notice`、`reasoning_summary` 或 `openai_reasoning` record
- **THEN** Chat 转换器 SHALL NOT 把该 record 放入 Chat messages
- **THEN** 后续可发送 records SHALL 继续按顺序参与转换

#### Scenario: 回放 Chat reasoning content carry-over
- **WHEN** transcript records 包含 Chat reasoning content record
- **AND** 该 record 后续紧邻可发送 assistant message 或 tool call
- **THEN** Chat 转换器 SHALL 将该 reasoning 内容写入对应 assistant message 的 `reasoning_content`
- **THEN** 转换器 SHALL 忽略缺少有效 reasoning 内容的 Chat reasoning content record

### Requirement: OpenAI Chat Completions 图片工具结果转换
系统 SHALL 在 OpenAI Chat Completions provider 边界内把带图片附件的 `tool_result` transcript record 转换为模型可见的视觉输入。转换 SHALL 保留原有 tool message 的文本 metadata，并 SHALL 将每个受支持图片附件作为同一续传上下文中的 `image_url` 内容发送给模型。

#### Scenario: 转换带图片附件的 read_files tool result
- **WHEN** transcript records 包含具备 tool call id、output text 和图片附件的 `read_files` `tool_result` record
- **THEN** OpenAI Chat 转换器 SHALL 继续生成对应 role 为 `tool` 的 message，并把 record text 映射为 content
- **THEN** 转换器 SHALL 为图片附件生成 OpenAI Chat Completions 可接收的 `image_url` 内容
- **THEN** 图片内容 SHALL 保留附件 media type 和 base64 数据
- **THEN** 后续 provider request SHALL 让模型能够同时看到工具文本 metadata 和图片内容

#### Scenario: 多图片附件按顺序转换
- **WHEN** 一个或多个 OpenAI Chat `tool_result` records 携带多个图片附件
- **THEN** OpenAI Chat 转换器 SHALL 按 transcript 顺序和附件顺序转换图片内容
- **THEN** 转换器 SHALL NOT 丢弃同一工具结果中的后续图片附件

#### Scenario: 没有图片附件时保持纯文本转换
- **WHEN** transcript records 中的 `tool_result` record 不包含图片附件
- **THEN** OpenAI Chat 转换器 SHALL 保持既有纯文本 `tool` message 转换行为
- **THEN** 转换器 SHALL NOT 额外生成图片内容

#### Scenario: 图片附件格式无效时降级为文本 metadata
- **WHEN** `tool_result` record 携带缺少 media type、缺少 base64 数据或 Chat Completions 不支持格式的图片附件
- **THEN** OpenAI Chat 转换器 SHALL NOT 构造无效图片内容
- **THEN** 转换器 SHALL 保留该 tool result 的文本 metadata
- **THEN** 转换器 SHALL NOT 因单个无效附件中断整个请求构造

### Requirement: OpenAI SDK 流式请求
真实 LLM adapter SHALL 使用 OpenAI 官方 SDK 发起对话请求，并默认使用流式模式。请求输入 SHALL 从当前本地 transcript records 派生，包含可发送的多轮上下文。启用本地工具时，请求 SHALL 包含已注册 function tools；已成功初始化的 MCP tools SHALL 作为已注册 function tools 的一部分随 normal mode provider request 暴露。未启用工具时，请求 SHALL 保持纯文本行为且 SHALL NOT 包含 tools。默认请求 SHALL NOT 包含客户端输出 token 上限。

#### Scenario: 构造流式文本请求
- **WHEN** 用户提交普通非 slash 消息并触发真实 adapter
- **THEN** adapter SHALL 通过 OpenAI 官方 SDK 发起流式文本响应请求
- **THEN** 请求参数 SHALL 包含配置中的模型名和从 transcript records 派生的 OpenAI input
- **THEN** 请求参数 SHALL 默认不包含 `max_output_tokens`
- **THEN** OpenAI input SHALL 包含本轮刚提交的 user record

#### Scenario: SDK 请求携带取消信号
- **WHEN** OpenAI provider agent 执行 provider turn 且调用方提供取消信号
- **THEN** provider SHALL 将该取消信号传递给 OpenAI SDK responses create 调用
- **THEN** SDK 请求 SHALL 能响应该取消信号

#### Scenario: 携带已提交多轮上下文
- **WHEN** 当前 transcript records 已包含此前完成的 user / assistant / system records，且用户提交新普通消息
- **THEN** adapter SHALL 在本次 OpenAI input 中按 transcript 顺序包含这些可发送 records
- **THEN** adapter SHALL NOT 只发送当前用户文本

#### Scenario: 未启用工具时不发送工具调用定义
- **WHEN** adapter 构造请求且本地 tool registry 为空
- **THEN** 请求参数 SHALL NOT 包含 tools、function calling、多模态输入或后台任务调度相关字段

#### Scenario: 启用工具时发送 function tool 定义
- **WHEN** adapter 构造请求且本地 tool registry 包含已启用工具
- **THEN** 请求参数 SHALL 包含这些工具对应的 OpenAI function tool schema
- **THEN** 请求参数 SHALL NOT 包含本次未注册或未启用的工具定义

#### Scenario: normal mode 发送已初始化 MCP tool 定义
- **WHEN** 当前 interaction mode 为 normal，且 MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** OpenAI 请求 SHALL 包含这些 MCP tools 转换后的 function tool schema
- **THEN** 请求参数 SHALL NOT 包含初始化失败的 MCP server tools

#### Scenario: 敏感配置不进入持久化内容
- **WHEN** adapter 使用配置创建 SDK client 或发起请求
- **THEN** 敏感配置值 SHALL NOT 被写入 transcript、日志、错误消息或持久化 session

### Requirement: OpenAI Chat Completions 流式请求
`openai-chat` adapter SHALL 使用 OpenAI SDK 的 Chat Completions API 发起流式请求。请求 SHALL 包含当前模型名、转换后的 Chat messages、`stream: true`，并在工具 registry 非空时包含 Chat Completions function tools。已成功初始化的 MCP tools SHALL 作为已注册 function tools 的一部分随 normal mode provider request 暴露。请求 SHALL NOT 发送 Responses-only `input`、`reasoning`、private reasoning item 或客户端输出 token 上限。

#### Scenario: 构造 Chat Completions stream 请求
- **WHEN** 当前 provider preset 解析出的 agent type 为 `openai-chat` 且用户提交普通消息
- **THEN** adapter SHALL 调用 OpenAI SDK `chat.completions.create`
- **THEN** 请求 SHALL 包含配置中的模型名、转换后的 `messages` 和 `stream: true`

#### Scenario: Chat 请求携带取消信号
- **WHEN** `openai-chat` provider agent 执行 provider turn 且调用方提供取消信号
- **THEN** provider SHALL 将该取消信号传递给 OpenAI SDK Chat Completions create 调用
- **THEN** SDK 请求 SHALL 能响应该取消信号

#### Scenario: 启用工具时发送 Chat function tools
- **WHEN** `openai-chat` adapter 构造请求且本地 tool registry 包含已启用工具
- **THEN** 请求参数 SHALL 包含这些工具对应的 Chat Completions function tool schema
- **THEN** 请求参数 SHALL NOT 包含本次未注册或未启用的工具定义

#### Scenario: normal mode 发送已初始化 MCP Chat tools
- **WHEN** 当前 interaction mode 为 normal，且 MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** Chat 请求 SHALL 包含这些 MCP tools 转换后的 function tool schema
- **THEN** Chat 请求 SHALL NOT 包含初始化失败的 MCP server tools

#### Scenario: 未启用工具时不发送 Chat tools
- **WHEN** `openai-chat` adapter 构造请求且本地 tool registry 为空
- **THEN** 请求参数 SHALL NOT 包含 `tools`
- **THEN** 请求参数 SHALL 保持纯文本 Chat Completions 行为

#### Scenario: Chat 请求不发送 Responses-only 字段
- **WHEN** `openai-chat` adapter 构造请求
- **THEN** 请求参数 SHALL NOT 包含 Responses API 的 `input` 字段
- **THEN** 请求参数 SHALL NOT 包含 `reasoning`、private reasoning item 或 `max_output_tokens`

### Requirement: OpenAI Chat compatible reasoning effort 请求
系统 SHALL 在 `openai-chat` provider 边界内支持 model profile 的 `reasoning.effort`。当 effort 非 `none` 时，adapter SHALL 在 Chat Completions compatible request 中以 `reasoning_effort` 字段直传 Echo TUI 的 effort 值；请求 SHALL NOT 使用 OpenAI Responses-only 的 `reasoning` 对象。

#### Scenario: Chat profile 保留 reasoning effort
- **WHEN** 当前生效模型 profile 引用的 provider preset 解析为 `agentType: "openai-chat"`，且模型 profile 配置了合法的 `reasoning.effort`
- **THEN** 系统 SHALL 在解析生效配置时携带该 `reasoningEffort`
- **THEN** `/effort` 和状态栏 SHALL 能基于该值展示当前 effort

#### Scenario: Chat request 直传 reasoning effort
- **WHEN** `openai-chat` adapter 构造请求，且当前配置包含非 `none` 的 `reasoningEffort`
- **THEN** 请求参数 SHALL 包含顶层 `reasoning_effort`
- **THEN** `reasoning_effort` 的值 SHALL 与 Echo TUI 配置的 effort 值一致，不做本地映射

#### Scenario: none effort 不发送 reasoning effort
- **WHEN** `openai-chat` adapter 构造请求，且当前配置未设置 `reasoningEffort` 或值为 `none`
- **THEN** 请求参数 SHALL NOT 包含 `reasoning_effort`
- **THEN** 系统 SHALL 让兼容服务端决定默认推理行为

#### Scenario: Chat request 不发送 Responses-only reasoning 字段
- **WHEN** `openai-chat` adapter 构造包含 reasoning effort 的 request
- **THEN** 请求参数 SHALL NOT 包含 OpenAI Responses API 的 `reasoning` 字段
- **THEN** 请求参数 SHALL NOT 包含 OpenAI private reasoning item

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

### Requirement: OpenAI Chat Completions stream 处理
`openai-chat` adapter SHALL 消费 Chat Completions streaming chunks，累积 assistant 文本 draft，聚合完整 tool calls，并在完成时返回 provider-neutral `AgentTurnResult`。adapter SHALL 处理服务端错误、SDK create 错误、stream 异常和用户主动取消，且错误消息 SHALL 做敏感信息脱敏。

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

#### Scenario: Chat stream 异常失败
- **WHEN** Chat SDK create 调用失败、stream 抛错、服务端返回错误或 stream 未完成
- **THEN** adapter SHALL reject 一个明确错误
- **THEN** 错误消息 SHALL NOT 包含 API key、Bearer token 或其他敏感凭据

#### Scenario: Chat stream 被取消时不作为服务失败
- **WHEN** Chat streaming 请求因调用方取消信号触发而中断
- **THEN** `openai-chat` provider agent SHALL 以可识别的中断结果结束当前 turn
- **THEN** provider SHALL NOT 将该用户主动中断包装为普通模型服务失败或 stream incomplete 失败

### Requirement: OpenAI Chat compatible reasoning stream 展示
系统 SHALL 处理 OpenAI Chat Completions compatible stream 返回的 reasoning 内容。adapter SHALL 聚合 `choices[].delta.reasoning_content` 为 `AgentTurnResult.reasoningSummary`，并 SHALL 继续将 `choices[].delta.content` 作为 assistant 正文、`choices[].delta.tool_calls` 作为工具调用分片处理。adapter SHALL 同时生成 Chat reasoning content transcript record，供后续请求按 Chat compatible provider 协议原样续传。

#### Scenario: 聚合 reasoning_content 为 reasoning summary
- **WHEN** Chat compatible stream 返回 `choices[].delta.reasoning_content` 字符串增量
- **THEN** adapter SHALL 按 stream 到达顺序聚合 reasoning 文本
- **THEN** provider turn 完成时 SHALL 将聚合后的 reasoning 文本作为 `AgentTurnResult.reasoningSummary` 返回
- **THEN** app 层 SHALL 通过既有 reasoning summary 展示链路显示该内容

#### Scenario: reasoning content 不作为 assistant 正文 token
- **WHEN** Chat compatible stream 同时或先后返回 `reasoning_content` 和 `content`
- **THEN** adapter SHALL 只将 `content` 追加到 assistant draft 并触发文本 token 回调
- **THEN** adapter SHALL NOT 将 `reasoning_content` 追加到 assistant draft

#### Scenario: reasoning content 与工具调用共存
- **WHEN** Chat compatible stream 返回 `reasoning_content` 后以 `tool_calls` finish reason 结束并包含工具调用分片
- **THEN** adapter SHALL 返回聚合后的 `reasoningSummary`
- **THEN** adapter SHALL 继续返回完整的 provider-neutral `ToolCall`
- **THEN** 工具执行和 continuation SHALL 继续由 agent loop runtime 编排

#### Scenario: 生成 Chat reasoning content record
- **WHEN** Chat compatible stream 返回 `reasoning_content`
- **THEN** adapter SHALL 生成 Chat reasoning content transcript record
- **THEN** app SHALL 持久化该 record 但不把它作为可见 assistant 正文展示

### Requirement: Anthropic Messages stream 处理
`anthropic` adapter SHALL 使用官方 Anthropic SDK 的 Messages API 发起流式请求，消费 Anthropic streaming events，累积 assistant 文本 draft，聚合完整 tool calls，并在完成时返回 provider-neutral `AgentTurnResult`。请求 SHALL 包含当前模型名、转换后的顶层 `system`、转换后的 `messages`、协议要求的 `max_tokens`，并在工具 registry 非空时包含 Anthropic `tools`。已成功初始化的 MCP tools SHALL 作为已注册 tools 的一部分随 normal mode provider request 暴露。请求 SHALL NOT 发送 OpenAI Responses-only `input`、`reasoning`、private reasoning item、Chat Completions `tool_calls` 或 OpenAI `max_output_tokens`。adapter SHALL 处理服务端错误、SDK create 错误、stream 异常和用户主动取消，且错误消息 SHALL 做敏感信息脱敏。

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

#### Scenario: Anthropic stream 异常失败
- **WHEN** Anthropic SDK create 调用失败、stream 抛错、服务端返回错误或 stream 未完成
- **THEN** adapter SHALL reject 一个明确错误
- **THEN** 错误消息 SHALL NOT 包含 API key、Bearer token、x-api-key 或其他敏感凭据

#### Scenario: Anthropic stream 被取消时不作为服务失败
- **WHEN** Anthropic streaming 请求因调用方取消信号触发而中断
- **THEN** `anthropic` provider agent SHALL 以可识别的中断结果结束当前 turn
- **THEN** provider SHALL NOT 将该用户主动中断包装为普通模型服务失败或 stream incomplete 失败

### Requirement: Agent 回调契约兼容
真实 LLM adapter SHALL 兼容 app agent contract：在请求开始时通知 thinking，在每个文本增量到达时通知文本增量，在 assistant segment、tool call、tool approval request 和 tool result 产生时通知 app 层处理对应状态，在成功完成时通知 complete，并返回最终 assistant 文本。agent contract 的输入 SHALL 是当前 `TranscriptRecord[]`，并 MAY 包含一次 run 级取消信号；由具体 adapter 决定如何投影为 provider 请求。

#### Scenario: 请求开始触发 thinking
- **WHEN** adapter 开始处理一次 transcript 输入
- **THEN** adapter SHALL 在首个文本增量之前调用 `onThinking`

#### Scenario: agent run 接收取消信号
- **WHEN** app 层启动一次 agent run 并提供取消信号
- **THEN** agent loop runtime SHALL 将该取消信号传递给底层 provider agent
- **THEN** provider agent SHALL 能在本次 provider turn 中观察该取消信号

#### Scenario: 文本增量到达触发增量回调
- **WHEN** adapter 接收到新的文本增量
- **THEN** adapter SHALL 调用文本增量回调并传入 `delta` 与 `draft`
- **THEN** `draft` SHALL 是当前 assistant segment 从开始到当前增量为止的 draft

#### Scenario: 工具调用前提交 assistant segment
- **WHEN** adapter 在已经产生非空文本 draft 后收到 function call
- **THEN** adapter SHALL 在通知 tool call 前先通知 app 层提交当前 assistant segment
- **THEN** 后续文本增量 SHALL 从新的 assistant segment draft 开始累积

#### Scenario: 工具调用和结果触发回调
- **WHEN** adapter 解析出模型请求的 function call
- **THEN** adapter SHALL 调用 tool call 回调并传入 provider-neutral tool call
- **WHEN** 本地工具执行完成或工具执行被用户拒绝
- **THEN** adapter SHALL 调用 tool result 回调并传入 provider-neutral tool result

#### Scenario: apply_patch 工具调用触发授权回调
- **WHEN** agent loop runtime 准备执行 `apply_patch` tool call
- **THEN** runtime SHALL 在执行工具前调用 tool approval request 回调并传入 provider-neutral tool call
- **THEN** runtime SHALL 等待该回调返回授权决策后再继续处理该 tool call

#### Scenario: 成功完成触发 complete
- **WHEN** adapter 成功读到最终响应完成并得到最终 assistant 文本
- **THEN** adapter SHALL 调用 `onComplete(finalText)` 或等价完成回调
- **THEN** adapter SHALL resolve 为同一个 `finalText`

#### Scenario: 失败时不触发 complete
- **WHEN** adapter 因配置、网络、SDK stream、服务错误或工具循环上限失败
- **THEN** adapter SHALL reject 一个明确错误
- **THEN** adapter SHALL NOT 调用 complete 回调把失败伪装成成功回复

#### Scenario: agent 运行源码行为稳定
- **WHEN** `src/agent/openai-responses/agent`、`src/agent/openai-chat/agent`、`src/agent/anthropic/agent` 或 `src/agent/fake/agent` 处理 LLM 运行流程
- **THEN** 系统 SHALL 从 `~/.echo/config.json` 读取 LLM 运行配置，并保持必要字段、可选字段和默认不发送 OpenAI 客户端输出上限的语义
- **THEN** adapter SHALL 在请求开始时调用 `onThinking`，在文本增量到达时调用增量回调，并在成功完成时调用 complete 回调
- **THEN** fake agent SHALL 支持 thinking、逐字 streaming 和 completion 回调，且测试通过 assistant turn runner、agent loop runtime 或 `createApp(runAgent, ...)` 这类公开运行 seam 使用 fake 或 stub agent 时，CLI 默认真实 adapter 行为 SHALL 不受影响
- **THEN** fake agent SHALL 从传入的 transcript records 中选择最新 user record 作为模拟响应文本来源

#### Scenario: fake thinking 阶段取消
- **WHEN** fake provider 正处于首个 token 前的 thinking delay
- **AND** 取消信号触发
- **THEN** fake provider SHALL 停止等待并结束当前 provider turn
- **THEN** fake provider SHALL NOT 产生 token callback 或 complete 结果

#### Scenario: fake streaming 阶段取消
- **WHEN** fake provider 已经产生部分 token callback 并继续逐字符 streaming
- **AND** 取消信号触发
- **THEN** fake provider SHALL 停止产生后续 token callback
- **THEN** fake provider SHALL 以可识别的中断结果结束当前 provider turn

#### Scenario: agent 编译与测试路径保持兼容
- **WHEN** `src/agent` 中的运行源码模块参与 TypeScript 编译
- **THEN** agent 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`
- **THEN** 编译后的 agent 和 app 测试 SHALL 能够通过原有相对路径加载 `dist/src/agent` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

### Requirement: Agent loop runtime 编排真实工具循环
真实 LLM adapter SHALL 通过 provider-neutral agent loop runtime 编排 function tool call loop。该 runtime SHALL 保持现有 `RunAgent(records, callbacks)` app contract，接收一个底层 provider agent 作为依赖，并负责读取 LLM 配置、创建默认 tool registry、创建 tool executor、执行本地工具、维护 continuation `TranscriptRecord[]`，直到底层 provider agent 返回无 tool call 的最终 assistant 文本、发生错误或调用方取消当前 turn。对于需要用户授权的工具调用，runtime SHALL 在执行工具前通过 app callback 获取授权决策；用户拒绝时 SHALL 不执行工具，并 SHALL 生成拒绝 tool result 参与 continuation。runtime SHALL 将 run 级取消信号传递给 provider turn、自动压缩摘要请求和 tool executor，并在 provider、compaction、approval、user question、tool execution 与 continuation 边界检查该信号。

#### Scenario: 取消信号传递到 provider 和工具运行时
- **WHEN** agent loop runtime 在 provider turn、tool call 或 continuation 编排期间持有取消信号
- **THEN** runtime SHALL 将该信号继续传递给底层 provider turn
- **THEN** runtime SHALL 将该信号传递给自动上下文压缩摘要请求
- **THEN** runtime SHALL 将该信号传递给 tool executor

#### Scenario: 取消后停止工具 continuation
- **WHEN** agent loop runtime 在 provider turn、tool call 或 continuation 编排期间观察到取消信号已触发
- **THEN** runtime SHALL NOT 发起新的 provider continuation turn
- **THEN** runtime SHALL NOT 调用 final complete callback 把该 turn 伪装成成功完成
- **THEN** runtime SHALL 允许 app 层按用户主动中断路径收尾

#### Scenario: 已启动工具 best-effort 取消
- **WHEN** agent loop runtime 已经启动本地工具执行
- **AND** 取消信号随后触发
- **THEN** runtime SHALL 依赖 tool executor 和 handler 对该信号进行 best-effort 取消
- **THEN** runtime SHALL 在工具 await 返回后再次检查取消信号
- **THEN** runtime SHALL NOT 要求不可取消工具必须被同步强制终止

#### Scenario: 默认真实路径通过 loop runtime 调用 OpenAI agent
- **WHEN** CLI 默认真实 adapter 处理普通用户消息
- **THEN** 系统 SHALL 通过 agent loop runtime 调用底层 OpenAI provider agent
- **THEN** `main.ts` SHALL NOT 直接创建 tool registry 或 tool executor
- **THEN** app 层看到的 agent contract SHALL 仍是 `RunAgent(records, callbacks)`

#### Scenario: loop runtime 加载配置和工具运行时
- **WHEN** agent loop runtime 开始一次 `RunAgent` 调用
- **THEN** runtime SHALL 读取当前 LLM 配置
- **THEN** runtime SHALL 使用该配置创建默认 tool registry 和 tool executor
- **THEN** runtime SHALL 使用同一配置和 tool registry 初始化底层 provider agent
- **THEN** runtime SHALL NOT 在后续 `runTurn` 调用中把 provider 私有运行态作为参数传回底层 provider agent

### Requirement: Agent loop 行为不依赖测试专用 runtime dependencies
系统 SHALL 在删除 agent runtime 创建入口测试专用 dependencies 后保持 agent loop 外部行为不变，包括读取配置、初始化 provider、构建工具 registry、执行 tool call continuation、处理 approval/user question、context compaction 和 context usage callback。Plan mode SHALL 使用与 normal mode 相同的 provider-visible tool registry 来初始化 provider agent，但 SHALL 在执行前风险分类中继续强制只读规划约束。

#### Scenario: Runtime 使用真实配置和 provider 装配
- **WHEN** app 启动 agent loop runtime
- **THEN** runtime SHALL 按当前配置读取和初始化 provider agent
- **THEN** runtime SHALL 使用真实工具 registry 和 tool executor 装配路径
- **THEN** 调用方 SHALL 不需要提供测试专用 provider/config/tool factory dependencies

#### Scenario: Tool continuation 行为保持不变
- **WHEN** provider 返回 tool calls
- **THEN** runtime SHALL 仍追加 tool call/result continuation records
- **THEN** runtime SHALL 仍按工具风险分类处理拒绝、授权和执行结果

#### Scenario: Plan mode 使用稳定 provider-visible registry
- **WHEN** session interaction mode 为 plan
- **THEN** runtime SHALL 使用与 normal mode 相同的 provider-visible tool registry 初始化底层 provider agent
- **THEN** provider-visible tool definitions SHALL 包含默认内置工具，并在 MCP manager 可用时包含成功初始化的 MCP tools
- **THEN** 删除测试专用 dependencies SHALL NOT 放宽 plan mode 的工具执行约束

#### Scenario: MCP 工具仍合并到 runtime registry
- **WHEN** runtime 具有 MCP manager
- **THEN** runtime SHALL 仍将 MCP tool registry 与本地 tool registry 合并
- **THEN** MCP tool approval 配置 SHALL 仍参与 normal mode 风险分类
- **THEN** plan mode SHALL 在执行前风险分类中拒绝 MCP tool call

#### Scenario: 底层 provider agent 不执行工具循环
- **WHEN** provider agent 返回 tool calls
- **THEN** 底层 provider agent SHALL NOT 直接执行本地工具
- **THEN** agent loop runtime SHALL 继续负责执行工具、追加 tool continuation records 并发起后续 provider turn

### Requirement: agent loop 高危工具授权编排
agent loop runtime SHALL 在普通 tool executor 前执行 tool call 风险分类。对于需要授权的高危调用，runtime SHALL 请求 app 层授权并等待用户决策；app 层 callback MAY 因当前 CLI 进程会话内已有授权而立即返回允许执行的结构化决策，且不显示授权 UI。用户允许或 app 层命中会话授权时，runtime SHALL 执行原始 tool call；用户拒绝或提供反馈时，runtime SHALL 生成拒绝 tool result 并继续模型 continuation。

#### Scenario: 高危调用通过 approval callback 获取授权决策
- **WHEN** provider 返回被风险分类为需要授权的 tool call
- **THEN** agent loop runtime SHALL 在调用普通 tool executor 前调用 tool approval request callback
- **THEN** runtime SHALL 等待用户授权决策后再处理该 tool call

#### Scenario: 用户允许本次后执行原始工具调用
- **WHEN** 高危 tool call 授权请求返回允许本次执行
- **THEN** agent loop runtime SHALL 调用普通 tool executor 执行原始 tool call
- **THEN** runtime SHALL 将真实执行结果追加为 continuation 中的 tool result record
- **THEN** runtime SHALL NOT 因该决策在自身内部建立会话级授权缓存

#### Scenario: 用户允许非 bash 工具在当前会话内执行
- **WHEN** 高危非 bash tool call 授权请求返回允许同名工具在当前会话内执行
- **THEN** runtime SHALL 调用普通 tool executor 执行当前原始 tool call
- **THEN** runtime SHALL 将该决策视为允许执行
- **THEN** runtime SHALL NOT 在自身内部记录该 tool name 的会话级授权

#### Scenario: 用户允许 bash command 在当前会话内执行
- **WHEN** 高危 `run_bash_command` 授权请求返回允许同一 command 在当前会话内执行
- **THEN** runtime SHALL 调用普通 tool executor 执行当前原始 tool call
- **THEN** runtime SHALL 将该决策视为允许执行
- **THEN** runtime SHALL NOT 在自身内部记录该 bash command 文本的会话级授权

#### Scenario: 用户允许所有需审批工具在当前会话内执行
- **WHEN** 高危 tool call 授权请求返回允许所有工具在当前会话内执行
- **THEN** runtime SHALL 调用普通 tool executor 执行当前原始 tool call
- **THEN** runtime SHALL 将该决策视为允许执行
- **THEN** runtime SHALL NOT 在自身内部记录允许所有工具的会话级授权

#### Scenario: 用户拒绝后不执行原始工具调用
- **WHEN** 高危 tool call 授权请求返回拒绝执行
- **THEN** agent loop runtime SHALL NOT 调用普通 tool executor 执行原始 tool call
- **THEN** runtime SHALL 生成拒绝 tool result
- **THEN** runtime SHALL 将拒绝结果追加为 continuation 中的 tool result record

#### Scenario: 用户反馈后不执行原始工具调用
- **WHEN** 高危 tool call 授权请求返回用户反馈决策
- **THEN** agent loop runtime SHALL NOT 调用普通 tool executor 执行原始 tool call
- **THEN** runtime SHALL 生成包含用户反馈文本的拒绝 tool result
- **THEN** runtime SHALL 将拒绝结果追加为 continuation 中的 tool result record

#### Scenario: 安全调用不请求授权
- **WHEN** provider 返回被风险分类为可直接执行的 tool call
- **THEN** agent loop runtime SHALL NOT 调用 tool approval request callback
- **THEN** runtime SHALL 直接调用普通 tool executor 执行该 tool call

#### Scenario: 会话授权命中不改变 transcript continuation
- **WHEN** app 层 approval callback 因会话级授权命中而立即返回允许执行决策
- **AND** agent loop runtime 执行对应 tool call
- **THEN** runtime SHALL 继续追加原始 tool call record 和真实 tool result record
- **THEN** runtime SHALL NOT 追加表示授权缓存命中的额外 provider-facing transcript record

### Requirement: interactive tool continuation
agent loop runtime SHALL 支持 interactive tool continuation。对于 `ask_user_questions`，agent loop SHALL 在收到 tool call 后暂停普通工具执行流程，等待 app 层用户交互返回 tool result，再将该 result 追加到 continuation records 并继续后续模型请求。

#### Scenario: ask_user_questions 通过 app callback 执行
- **WHEN** provider 返回名为 `ask_user_questions` 的 tool call
- **THEN** agent loop SHALL 通知 app 层打开用户问题交互
- **THEN** agent loop SHALL 等待 app 层返回 tool result
- **THEN** agent loop SHALL NOT 将该 tool call 交给普通 tool executor 执行

#### Scenario: 用户回答后继续 agent loop
- **WHEN** app 层为 `ask_user_questions` 返回 tool result
- **THEN** agent loop SHALL 将对应 tool result record 加入 continuation records
- **THEN** agent loop SHALL 使用包含该 tool result 的上下文继续请求模型

#### Scenario: 用户取消后继续回传取消结果
- **WHEN** app 层为 `ask_user_questions` 返回 `ok: false` 的取消 tool result
- **THEN** agent loop SHALL 将取消结果作为普通 tool result 追加到 continuation records
- **THEN** agent loop SHALL NOT 因用户取消而把当前 turn 标记为本地执行错误

#### Scenario: OpenAI provider 边界保留协议转换
- **WHEN** 底层 OpenAI provider agent 发起一次 provider turn
- **THEN** OpenAI provider agent SHALL 在自身边界内把 `TranscriptRecord[]` 转换为 OpenAI Responses input
- **THEN** OpenAI provider agent SHALL 在自身边界内把 tool registry definitions 转换为 OpenAI function tools
- **THEN** OpenAI provider agent SHALL 返回 provider-neutral tool calls 给 agent loop runtime

### Requirement: 内置 system prompt 注入
真实 LLM adapter SHALL 在每次默认真实 agent 调用中解析基础 system prompt，并将其作为 provider 请求上下文中的 transient `system` transcript record 注入。系统 SHALL 优先使用项目级 `SYSTEM.md`，其次使用用户级 `~/.echo/SYSTEM.md`，最后使用源码内置 prompt。`SYSTEM.md` SHALL 只替换基础文本；当前 cwd、AGENTS.md、skills 和 memory SHALL 继续追加到同一 system record。具体工具选择 SHALL 由请求中提供的工具 definitions 与任务上下文决定。

#### Scenario: 默认真实请求携带内置基础 prompt
- **WHEN** 用户提交普通消息并触发默认真实 agent
- **THEN** agent loop runtime SHALL 在传给底层 provider agent 的 records 开头注入一条 `system` record
- **THEN** 未发现有效 `SYSTEM.md` 时，该 system record 的基础文本 SHALL 来自源码内置 prompt
- **THEN** 该 system record SHALL 包含当前工作目录 cwd
- **THEN** OpenAI provider request input SHALL 包含该 system message

#### Scenario: 内置规则保持最小且不编排工具选择
- **WHEN** agent loop runtime 构造内置 system prompt
- **THEN** prompt SHALL 保留语言与回答风格、基于当前对话和工具结果、明确不确定性及非平凡多步骤 todo 生命周期规则
- **THEN** prompt SHALL NOT 指定具体工具的使用优先级或要求模型先判断工具是否必要
- **THEN** prompt SHALL NOT 包含通用凭据或敏感信息提醒

#### Scenario: 项目级 SYSTEM.md 覆盖用户级和内置基础 prompt
- **WHEN** 项目根目录存在非空可读的 `SYSTEM.md`
- **THEN** agent loop runtime SHALL 使用该文件内容作为基础 system prompt
- **THEN** runtime SHALL NOT 同时拼接用户级 `~/.echo/SYSTEM.md` 或源码内置基础文本

#### Scenario: 用户级 SYSTEM.md 覆盖内置基础 prompt
- **WHEN** 项目级 `SYSTEM.md` 不可用且 `~/.echo/SYSTEM.md` 非空可读
- **THEN** agent loop runtime SHALL 使用用户级文件内容作为基础 system prompt
- **THEN** runtime SHALL NOT 同时拼接源码内置基础文本

#### Scenario: SYSTEM.md 保留动态上下文 section
- **WHEN** agent loop runtime 使用任一 `SYSTEM.md` 覆盖基础 prompt
- **THEN** system record SHALL 继续包含当前 cwd
- **THEN** system record SHALL 继续按现有行为追加适用的 AGENTS.md、skills 和 memory section

#### Scenario: 无效 SYSTEM.md 回退
- **WHEN** 某个 `SYSTEM.md` 缺失、不是普通文件、不可读或规范化后为空
- **THEN** runtime SHALL 忽略该候选并尝试下一优先级来源
- **THEN** runtime SHALL 完整读取生效文件且 SHALL NOT 按字节数截断其内容

#### Scenario: JSON 用户配置不能覆盖 system prompt
- **WHEN** `~/.echo/config.json` 或模型 profile 中包含 `systemPrompt`、`prompt` 或类似字段
- **THEN** 默认真实 agent SHALL NOT 使用这些字段覆盖基础 system prompt
- **THEN** 默认真实 agent SHALL 继续使用按 `SYSTEM.md` 优先级解析出的基础 prompt

#### Scenario: system prompt 不进入本地 transcript ledger
- **WHEN** agent loop runtime 注入内置 system prompt
- **THEN** runtime SHALL NOT 通过 app callbacks 追加该 system record
- **THEN** runtime SHALL NOT 修改调用方传入的 `TranscriptRecord[]`
- **THEN** transcript persistence SHALL NOT 保存该内置 system prompt record

#### Scenario: tool continuation 保留已解析的 system prompt
- **WHEN** 模型产生 tool call 且 agent loop runtime 需要发起 continuation provider turn
- **THEN** continuation records SHALL 仍以同一条 system record 开头
- **THEN** 同一次 agent run SHALL 使用相同的基础 prompt 快照
- **THEN** runtime SHALL 在该 system record 后继续追加 assistant segment、tool_call 和 tool_result records

#### Scenario: OpenAI adapter 不拥有 prompt 来源策略
- **WHEN** OpenAI provider agent 构造 Responses request
- **THEN** OpenAI provider agent SHALL 只转换传入 records 中已有的 `system` record
- **THEN** OpenAI provider agent SHALL NOT 自行读取配置或生成额外 system prompt

### Requirement: provider system prompt 注入 skill catalog
真实 LLM adapter 的 provider records 构建 SHALL 在内置 system prompt 中包含当前可用 skill catalog。catalog SHALL 基于默认 skill registry 发现结果生成，并 SHALL 只包含模型选择 skill 所需的短元数据。

#### Scenario: 构造 provider records 时包含 skill catalog
- **WHEN** agent loop runtime 构造 provider records 且存在可用 skill
- **THEN** 第一条 system record SHALL 包含内置系统提示和 skill catalog
- **THEN** catalog SHALL 包含每个 skill 的名称和描述

#### Scenario: catalog 引导模型调用 use_skill
- **WHEN** system prompt 包含 skill catalog
- **THEN** catalog 文本 SHALL 说明模型可在用户请求明确匹配某个 skill 时调用 `use_skill`
- **THEN** catalog 文本 SHALL NOT 要求模型无条件加载全部 skill

#### Scenario: skill catalog 随 registry 更新
- **WHEN** 发起新的 agent run 且 skill 文件内容或集合已变化
- **THEN** 系统 SHALL 基于当前文件系统重新生成或刷新 skill catalog
- **THEN** 后续 provider 请求 SHALL 使用最新可用的 skill 名称和描述

#### Scenario: 无 skill 时保持原请求形态
- **WHEN** 当前没有可用 skill
- **THEN** provider system prompt SHALL 保持不包含 skill catalog
- **THEN** 普通 OpenAI input 转换和工具 schema 发送语义 SHALL 保持不变

### Requirement: provider system prompt 注入 AGENTS.md 指令
真实 LLM adapter 的 provider records 构建 SHALL 在内置 system prompt 中追加适用的 `AGENTS.md` 指令。AGENTS 指令 SHALL 作为 transient system prompt 内容参与模型请求，并 SHALL NOT 写入本地 transcript、持久化 session 或用户配置。内置运行时约束、tool 安全策略和当前交互模式 SHALL 优先于 AGENTS 指令；项目内更具体路径的 AGENTS 指令 SHALL 优先于项目根 AGENTS 指令；项目 AGENTS 指令 SHALL 优先于全局 AGENTS 指令。

#### Scenario: 构造 provider records 时包含全局 AGENTS
- **WHEN** `~/.echo/AGENTS.md` 存在且可读
- **AND** agent loop runtime 构造 provider records
- **THEN** 第一条 system record SHALL 包含该全局 AGENTS 指令内容
- **THEN** system record SHALL 标明该指令来自全局 AGENTS

#### Scenario: 使用项目根到 cwd 的 AGENTS 链路
- **WHEN** 当前 `cwd` 位于一个由 `.git` 或项目 `.echo` marker 判定出的项目根下
- **AND** 项目根到 `cwd` 的路径链路中存在一个或多个 `AGENTS.md`
- **THEN** 第一条 system record SHALL 按从项目根到 `cwd` 的顺序包含这些项目 AGENTS 指令
- **THEN** system record SHALL 为每个项目 AGENTS 标明相对项目路径

#### Scenario: 项目根使用最近 marker 判定
- **WHEN** 从当前 `cwd` 向父目录查找项目根
- **THEN** 系统 SHALL 使用最近的包含 `.git` 或项目 `.echo` marker 的目录作为项目根
- **THEN** `.git` marker SHALL 支持目录或文件形式
- **THEN** 项目 `.echo` marker SHALL NOT 把用户 home 下的全局 `~/.echo` 当作项目根

#### Scenario: 无项目 marker 时只读取 cwd AGENTS
- **WHEN** 从当前 `cwd` 向父目录没有找到 `.git` 或项目 `.echo` marker
- **THEN** 系统 SHALL 只尝试读取当前 `cwd/AGENTS.md`
- **THEN** 系统 SHALL NOT 继续读取父目录中的 `AGENTS.md`

#### Scenario: AGENTS 缺失或不可读时保持请求可用
- **WHEN** 全局或项目 `AGENTS.md` 缺失、不可读或不是可读取的普通文本文件
- **THEN** agent loop runtime SHALL 跳过该 AGENTS 文件
- **THEN** agent loop runtime SHALL 继续构造 provider records
- **THEN** 系统 SHALL NOT 因该 AGENTS 文件问题追加本地 transcript 错误记录

#### Scenario: AGENTS 内容受大小预算限制
- **WHEN** 单个 AGENTS 文件或全部 AGENTS 指令内容超过运行时大小预算
- **THEN** system prompt SHALL 只包含预算内的 AGENTS 内容
- **THEN** system prompt SHALL 对被裁剪内容显示 `truncated` 或等价提示
- **THEN** provider records SHALL 继续保留内置 system prompt、当前工作目录、plan mode 和 skill catalog 语义

#### Scenario: AGENTS 指令不覆盖内置 system prompt
- **WHEN** AGENTS 指令与源码内置 system prompt、tool 安全策略或 plan mode 约束冲突
- **THEN** system prompt SHALL 明确内置运行时约束和当前交互模式优先级更高
- **THEN** OpenAI provider agent SHALL 继续只转换传入 records 中已有的 system record
- **THEN** OpenAI provider agent SHALL NOT 自行读取 AGENTS 文件或生成额外 system prompt

#### Scenario: 无 AGENTS 时保持原请求形态
- **WHEN** 当前没有可用的全局或项目 AGENTS 指令
- **THEN** provider system prompt SHALL 保持不包含 AGENTS section
- **THEN** 普通 OpenAI input 转换、skill catalog 注入和工具 schema 发送语义 SHALL 保持不变

### Requirement: 失败反馈
系统 SHALL 对真实服务接入中的失败提供可见、可测试且不泄密的反馈。失败后应用 SHALL 停止 pending 状态、释放响应锁，并避免把敏感配置值暴露给用户。本地失败反馈 SHALL 记录为 `error` transcript record，而不是伪装成 assistant 回复。若失败前已经生成 partial assistant draft，系统 SHALL 先保留该 partial assistant 内容，再追加本地 error record 表示失败事实。

#### Scenario: 服务错误失败
- **WHEN** 模型服务返回错误或 SDK 抛出服务错误
- **THEN** adapter SHALL 产生包含错误类别或状态摘要的错误
- **THEN** 错误内容 SHALL NOT 包含敏感配置值

#### Scenario: stream 中断失败且没有 partial draft
- **WHEN** stream 在完成前中断且尚未产生文本增量
- **THEN** adapter SHALL 产生明确的 stream incomplete 错误
- **THEN** 应用 SHALL 释放 response lock，使用户可以继续输入

#### Scenario: stream 中断失败且已有 partial draft
- **WHEN** stream 在完成前中断或返回 incomplete，且本次响应已经产生 partial draft
- **THEN** 应用 SHALL 先追加一条 assistant transcript record 保存 partial draft
- **THEN** 应用 SHALL 再追加一条本地 error record 表示响应未完整结束
- **THEN** 应用 SHALL 释放 response lock，使用户可以继续输入

#### Scenario: app 层展示本地错误
- **WHEN** 真实 adapter reject 且用户消息已经提交到 transcript
- **THEN** 应用 SHALL 清空 pending preview 并停止 spinner
- **THEN** 应用 SHALL 追加一条本地 `error` transcript record 作为可见反馈
- **THEN** 该错误 record SHALL 被持久化到当前 transcript session
- **THEN** 该错误 record SHALL NOT 进入后续 OpenAI input

### Requirement: OpenAI function tool call loop
真实 LLM adapter SHALL 支持 Responses API function tool call loop。启用工具后，agent loop runtime SHALL 调用底层 OpenAI provider agent 解析模型产生的 function call，执行本地工具，将 tool result 作为后续 `function_call_output` 上下文回传模型，并继续请求直到最终 assistant 文本完成或发生错误。

#### Scenario: 模型调用 bash 工具并继续生成回复
- **WHEN** OpenAI stream 产生 `run_bash_command` function call
- **THEN** adapter SHALL 执行对应本地工具
- **THEN** adapter SHALL 把工具结果作为 `function_call_output` 放入下一次 OpenAI request input
- **THEN** adapter SHALL 继续读取后续模型响应直到最终完成

#### Scenario: function call arguments delta 被累积到 done
- **WHEN** OpenAI stream 产生 function call arguments delta 或 done 事件
- **THEN** adapter SHALL 以 done 事件中的完整 arguments 作为工具执行参数
- **THEN** adapter SHALL NOT 使用未完成的 partial arguments 执行工具

#### Scenario: 单轮多个工具调用按顺序处理
- **WHEN** 同一次响应中出现多个 function call
- **THEN** adapter SHALL 按 provider 输出顺序为每个 call 追加 tool call、执行工具并追加 tool result
- **THEN** 下一次 continuation request SHALL 包含这些 tool result

#### Scenario: 工具执行失败回传模型
- **WHEN** 本地工具返回 `ok: false` 的 tool result
- **THEN** adapter SHALL 仍把该 tool result 作为 function call output 回传模型
- **THEN** adapter SHALL NOT 仅因工具业务失败中断整个 agent turn

### Requirement: 工具调用可见消息延迟落盘
系统 SHALL 在 app 可见层把未完成的工具调用视为 footer pending 状态，而不是在 `tool_call` 回调到达时立即写入 transcript 区域。工具执行完成后，系统 SHALL 保持既有 transcript record 类型，按顺序追加对应的 `tool_call` record 和 `tool_result` record。

#### Scenario: tool call 先显示为 pending preview
- **WHEN** agent callback 收到 provider-neutral tool call
- **THEN** app SHALL 暂存该 tool call
- **THEN** app SHALL 更新 footer pending preview 以显示该工具调用
- **THEN** app SHALL NOT 立即追加可见 `tool_call` transcript record

#### Scenario: tool result 到达后追加既有 transcript records
- **WHEN** 本地工具执行完成且 agent callback 收到 tool result
- **THEN** app SHALL 使用暂存的 tool call 追加 `tool_call` transcript record
- **THEN** app SHALL 紧随其后追加 `tool_result` transcript record
- **THEN** 两条 record SHALL 保持既有 metadata 字段，供历史恢复和 provider input 转换继续使用

#### Scenario: runtime continuation 记录不受可见延迟影响
- **WHEN** agent loop runtime 执行工具调用并发起 continuation turn
- **THEN** runtime SHALL 继续在自身维护的 continuation records 中追加 `tool_call` 和 `tool_result`
- **THEN** app 可见层延迟 transcript append SHALL NOT 改变 provider continuation input 顺序

#### Scenario: result 缺少暂存 call 时安全降级
- **WHEN** app 收到 tool result 但没有可匹配的暂存 tool call
- **THEN** app SHALL 仍追加该 `tool_result` record 或等价可见失败反馈
- **THEN** app SHALL NOT 因缺少暂存 call 中断本轮响应或丢失 tool result

### Requirement: apply_patch tool result diff-style rendering
系统 SHALL 为相邻的 `apply_patch` tool call/result transcript records 提供按文件和 hunk 组织的专属 TUI 渲染。该渲染 SHALL 使用 tool result 中持久化的 display-only metadata 展示实际编辑内容、位置和上下文，SHALL 支持 added、updated 和 deleted 文件种类，SHALL NOT 改变 transcript 事实内容或 provider continuation input。

#### Scenario: 简化 apply_patch 调用行
- **WHEN** TUI renders an `apply_patch` tool call paired with its matching tool result
- **THEN** call line SHALL NOT display the raw JSON patch arguments
- **THEN** call line SHALL display a concise `ApplyPatch` label
- **THEN** call line MAY include a single file path or changed file count derived from display metadata
- **THEN** call prefix symbol SHALL continue to use success or failure styling based on adjacent result `ok`

#### Scenario: 按文件和 hunk 展示编辑内容
- **WHEN** TUI renders an `apply_patch` result with valid display metadata
- **THEN** result area SHALL preserve file and hunk boundaries instead of flattening all edit lines
- **THEN** each file SHALL display its path and added/removed logical line counts
- **THEN** result area SHALL display context, removed, added and omitted-context rows from display metadata
- **THEN** result area SHALL NOT display patch syntax headers such as `diff --git`, `---`, `+++`, `@@`, `deleted file mode`, `*** Begin Patch`, `*** Update File`, `*** Add File`, `*** Delete File` or `*** End Patch`
- **THEN** result area SHALL NOT display the raw `Applied patch` changed files summary when valid display metadata is available and result succeeded

#### Scenario: 渲染 deleted 文件 metadata
- **WHEN** TUI renders an `apply_patch` result whose display metadata contains a file with `kind: deleted`
- **THEN** result area SHALL display that file heading as a deleted file or with equivalent removed-file semantics
- **THEN** result area SHALL display the deleted file content as removed rows
- **THEN** the file heading SHALL include zero added lines and the removed logical line count
- **THEN** renderer SHALL accept deleted files as valid apply_patch display metadata

#### Scenario: 使用单列定位 gutter
- **WHEN** TUI renders display lines with actual post-image location metadata
- **THEN** context rows SHALL display their real 1-based post-image file line number in one right-aligned gutter
- **THEN** added rows SHALL display `+` in that same gutter instead of displaying their numeric line number
- **THEN** removed rows SHALL display `-` in that same gutter
- **THEN** an added row SHALL still consume one post-image line number so the next context row reflects that addition
- **THEN** a removed row SHALL NOT consume a post-image line number
- **THEN** wrapped continuation rows SHALL leave the gutter blank and SHALL NOT consume another logical line number

#### Scenario: unresolved 行不显示伪造行号
- **WHEN** TUI renders apply-patch display lines whose `postLine` is null
- **THEN** context rows SHALL leave the numeric gutter blank
- **THEN** added and removed rows SHALL still display `+` and `-`
- **THEN** renderer SHALL NOT derive visible line numbers from the original patch header or current target file

#### Scenario: 增删背景覆盖完整内容行
- **WHEN** TUI renders an added or removed logical row
- **THEN** added rows SHALL use a green background
- **THEN** removed rows SHALL use a red background
- **THEN** the background SHALL start at the location gutter and include its separator, content and right-side padding through the terminal safe render width
- **THEN** the outer tool prefix indentation SHALL remain outside the red or green background
- **THEN** every wrapped physical continuation row SHALL preserve the source logical row background through the terminal safe render width
- **THEN** context and omitted rows SHALL remain neutral without red or green background

#### Scenario: deleted 文件 removed 行使用删除样式
- **WHEN** TUI renders removed rows from a deleted apply_patch file
- **THEN** those rows SHALL use the same red background and `-` gutter semantics as other removed rows
- **THEN** those rows SHALL NOT display fabricated post-image line numbers
- **THEN** wrapped continuation rows SHALL preserve the removed-row background through the terminal safe render width

#### Scenario: 折叠较长的未修改上下文
- **WHEN** display metadata contains complete file lines with an unchanged interval beyond the configured context window
- **THEN** renderer SHALL preserve up to 3 unchanged lines before and after the edit window
- **THEN** renderer SHALL replace the hidden middle interval with a neutral omitted marker
- **THEN** the omitted marker SHALL report the number of hidden logical lines
- **THEN** the next visible context row SHALL retain its actual post-image line number
- **THEN** renderer SHALL merge adjacent omitted intervals
- **THEN** renderer SHALL NOT output consecutive unchanged-lines markers

#### Scenario: 多文件和多修改区块使用结构化软预算
- **WHEN** the folded apply-patch projection still exceeds the apply-patch display budget
- **THEN** truncation SHALL affect only the visible projection
- **THEN** renderer SHALL preserve every file heading
- **THEN** renderer SHALL preserve at least one actual added or removed row from every modification group
- **THEN** renderer SHALL prefer omitting unchanged context before omitting changed rows
- **THEN** any omitted changed rows SHALL use a marker that reports the hidden logical line count
- **THEN** renderer SHALL NOT discard later files or modification groups solely because earlier content consumed the budget
- **THEN** when failure rows, file headings and one changed row per modification group exceed the budget, renderer SHALL allow the visible projection to exceed the budget
- **THEN** the apply-patch display budget SHALL remain larger than the generic tool result display budget

#### Scenario: 失败结果保留失败原因和尝试编辑内容
- **WHEN** TUI renders an `apply_patch` result whose `ok` is false and display metadata is available
- **THEN** result area SHALL include the concise failure reason from the provider-facing result text
- **THEN** result area SHALL also display the available parsed or simulated edit structure
- **THEN** result area SHALL still use red and green background styling for removed and added rows

#### Scenario: 本次结果缺少 metadata 时安全处理
- **WHEN** TUI renders an `apply_patch` tool result that has no display metadata because patch parsing failed
- **THEN** renderer SHALL use the generic tool result rendering
- **THEN** renderer SHALL NOT throw or interrupt transcript rendering

#### Scenario: 历史恢复使用持久化 metadata
- **WHEN** a transcript session containing `apply_patch` display metadata is loaded through resume
- **THEN** TUI SHALL render the stored file grouping, locations, context and omission information
- **THEN** TUI SHALL NOT read current target files or recompute hunk matches

### Requirement: 默认真实 agent 暴露 apply_patch 工具
真实 LLM adapter SHALL 在默认 tool registry 中暴露 `apply_patch` 工具，使模型可以通过 agent loop runtime 对文本文件执行 patch 编辑。OpenAI provider agent SHALL 继续只把 registry 中的 tool definitions 转换为 OpenAI function tools，不直接执行 patch 逻辑。内置 system prompt SHALL NOT 规定模型优先使用 `apply_patch` 或限制 bash 的适用任务。

#### Scenario: OpenAI 请求包含 apply_patch tool schema
- **WHEN** 默认真实 agent 初始化 tool registry 并构造 OpenAI request
- **THEN** OpenAI request tools SHALL 包含 `apply_patch` function tool definition
- **THEN** OpenAI request tools SHALL 继续包含 `run_bash_command` function tool definition

#### Scenario: agent loop runtime 执行 apply_patch tool call
- **WHEN** 底层 provider agent 返回名为 `apply_patch` 的 tool call
- **THEN** agent loop runtime SHALL 通过 tool executor 查找并执行 `apply_patch` handler
- **THEN** runtime SHALL 将 handler 返回的 tool result 追加为 `tool_result` record
- **THEN** runtime SHALL 使用包含该 tool result 的 continuation records 继续请求模型

### Requirement: 默认真实 agent 暴露 glob 工具
真实 LLM adapter SHALL 在默认 tool registry 中暴露 `glob` 工具，使模型可以通过 agent loop runtime 按路径模式发现本地文件。OpenAI provider agent SHALL 继续只把 registry 中的 tool definitions 转换为 OpenAI function tools，不直接执行 glob 逻辑。内置 system prompt SHALL NOT 规定 glob、grep、read_files、apply_patch 或 bash 的选择优先级。

#### Scenario: OpenAI 请求包含 glob tool schema
- **WHEN** 默认真实 agent 初始化 tool registry 并构造 OpenAI request
- **THEN** OpenAI request tools SHALL 包含 `glob` function tool definition
- **THEN** OpenAI request tools SHALL 继续包含 `run_bash_command`、`apply_patch`、`grep` 和 `read_files` function tool definitions

#### Scenario: agent loop runtime 执行 glob tool call
- **WHEN** 底层 provider agent 返回名为 `glob` 的 tool call
- **THEN** agent loop runtime SHALL 通过 tool executor 查找并执行 `glob` handler
- **THEN** runtime SHALL 将 handler 返回的 tool result 追加为 `tool_result` record
- **THEN** runtime SHALL 使用包含该 tool result 的 continuation records 继续请求模型

### Requirement: 默认真实 agent 暴露 web_fetch 工具
真实 LLM adapter SHALL 在默认 tool registry 中暴露 `web_fetch` 工具，使模型可以通过 agent loop runtime 读取一个明确 HTTP(S) URL 的远程文本内容。OpenAI provider agent SHALL 继续只把 registry 中的 tool definitions 转换为 OpenAI function tools，不直接执行 web fetch 逻辑。内置 system prompt SHALL NOT 规定 web_fetch 或其他本地工具的选择优先级。

#### Scenario: OpenAI 请求包含 web_fetch tool schema
- **WHEN** 默认真实 agent 初始化 tool registry 并构造 OpenAI request
- **THEN** OpenAI request tools SHALL 包含 `web_fetch` function tool definition
- **THEN** OpenAI request tools SHALL 继续包含 `run_bash_command`、`apply_patch`、`glob`、`grep` 和 `read_files` function tool definitions

#### Scenario: agent loop runtime 执行 web_fetch tool call
- **WHEN** 底层 provider agent 返回名为 `web_fetch` 的 tool call
- **THEN** agent loop runtime SHALL 通过 tool executor 查找并执行 `web_fetch` handler
- **THEN** runtime SHALL 将 handler 返回的 tool result 追加为 `tool_result` record
- **THEN** runtime SHALL 使用包含该 tool result 的 continuation records 继续请求模型

### Requirement: 发请求前上下文压缩检查
agent loop runtime SHALL 在构造 provider 请求前执行上下文压缩检查。当预估上下文长度超过当前模型上下文窗口阈值且记录足以压缩时，runtime SHALL 先同步生成结构化摘要、更新并落盘压缩状态，再继续本轮 provider 请求；否则 SHALL 直接按现有流程发送请求。压缩 SHALL 在发请求前同步完成，不得改写完整 `records[]`。若调用方提供 turn-level 取消信号，压缩摘要请求 SHALL 使用同一个取消信号；取消后 SHALL NOT 落盘未完成或迟到的压缩结果。

#### Scenario: 超阈值时先压缩再发请求
- **WHEN** agent loop runtime 即将发起 provider 请求且预估上下文长度超过窗口阈值且记录足以压缩
- **THEN** runtime SHALL 先同步生成结构化摘要并更新压缩状态
- **THEN** runtime SHALL 在压缩状态落盘后再发起本轮 provider 请求
- **THEN** runtime SHALL NOT 删除或改写完整 `records[]`

#### Scenario: 未超阈值时直接发请求
- **WHEN** agent loop runtime 即将发起 provider 请求且预估上下文长度未超过窗口阈值
- **THEN** runtime SHALL NOT 触发压缩
- **THEN** runtime SHALL 按现有流程发起 provider 请求

#### Scenario: 压缩摘要请求携带取消信号
- **WHEN** agent loop runtime 触发自动上下文压缩
- **AND** 当前 assistant turn 具有取消信号
- **THEN** runtime SHALL 将该取消信号传递给摘要生成 provider 请求
- **THEN** 摘要请求 SHALL 能响应用户 Esc 中断

#### Scenario: 压缩取消不落盘摘要
- **WHEN** 自动上下文压缩摘要请求期间用户按 Esc 中断当前 assistant turn
- **THEN** runtime SHALL 取消或忽略该摘要请求结果
- **THEN** runtime SHALL NOT 写入新的压缩状态
- **THEN** runtime SHALL NOT 继续发起原计划的 provider 请求

### Requirement: Tool executor 接收 turn-level 取消信号
工具执行层 SHALL 支持调用方传入可选 turn-level 取消信号。tool executor SHALL 将该信号传给工具 handler；handler 支持取消时 SHALL 用该信号停止底层工作，handler 不支持取消时 SHALL 保持既有业务结果格式。

#### Scenario: bash tool 响应 turn-level 取消
- **WHEN** `run_bash_command` tool handler 正在执行本地命令
- **AND** turn-level 取消信号触发
- **THEN** handler SHALL 将取消信号传递给共享 bash runner
- **THEN** bash runner SHALL 按既有进程终止策略尽力停止该命令

#### Scenario: web 工具组合 timeout 和 turn abort
- **WHEN** `web_fetch`、`web_search` 或等价 web tool 正在等待网络结果
- **AND** 工具有自身 timeout 且调用方提供 turn-level 取消信号
- **THEN** handler SHALL 使用任一信号触发都能取消底层请求的组合取消语义
- **THEN** timeout 语义和用户 Esc 中断语义 SHALL 均保持有效

#### Scenario: 快速本地工具忽略可选信号
- **WHEN** 某个快速本地工具 handler 不需要异步取消能力
- **AND** tool executor 传入取消信号
- **THEN** handler MAY 忽略该信号并保持既有返回格式
- **THEN** runtime SHALL 在 handler 返回后继续检查取消信号

### Requirement: provider skill catalog 只包含 enabled skills
真实 LLM adapter 注入 provider system prompt 的 skill catalog SHALL 只包含当前 enabled skills。disabled skills SHALL 不出现在 provider catalog 中，也 SHALL 不被描述为模型可通过 `use_skill` 调用的候选项。

#### Scenario: disabled skill 不进入 catalog
- **WHEN** skill registry 发现某个有效 skill 但该 skill 被状态文件标记为 disabled
- **THEN** provider system prompt 的 skill catalog SHALL NOT 包含该 skill 的名称或描述
- **THEN** catalog SHALL 继续包含其他 enabled skills

#### Scenario: 状态变化后新请求使用最新 catalog
- **WHEN** 用户通过 `/skills` 保存 skill 启用状态变化
- **THEN** 后续新的 agent run SHALL 基于最新 enabled skills 生成 provider skill catalog
- **THEN** 系统 SHALL NOT 要求重启 TUI 才更新 provider catalog

### Requirement: slash 注入 skill 内容参与普通 provider input
通过 direct slash skill invocation 产生的 user record SHALL 按普通 user transcript record 参与 provider input 转换。该 user record SHALL 能在无压缩时进入完整上下文，在有压缩时按既有活跃区间与摘要规则处理。

#### Scenario: slash skill user record 进入 provider input
- **WHEN** 用户通过 direct slash skill invocation 追加了 user transcript record 并触发 agent
- **THEN** OpenAI transcript converter SHALL 将该 record 作为 user message 转换
- **THEN** provider input SHALL 包含该 record 中的 skill 内容和 arguments

#### Scenario: slash skill user record 按普通压缩规则处理
- **WHEN** 存在压缩状态且 slash skill user record 位于活跃区间内
- **THEN** provider input SHALL 包含该 user record
- **WHEN** 该 user record 位于压缩边界之前
- **THEN** provider input SHALL 不再包含其原文，并 SHALL 由压缩摘要承载必要信息

### Requirement: 真实 context usage 上报
agent loop runtime SHALL 在 provider 返回真实 input token usage 后，通过 app callback 上报最近一次 provider request 的 context usage。该 usage SHALL 来自 provider 的真实 usage 字段，并 SHALL 携带当前运行模型的 context window。缺失真实 usage 时系统 SHALL NOT 伪造 usage 上报。

#### Scenario: provider 返回 input usage 后上报
- **WHEN** provider turn 返回 `usageInputTokens`
- **THEN** agent loop runtime SHALL 调用 context usage callback
- **THEN** callback payload SHALL 包含 provider 返回的 used token 数
- **THEN** callback payload SHALL 包含当前 run state 的 context window

#### Scenario: provider 未返回 usage 时不伪造
- **WHEN** provider turn 没有返回 `usageInputTokens`
- **THEN** agent loop runtime SHALL NOT 调用 context usage callback
- **THEN** agent loop runtime SHALL NOT 用本地 token 估算替代真实 usage 上报

#### Scenario: continuation turn 更新最近 usage
- **WHEN** 同一 assistant response 触发多次 provider turn continuation
- **AND** 后续 provider turn 返回新的 `usageInputTokens`
- **THEN** agent loop runtime SHALL 为每次真实 usage 调用 context usage callback
- **THEN** app 层 SHALL 能以最后一次 callback 作为 status line 的最近 usage

#### Scenario: usage 上报不改变 compaction 语义
- **WHEN** agent loop runtime 上报 context usage
- **THEN** runtime SHALL 继续使用同一 `usageInputTokens` 更新 context compaction usage anchor
- **THEN** usage 上报 SHALL NOT 改变 compaction boundary、summary 或 provider continuation records

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

### Requirement: Plan mode provider prompt cache stability
agent loop runtime SHALL keep the built-in provider system prompt stable across normal and plan interaction modes when cwd、AGENTS.md、enabled skill catalog 和 MCP 状态不变。Plan mode 的具体只读约束 SHALL 作为 transient `user` record 注入 provider records，SHALL NOT 写入本地 transcript 或持久化 session。

#### Scenario: Plan mode does not alter built-in system prompt
- **WHEN** agent loop runtime 分别为 normal mode 和 plan mode 构造 provider records
- **AND** cwd、AGENTS.md、enabled skill catalog 和 compaction state 相同
- **THEN** 两次 provider records 中的第一条 `system` record 文本 SHALL 相同
- **AND** plan mode 的只读约束 SHALL NOT 出现在该 `system` record 文本中

#### Scenario: Plan mode injects transient user instruction
- **WHEN** agent loop runtime 为 plan mode 构造 provider records
- **THEN** runtime SHALL 在 provider records 末尾追加一条 transient `user` record
- **AND** 该 record SHALL 说明当前处于 plan mode、禁止修改文件或执行会改变状态的命令，并提示需要切换回 normal mode 才能实施计划
- **AND** normal mode provider records SHALL 是相同上下文下 plan mode provider records 的完整前缀

#### Scenario: Plan mode transient instruction is not persisted
- **WHEN** plan mode provider request 完成
- **THEN** 本地 transcript SHALL NOT 追加 plan mode transient instruction record
- **AND** transcript session persistence SHALL NOT 保存该 transient instruction

### Requirement: provider adapter 回传完整 token usage
真实 LLM adapter SHALL 在 provider stream 完成时尽量从 provider usage 字段中提取输入 token、缓存命中输入 token、缓存创建输入 token 和输出 token，并通过 provider-neutral usage 结构回传给 agent loop。缺少部分字段时 SHALL 保留可用字段，不得因 usage 字段缺失而阻断响应完成。

#### Scenario: OpenAI Responses adapter 提取 usage
- **WHEN** OpenAI Responses stream completed event 携带 usage
- **THEN** adapter SHALL 提取输入 token
- **AND** adapter SHALL 提取缓存命中输入 token
- **AND** adapter SHALL 提取输出 token
- **AND** adapter SHALL 将这些字段写入 provider-neutral usage

#### Scenario: OpenAI Chat adapter 提取 usage
- **WHEN** OpenAI Chat compatible stream chunk 携带 usage
- **THEN** adapter SHALL 提取输入 token
- **AND** adapter SHALL 提取缓存命中输入 token
- **AND** adapter SHALL 提取输出 token
- **AND** adapter SHALL 将这些字段写入 provider-neutral usage

#### Scenario: Anthropic adapter 提取 usage
- **WHEN** Anthropic compatible stream event 携带 usage
- **THEN** adapter SHALL 提取输入 token
- **AND** adapter SHALL 提取缓存创建输入 token
- **AND** adapter SHALL 提取缓存命中输入 token
- **AND** adapter SHALL 提取输出 token
- **AND** adapter SHALL 将这些字段写入 provider-neutral usage

#### Scenario: usage 字段缺失时不中断响应
- **WHEN** provider stream 正常完成但 usage 缺少部分或全部 token 字段
- **THEN** adapter SHALL 返回所有可用 usage 字段
- **AND** adapter SHALL NOT 因 usage 缺失抛出错误
- **AND** assistant response SHALL 继续按 provider stream 的完成结果处理

### Requirement: Codex OAuth provider 配置解析
系统 SHALL 支持通过用户级 `~/.echo/config.json` 配置 Codex OAuth provider。该 provider SHALL 使用独立 provider preset 解析为 Codex backend Responses 传输，SHALL NOT 要求用户配置 OpenAI Platform API key，且 SHALL NOT 将 Codex OAuth access token 或 refresh token 保存到 `~/.echo/config.json`。

#### Scenario: 解析 Codex OAuth provider
- **WHEN** 当前生效 provider profile 引用 Codex OAuth preset
- **THEN** 系统 SHALL 将其解析为 `agentType: "codex"` 的 Codex backend Responses 传输配置
- **THEN** 系统 SHALL 使用固定 Base URL `https://chatgpt.com/backend-api/codex`
- **THEN** 系统 SHALL NOT 要求 provider profile 包含 `apiKey`

#### Scenario: 缺少 Codex auth cache 时明确失败
- **WHEN** 当前生效 provider profile 引用 Codex OAuth preset
- **AND** 系统无法在配置路径、`CODEX_HOME` 或默认 `~/.codex/auth.json` 找到 file-based Codex auth cache
- **THEN** 系统 SHALL 明确提示需要已有 Codex file auth cache
- **THEN** 系统 SHALL NOT 发起 provider request
- **THEN** 错误提示 SHALL NOT 包含任何 token、header value 或 auth cache 文件内容

#### Scenario: Codex auth cache 格式无法识别时明确失败
- **WHEN** 当前生效 provider profile 引用 Codex OAuth preset
- **AND** Codex auth cache 存在但缺少可识别的 ChatGPT/Codex OAuth access token
- **THEN** 系统 SHALL 明确提示 Codex OAuth 凭据不可用或需要重新登录
- **THEN** 系统 SHALL NOT 发起 provider request
- **THEN** 错误提示 SHALL NOT 输出 auth cache 原文

### Requirement: Codex OAuth token 刷新
系统 SHALL 在 Codex OAuth access token 过期且 refresh token 可用时，通过 OpenAI OAuth token endpoint 刷新 access token。刷新结果 SHALL 只用于当前进程运行时，系统 SHALL NOT 回写 Codex CLI 的 `auth.json`、keyring 或其他外部 credential store。

#### Scenario: access token 未过期时直接使用
- **WHEN** Codex auth cache 中的 access token 存在且未过期
- **THEN** 系统 SHALL 使用该 access token 构造 Codex backend 请求
- **THEN** 系统 SHALL NOT 调用 OAuth refresh endpoint

#### Scenario: access token 过期时刷新
- **WHEN** Codex auth cache 中的 access token 已过期
- **AND** refresh token 存在
- **THEN** 系统 SHALL 向 `https://auth.openai.com/oauth/token` 发送 refresh token 请求
- **THEN** 请求 SHALL 使用 `grant_type=refresh_token`
- **THEN** 刷新成功后系统 SHALL 使用新的 access token 发起本次 provider request
- **THEN** 系统 SHALL NOT 将新的 access token 或 refresh token 写回 Codex auth cache

#### Scenario: refresh token 缺失或刷新失败
- **WHEN** Codex auth cache 中的 access token 已过期
- **AND** refresh token 缺失或 refresh endpoint 返回失败
- **THEN** 系统 SHALL 阻止本次 provider request
- **THEN** 系统 SHALL 提示用户通过 Codex CLI 重新登录或刷新本机 Codex auth cache
- **THEN** 错误提示 SHALL 对 access token、refresh token 和响应体中的敏感字段脱敏

### Requirement: Codex backend Responses 请求
Codex OAuth provider SHALL 使用独立 Codex adapter 调用 Codex backend Responses 端点发起流式模型请求。请求 SHALL 复用现有 OpenAI Responses transcript conversion、工具 schema 投影、streaming 回调、usage 上报和中断语义；认证 SHALL 使用 Codex OAuth access token 的 Bearer header。

#### Scenario: 构造 Codex Responses 请求
- **WHEN** 当前 provider preset 为 Codex OAuth 且用户提交普通消息
- **THEN** adapter SHALL 向 `https://chatgpt.com/backend-api/codex/responses` 发起流式 Responses 请求
- **THEN** 请求 SHALL 包含当前模型名、转换后的 transcript input、prompt cache key 和可用工具 definitions
- **THEN** 请求 SHALL 包含 `Authorization: Bearer <access token>` header
- **THEN** 请求日志、错误文本和 transcript SHALL NOT 包含 access token 明文

#### Scenario: 发送 ChatGPT account id header
- **WHEN** 系统能从 Codex OAuth token 或 auth cache 中解析 ChatGPT account id
- **THEN** Codex backend 请求 SHALL 包含 `ChatGPT-Account-ID` header
- **THEN** 系统 SHALL NOT 将 account id 当作敏感 token 脱敏为不可诊断内容

#### Scenario: 保持 Responses 工具循环
- **WHEN** Codex backend stream 返回 function tool call
- **THEN** 系统 SHALL 按现有 OpenAI Responses tool call 语义生成 provider-neutral tool call
- **THEN** 外层 agent loop SHALL 继续执行本地工具并发起后续 Codex backend continuation request

#### Scenario: Codex 请求被用户中断
- **WHEN** 用户在 Codex backend provider turn 进行中触发中断
- **THEN** adapter SHALL 将 abort signal 传递给 provider request
- **THEN** 系统 SHALL 按现有用户主动中断语义结束本次 assistant turn

### Requirement: Codex backend 模型枚举
系统 SHALL 支持 Codex OAuth provider 的模型枚举。模型枚举 SHALL 使用当前 Codex OAuth access token 访问 Codex backend models endpoint，并 SHALL 过滤出可供用户选择的模型 id。

#### Scenario: 枚举 Codex 订阅模型
- **WHEN** 用户在 `/config` 中对 Codex OAuth provider 激活模型枚举
- **AND** Codex OAuth credential 可用
- **THEN** 系统 SHALL 请求 `https://chatgpt.com/backend-api/codex/models?client_version=1.0.0`
- **THEN** 请求 SHALL 包含 Bearer access token
- **THEN** 系统 SHALL 返回可见模型 id 列表供配置面板选择

#### Scenario: 模型枚举失败时保护凭据
- **WHEN** Codex backend 模型枚举因鉴权、网络、usage limit 或响应格式失败
- **THEN** 系统 SHALL 返回脱敏后的错误
- **THEN** 错误 SHALL NOT 包含 access token、refresh token、Authorization header 或 auth cache 内容
- **THEN** 用户 SHALL 仍可手动添加模型 id

### Requirement: provider 使用配置选择文件编辑工具 schema
真实 LLM adapter SHALL 只转换当前默认 registry 中已注册的文件编辑工具 definition，不得在 adapter 内硬编码补充 `apply_patch` 或 `edit_file`。当归一化模式为 `edit_file` 时，OpenAI Responses、OpenAI Chat、Anthropic 和 Codex provider-visible tools SHALL 包含 `edit_file` schema 而不包含 `apply_patch` schema；默认或 `apply_patch` 模式 SHALL 保持既有 `apply_patch` 暴露行为。

#### Scenario: edit_file 模式构造 provider request
- **WHEN** `tools.fileEdit.mode` 为 `edit_file`，且真实 agent 准备 provider request
- **THEN** request tools SHALL 包含要求 `path`、`old_string` 和 `new_string` 的 `edit_file` function tool definition
- **THEN** request tools SHALL NOT 包含 `apply_patch` function tool definition
- **THEN** 其他已注册本地工具和 MCP tools SHALL 继续按既有 adapter 规则转换

#### Scenario: apply_patch 模式保持现有 schema
- **WHEN** 文件编辑模式缺失、非法或显式为 `apply_patch`
- **THEN** request tools SHALL 包含现有 `apply_patch` function tool definition
- **THEN** request tools SHALL NOT 包含 `edit_file` function tool definition

#### Scenario: runtime 执行 edit_file tool call
- **WHEN** provider 在 `edit_file` 模式下返回名为 `edit_file` 的 tool call
- **THEN** agent loop runtime SHALL 通过普通 tool executor 执行已注册 handler
- **THEN** runtime SHALL 将真实 result 追加为匹配 call id 与工具名的 `tool_result` record
- **THEN** provider continuation SHALL 接收原始 result text，而不是 TUI diff 投影

#### Scenario: 配置切换不改变历史 continuation 事实
- **WHEN** transcript 已包含历史 `apply_patch` 或 `edit_file` call/result records，且后续 assistant run 使用另一文件编辑模式
- **THEN** provider adapter SHALL 继续按其既有 transcript 转换规则保留历史匹配 call/result
- **THEN** 当前 request 的可调用工具 definition SHALL 只包含当前模式选中的文件编辑工具

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

