## 1. 配置读取

- [x] 1.1 更新 LLM config 读取逻辑：`openai-chat` model profile 保留合法 `reasoning.effort`。
- [x] 1.2 保持 `openai-chat` 忽略 `reasoning.summary`，该字段继续只对 OpenAI Responses 生效。
- [x] 1.3 更新 config 相关测试，覆盖 Chat effort 保留、summary 忽略，以及 OpenAI Responses / Anthropic 现有行为不回归。

## 2. OpenAI Chat 请求构造

- [x] 2.1 在 Chat Completions request 类型中加入可选顶层 `reasoning_effort` 字段。
- [x] 2.2 当 `reasoningEffort` 非空且非 `none` 时，在 `openai-chat` 请求中直传 `reasoning_effort`。
- [x] 2.3 确保 `none` 或未配置时不发送 `reasoning_effort`。
- [x] 2.4 确保 Chat request 仍不发送 Responses-only `reasoning`、`input` 或 `max_output_tokens` 字段。
- [x] 2.5 更新 Chat request 测试，覆盖 effort 直传、`none` 不发送和 OpenAI-only 字段不回归。

## 3. OpenAI Chat reasoning stream 处理

- [x] 3.1 扩展 Chat stream chunk 类型，识别 `choices[].delta.reasoning_content`。
- [x] 3.2 在 `readChatCompletionStream` 中聚合 `reasoning_content` 为 `reasoningSummary`，不追加到 assistant draft，不触发文本 token 回调。
- [x] 3.3 保持 `content`、`tool_calls`、usage 和完成条件的现有处理语义不变。
- [x] 3.4 确保 Chat reasoning 不生成 provider-only transcript record，也不回放到后续 Chat messages。
- [x] 3.5 更新 stream 测试，覆盖 reasoning-only、reasoning + content、reasoning + tool_calls continuation。

## 4. OpenSpec 与验证

- [x] 4.1 根据 delta spec 更新或确认主 spec 同步策略，确保归档时能正确合并 `streaming-llm-service-adapter` 行为变化。
- [x] 4.2 运行 `npm run typecheck`。
- [x] 4.3 运行 `npm test`。
- [x] 4.4 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
