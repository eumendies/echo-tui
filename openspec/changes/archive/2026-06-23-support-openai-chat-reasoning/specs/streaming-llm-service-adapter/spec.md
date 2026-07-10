## ADDED Requirements

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

### Requirement: OpenAI Chat compatible reasoning stream 展示
系统 SHALL 处理 OpenAI Chat Completions compatible stream 返回的 reasoning 内容。adapter SHALL 聚合 `choices[].delta.reasoning_content` 为 `AgentTurnResult.reasoningSummary`，并 SHALL 继续将 `choices[].delta.content` 作为 assistant 正文、`choices[].delta.tool_calls` 作为工具调用分片处理。

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

#### Scenario: 不生成 Chat reasoning provider-only record
- **WHEN** Chat compatible stream 返回 `reasoning_content`
- **THEN** adapter SHALL NOT 生成 provider-only transcript record
- **THEN** 后续 Chat messages SHALL NOT 回放该 reasoning 文本

## MODIFIED Requirements

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
- **WHEN** 当前生效模型 profile 的 `reasoning.effort` 不是 `none`、`minimal`、`low`、`medium`、`high` 或 `xhigh`
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
