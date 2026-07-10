## Context

现有运行路径已经把 app 编排、tool loop 和 provider 协议边界拆开：`agent-loop-runtime` 只依赖 `ProviderAgent`，OpenAI Responses、OpenAI Chat Completions 和 fake provider 分别在 `src/agent/*` 下实现自己的 transcript 转换、tool schema 转换和 stream 事件归一化。Anthropic Messages API 与 OpenAI Chat Completions 在形态上接近，但 system prompt、tool_use/tool_result content blocks、stream 事件和 usage 字段不同，不能直接复用 OpenAI Chat converter。

用户明确希望支持 Anthropic-compatible 接口并使用官方 SDK，因此本设计选择新增 Anthropic provider adapter，而不是把 Anthropic-compatible 网关伪装成 OpenAI Chat provider。

## Goals / Non-Goals

**Goals:**

- 新增 `agentType: "anthropic"`，通过现有 provider/model profile 配置选择 Anthropic provider。
- 使用官方 `@anthropic-ai/sdk` 创建 client，支持官方 Anthropic API 和兼容 Anthropic Messages API 的网关。
- 保持 app、render、tool executor、transcript persistence 和 agent loop runtime 的 provider-neutral contract 不变。
- 支持纯文本流式输出、工具调用、工具结果 continuation、usage input token 捕获、取消信号和错误脱敏。
- 将 Anthropic adapter 模块纳入现有 TypeScript 编译、测试和文档流程。

**Non-Goals:**

- 不实现 Anthropic extended thinking、prompt caching、computer use、server tools、web search、文件/图片多模态 content block。
- 不新增 `/model` 或 `/effort` 的 UI 能力；`/effort` 仍只对 OpenAI Responses reasoning profile 有意义。
- 不引入新的 provider-neutral message 中间模型；继续以 `TranscriptRecord[]` 作为 agent loop continuation 主干。
- 不支持旧的顶层 `llm.agentType/apiKey/baseURL` 配置 fallback。

## Decisions

### 1. 新增独立 `src/agent/anthropic/*` adapter

采用与 `openai-chat` 平行的模块结构：

```text
src/agent/anthropic/
├── agent.ts
├── transcript-converter.ts
└── tool-converter.ts
```

理由：Anthropic 的请求、stream 和工具历史格式与 OpenAI Chat 类似但不相同。独立 adapter 能把协议差异限制在 provider 边界内，避免污染 agent loop runtime。

替代方案：在 `openai-chat` adapter 中增加协议分支。该方案短期少建文件，但会把 Chat Completions 的 `messages/tool_calls` 与 Anthropic 的 `content` blocks 混在一起，后续维护和测试成本更高。

### 2. 使用官方 Anthropic SDK，而不是手写 HTTP/SSE

新增运行时依赖 `@anthropic-ai/sdk`。`AnthropicAgent` 通过 SDK client 发起 streaming Messages API 请求，并通过 SDK 支持的 `baseURL`、`defaultHeaders` 或等价 client options 支持兼容网关。

理由：用户明确指定使用官方 SDK；SDK 能减少 SSE 解析、错误类型和流式事件 shape 的手写维护成本。

替代方案：使用 Node `fetch` 手写 `/v1/messages` 和 SSE parser。该方案对兼容网关控制更强，但重复实现 SDK 已有能力，也增加协议细节风险。

### 3. Anthropic provider 不消费现有 OpenAI reasoning 配置

配置读取应把 `reasoning.effort` 和 `reasoning.summary` 限定为 `agentType: "openai"` 的模型 profile 能力。`openai-chat` 和 `anthropic` provider 如配置这些字段，应静默忽略并不把字段带入 resolved `LlmConfig`，保持 OpenAI Chat 的既有兼容行为，同时避免向 Anthropic 发送无效请求。

理由：现有 reasoning 字段语义绑定 OpenAI Responses。Anthropic extended thinking 的配置模型、返回内容和权限要求不同，不能复用当前字段。

替代方案：明确拒绝 Anthropic reasoning 配置。该方案能暴露配置误解，但会让 `/effort` 或共享模型 profile 更容易把非 Responses provider 配置变成不可启动状态。

### 4. Anthropic 请求构造采用 provider 边界转换

Anthropic transcript converter 负责：

- 把第一类 `system` records 合并或串接为顶层 `system` 文本。
- 把 `user` 和 `assistant` records 转换为 Messages API `messages`。
- 把本地 `tool_call` 转换为 assistant content block `tool_use`。
- 把本地 `tool_result` 转换为 user content block `tool_result`。
- 过滤 `error`、`local_notice`、`reasoning_summary`、`openai_reasoning` 等本地或 OpenAI-private records。
- 对缺少必要 metadata 或参数不是 JSON object 的历史工具记录采取安全跳过或回注用户反馈，保持 continuation 可恢复。

理由：Anthropic tool history 必须使用 content blocks，不能用 OpenAI Chat 的独立 `tool` role 表达。

### 5. 输出 token 上限使用 adapter 内置默认值

Anthropic Messages API 通常要求 `max_tokens`。本变更不新增用户配置项，Anthropic adapter 使用一个小而明确的默认值，例如 `4096`，只作为 Anthropic 请求必填参数。OpenAI providers 继续保持“不发送客户端输出 token 上限”的既有行为。

理由：项目已有规格强调用户无需配置 OpenAI 输出 token 上限；为了首版范围可控，不把 Anthropic 协议必填项扩展成新的跨 provider 配置面。

替代方案：新增 `maxOutputTokens` 配置。该方案更灵活，但会扩大 `/model`、文档、校验和多 provider 语义范围。

### 6. 工具 schema 继续保持 provider-neutral 源定义

本地 tool handler 的 `ToolDefinition.parameters` 保持语义 JSON Schema：optional 字段不进入 `required`，类型不写 `null`。Anthropic tool converter 直接映射为：

```text
{ name, description, input_schema: parameters }
```

理由：Anthropic 不需要 OpenAI Responses 的 `strict: true` 全字段 required workaround。Responses strict 投影继续只留在 OpenAI Responses converter。

## Risks / Trade-offs

- Anthropic SDK 对第三方 compatible 网关的 `baseURL`、headers 或 streaming 行为支持不完全 → 通过依赖注入 SDK client 的测试覆盖 request/options shape，并在文档中说明 compatible 网关需兼容官方 SDK。
- Anthropic stream event shape 与 SDK 版本强相关 → adapter 内部用窄类型守卫解析事件，只依赖文本增量、tool_use 分片、message stop 和 usage 等必要字段。
- `max_tokens` 内置默认值可能截断长回答 → 首版用文档说明默认值；后续如确有需要再提出单独配置变更。
- Anthropic system prompt 是顶层字段，多个 transient/system records 需要合并 → converter 按顺序用空行连接 system 文本，避免丢失内置 prompt、AGENTS 和 skill catalog。
- 工具参数分片可能得到不完整 JSON → 与 OpenAI Chat 一样保留原始 `argumentsText`，由 tool executor/runtime 负责校验并把失败结果回注模型。
- 新增依赖增加安装体积和供应链风险 → 仅新增官方 SDK，不引入第三方 TUI、SSE 或测试框架依赖。

## Migration Plan

无需数据迁移。现有配置继续默认 `agentType: "openai"`，现有 transcripts 保持原格式。用户如需启用 Anthropic，新增 provider profile 并把模型 profile 指向该 provider。

回滚时删除 `anthropic` provider profile 或切回已有 `openai`/`openai-chat` provider 即可；已持久化 transcript 中的 provider-neutral `tool_call`/`tool_result` records 可继续被其他 provider converter 过滤或转换。

## Open Questions

- Anthropic `max_tokens` 默认值是否选 `4096`，还是更保守的 `2048`？首版建议 `4096`。
- compatible 网关是否要求额外 header，例如 `anthropic-version` 或内部鉴权头？现有 provider `headers` 可覆盖大多数情况。
- Anthropic SDK 的具体 streaming API 使用 `messages.stream` 还是 `messages.create({stream: true})`，实现时应选择当前 SDK 版本下最稳定且可测试注入的方式。
