## Context

当前重试实现分散且语义单一：

- `src/agent/openai-responses/agent.ts` 内的 `runResponseStreamWithRetry` 是唯一的流级重试执行器，OpenAI Responses 与 Codex 共用；OpenAI Chat 与 Anthropic adapter 完全没有流级重试。
- 可重试判定 `isRetryableResponseStreamError` 只认 `RetryableResponseStreamError` 实例、`code === 'server_error'` 与两条英文文案子串。
- attempt 门控 `emittedText` 把非空 reasoning summary 增量与正文增量合并为同一个布尔值。
- 退避为 `1000ms × 2^(n-1)`，上限 256 秒，无抖动，不读取服务端重试建议；无 SSE 空闲超时。

参考实现是 codex-cli（`codex-rs/protocol/src/error.rs` 的 `retry_delay` / `retry_policy`、`codex-rs/async-utils/src/backoff.rs`、`codex-rs/model-provider-info/src/lib.rs` 的 `stream_max_retries` / `stream_idle_timeout_ms`、`codex-rs/core/src/responses_retry.rs`）。其核心是把「是否可重试、等待多久」建模为错误语义类型的属性，而不是消息文本比较。

约束：

- transcript 是 append-only；assistant 正文一旦通过 `onAssistantSegment` 进入 app，就不能回退或替换。
- reasoning 预览是可重置的瞬时状态（`appContext.turnContext.setReasoningStreamingPending`），不落盘。
- 退避等待必须能被 turn 级取消信号与 active-turn steering 抢占立即中断。
- compaction 请求保持不重试。
- 不引入第三方依赖，不切换模块系统，不使用 bundler。

## Goals / Non-Goals

**Goals:**

- 用结构化错误分类取代文案子串匹配，并让文案匹配降级为最后一级兼容兜底。
- 覆盖真实高频瞬时失败：SSE 提前结束、迭代期连接错误、rate limit、overload、空闲超时。
- 用「never / server-directed / backoff」三态表达重试决策，取代布尔判断与固定序列退避。
- 让 reasoning 预览不再阻塞重试，同时保持正文 append-only 不回退。
- 让四个 adapter（Responses、Codex、Chat、Anthropic）共用同一套分类与执行器。
- 重试过程对用户可见、可中断、有界且可解释。

**Non-Goals:**

- 不重试 compaction 请求、工具执行、MCP 调用或子 Agent 委派本身。
- 不为已产生正文增量、已产生工具调用或已产生 provider-private record 的 attempt 做「回滚后重试」。
- 不实现跨进程恢复、离线队列或断点续传。
- 不改变 SDK 请求级 `maxRetries` 配置；`createStream()` 阶段的失败仍由 SDK 处理，不进入流级重试预算。
- 不引入备用模型切换、成本预算或熔断器。
- 不做内容过滤 guidance 注入（Codex 在 ContentFilter 重试前会注入 developer guidance，本仓库没有等价机制）。

## Decisions

### 1. 新增 provider-neutral 的 `ProviderError` 分类层

新增模块承载三个东西：

- `ProviderErrorKind`：`transient`、`rate_limit`、`overloaded`、`stream_incomplete`、`provider_incomplete`、`content_filter`、`invalid_request`、`context_overflow`、`auth`、`quota`、`aborted`、`unknown`。
- `ProviderError`：携带 kind、HTTP status、provider 错误码、`retryAfterMs`、requestId、脱敏后的可展示消息与原始 cause。
- `classifyProviderError(error, adapterKind)`：按优先级链判定 kind。

分类优先级链（高到低）：

1. 结构化 provider 错误码（`response.failed` 的 `error.code`、Chat chunk 的 `error.code`、Anthropic 的 `error.type`）。
2. SDK 错误类（`APIUserAbortError`、`APIConnectionTimeoutError`、`APIConnectionError`、`RateLimitError`、`InternalServerError`、`APIError.status`）。
3. Node/undici 错误特征（`code` 为 `ECONNRESET` / `EPIPE` / `ETIMEDOUT` / `ECONNREFUSED` / `ENOTFOUND` / `UND_ERR_*`，或消息含 `premature close` / `terminated` / `socket hang up`）。
4. 兼容文案表（现有两条文案 + rate limit 的 `try again in` 形态），仅作为兜底。

替代方案是继续扩充 `RETRYABLE_RESPONSE_STREAM_ERROR_TEXTS`。不采用：文案不稳定、无法表达「只按服务端建议重试」与「等待时长」两类信息，且每新增一个 provider 都要复制一份。

替代方案是每个 adapter 自己判定。不采用：四个 adapter 的策略会漂移，正是本次要解决的问题。

### 2. 重试决策使用三态模型

`resolveRetryDecision(kind, policy)` 返回三种结果之一：

| kind | 决策 | 无服务端建议时的行为 |
| --- | --- | --- |
| `transient`、`stream_incomplete` | `backoff` | 指数退避 + 抖动 |
| `rate_limit` | `server-directed` | 保守退避：基础 5 秒，最多 2 次 |
| `overloaded` | `server-directed` | 保守退避：基础 2 秒，最多 2 次 |
| `provider_incomplete`、`content_filter` | `never` | — |
| `invalid_request`、`context_overflow`、`auth`、`quota` | `never` | — |
| `aborted` | `never` | — |
| `unknown` | `never` | — |

`server-directed` 的语义是「服务端建议优先，缺失时回退到该 kind 的保守退避」，与 Codex 的 `RetryPolicy::ServerDirected`（无建议即终止）有意不同。原因：echo-tui 的多数 provider 配置指向第三方兼容服务，stream 建立后既拿不到 HTTP headers（OpenAI SDK 在 SSE 内 error 事件传入的是 200 建连响应的 headers，`retry-after` 实际不可得），Anthropic 走的又是原始 SSE iterable，`event.error` 只有 `type` 与 `message`。若严格对齐 Codex，限流与过载会退化成「永不重试」，与本次变更目标自相矛盾。

保守退避另设独立子预算（2 次），不占用主预算，避免对过载后端形成持续重打。该子预算仍受主预算剩余次数约束，取两者较小值。

`transient` 与 `stream_incomplete` 的重试决策、退避参数和预算完全一致，区分两者只用于用户可见的失败原因文案（「连接中断」vs「响应流提前结束」）。实现时 SHALL NOT 为两者配置不同退避。

与 Codex 的显式差异：Codex 对 `ContentFilter` 归入 `Backoff` 并在重试前注入 guidance；本仓库不重试该类别。理由是没有 guidance 注入手段，重试只会得到同样的过滤结果并多消耗一次请求。

### 3. 退避参数

- 基础延迟 500ms，指数因子 2，单次上限 60 秒，施加 ±20% 抖动。
- 服务端建议优先：`Retry-After`（秒数或 HTTP date）、`retry-after-ms`、stream 内错误对象携带的 `headers`、rate limit 消息中的 `try again in <N>s|ms`。取值后 `min(建议值, 60 秒)`。
- 服务端建议只改变等待时长，不增加重试次数。

为什么不直接沿用 `1s × 2^(n-1)` 上限 256 秒：256 秒的单次静默等待在 TUI 中与卡死无法区分，且等比放大没有抖动会让并发失败的客户端同步重打。

为什么基础值取 500ms 而 Codex 取 200ms：Codex 面向自家后端，echo-tui 的多数配置指向第三方兼容服务，更保守的基础延迟可以减少无效重打。

### 4. 重试预算

- 默认 `streamMaxRetries = 5`（对齐 Codex 的 `DEFAULT_STREAM_MAX_RETRIES`），语义是「5 次重试」＝最多 6 次 stream，与 Codex 一致；硬上限 20。
- 预算按 provider turn 计，不按 transcript 计；一次工具循环中的每次 provider turn 各自拥有独立预算。
- 预算耗尽后不再创建新 stream，直接抛出最后一次分类错误。

不采用当前无上限感的设计：`RESPONSE_STREAM_MAX_RETRIES = 10` 配合 256 秒上限意味着单次 provider turn 理论上可以静默等待超过 20 分钟。

最坏等待需要显式说明：单个 provider turn 在全部重试都命中 60 秒上限时约 5 分钟；一次工具循环若发生 N 个 provider turn，理论上限是 N × 5 分钟。这是「按 provider turn 独立预算」的刻意取舍——每个 provider turn 都是独立请求，共享预算会让长工具循环在后期丧失恢复能力。notice 中的次数展示让用户可以随时判断并中断。

`createStream()` 工厂本身抛错（HTTP 建连阶段失败）SHALL NOT 扣减流式重试预算：该阶段由 SDK 的 `maxRetries` 负责，执行器的分类与退避只作用于 stream 已建立之后的失败。否则鉴权失败等 4xx 也会被流式预算重复重试。

### 5. SSE 空闲看门狗

在 stream 消费层为每次 `next()` 加空闲计时器，默认 300 秒无任何事件即视为 `stream_incomplete` 并进入重试判定。

替代方案是不加超时。不采用：`for await` 在连接半开时不会返回，用户只能看到 spinner 无限旋转。

为什么默认 300 秒而非更短：高 effort 思考模型在无 reasoning summary 配置时可能长时间不产生事件，过早超时会把正常响应误判为断流。

超时或取消后必须显式释放旧 stream：执行器 SHALL 在离开 attempt 时调用 `stream.return?.()`（或等价中断路径），否则未消费的 `next()` 会继续持有底层连接，下一次 `createStream()` 可能复用坏连接。仅用 `Promise.race` 做超时判定不足以释放连接，必须有显式收尾步骤。

### 6. attempt 门控拆分

把现有单一 `emittedText` 拆成两个独立状态：

- `emittedAssistantText`：attempt 期间是否通过 `onToken` 发出过非空正文增量。
- `emittedReasoningPreview`：attempt 期间是否通过 `onReasoningUpdate({kind: 'draft'})` 发出过非空 reasoning 预览。
- `emittedReasoningComplete`：attempt 期间是否通过 `onReasoningUpdate({kind: 'complete'})` 发出过完成通知。
- `emittedToolCall`：attempt 期间是否已解析出完整工具调用。
- `emittedProviderRecord`：attempt 期间是否已产生 provider-private record。

决策规则：

- `emittedAssistantText`、`emittedReasoningComplete`、`emittedToolCall` 或 `emittedProviderRecord` 任一为 true → 不重试。
- 仅 `emittedReasoningPreview === true` → 允许重试，并在新 attempt 开始前清空该 attempt 的预览。
- 全部为 false → 允许重试。

清空方式优先复用现有回调语义：`onReasoningUpdate?.({kind: 'draft', text: ''})`。若实现验证发现渲染层无法用空 draft 清空预览，则引入显式的 `{kind: 'reset'}` 并同步更新 `streaming-llm-service-adapter` 的回调契约要求；该决定在实现阶段确认，不阻塞本设计。

Anthropic 的 reasoning 完成通知时机需要同步调整：当前 `completeThinkingBlock` 在**每个 `content_block_stop`** 就发出 `{kind: 'complete'}`，与正文无关。这意味着「thinking block 已 complete 落盘 → 后续正文 block 中断 → 重试 → 再次 complete 同一段摘要」会真实发生。改为在整个 provider turn 确认完成（`message_stop` 之后、`assertSupportedStopReason` 之前）统一发出一次完整 reasoning 完成通知，与 Responses adapter 的既有做法对齐。Chat adapter 的 `completeReasoning()` 绑定在「正文首次出现」与「空响应完成」两个时刻，前者已被 `emittedAssistantText` 门控拦住，无需调整。

关于 Chat `finish_reason` 与 Anthropic `stop_reason` 的差异：Anthropic 的 `assertSupportedStopReason` 在 `message_stop` 之后才执行，因此「缺 `message_stop`」表示流被截断（`stream_incomplete`，可重试），「有 `message_stop` 但缺 `stop_reason`」表示协议异常（`never`）。Chat 的 `finish_reason` 是它唯一的完成信号，缺失即等价于流截断。两者语义一致，不需要额外统一。

替代方案是照搬 Codex 的「正文已输出也重试 + 工具去重」。不采用：那需要在 transcript 上做输出项去重与半成品重建，与本仓库 append-only、仅在成功后提交 draft 的架构冲突，改动面远超本次目标。

### 7. 共享重试执行器

新增 provider-neutral 执行器，输入为：

- `createStream()`：每次 attempt 必须重新调用，返回新的 AsyncIterable。
- `readStream(stream, attemptCallbacks, options)`：单次 attempt 的解析与结果构造，保持现有 reader 职责不变。
- `classify(error)`：adapter 提供的分类入口（可复用共享实现 + adapter 特化映射）。
- `policy`：预算、退避参数、空闲阈值。
- `callbacks` / `options`：含 abortSignal。
- `deps`：可注入的 `sleep`、`random`、`now` 与定时器接口，缺省使用真实实现。

执行器负责 attempt 编排、attempt 级回调隔离、门控判定、退避等待、abort/steering 中断、`onProviderRetry` 通知与最终错误包装。reader 不再关心重试。

为什么需要注入 `sleep` / `random`：spec 要求测试断言退避区间而非精确毫秒，同时不能 pin 住抖动。若不注入，测试只能依赖 `mock.timers` 加随机种子，仍是 flaky 的。注入点是公开运行 seam，不为了测试而增加生产分支。

替代方案是每个 adapter 保留自己的循环。不采用：这正是当前策略漂移的来源。

### 8. 四个 adapter 的接入边界

- OpenAI Responses：`response.failed` 的 `error.code` 与迭代期异常进入分类层；`response.incomplete` 归入 `provider_incomplete`；无完成事件即 EOF 归入 `stream_incomplete`。
- Codex：复用同一执行器与分类映射；每个 provider turn 只解析一次 OAuth credential 与请求快照，重试复用同一 client 与 request。
- OpenAI Chat：`chunk.error` 的 `code`/`type` 进入分类层；`finish_reason` 缺失即 EOF 归入 `stream_incomplete`；连接类异常按第 1 节特征识别。
- Anthropic：`event.error.type` 的 `overloaded_error` → `overloaded`，`rate_limit_error` → `rate_limit`，`api_error` → `transient`。「缺 `message_stop`」表示流被截断（`stream_incomplete`，可重试），「有 `message_stop` 但缺 `stop_reason`」表示协议异常（`never`）。`max_tokens`、`refusal`、`pause_turn` 三种停止原因保持既有 `never` 语义。reasoning 完成通知从每个 `content_block_stop` 改为 `message_stop` 之后统一发出一次（见「attempt 门控拆分」）。

### 9. 可见性

- `ProviderRetry` 增加错误类别与可读原因（如「响应流中断」「服务限流」「服务过载」）与下次等待毫秒数。
- 本地 notice 文案包含原因与次数，例如「模型响应流中断，2 秒后重试（2/5）」。
- 预算耗尽的最终错误包含已重试次数与最后一次 attempt 的 request ID。
- 首次重试前的 notice 在正文未开始时立即插入；正文已开始时沿用现有 `incremental-streaming-commit` 的 drain 语义。

### 10. 配置项

provider profile 支持可选 `streamMaxRetries` 与 `streamIdleTimeoutMs`。越界处理规则：

- 合法整数且在上限内 → 直接采用。
- 合法整数但超过硬上限 → **clamp 到硬上限**，不静默回退默认值。用户写 `streamMaxRetries: 30` 时期望「尽可能多」，静默变成 5 违反直觉。
- `streamMaxRetries: 0` → 合法，表示关闭流式重试（只发起一次 stream）。
- 非整数、负数或非数字 → 回退默认值。这类输入无法推断用户意图。

`streamIdleTimeoutMs` 的下限设为 10000 毫秒，避免误配成极短值后把正常响应判成断流。

缺省配置不要求用户修改 `~/.echo/config.json`。

## Risks / Trade-offs

- [Risk] 扩大可重试面会放大 provider 成本与配额消耗。 → 预算按 provider turn 计且默认 5 次；`overloaded` 与 `rate_limit` 使用独立的 2 次保守子预算并优先采纳服务端建议；`unknown` 与 policy 类永不重试；单次等待上限 60 秒。
- [Risk] 对兼容后端的 5xx 反复重打可能触发更严格限流。 → 使用抖动退避并在 notice 中展示重试次数，用户可以看到并主动中断。
- [Risk] 空闲超时默认值对极长思考模型过短。 → 默认对齐 Codex 的 300 秒，并开放 provider 级配置；实现阶段用真实模型验证。
- [Risk] reasoning 预览清空若依赖空 draft 语义，可能与渲染层空文本处理冲突。 → 设计已给出退化方案（显式 reset 事件），并在实现阶段做针对性验证。
- [Risk] 正文已输出仍不重试，会漏掉一部分本可恢复的失败。 → 这是 append-only 架构下的有意取舍，写入 spec 的既有约束；用户可重新发送。
- [Risk] 四个 adapter 共用执行器后，某个 adapter 的语义特化可能被稀释。 → 分类入口按 adapter 参数化，读写职责仍留在各自 reader。
- [Risk] Anthropic reasoning 完成通知时机变更会改变现有 transcript 落盘次数，可能影响既有快照或手工验证预期。 → 该变更同时修复「多 thinking block 重复落盘」的现存缺陷，属于净收益；实现阶段需在 `test/agent/anthropic-agent.test.js` 中显式覆盖单条摘要断言。
- [Risk] 现有测试大量断言固定退避序列与「最多额外重试一次」，改造会带来较大测试重写量。 → 通过可注入的 `sleep` / `random` / `now`，测试改为断言「重试判定 + 退避区间 + notice 内容」，不再断言精确毫秒序列。

## Migration Plan

内部原型项目，无外部 API 兼容承诺，不需要数据迁移。

建议按三步合并：

1. 引入 `ProviderError` 分类层与单元测试，暂不改变任何 adapter 行为（旧 `RetryableResponseStreamError` 映射到新分类）。
2. 引入共享重试执行器并接入 Responses 与 Codex，重写对应测试。
3. 接入 Chat 与 Anthropic，补齐配置项、notice 文案与最终错误信息。

回滚策略：三次改动均可独立回滚；配置项缺省不影响旧配置读取；无持久化格式变化。

## Open Questions

- reasoning 预览清空能否完全复用 `onReasoningUpdate({kind: 'draft', text: ''})`，还是需要显式的 `{kind: 'reset'}`？
- 空闲超时默认值取 300 秒是否对现有用户的高 effort 模型足够，是否需要改为按 reasoning effort 调整？
- Chat 与 Anthropic 是否应与 Responses 共用同一个默认预算（5 次），还是使用更保守的值（如 3 次）？
- 是否需要在 `/status` 或 debug 诊断中暴露本次 turn 的重试历史？

已解决：

- provider-private record 纳入门控（见「attempt 门控拆分」）：`emittedProviderRecord` 为 true 即不重试。虽然会缩窄窗口，但 provider-private record 一旦落盘就无法在不回滚 transcript 的前提下重放，代价高于收益。
- Chat `finish_reason` 与 Anthropic `stop_reason` 的语义差异已在「attempt 门控拆分」中解释，两者一致，不需要统一。
