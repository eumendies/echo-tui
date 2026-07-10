## MODIFIED Requirements

### Requirement: 真实 LLM 服务配置
系统 SHALL 通过用户级 JSON 配置文件创建真实 LLM adapter。配置 SHALL 从 `~/.echo/config.json` 读取，并包含创建 provider client 和发起文本响应所需的运行参数；敏感字段 SHALL 只驻留在运行时内存中，不得硬编码在源码、测试 fixture、文档示例或 OpenSpec artifacts 中。系统 SHALL NOT 要求用户配置客户端输出 token 上限；默认请求 SHALL NOT 发送 `max_output_tokens`。系统 SHALL 支持包含多个 provider profile、多个模型 profile 与持久化当前模型选择的配置。模型 profile SHALL 通过 `provider` 引用 provider profile，并支持可选的 `contextWindow` 配置项，用于上下文压缩的窗口解析；缺省时由内置映射表或默认值回退。provider profile SHALL 支持可选的字符串 `headers` 配置，并将其作为 provider client 的默认请求 headers。系统 SHALL NOT 读取旧的顶层或 model profile 级 `agentType`、`apiKey`、`baseURL`、`headers` provider 字段。

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
