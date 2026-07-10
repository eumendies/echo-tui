## Why

OpenAI Chat Completions compatible provider 已经支持多家推理模型服务，但当前 `openai-chat` adapter 会忽略 model profile 中的 `reasoning.effort`，也不会展示兼容服务流式返回的 reasoning 内容。支持 Chat-compatible reasoning 可以让用户在不切换到 Responses API 的情况下使用推理模型的 effort 控制和 reasoning 展示能力。

## What Changes

- `openai-chat` model profile 保留合法的 `reasoning.effort`，继续忽略 OpenAI Responses-only 的 `reasoning.summary`。
- `openai-chat` 请求在 effort 非 `none` 时发送 Chat Completions compatible 的 `reasoning_effort` 字段，effort 值采用 Echo TUI 配置值直传。
- `openai-chat` stream 处理 `choices[].delta.reasoning_content`，聚合为 `AgentTurnResult.reasoningSummary` 并复用既有 reasoning summary 展示链路。
- 保持 Chat adapter 不发送 OpenAI Responses-only 的 `reasoning` 字段，也不新增 provider-only continuation record。
- 更新相关配置、请求构造、stream 聚合和 spec 测试。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 修改 OpenAI Chat Completions compatible adapter 的配置读取、请求构造和 stream reasoning 展示行为。

## Impact

- 影响 `src/config/llm-config.ts` 的 model profile reasoning 配置解析。
- 影响 `src/agent/openai-chat/agent.ts` 的 Chat Completions 请求类型、请求构造和 stream delta 聚合逻辑。
- 影响 `test/config/llm-config.test.js` 与 `test/agent/openai-chat-agent.test.js`。
- 需要更新 `openspec/specs/streaming-llm-service-adapter/spec.md` 对非 Responses provider reasoning 配置行为的描述。
