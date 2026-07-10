## Why

当前 TUI 只在 `/context` 和 status line 中显示最近一次 provider request 的 context usage，用户无法回看每日 token 消耗，也无法区分缓存命中输入、未命中输入和输出 token。新增 `/usage` 可以把真实 provider usage 沉淀为本地账本，让用户在不离开 TUI 的情况下查看按天聚合的用量趋势和缓存收益。

## What Changes

- 新增 `/usage` slash command，打开只读 usage surface，展示每日 token 用量。
- 新增本地 token usage 持久化账本，按 provider 返回的真实 usage 记录每次模型请求的输入、缓存命中输入、缓存创建输入、未命中输入和输出 token。
- usage surface 采用 demo 风格的终端卡片和每日堆叠柱状图，但遵循项目现有 footer command surface、按键处理、主题和布局约束。
- 扩展 provider usage 采集，统一 OpenAI Responses、OpenAI Chat compatible 和 Anthropic compatible adapter 的输入缓存与输出 token 字段。
- `/context` 继续表示最近一次上下文窗口占用；`/usage` 表示历史账本式用量统计，两者语义保持分离。

## Capabilities

### New Capabilities
- `usage-command`: 定义 `/usage` slash command、token usage 持久化账本、每日聚合和 usage surface 行为。

### Modified Capabilities
- `streaming-llm-service-adapter`: provider adapter 需要在现有 usage 回传基础上提供完整的输入缓存和输出 token usage，供 `/usage` 账本记录。

## Impact

- `src/types/agent.ts` 的 provider usage 类型需要补充输出 token 字段并统一缓存字段语义。
- `src/agent/openai-responses/agent.ts`、`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts` 需要解析各 provider 的 usage 字段。
- `src/agent/agent-loop-runtime.ts` 或 app callback 边界需要把每次真实 provider usage 记录到本地账本。
- 新增 `src/persistence/` 下的 usage store，用于 append-only JSONL 持久化和按天读取聚合。
- 新增 `/usage` command handler、command surface 类型、footer renderer 和对应测试。
- 不引入第三方 TUI 库，不改变 transcript 持久化语义，不把 prompt、API key、headers 或 provider 请求内容写入 usage 账本。
