## 1. 移除客户端输出长度上限

- [x] 1.1 更新 `src/types/agent.ts`、`src/agent/llm-config.ts` 和相关测试，移除公开 `maxOutputTokens` 配置、默认值与正整数校验。
- [x] 1.2 更新 `src/agent/openai-agent.ts` 的 request 构造，默认不发送 `max_output_tokens`。
- [x] 1.3 更新配置、request shape 和文档测试，确认默认配置只需要 `apiKey`、`baseURL`（可选）和 `model`。

## 2. 处理 OpenAI incomplete 与 partial draft

- [x] 2.1 在 `src/agent/openai-agent.ts` 中识别 `response.incomplete`，提取 `response.incomplete_details` 或可用摘要，避免误报“模型响应流未完成”。
- [x] 2.2 调整 agent/app 失败 contract，使 stream 失败或 incomplete 前已有 draft 时，app 能先提交 partial assistant record，再追加 error record。
- [x] 2.3 更新 agent 和 app 测试，覆盖 incomplete 无 draft、incomplete 有 partial draft、stream 异常有 partial draft，以及失败时不调用 `onComplete` 的语义。

## 3. 折叠长 streaming pending preview

- [x] 3.1 在 render 层为 streaming pending preview 增加基于 terminal rows 的动态高度预算，超过预算时显示折叠提示和尾部内容。
- [x] 3.2 保持 thinking pending 和短 streaming draft 的现有样式与布局语义不变。
- [x] 3.3 更新 render/footer/app 测试，确认长 streaming preview 不会无限增加 footer 高度，且最终 assistant record 仍保存完整 draft。
- [x] 3.4 在 app resize 路径记录 previous rows，并在 terminal rows 压缩时执行 destructive recovery；补充 streaming 期间快速 rows shrink 和 rows grow 不重放的回归测试。

## 4. 文档、规格与验证

- [x] 4.1 更新 `docs/README.md` 和 `docs/tui-architecture.md`，移除用户调 `maxOutputTokens` 的说明，补充长 streaming preview 折叠和 incomplete 处理语义。
- [x] 4.2 运行 `npm run build`、`npm run typecheck`、`npm test`、`find bin src test -name '*.js' -exec node --check {} \;` 和 `node --check dist/bin/echo-tui.js`。
- [x] 4.3 针对长输出和服务端 incomplete/配置缺失路径执行 `npm start` 手工验收，并记录是否仍出现重复 pending 内容。
