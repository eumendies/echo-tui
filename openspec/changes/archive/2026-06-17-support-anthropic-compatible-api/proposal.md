## Why

当前 TUI 已支持 OpenAI Responses API、OpenAI Chat Completions 兼容接口和 fake provider，但无法直接连接官方 Anthropic Messages API 或 Anthropic-compatible 网关。用户希望在保持现有 provider-neutral agent loop、工具执行和终端交互体验不变的前提下，使用官方 Anthropic SDK 访问 Claude 系列或兼容 Anthropic 协议的模型服务。

## What Changes

- 新增 `agentType: "anthropic"` provider profile，支持通过用户级配置选择 Anthropic Messages API adapter。
- 使用官方 Anthropic SDK 创建 client，并支持 `apiKey`、可选 `baseURL` 和可选 `headers`。
- 新增 Anthropic transcript 转换：把本地 `system`、`user`、`assistant`、`tool_call`、`tool_result` records 投影为 Messages API 的 `system` 与 `messages`。
- 新增 Anthropic tool schema 转换：把 provider-neutral tool definition 投影为 Anthropic `tools` 的 `input_schema`。
- 新增 Anthropic stream 处理：消费文本增量、工具调用分片、usage input tokens、错误和取消信号，返回现有 provider-neutral `AgentTurnResult`。
- Anthropic provider 不支持现有 OpenAI Responses 专用 `reasoning.effort` 和 `reasoning.summary` 配置；配置读取应静默忽略这些字段，避免发送无效请求并保持 OpenAI Chat 兼容行为。
- 更新文档、测试和 OpenSpec 主规格，说明 Anthropic-compatible 配置方式和 adapter 行为。

## Capabilities

### New Capabilities
- `anthropic-compatible-llm-adapter`: 定义 Anthropic Messages API/compatible provider 的配置、transcript/tool 转换、流式请求和 stream 归一化行为。

### Modified Capabilities
- `streaming-llm-service-adapter`: 扩展真实 LLM adapter 配置和 provider 行为，新增 `anthropic` agent type，并约束 Anthropic provider 与现有 reasoning 配置、工具循环和上下文 usage 的交互。
- `typescript-build-test-pipeline`: 将新增 Anthropic agent 模块纳入 TypeScript 编译和测试路径稳定性要求。

## Impact

- 代码：`src/types/agent.ts`、`src/config/llm-config.ts`、`src/agent/agent-setup.ts`、新增 `src/agent/anthropic/*`，以及相关测试。
- 依赖：新增官方 Anthropic SDK 运行时依赖。
- 文档：更新 `docs/README.md` 的 provider 配置说明和 Anthropic-compatible 示例。
- 行为：用户可通过 `agentType: "anthropic"` 选择 Anthropic Messages API；app 层、render 层、tool executor 和 transcript 持久化格式保持 provider-neutral，不引入破坏性变更。
