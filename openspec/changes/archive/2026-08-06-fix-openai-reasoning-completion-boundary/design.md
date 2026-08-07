## Context

OpenAI Responses 会以 `response.reasoning_summary_text.delta/done` 提供可读摘要分片，并以 reasoning `response.output_item.done` 提供单个 output item 的完整 summary。一个 provider turn 可能包含多个 reasoning item，当前若在每个 item 完成时发送累计全文的 complete，会把仍可能增长的 turn 级摘要重复提交到 append-only transcript。

provider-neutral `onReasoningUpdate(draft|complete)`、agent loop runtime 和 app 已经支持 transient draft 与唯一持久化 complete。此次变更只需修正 OpenAI Responses adapter 选择完成边界的方式，同时保证复用同一 stream reader 的 Codex 行为一致。

## Goals / Non-Goals

**Goals:**

- 将 OpenAI Responses 的可持久化 reasoning 完成边界统一为 `response.completed`。
- 继续使用 reasoning `response.output_item.done` 的完整 summary 校正实时 draft。
- 一个 provider turn 最多发送一次包含全部可读 reasoning parts 的 complete。
- 在 response 完成前失败、取消或不完整结束时只清理 transient draft，不提交 summary。
- 保持 reasoning summary 位于同一 provider turn 的最终 assistant 或工具记录之前。

**Non-Goals:**

- 不改变 OpenAI Chat compatible 和 Anthropic 的既有 reasoning 完成边界。
- 不改变 reasoning 配置、transcript record schema、provider-private continuation 或工具循环。
- 不展示 raw、encrypted 或 redacted reasoning。
- 不为缺失可读 reasoning 的 response 合成摘要。

## Decisions

### 1. 以整个 Responses response 作为唯一提交边界

stream reader 在消费事件期间只维护 turn 级 reasoning parts；reasoning `response.output_item.done` 更新对应 output index 的权威 summary，但仍发送 `draft`。只有 stream 已确认收到 `response.completed` 且成功结束后，reader 才合并全部 parts 并发送一次 `complete`。

未选择“按 output item 分别提交”，因为当前 `reasoning_summary` 表示 provider turn 的可读累计摘要，append-only transcript 无法在后续 item 到达时回写早期记录。也未在 runtime 增加去重或覆盖状态，因为 provider adapter 最了解 Responses 的事件边界，且 provider-neutral 层应继续只消费唯一 complete。

### 2. 保留 output index 与 summary index 的稳定聚合

`response.reasoning_summary_text.delta/done` 继续按 `(output_index, summary_index)` 聚合；reasoning `response.output_item.done` 到达时，先删除该 output index 的旧分片，再用 item 的完整 summary 重新建立对应 parts。最终 complete 使用相同排序规则生成权威全文，因此重复 item done 最多产生重复 draft，不会产生重复持久化事实。

### 3. complete 到达时不破坏已开始的正文预览

OpenAI Responses 的 complete 可能晚于 assistant 文本增量。app 现有 reasoning complete 处理只在当前 pending 为 thinking 或 reasoning preview 时清空 pending；若正文已进入 `streaming`，则保留正文 draft，同时追加 reasoning summary。runtime 随后按既有顺序提交 provider records、工具调用或最终 assistant，因而无需引入新的 pending 类型或重排 transcript。

### 4. 未完成 response 不提交 reasoning summary

`response.failed`、`response.incomplete`、取消、stream 异常或未收到 `response.completed` 的自然结束均沿既有错误路径退出，不执行流结束后的 complete。这样 partial reasoning 只存在于 footer pending，并由当前 turn 的失败或取消清理逻辑移除。

## Risks / Trade-offs

- [Risk] OpenAI Responses 的 reasoning summary 会比单个 item 完成时更晚落盘。→ Mitigation：item done 仍以 draft 更新预览；延迟只影响持久化边界，换取唯一且完整的 transcript 事实。
- [Risk] reasoning complete 到达时正文已经 streaming，错误清理可能覆盖正文 preview。→ Mitigation：保留现有 app 状态约束并补充对应顺序测试。
- [Risk] Codex 复用 Responses reader，完成时机也会随之改变。→ Mitigation：将其视为同协议边界，并在相关 adapter 测试中确认无回归。
- [Risk] 重复 `response.output_item.done` 造成重复预览通知。→ Mitigation：允许幂等 draft 刷新，但通过 turn-end 唯一 complete 保证不会重复落盘。
