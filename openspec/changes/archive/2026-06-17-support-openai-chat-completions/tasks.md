## 1. Agent 目录重组

- [x] 1.1 将 `src/agent/openai-agent.ts`、`src/agent/openai-transcript-converter.ts`、`src/agent/openai-tool-converter.ts` 迁移到 `src/agent/openai-responses/`，并更新导入导出路径。
- [x] 1.2 将 `src/agent/fake-agent.ts` 迁移到 `src/agent/fake/agent.ts`，并更新 app、runtime 和测试中的导入路径。
- [x] 1.3 更新 `agent-setup` 的装配入口，保持 `agentType: "openai"` 仍创建 Responses adapter，`agentType: "fake"` 仍创建 fake adapter。
- [x] 1.4 更新现有 OpenAI Responses、fake、agent loop、app 和 config 测试中的模块路径，确认目录重组不改变现有行为。

## 2. 配置与类型扩展

- [x] 2.1 将 `AgentType` 扩展为支持 `openai-chat`，并更新 OpenAI agent dependency 类型以覆盖 Chat client 结构。
- [x] 2.2 更新 LLM config 解析，允许 provider profile 使用 `agentType: "openai-chat"` 并保留 `openai` / `fake` 现有语义。
- [x] 2.3 为 `openai-chat` + `reasoning.effort` 或 `reasoning.summary` 增加明确配置错误，避免 reasoning 配置静默失效。
- [x] 2.4 补充 config 单元测试，覆盖 `openai-chat` provider 解析、agentType 错误提示和 Chat reasoning 配置拒绝路径。

## 3. Chat Completions 转换器

- [x] 3.1 新增 `src/agent/openai-chat/tool-converter.ts`，将本地 tool definitions 转换为 Chat Completions function tool schema。
- [x] 3.2 新增 `src/agent/openai-chat/transcript-converter.ts`，转换 `system` / `user` / `assistant` 普通消息并过滤本地-only records。
- [x] 3.3 在 Chat transcript converter 中支持把平铺的 `tool_call` records 聚合为 assistant message 的 `tool_calls`。
- [x] 3.4 在 Chat transcript converter 中支持把 `tool_result` records 转换为 role 为 `tool` 的 messages，并跳过缺失必要 metadata 的旧记录。
- [x] 3.5 补充 Chat converter 单元测试，覆盖普通消息、多工具调用、工具结果、缺 metadata 和 `openai_reasoning` 过滤。

## 4. Chat Completions Provider Agent

- [x] 4.1 新增 `src/agent/openai-chat/agent.ts`，创建 OpenAI SDK client 并校验 `chat.completions.create` 可用。
- [x] 4.2 实现 Chat request 构造：发送 `model`、`messages`、`stream: true`、可选 `tools`，不发送 Responses-only 字段或 `max_output_tokens`。
- [x] 4.3 实现 Chat stream 文本增量读取，累积 draft 并触发 `onToken(delta, draft)` 回调。
- [x] 4.4 实现 Chat stream tool call 分片聚合，按 choice/tool index 合并 id、function name 和 arguments，并返回 provider-neutral `ToolCall[]`。
- [x] 4.5 实现 Chat stream 完成、usage prompt tokens 捕获、SDK create 错误、stream 异常、服务端错误和 abort signal 处理，并复用敏感信息脱敏策略。
- [x] 4.6 补充 Chat agent 单元测试，覆盖纯文本 streaming、tool call streaming、usage、abort、错误脱敏和未完成 stream。

## 5. Runtime 集成

- [x] 5.1 在 `agent-setup` 中为 `agentType: "openai-chat"` 创建 Chat Completions adapter。
- [x] 5.2 补充 agent loop 集成测试，确认 Chat adapter 返回 tool calls 后仍由现有 runtime 执行工具、记录 tool result 并发起 continuation。
- [x] 5.3 确认上下文压缩 summary 请求可通过当前选中的 Chat adapter 正常运行，且缺失 provider usage 时仍使用字符估算兜底。

## 6. 文档与验证

- [x] 6.1 更新 `docs/README.md` 配置示例或说明，展示 `agentType: "openai-chat"` 的 OpenAI Chat Completions 兼容 provider 配置。
- [x] 6.2 更新或新增 OpenSpec 主规格同步所需的实现注释/测试说明，确保目录结构与 spec 保持一致。
- [x] 6.3 运行 `npm run typecheck`。
- [x] 6.4 运行 `npm test`。
- [x] 6.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 6.6 手动验证 `agentType: "openai"` Responses 配置仍可启动，`agentType: "openai-chat"` Chat Completions 兼容配置可完成文本流式响应和工具调用路径。
