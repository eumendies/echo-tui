## MODIFIED Requirements

### Requirement: 真实 LLM 服务配置
系统 SHALL 通过用户级 JSON 配置文件创建真实 LLM adapter。配置 SHALL 从 `~/.echo/config.json` 读取，并包含创建 provider client 和发起文本响应所需的运行参数；敏感字段 SHALL 只驻留在运行时内存中，不得硬编码在源码、测试 fixture、文档示例或 OpenSpec artifacts 中。系统 SHALL NOT 要求用户配置客户端输出 token 上限；默认请求 SHALL NOT 发送 `max_output_tokens`。系统 SHALL 支持包含多个 provider profile、多个模型 profile 与持久化当前模型选择的配置。模型 profile SHALL 通过 `provider` 引用 provider profile，并支持可选的 `contextWindow` 配置项，用于上下文压缩的窗口解析；缺省时由内置映射表或默认值回退。provider profile SHALL 支持 `openai`、`openai-chat` 和 `fake` agent type；其中 `openai` 表示 OpenAI Responses API，`openai-chat` 表示 OpenAI Chat Completions API。模型 profile SHALL 支持 Responses-backed 模型使用可选的 `reasoning.effort` 配置项，用于控制 reasoning 模型的推理等级。provider profile SHALL 支持可选的字符串 `headers` 配置，并将其作为 provider client 的默认请求 headers。系统 SHALL NOT 读取旧的顶层或 model profile 级 `agentType`、`apiKey`、`baseURL`、`headers` provider 字段。

#### Scenario: 从用户级配置文件创建配置
- **WHEN** CLI 启动默认真实 adapter
- **THEN** 系统 SHALL 从 `~/.echo/config.json` 读取 LLM 运行配置
- **THEN** 系统 SHALL 使用读取到的配置创建 provider client 和模型请求参数

#### Scenario: 从多 provider 多模型配置创建当前生效配置
- **WHEN** `~/.echo/config.json` 中的 `llm.providers` 包含多个有效 provider profile，`llm.models` 包含多个有效模型 profile，且 `llm.selectedModel` 指向其中一个 profile id
- **THEN** 系统 SHALL 使用被选中的模型 profile 解析当前生效模型名
- **THEN** 系统 SHALL 使用该模型 profile 的 `provider` 字段查找 provider profile
- **THEN** 系统 SHALL 使用 provider profile 的 `agentType`、`apiKey` 和 `baseURL` 创建当前生效 provider 配置

#### Scenario: provider headers 随请求发送
- **WHEN** 当前生效模型 profile 引用的 provider profile 配置了字符串 `headers`
- **THEN** 系统 SHALL 在创建 OpenAI SDK client 时将这些 headers 设置为默认请求 headers
- **THEN** 系统 SHALL NOT 把 headers 值输出到错误消息或文档示例中的真实配置

#### Scenario: 读取 Responses 模型 profile 的 reasoning effort 配置
- **WHEN** 当前生效模型 profile 引用的 provider profile 使用 `agentType: "openai"`，且模型 profile 配置了有效的 `reasoning.effort`
- **THEN** 系统 SHALL 在解析生效配置时携带该推理等级
- **THEN** 后续 OpenAI Responses 请求 SHALL 发送 `reasoning.effort`

#### Scenario: 未配置 reasoning effort 时不发送 reasoning
- **WHEN** 当前生效模型 profile 没有配置 `reasoning.effort`
- **THEN** 系统 SHALL NOT 在 OpenAI Responses 请求中发送 `reasoning`
- **THEN** 系统 SHALL 让模型服务端决定默认推理行为

#### Scenario: 无效 reasoning effort 明确失败
- **WHEN** 当前生效模型 profile 的 `reasoning.effort` 不是 `none`、`minimal`、`low`、`medium`、`high` 或 `xhigh`
- **THEN** 系统 SHALL 明确提示 reasoning effort 配置无效
- **THEN** 系统 SHALL NOT 发起真实模型请求

#### Scenario: Chat Completions provider 不接受 reasoning 配置
- **WHEN** 当前生效模型 profile 引用的 provider profile 使用 `agentType: "openai-chat"`，且模型 profile 配置了 `reasoning.effort` 或 `reasoning.summary`
- **THEN** 系统 SHALL 明确提示 Chat Completions adapter 不支持该 reasoning 配置
- **THEN** 系统 SHALL NOT 发起真实模型请求

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

#### Scenario: provider 引用不存在时明确失败
- **WHEN** `llm.providers` 存在，且当前生效模型 profile 的 `provider` 指向不存在的 provider id
- **THEN** 系统 SHALL 明确提示模型 profile 引用了不存在的 provider
- **THEN** 系统 SHALL NOT 发起真实模型请求
- **THEN** 错误提示 SHALL NOT 包含敏感字段值

#### Scenario: provider-backed 模型缺少 provider 字段时明确失败
- **WHEN** `llm.providers` 存在，且 `llm.models` 中的模型 profile 缺少 `provider` 字段
- **THEN** 系统 SHALL 明确提示模型 profile 缺少 `provider`
- **THEN** 系统 SHALL NOT 将该 profile 隐式绑定到顶层 provider 配置

#### Scenario: fake provider 不要求真实 apiKey
- **WHEN** 当前生效模型 profile 引用的 provider profile 的 `agentType` 为 `fake`
- **THEN** 系统 SHALL NOT 要求该 provider profile 配置真实 `apiKey`
- **THEN** 系统 SHALL 使用 fake agent 所需的安全占位凭据初始化运行时配置

#### Scenario: Chat Completions provider 读取配置
- **WHEN** 当前生效模型 profile 引用的 provider profile 的 `agentType` 为 `openai-chat`
- **THEN** 系统 SHALL 接受该 agent type 并解析 `apiKey`、可选 `baseURL`、可选 `headers` 和模型名
- **THEN** 后续 provider 装配 SHALL 创建 Chat Completions adapter，而不是 Responses adapter

#### Scenario: 缺少 providers 时明确失败
- **WHEN** `~/.echo/config.json` 中不存在 `llm.providers`
- **THEN** 系统 SHALL 明确提示缺少 `providers`
- **THEN** 系统 SHALL NOT 读取 `llm` 顶层或 model profile 级 provider 字段作为隐式 fallback

#### Scenario: 默认不发送客户端输出长度限制
- **WHEN** 用户级配置文件未提供服务端专有输出长度参数
- **THEN** 系统 SHALL NOT 在 OpenAI request 中发送 `max_output_tokens`
- **THEN** 系统 SHALL 让模型服务端决定本次响应的输出长度上限

#### Scenario: 选择持久化后后续请求使用新模型
- **WHEN** `/model` 命令已将某个 profile id 写入 `llm.selectedModel`
- **THEN** 后续普通用户消息触发真实 adapter 时 SHALL 重新读取 `~/.echo/config.json`
- **THEN** 后续 OpenAI 请求参数 SHALL 使用新选择的模型 profile 解析出的模型名和 provider 配置

#### Scenario: 读取模型 profile 的上下文窗口配置
- **WHEN** 当前生效模型 profile 配置了有效的 `contextWindow`
- **THEN** 系统 SHALL 在解析生效配置时携带该上下文窗口值
- **THEN** 该值 SHALL 可供上下文压缩的窗口解析使用

## ADDED Requirements

### Requirement: OpenAI Chat Completions transcript 转换
系统 SHALL 在 `openai-chat` provider 边界内把本地 `TranscriptRecord[]` 转换为 OpenAI Chat Completions API 的 `messages`。转换器 SHALL 保留 user、assistant、system 的多轮语义，SHALL 将本地 tool call/tool result 记录投影为 Chat Completions 所需的 assistant `tool_calls` 与后续 `tool` messages，并 SHALL 过滤本地错误、local notice、reasoning summary 和 Responses-only private reasoning records。

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

### Requirement: OpenAI Chat Completions 流式请求
`openai-chat` adapter SHALL 使用 OpenAI SDK 的 Chat Completions API 发起流式请求。请求 SHALL 包含当前模型名、转换后的 Chat messages、`stream: true`，并在工具 registry 非空时包含 Chat Completions function tools。请求 SHALL NOT 发送 Responses-only `input`、`reasoning`、private reasoning item 或客户端输出 token 上限。

#### Scenario: 构造 Chat Completions stream 请求
- **WHEN** 当前 provider agent type 为 `openai-chat` 且用户提交普通消息
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

#### Scenario: 未启用工具时不发送 Chat tools
- **WHEN** `openai-chat` adapter 构造请求且本地 tool registry 为空
- **THEN** 请求参数 SHALL NOT 包含 `tools`
- **THEN** 请求参数 SHALL 保持纯文本 Chat Completions 行为

#### Scenario: Chat 请求不发送 Responses-only 字段
- **WHEN** `openai-chat` adapter 构造请求
- **THEN** 请求参数 SHALL NOT 包含 Responses API 的 `input` 字段
- **THEN** 请求参数 SHALL NOT 包含 `reasoning`、private reasoning item 或 `max_output_tokens`

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
