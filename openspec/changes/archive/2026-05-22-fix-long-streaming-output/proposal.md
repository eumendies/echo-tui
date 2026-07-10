## Why

长 assistant 输出目前会把完整 streaming draft 放进 footer pending 区域反复重绘；当 pending 高度增长到触发终端滚动时，旧 draft 会进入 scrollback，导致用户看到多段重复的 assistant 内容。

长输出还会因为本地默认 `max_output_tokens = 512` 和未识别 OpenAI `response.incomplete` 事件而失败为“模型响应流未完成”。用户不应被要求理解或调整客户端输出长度参数，CLI 应让服务端决定输出上限，并清晰处理服务端 incomplete。

## What Changes

- 移除客户端默认输出长度限制：默认 OpenAI request 不再发送 `max_output_tokens`。
- 收敛 LLM 配置：`maxOutputTokens` 不再作为用户需要配置或校验的公开运行参数。
- 对 streaming pending preview 做头部折叠，按当前 terminal rows 动态预算尾部行数并显示折叠提示，避免 footer 高度无限增长进入 scrollback。
- 保持最终 assistant transcript record 为完整输出：streaming 中可折叠预览，完成后正式 `assistant` record 不折叠。
- 识别 OpenAI Responses API 的 `response.incomplete` 事件，提供明确错误语义，不再把它误报为本地“模型响应流未完成”。
- 当 incomplete 或 stream 异常发生且已有部分 draft 时，保留已生成内容的可见性和恢复语义，避免用户看到的内容被静默丢弃。
- 更新测试与文档，覆盖长 streaming preview、request shape、incomplete 事件和失败反馈。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 真实 LLM adapter 的请求参数、输出长度配置、incomplete stream 事件和 partial draft 失败语义发生变化。
- `terminal-tui-prototype`: streaming pending preview 的可见高度和折叠行为发生变化，防止长输出重复进入 scrollback。

## Impact

- 影响 `src/agent/llm-config.ts`、`src/agent/openai-agent.ts` 和相关 agent 测试。
- 影响 `src/render/blocks.ts`、`src/render/footer.ts` 或其测试覆盖的 pending preview 渲染行为。
- 影响 `src/app/main.ts` / `TurnContext` 的失败路径语义：如果已有 partial draft，需决定如何提交 partial assistant 与 error record。
- 影响 `docs/README.md`、`docs/tui-architecture.md` 中关于 LLM 配置、长输出和 streaming preview 的说明。
- 不引入新的运行时依赖，不改变 CommonJS 构建产物，不新增 TUI 框架。
