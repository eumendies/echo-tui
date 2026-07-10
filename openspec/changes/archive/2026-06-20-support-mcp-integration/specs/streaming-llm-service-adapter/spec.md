## MODIFIED Requirements

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

### Requirement: Anthropic Messages 流式请求
`anthropic` adapter SHALL 使用 Anthropic SDK 的 Messages API 发起流式请求。请求 SHALL 包含当前模型名、转换后的 messages、可选 system prompt、协议必需的 `max_tokens`，并在工具 registry 非空时包含 Anthropic tools。已成功初始化的 MCP tools SHALL 作为已注册 tools 的一部分随 normal mode provider request 暴露。请求 SHALL NOT 发送 OpenAI-only 字段、Responses private reasoning item 或 Chat Completions messages 结构。

#### Scenario: 构造 Anthropic stream 请求
- **WHEN** 当前 provider preset 解析出的 agent type 为 `anthropic` 且用户提交普通消息
- **THEN** adapter SHALL 调用 Anthropic SDK Messages stream API
- **THEN** 请求 SHALL 包含配置中的模型名、转换后的 messages 和协议必需的 `max_tokens`

#### Scenario: Anthropic 请求携带取消信号
- **WHEN** `anthropic` provider agent 执行 provider turn 且调用方提供取消信号
- **THEN** provider SHALL 将该取消信号传递给 Anthropic SDK 请求
- **THEN** SDK 请求 SHALL 能响应该取消信号

#### Scenario: 启用工具时发送 Anthropic tools
- **WHEN** `anthropic` adapter 构造请求且本地 tool registry 包含已启用工具
- **THEN** 请求参数 SHALL 包含这些工具对应的 Anthropic tool schema
- **THEN** 请求参数 SHALL NOT 包含本次未注册或未启用的工具定义

#### Scenario: normal mode 发送已初始化 MCP Anthropic tools
- **WHEN** 当前 interaction mode 为 normal，且 MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** Anthropic 请求 SHALL 包含这些 MCP tools 转换后的 tool schema
- **THEN** Anthropic 请求 SHALL NOT 包含初始化失败的 MCP server tools
