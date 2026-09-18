## Context

持久化 transcript 里的 tool 记录全部由 app 侧产生：`assistant-turn-runner.ts` 在 `onToolCall` 时只把调用放入 `TurnContext.pendingToolCalls`（footer pending preview），在 `onToolResult` 时由 `appendPendingToolResult()` 返回相邻的 `[tool_call, tool_result]` 并交给 `TranscriptContext.appendRecords()` 一次性落盘。runtime 的 `recordRegion` 只服务本次 run 的 provider 上下文，run 被 abort 后随栈丢弃。

Esc 中断链路是 `main.ts interruptActiveTurn()` → `AppContext.interruptActiveAssistantTurn()` → `TurnContext.interruptActiveAssistantTurn()`：abort turn signal、停 spinner、把完整 reasoning/assistant 草稿落成 partial records、`cancelAssistantTurn()` 追加本地中断提示并 `clearPending()`。此时 runtime 侧任何工具路径都会在 `onToolResult` 之前命中 `throwIfAborted`，runner 侧 `isCurrentTurn()` 也已因 `activeAssistantTurn` 置空而为 false，所以真实结果永远不会进入 transcript。

三个 provider converter 的重建规则决定了"调用不能单独保留"：OpenAI Chat 需要 assistant `tool_calls` 与 `tool` 消息配对，OpenAI Responses 需要 `function_call` 与 `function_call_output` 配对，Anthropic Messages 对没有 `tool_result` 的 `tool_use` 直接拒绝。因此遗留调用必须以合法 pair 收尾。

## Goals / Non-Goals

**Goals:**

- Esc 中断后，模型已发起的工具调用不再从 transcript 中成对消失；未完成调用以合法、可持久化、可恢复的 pair 收尾。
- 保持既有中断语义不变：立即释放 response lock、清空 pending preview、隔离迟到回调、追加本地中断提示。
- 补齐记录在一个 journal batch 内原子写入，`/resume` 恢复后可直接参与 provider 转换。

**Non-Goals:**

- 不改变 runtime `recordRegion` 随 run 丢弃的语义；中断后不再发起任何 provider 请求。
- 不为同轮尚未播报的兄弟调用补写记录。
- 不改变非中断失败路径（provider/工具硬失败）、BTW 侧 turn、headless `--once` 的收尾行为。
- 不新增 transcript role、不新增 `tool_result` details kind、不新增 renderer 分支。

## Decisions

**D1：在 app 侧合成补齐记录，而不是 runtime 侧。** pending 调用集合由 `TurnContext` 持有，且天然覆盖审批等待、提问等待和并行只读段；runtime 侧要补齐必须在 abort 后继续调用 app 回调，与"立即释放 response lock"和"迟到回调隔离"两条既有 requirement 直接冲突。runtime 在 abort 后不再发送请求，因此其 `recordRegion` 无需保持成对。

**D2：合成 record 不经过 `ToolExecutionResult`。** `ToolExecutionResult` 是按工具名区分的联合类型，通用形状无法合法套用到 `run_bash_command`、`apply_patch` 等分支；因此在 record 层直接构造 `ToolResultTranscriptRecord`，把文案常量与构造集中在 `src/tools/tool-transcript-record.ts`，与既有的 call/result record 工厂同处一地。

**D3：单个 batch 原子写入。** `TurnContext` 的 `TranscriptTurnBridge` 暴露 `TranscriptContext.appendRecords()`，补齐的 call/result 交替成组一次写入 journal，避免进程在两次写入之间退出产生真正的孤儿 `tool_call`。

**D4：返回契约与顺序。** `InterruptAssistantTurnResult` 增加 `interruptedToolRecords`；`main.ts` 渲染顺序为 reasoning → partial → 补齐 pairs（`renderRecords`）→ 本地中断提示。无 pending 调用时不产生该字段，既有调用方与测试语义保持不变。合成结果固定为 `ok: false`、`details: {kind: 'generic'}`、文本 `Tool execution was interrupted by the user before it returned a result.`。

**D5：覆盖范围只限已播报的 pending 调用。** 未播报的兄弟调用本来就不在 transcript 里，而下一轮 provider 请求完全由 transcript 重建，因此历史依然合法；要全量补齐需要 runtime 在执行前预播报整轮 tool call，会改变 footer pending 语义，本次不做。

**D6：渲染层无需新增分支。** pair renderer 以 `result.ok === false` 走失败样式；bash 等专属 renderer 在缺少专属 metadata 时回退通用渲染，不会伪造参数或结果。

## Risks / Trade-offs

- [合成文案被模型当成真实工具失败] → 文案明确 "interrupted by the user before it returned a result"，且 result 为失败态；不声明副作用是否已生效，模型不会默认调用成功。
- [工具实际已执行完毕，结果却在 abort 后到达] → 与既有语义一致（迟到结果本来就被丢弃）；本变更不改变副作用边界，change checkpoint 仍在中断时 finalize，`/diff` 与 `/undo` 能力不变。
- [同一次中断重复写入 pair] → runtime 所有工具路径都在 `onToolResult` 前 `throwIfAborted`，runner 侧还有 `isCurrentTurn()` 兜底；补齐只消费一次性清空的 pending 集合。
- [补齐记录改变既有测试断言] → `test/app/app-context.test.js` 的 pending 中断用例与本变更语义直接冲突，属于需要同步更新的规格化断言，而非放宽校验。
- [Anthropic 配对敏感] → 本变更把"调用消失"换成"调用成对补齐"，不会新增无 result 的 `tool_use`。
