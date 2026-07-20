## Why

OpenAI Responses 和 Codex 的流式请求偶尔会在 SSE 已建立后返回可重试的服务端临时处理错误。OpenAI SDK 的请求级 `maxRetries` 不会覆盖 stream 消费阶段的异常，导致本可恢复的普通 assistant turn 直接失败。

## What Changes

- 为 OpenAI Responses 和 Codex 共用的 Responses stream 执行路径增加有界自动重试。
- 仅识别 OpenAI 明确提示可重试的临时处理错误，并最多额外重试一次。
- 仅在当前尝试尚未产生 assistant 文本增量时自动重试，避免已展示的 partial draft 被替换或重复。
- 用户主动取消、非目标错误、已产生文本的 stream 错误和 compaction 请求保持现有失败行为，不触发额外重试。
- 重试继续复用同一 provider turn 的请求快照；Codex 复用该 turn 已解析的 OAuth credential 和 client。
- 重试最终仍失败时保留现有脱敏错误反馈和 OpenAI request ID，便于排查服务端问题。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 增加 OpenAI Responses 与 Codex 对指定服务端临时 stream 错误的有界重试行为。

## Impact

- 影响 `src/agent/openai-responses/agent.ts`、`src/agent/codex/agent.ts` 及对应 agent 测试。
- 不改变 provider-neutral `ProviderAgent`、`AgentTurnResult` 或 app callback 协议。
- 不新增用户配置项、后台重试队列或第三方依赖。
