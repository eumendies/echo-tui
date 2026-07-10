## 1. 配置与类型

- [x] 1.1 在 transcript 类型中新增 provider-only Anthropic thinking role，并确保非 Anthropic provider/converter 不会发送该 role。
- [x] 1.2 更新 LLM config 读取逻辑：Anthropic model profile 保留合法 `reasoning.effort`，继续忽略 `reasoning.summary`。
- [x] 1.3 更新 config/model context 相关测试，覆盖 Anthropic effort 保留、summary 忽略和现有 OpenAI 行为不回归。

## 2. Anthropic 请求构造

- [x] 2.1 在 Anthropic request 类型中加入 `thinking` 与 `output_config.effort` 字段。
- [x] 2.2 实现 Echo effort 到 Anthropic effort 的映射：`minimal -> low`、`low -> medium`、`medium -> high`、`high -> xhigh`、`xhigh -> max`，`none` 不发送。
- [x] 2.3 当 Anthropic effort 非空时发送 `thinking: { type: 'adaptive', display: 'summarized' }` 与映射后的 `output_config.effort`。
- [x] 2.4 更新 Anthropic request 测试，覆盖各等级映射、`none` 不启用 reasoning、以及不发送 OpenAI-only `reasoning` 字段。

## 3. Anthropic stream thinking 处理

- [x] 3.1 扩展 Anthropic stream event 类型与聚合状态，识别 `thinking`、`thinking_delta`、`signature_delta` 和 `redacted_thinking` blocks。
- [x] 3.2 将 thinking delta 按 content block index 聚合，并在 provider turn 完成时返回 `reasoningSummary`。
- [x] 3.3 将 signed thinking 或 redacted thinking block 转换为 provider-only Anthropic thinking transcript record，并通过 `providerRecords` 返回给 agent loop。
- [x] 3.4 更新 Anthropic stream 测试，覆盖 thinking-only、thinking + text、thinking + tool_use continuation、redacted thinking 和异常流不回归。

## 4. Anthropic transcript 回放

- [x] 4.1 扩展 Anthropic transcript converter，将 provider-only Anthropic thinking record 转换为 assistant content 中的 thinking 或 redacted_thinking block。
- [x] 4.2 确保 Anthropic thinking block 与同轮 `tool_call` 合并到同一个 assistant message content，后续 `tool_result` 仍按现有规则转换。
- [x] 4.3 更新 transcript converter 测试，覆盖 signed thinking 回放、redacted thinking 回放、未知/无效 provider block 跳过。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`。
- [x] 5.2 运行 `npm test`。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
