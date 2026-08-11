## MODIFIED Requirements

### Requirement: 真实 LLM 服务配置
系统 SHALL 通过用户级 JSON 配置创建真实 LLM adapter。配置 SHALL 来自实例级用户配置上下文对 `~/.echo/config.json` 最新 revision 的不可变 snapshot，并包含创建 provider client 和发起文本响应所需的运行参数；同一 agent run 的 provider、模型、reasoning、tools 和上下文参数 SHALL 来自同一 revision，且该 run 的 tool continuation 期间 SHALL NOT 重新读取或切换用户配置。敏感字段 SHALL 只驻留在运行时内存中，不得硬编码在源码、测试 fixture、文档示例或 OpenSpec artifacts 中。系统 SHALL NOT 要求用户为 OpenAI provider 配置客户端输出 token 上限；默认 OpenAI 请求 SHALL NOT 发送 `max_output_tokens`。系统 SHALL 支持包含多个 provider profile、多个模型 profile 与持久化当前模型选择的配置。模型 profile SHALL 通过 `provider` 引用 provider profile，并支持可选的 `contextWindow` 配置项，用于上下文压缩的窗口解析；缺省或无效时由内置映射表或默认值回退。provider profile SHALL 使用 `preset` 引用 provider preset catalog，由 catalog 解析出运行时 `agentType`、可选固定 `baseURL` 和可选默认 headers；provider profile 也 MAY 包含手写字符串 `headers`，系统 SHALL 将其与 preset headers 合并为 provider client 默认请求 headers；用户级 real provider presets SHALL 至少包含 `openai-responses-api`、`openai-chat-compatible-api`、`anthropic-compatible-api` 和 `xiaomi-mimo-token-plan`。运行时解析遇到引用 catalog 中未知 preset 的 provider profile 时 SHALL 忽略该 provider 及所有引用它的模型 profile，并 SHALL 继续使用其余有效 provider/model。系统 SHALL 将非字符串 `selectedModel` 视为未配置；当 preset 明确使用固定或隐藏 Base URL 时 SHALL 忽略用户 `baseURL`，当 preset 不要求 API key 时 SHALL 将非字符串可选 `apiKey` 视为未配置并使用 preset 默认值或空值。上述容错 SHALL NOT 扩展到缺失或类型错误的 preset、已知 preset 的必要凭据或其他实际生效字段，或模型引用完全不存在的 provider。模型 profile SHALL 支持 OpenAI Responses、OpenAI Chat compatible 和 Anthropic-backed 模型使用可选的 `reasoning.effort` 配置项，用于控制推理等级；`reasoning.summary` SHALL 仅对 Responses-backed 模型生效，其他 provider SHALL 静默忽略该 summary 配置。系统 SHALL NOT 读取旧的顶层或 model profile 级 `agentType`、`apiKey`、`baseURL`、`headers` provider 字段作为 fallback。

#### Scenario: 从用户级配置 snapshot 创建配置
- **WHEN** CLI 启动默认真实 adapter 并开始一次 agent run
- **THEN** 系统 SHALL 捕获用户配置上下文的最新 revision
- **THEN** 系统 SHALL 使用该 snapshot 中的 LLM 配置创建 provider client 和模型请求参数
- **THEN** 系统 SHALL NOT 为同一 run 的 App settings、LLM 或 tools 分别重复读取 `~/.echo/config.json`

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

#### Scenario: preset 不使用用户 Base URL 时忽略无效配置
- **WHEN** provider preset 的 `baseURLMode` 为 `fixed` 或 `hidden`，且 provider profile 包含非字符串 `baseURL`
- **THEN** 系统 SHALL 忽略该用户 `baseURL`，且 SHALL NOT 因其类型错误让模型目录 unavailable
- **THEN** `fixed` preset SHALL 继续使用其内置 Base URL，`hidden` preset SHALL 不使用用户 Base URL

#### Scenario: 无需 API key 的 preset 忽略无效可选值
- **WHEN** provider preset 不要求 API key，且 provider profile 包含非字符串 `apiKey`
- **THEN** 系统 SHALL 将该 `apiKey` 视为未配置
- **THEN** 系统 SHALL 使用 preset 的默认 API key 或空值继续解析
- **THEN** 要求 API key 的 preset SHALL 继续严格校验非空字符串凭据

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

#### Scenario: selectedModel 类型错误时使用安全默认
- **WHEN** 过滤后的模型目录非空，但 `llm.selectedModel` 不是字符串
- **THEN** 系统 SHALL 将 `selectedModel` 视为未配置并使用第一个有效 profile
- **THEN** 系统 SHALL NOT 因该可选字段类型错误阻止默认真实 adapter 启动
- **THEN** 系统 SHALL NOT 把回退选择写回用户配置文件

#### Scenario: 缺少必要配置时明确失败
- **WHEN** CLI 默认真实 adapter 缺少创建 client 或发起响应所需的必要配置
- **THEN** 系统 SHALL 明确提示缺少必要配置
- **THEN** 系统 SHALL NOT 发起真实模型请求
- **THEN** 错误提示 SHALL NOT 包含敏感字段值

#### Scenario: 混合配置中的未知 provider preset 被局部忽略
- **WHEN** `llm.providers` 同时包含至少一个有效 provider profile 和一个 `preset` 指向 catalog 中未知 id 的 provider profile，且两者均有模型引用
- **THEN** 系统 SHALL 忽略未知 preset 对应的 provider profile 及引用它的模型 profile
- **THEN** 系统 SHALL 在运行时模型目录中保留并正常解析其余有效模型
- **THEN** 系统 SHALL NOT 因未知 preset 将整个模型目录标记为 unavailable

#### Scenario: selectedModel 指向未知 preset 关联模型时回退
- **WHEN** `llm.selectedModel` 指向一个因 provider preset 未知而被忽略的模型 profile，且过滤后仍有有效模型
- **THEN** 系统 SHALL 使用过滤后第一个有效模型 profile 作为当前生效模型
- **THEN** 系统 SHALL NOT 把该回退写回用户配置文件

#### Scenario: 未知 provider preset 过滤后没有有效模型
- **WHEN** 所有已配置模型都引用因 preset 未知而被忽略的 provider profile
- **THEN** 系统 SHALL 明确提示没有可解析的有效模型或对应 provider preset 未知
- **THEN** 系统 SHALL NOT 构造 provider client 或发起真实模型请求
- **THEN** 错误提示 SHALL NOT 包含敏感字段值

#### Scenario: 未知 provider preset 草稿保持可修复
- **WHEN** `/config` 读取包含未知 preset 的 provider profile
- **THEN** 系统 SHALL 在编辑草稿中保留并展示该 provider 及其模型
- **THEN** 系统 SHALL 要求用户在保存 LLM 配置前切换到已知 preset 或删除该 provider
- **THEN** 系统 SHALL NOT 因运行时过滤而自动删除或改写未知配置

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
- **WHEN** `/config` 已将某个 profile id 写入 `llm.selectedModel`，或当前 session 已通过 `/model` 选择有效 profile
- **THEN** 用户配置写入成功 SHALL 立即安装新 revision，session 选择 SHALL 继续由 ModelContext 管理
- **THEN** 后续普通用户消息 SHALL 捕获用户配置上下文的最新 revision，并结合当前 session profile 解析模型名和 provider 配置

#### Scenario: active run 不切换配置 revision
- **WHEN** agent run 已开始，且 watcher 在 provider streaming 或 tool continuation 期间安装新的用户配置 revision
- **THEN** 当前 run SHALL 继续使用开始时捕获的模型、provider、reasoning 和工具配置
- **THEN** 新 revision SHALL 只影响后续 agent run

#### Scenario: 读取模型 profile 的上下文窗口配置
- **WHEN** 当前生效模型 profile 配置了有效的 `contextWindow`
- **THEN** 系统 SHALL 在解析生效配置时携带该上下文窗口值
- **THEN** 该值 SHALL 可供上下文压缩的窗口解析使用

#### Scenario: 无效上下文窗口配置回退默认解析
- **WHEN** 可运行模型 profile 的可选 `contextWindow` 不是正整数
- **THEN** 系统 SHALL 将该字段视为未配置，并 SHALL NOT 因该字段让模型 profile 或整个目录失效
- **THEN** 系统 SHALL 按内置模型映射或默认窗口解析上下文窗口
