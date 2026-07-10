## MODIFIED Requirements

### Requirement: 真实 LLM 服务配置
系统 SHALL 通过用户级 JSON 配置文件创建真实 LLM adapter。配置 SHALL 从 `~/.echo/config.json` 读取，并包含创建 provider client 和发起文本响应所需的运行参数；敏感字段 SHALL 只驻留在运行时内存中，不得硬编码在源码、测试 fixture、文档示例或 OpenSpec artifacts 中。系统 SHALL NOT 要求用户为 OpenAI provider 配置客户端输出 token 上限；默认 OpenAI 请求 SHALL NOT 发送 `max_output_tokens`。系统 SHALL 支持包含多个 provider profile、多个模型 profile 与持久化当前模型选择的配置。模型 profile SHALL 通过 `provider` 引用 provider profile，并支持可选的 `contextWindow` 配置项，用于上下文压缩的窗口解析；缺省时由内置映射表或默认值回退。provider profile SHALL 支持 `openai`、`openai-chat`、`anthropic` 和 `fake` agent type；其中 `openai` 表示 OpenAI Responses API，`openai-chat` 表示 OpenAI Chat Completions API，`anthropic` 表示 Anthropic Messages API 或 Anthropic-compatible 接口。模型 profile SHALL 支持 Responses-backed 模型使用可选的 `reasoning.effort` 和 `reasoning.summary` 配置项，用于控制 reasoning 模型的推理等级和摘要；非 Responses provider SHALL 静默忽略这些 reasoning 配置。provider profile SHALL 支持可选的字符串 `headers` 配置，并将其作为 provider client 的默认请求 headers。系统 SHALL NOT 读取旧的顶层或 model profile 级 `agentType`、`apiKey`、`baseURL`、`headers` provider 字段。

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
- **THEN** 系统 SHALL 在创建 provider SDK client 时将这些 headers 设置为默认请求 headers
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

#### Scenario: 非 Responses provider 忽略 reasoning 配置
- **WHEN** 当前生效模型 profile 引用的 provider profile 使用 `agentType: "openai-chat"` 或 `agentType: "anthropic"`，且模型 profile 配置了 `reasoning.effort` 或 `reasoning.summary`
- **THEN** 系统 SHALL 在解析生效配置时忽略这些 reasoning 字段
- **THEN** 后续 provider 请求 SHALL NOT 发送 `reasoning.effort` 或 `reasoning.summary`

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

#### Scenario: Anthropic provider 读取配置
- **WHEN** 当前生效模型 profile 引用的 provider profile 的 `agentType` 为 `anthropic`
- **THEN** 系统 SHALL 接受该 agent type 并解析 `apiKey`、可选 `baseURL`、可选 `headers` 和模型名
- **THEN** 后续 provider 装配 SHALL 创建 Anthropic adapter，而不是 OpenAI Responses 或 Chat Completions adapter

#### Scenario: 缺少 providers 时明确失败
- **WHEN** `~/.echo/config.json` 中不存在 `llm.providers`
- **THEN** 系统 SHALL 明确提示缺少 `providers`
- **THEN** 系统 SHALL NOT 读取 `llm` 顶层或 model profile 级 provider 字段作为隐式 fallback

#### Scenario: 默认不发送 OpenAI 客户端输出长度限制
- **WHEN** 用户级配置文件未提供服务端专有输出长度参数
- **THEN** 系统 SHALL NOT 在 OpenAI request 中发送 `max_output_tokens`
- **THEN** 系统 SHALL 让 OpenAI 模型服务端决定本次响应的输出长度上限

#### Scenario: Anthropic provider 使用协议必需输出上限
- **WHEN** 当前 provider agent type 为 `anthropic`
- **THEN** Anthropic adapter SHALL 在请求中发送协议要求的 `max_tokens`
- **THEN** 该默认值 SHALL 由 adapter 内部提供，用户不需要在 provider 或 model profile 中配置

#### Scenario: 选择持久化后后续请求使用新模型
- **WHEN** `/model` 命令已将某个 profile id 写入 `llm.selectedModel`
- **THEN** 后续普通用户消息触发真实 adapter 时 SHALL 重新读取 `~/.echo/config.json`
- **THEN** 后续 provider 请求参数 SHALL 使用新选择的模型 profile 解析出的模型名和 provider 配置

#### Scenario: 读取模型 profile 的上下文窗口配置
- **WHEN** 当前生效模型 profile 配置了有效的 `contextWindow`
- **THEN** 系统 SHALL 在解析生效配置时携带该上下文窗口值
- **THEN** 该值 SHALL 可供上下文压缩的窗口解析使用

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
- **THEN** fake agent SHALL 支持 thinking、逐字 streaming 和 completion 回调，且测试通过 `createApp(options).runAgent` 注入 fake 或 stub agent 时，CLI 默认真实 adapter 行为 SHALL 不受影响
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
