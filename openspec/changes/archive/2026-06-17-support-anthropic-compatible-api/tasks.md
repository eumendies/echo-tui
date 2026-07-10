## 1. 依赖与配置

- [x] 1.1 在 `package.json` 中新增官方 `@anthropic-ai/sdk` 运行时依赖，并更新 lockfile。
- [x] 1.2 将 `AgentType` 扩展为包含 `anthropic`，并新增 Anthropic agent dependency 类型。
- [x] 1.3 更新 LLM 配置解析，接受 provider profile 的 `agentType: "anthropic"`、`apiKey`、可选 `baseURL` 和可选 `headers`。
- [x] 1.4 收紧 reasoning 配置投影：仅 `agentType: "openai"` 的模型 profile 可向运行时输出 `reasoning.effort` 和 `reasoning.summary`，Anthropic/OpenAI Chat 配置时静默忽略。
- [x] 1.5 更新 provider 装配逻辑，使 `createConfiguredAgent` 能根据 `anthropic` 创建 Anthropic provider agent。

## 2. Anthropic Provider Adapter

- [x] 2.1 新建 `src/agent/anthropic/` 模块结构，包含 `agent.ts`、`transcript-converter.ts` 和 `tool-converter.ts`。
- [x] 2.2 实现 Anthropic transcript converter：system 顶层合并、user/assistant 文本 messages、tool_use/tool_result content blocks、过滤本地和 OpenAI-only records。
- [x] 2.3 实现 Anthropic tool converter：将 provider-neutral `ToolDefinition` 映射为 `{name, description, input_schema}`，不做 OpenAI strict schema 投影。
- [x] 2.4 实现 Anthropic request 构造：发送模型名、system/messages、协议必需 `max_tokens`、可选 tools，并排除 OpenAI-only 字段。
- [x] 2.5 实现 Anthropic SDK client 创建：使用 `apiKey`、可选 `baseURL`、可选默认 headers，并保留测试可注入 client seam。
- [x] 2.6 实现 Anthropic stream 文本增量处理，累积 draft 并触发 `onToken(delta, draft)`。
- [x] 2.7 实现 Anthropic tool_use stream 聚合，按 content block index 汇总 id、name 和 input JSON 分片，返回 provider-neutral `ToolCall[]`。
- [x] 2.8 实现 Anthropic usage、完成、服务错误、SDK create 错误、stream 异常和 abort signal 处理，并复用敏感信息脱敏策略。

## 3. 测试覆盖

- [x] 3.1 新增 Anthropic tool converter 测试，验证 optional schema 不被强制 required 或 nullable。
- [x] 3.2 新增 Anthropic transcript converter 测试，覆盖 system 顶层合并、普通消息、tool_use/tool_result、过滤本地 records 和不完整工具记录。
- [x] 3.3 新增 Anthropic request 构造测试，验证 tools、`max_tokens`、baseURL/headers、取消信号和 OpenAI-only 字段排除。
- [x] 3.4 新增 Anthropic stream 测试，覆盖文本增量、工具调用分片、usage input tokens、正常完成、工具 continuation、异常和 abort。
- [x] 3.5 更新 config 测试，覆盖 `agentType: "anthropic"`、非 Responses reasoning 配置忽略、provider headers 和 model selection。
- [x] 3.6 更新 agent loop/app 层相关测试，确认 Anthropic provider 可通过现有 provider-neutral tool loop 和 context usage 回调工作。

## 4. 文档与规格同步

- [x] 4.1 更新 `docs/README.md`，新增 Anthropic-compatible provider 配置示例和 `agentType` 说明。
- [x] 4.2 更新主规格中 streaming LLM adapter 的 provider、reasoning、Anthropic stream 和 callback 行为描述。
- [x] 4.3 更新主规格中 TypeScript build/test pipeline 的 agent 模块列表和语义稳定描述。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`。
- [x] 5.2 运行 `npm test`。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
