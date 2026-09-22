## MODIFIED Requirements

### Requirement: OpenAI Chat compatible reasoning effort 请求
系统 SHALL 在 `openai-chat` provider 边界内支持 model profile 的 `reasoning.effort`。当配置了 `reasoning.effort`（含显式 `none`）时，adapter SHALL 在 Chat Completions compatible request 中以 `reasoning_effort` 字段直传 Echo TUI 的 effort 值；显式 `none` 必须发送，SHALL NOT 以省略参数表达禁用。未配置 `reasoning.effort` 时，请求 SHALL NOT 包含 `reasoning_effort`，由兼容服务端决定默认推理行为。请求 SHALL NOT 使用 OpenAI Responses-only 的 `reasoning` 对象。

#### Scenario: Chat profile 保留 reasoning effort
- **WHEN** 当前生效模型 profile 引用的 provider preset 解析为 `agentType: "openai-chat"`，且模型 profile 配置了合法的 `reasoning.effort`
- **THEN** 系统 SHALL 在解析生效配置时携带该 `reasoningEffort`
- **THEN** `/effort` 和状态栏 SHALL 能基于该值展示当前 effort

#### Scenario: Chat request 直传 reasoning effort
- **WHEN** `openai-chat` adapter 构造请求，且当前配置包含非 `none` 的 `reasoningEffort`
- **THEN** 请求参数 SHALL 包含顶层 `reasoning_effort`
- **THEN** `reasoning_effort` 的值 SHALL 与 Echo TUI 配置的 effort 值一致，不做本地映射

#### Scenario: none effort 显式发送禁用值
- **WHEN** `openai-chat` adapter 构造请求，且当前配置值为 `none`
- **THEN** 请求参数 SHALL 包含 `reasoning_effort: none`
- **THEN** 系统 SHALL NOT 通过省略 `reasoning_effort` 表达禁用

#### Scenario: 未配置 reasoning effort 时不发送
- **WHEN** `openai-chat` adapter 构造请求，且当前配置未设置 `reasoning.effort`
- **THEN** 请求参数 SHALL NOT 包含 `reasoning_effort`
- **THEN** 系统 SHALL 让兼容服务端决定默认推理行为

#### Scenario: Chat request 不发送 Responses-only reasoning 字段
- **WHEN** `openai-chat` adapter 构造包含 reasoning effort 的 request
- **THEN** 请求参数 SHALL NOT 包含 OpenAI Responses API 的 `reasoning` 字段
- **THEN** 请求参数 SHALL NOT 包含 OpenAI private reasoning item
