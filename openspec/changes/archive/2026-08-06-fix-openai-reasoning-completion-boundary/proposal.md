## Why

OpenAI Responses 一次 provider turn 可能产生多个 reasoning output item，若在每个 `response.output_item.done` 到达时提交累计摘要，会把尚未结束的全文过早落盘并产生重复的完成事实。需要把该 provider 的唯一完成边界收敛到 `response.completed`，同时保留 output item 完成时对实时预览的权威校正。

## What Changes

- OpenAI Responses 在 reasoning `response.output_item.done` 到达时仅使用完整 summary 校正当前累计 draft，不触发 complete。
- OpenAI Responses 仅在 `response.completed` 后合并当前 provider turn 的所有 reasoning parts，并触发一次权威 complete。
- 明确 `response.completed` 前失败、取消或不完整结束时，reasoning draft 仍为 transient，不写入 transcript。
- 保持其他 provider 的既有 reasoning 完成边界、provider-private continuation 记录和 assistant/tool 输出语义不变。
- 同步主 Spec 与架构文档，并补充多 reasoning item、重复完成事件和失败边界验证。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 调整 OpenAI Responses 可读 reasoning 的唯一 complete 边界与失败语义。
- `terminal-tui-prototype`: 明确 reasoning 与正文交错时的 pending、落盘顺序和完成前失败清理行为。

## Impact

- 影响 `src/agent/openai-responses/agent.ts`，并间接覆盖复用 Responses stream reader 的 Codex adapter。
- 影响 OpenAI Responses reasoning stream 测试，以及 app/runtime 既有 reasoning 生命周期测试的契约表述。
- 需要同步 `docs/tui-architecture.md`；不引入新依赖，不改变公开 CLI、配置格式或 transcript record schema。
