## Why

当前流式请求的重试判定集中在 `src/agent/openai-responses/agent.ts`，只识别 `server_error` code 和两条英文文案子串，因此真正高频的瞬时失败——SSE 在 `response.completed` 前断开、stream 迭代期连接重置、`rate_limit_exceeded`、`server_is_overloaded`、SSE 长时间无事件——全部直接失败；同时 attempt 级门控把 reasoning summary 增量也算作「已输出正文」，而思考模型几乎必然先输出 reasoning，导致既有重试路径在真实环境中近乎失效。

OpenAI Chat Completions 与 Anthropic adapter 的流级中断完全没有重试能力，只能依赖 SDK 的请求级 `maxRetries`，该机制在 stream 建立后不再生效。

## What Changes

- **BREAKING** 用结构化错误分类替代文案子串匹配：新增 provider-neutral `ProviderError` 语义分类（`transient` / `rate_limit` / `overloaded` / `stream_incomplete` / `provider_incomplete` / `content_filter` / `invalid_request` / `context_overflow` / `auth` / `quota` / `aborted` / `unknown`），分类证据按「结构化 code 与 HTTP 状态 → SDK 错误类 → 网络错误特征 → 文案」优先级链取值。
- 新增可重试面：stream 未收到完成事件即结束、stream 迭代期连接错误（`APIConnectionError`、`ECONNRESET`、`EPIPE`、`ETIMEDOUT`、`UND_ERR_*`、premature close）、`rate_limit_exceeded`、`slow_down`、`server_is_overloaded`、Anthropic `overloaded_error`、Chat 错误 chunk 中的等价码。
- **BREAKING** 重试策略从「最多额外重试一次」改为按错误语义分为 `never` / `server-directed` / `backoff` 三态，并对可重试类别使用有界指数退避（含抖动、上限 60 秒）替代当前 `1s × 2^（n-1)`、上限 256 秒且无抖动的固定序列。
- 支持服务端重试建议：`Retry-After`、`retry-after-ms`、stream 内错误对象携带的 headers，以及 rate limit 文案中的 `try again in Ns`。服务端建议 SHALL 只调整等待时长，不放大重试预算。`rate_limit` 与 `overloaded` 在取不到服务端建议时 SHALL 回退到该类别的保守退避（更少次数、更长基础延迟），而不是直接失败。
- 新增 SSE 空闲看门狗：超过配置的空闲阈值未收到任何 stream 事件时视为瞬时断流并进入重试判定，而不是无限等待。
- **BREAKING** attempt 级门控拆分为「已向 app 发出非空正文增量」与「已展示 reasoning 预览」两条独立条件：正文已输出时不重试（正文已进入 append-only transcript 与终端历史区），reasoning 预览已输出时允许重试，并在重试前使 app 丢弃该 attempt 的预览。已发出 reasoning 完成通知、已解析出完整工具调用或已产生 provider-private record 的 attempt SHALL NOT 重试。
- Anthropic adapter 的 reasoning 完成通知从「每个 thinking block 结束时」改为「整个 provider turn 确认完成后统一发出」，既消除重试时的重复落盘，也保住 reasoning 阶段的重试窗口。
- 将重试执行器从 `openai-responses` adapter 提取为 provider-neutral 模块，由 OpenAI Responses、Codex、OpenAI Chat Completions、Anthropic 四个 adapter 共用。
- `ProviderRetry` 增加错误类别与可读原因，本地 notice 文案包含原因与下次等待时长；重试预算耗尽时最终错误包含已重试次数。
- 新增可选的 provider 级配置项 `streamMaxRetries` 与 `streamIdleTimeoutMs`，缺省值与硬上限在实现中固定，缺省配置不改变现有用户行为之外的新语义。

## Capabilities

### New Capabilities
- `provider-error-retry-policy`: 定义 provider-neutral 的流式失败分类、重试决策三态、退避与服务端建议、空闲超时、attempt 门控与重试可见性契约。

### Modified Capabilities
- `streaming-llm-service-adapter`: `SDK 流式文本增量处理` 改为引用共享重试策略并拆分 attempt 门控；`OpenAI Chat Completions stream 处理` 与 `Anthropic Messages stream 处理` 增加流级重试语义；`失败反馈` 增加重试耗尽与重试可见性约束。

## Impact

- 代码：新增 `src/agent/provider-error.ts`（或等价模块）与 provider-neutral 重试执行器；修改 `src/agent/openai-responses/agent.ts`、`src/agent/codex/agent.ts`、`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts`、`src/types/agent.ts`，并可能调整 `src/app/assistant-turn-runner.ts` 与 `src/app/btw-conversation-controller.ts` 的 reasoning 预览清理路径。
- 配置：`src/config/llm-config.ts` 增加可选 `streamMaxRetries` / `streamIdleTimeoutMs` 读取，缺省不要求用户修改 `~/.echo/config.json`。
- 测试：`test/agent/openai-agent.test.js`、`test/agent/codex-agent.test.js` 中硬编码的退避序列与「最多额外重试一次」断言需重写；补充 Chat、Anthropic 与错误分类矩阵的测试。
- 行为变更：Anthropic 多 thinking block 响应的 reasoning 完成通知时机从「每个 block 结束」改为「整个 provider turn 完成后一次」，同时修复现有的摘要重复落盘问题，会改变 reasoning 摘要在 transcript 中的落盘次数。
- Spec：`openspec/specs/streaming-llm-service-adapter/spec.md` 中「最多额外重试一次」「非目标错误不重试（含无完成事件）」「已产生 partial text 时不重试」三条语义被本变更取代。
- 不影响：provider-neutral `ProviderAgent` / `AgentTurnResult` 契约、agent loop runtime 的工具循环编排、compaction 请求不重试的既有约束、SDK 请求级 `maxRetries` 配置。
