## Context

OpenAI Responses 和 Codex 都通过 OpenAI SDK 创建 Responses-compatible 流，并复用 `readResponseStream(...)` 消费事件。两者的 SDK client 都配置了 `maxRetries: 3`，但 SDK 只能在 HTTP 请求尚未成功建立 stream 时执行请求级重试；SSE 已建立后，SDK iterator 遇到包含 `error` 的事件会直接抛出 `APIError`，当前 adapter 随即将其归一化为“模型响应流异常”。

Codex 使用独立 OAuth credential、ChatGPT Codex backend 和请求 payload，但其 stream 协议及读取器与普通 OpenAI Responses 相同，因此临时 stream 错误重试应作为 Responses 共享语义，而不是只放在一个具体 agent 中。

## Goals / Non-Goals

**Goals:**

- 让 OpenAI Responses 与 Codex 的普通 provider turn 能从指定服务端临时处理错误中自动恢复。
- 保持重试有界、无工具副作用，并避免覆盖已经展示的 partial assistant 文本。
- 保持 Abort、compaction、错误脱敏和最终 request ID 反馈语义不变。
- 复用两个 adapter 的共同 stream reader 与重试判定，避免策略漂移。

**Non-Goals:**

- 不为 OpenAI Chat Completions、Anthropic 或其他 provider 增加重试。
- 不重试任意网络错误、rate limit、invalid prompt、incomplete 或 stream 未完成错误。
- 不实现可配置重试次数、后台队列、跨进程恢复或失败请求计费审计。
- 不在已经产生文本增量后清空 pending preview 并重新生成回答。
- 不改变 SDK 已有的请求级 `maxRetries` 配置。

## Decisions

### 1. 使用共享 Responses stream attempt runner

在 Responses adapter 边界提供一个接收 `createStream` factory 的共享执行器。OpenAI Responses 和 Codex 都通过该执行器创建并消费 stream；每次 retry 必须调用 factory 获取新的 stream，因为已消费或失败的 AsyncIterable 不能复用。

`readResponseStream(stream, ...)` 继续只负责单个 stream 的事件解析、draft 累积和结果构造。重试编排位于其外层，避免把请求创建职责塞进 reader。

备选方案是在两个 `runTurn` 中分别复制循环。该方案改动表面更小，但会重复错误识别、callback 包装、次数限制和 Abort 处理，因此不采用。

### 2. 通过服务端错误码或稳定提示识别目标错误

目标错误满足以下任一证据：

- SDK/Responses failure 暴露 `code: "server_error"`；
- 脱敏前的错误消息包含稳定片段 `An error occurred while processing your request. You can retry your request`。

stream reader 将该错误保留为内部可识别的 retryable error，同时维持现有中文前缀、敏感字段脱敏和 request ID 文本。其他错误继续按原语义抛出。

只匹配整类 `LlmAgentError` 或所有 5xx 会扩大重试面，并可能重复 invalid request 或兼容服务错误，因此不采用。

### 3. 最多额外重试一次，且只允许无文本尝试重试

共享执行器为每次 attempt 包装 `onToken`，记录是否已经向 app 发出非空文本增量。首次 attempt 命中目标错误、尚未发出文本、不是 compaction 且未被取消时，等待一个短且固定的退避间隔后创建第二个 stream。第二次 attempt 无论何种失败都直接返回现有错误。

工具调用、reasoning summary 和 provider-private records 都只会在 stream reader 成功返回后交给 agent loop，因此无文本失败重试不会重复执行工具或提交 provider records。

备选方案是已有 partial text 时清空 UI 后重试。当前 callback 协议没有显式 reset 事件，强行复用 `onToken` 会混淆 delta 语义并造成可见回答回退，因此不采用。

### 4. 重试等待必须响应 turn Abort

短退避期间应监听 `AbortSignal`，用户按 Esc 后立即结束等待且不得创建下一次 stream。第二次 stream 使用与第一次相同的 turn signal。

### 5. Codex 每个 turn 只解析一次 OAuth runtime client

Codex 在进入共享执行器前解析 credential、创建 client 并构造 request。重试复用该 turn 的 runtime client、credential 和不可变 request snapshot；短时间的服务端 retry 不需要重复读取 `auth.json`，也避免引入 credential 刷新次数变化。

普通 OpenAI Responses 同样复用已构造的 request。`prompt_cache_key` 因此在两次 attempt 间保持稳定。

### 6. compaction 请求不进入本次重试

`AgentTurnOptions.isCompaction` 为 true 时直接保持单次 stream 行为。这样既遵守现有“手动压缩失败不重试”要求，也避免让摘要请求在用户不可见时产生额外调用。

## Risks / Trade-offs

- [Risk] 第一次失败请求可能已经消耗 provider 资源，但没有完成事件可提供 usage。 → 最多只增加一次 attempt，并接受失败 attempt 无法计入本地 usage 的既有限制。
- [Risk] OpenAI 调整错误文案后消息匹配失效。 → 同时识别结构化 `server_error` code；保留消息匹配用于当前 SDK iterator 错误形态。
- [Risk] 兼容后端复用 `server_error` 表示不可恢复问题。 → 只额外重试一次，第二次失败立即透传，不形成循环。
- [Risk] 固定短退避可能不足以跨过较长服务抖动。 → 本次目标是恢复偶发瞬时错误，不引入复杂指数退避或可配置策略。
- [Risk] 用户在退避期间认为请求停滞。 → 保持现有 thinking/working 状态，且等待时间保持短小；Abort 始终可用。
