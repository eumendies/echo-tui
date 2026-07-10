## Why

当前 TUI 只展示 assistant 可见文本和工具调用结果；当 reasoning 模型在工具循环中只产生工具调用而没有普通文本时，用户很难理解模型为何连续执行这些工具。OpenAI Responses API 已提供可显式开启的 reasoning summary，适合把模型思考摘要作为可见但不污染对话上下文的调试/透明度信息呈现出来。

## What Changes

- 模型 profile 支持可选 `reasoning.summary` 配置，取值为 `auto`、`concise` 或 `detailed`。
- OpenAI Responses 请求在配置 summary 时发送 `reasoning.summary`，并继续支持既有 `reasoning.effort`。
- OpenAI stream 解析 `response.reasoning_summary_text.delta` 与 `response.reasoning_summary_text.done`，累积每个 provider turn 的 reasoning summary。
- OpenAI provider 在工具 continuation 中保留服务端返回的 reasoning output item，并在下一次 Responses input 中原样回传；该 provider-private 状态不进入可见 transcript。
- agent loop 在每个 provider turn 结束后、执行 tool call 或提交最终 assistant 回复前，追加可见 `reasoning_summary` transcript record。
- TUI 以低强调样式渲染 reasoning summary，并将其持久化到 session；resume 后仍可见。
- `reasoning_summary` SHALL NOT 作为 user/assistant/system 或工具上下文回传 provider，也 SHALL NOT 参与上下文压缩摘要输入与 token 估算。
- 不支持 raw reasoning text 展示；仅支持 OpenAI 官方 reasoning summary。

## Capabilities

### New Capabilities
- 无。

### Modified Capabilities
- `streaming-llm-service-adapter`: 扩展 reasoning summary 配置、OpenAI 请求参数、stream 解析、agent result/callback 与 provider input 过滤行为。
- `terminal-tui-prototype`: 扩展 append-only transcript、持久化和渲染行为，新增 reasoning summary 可见记录。
- `context-compression`: 明确 reasoning summary 作为非 provider 本地可见记录，不参与压缩输入与上下文估算。

## Impact

- 影响 `src/config/llm-config.ts`、`src/types/agent.ts`、`src/agent/openai-agent.ts`、`src/agent/agent-loop-runtime.ts`、`src/agent/openai-transcript-converter.ts` 和相关测试；OpenAI provider 可新增 provider-private continuation item 支持。
- 影响 `src/app/main.ts`、`src/app/turn-context.ts`、`src/types/transcript.ts`、`src/render/app-renderer.ts`、`src/render/blocks.ts`、`src/persistence/transcript-store.ts` 的可见 transcript 处理与渲染测试。
- 影响 `src/agent/context-compaction.ts`，确保 reasoning summary 不回灌 provider、不参与压缩摘要。
- 不引入第三方依赖，不改变工具审批语义，不暴露 raw chain-of-thought，不要求默认开启 summary。
