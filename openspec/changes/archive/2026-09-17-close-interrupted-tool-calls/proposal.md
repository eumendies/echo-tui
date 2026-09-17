## Why

Esc 中断发生在 tool call 执行中、工具审批或 `ask_user_questions` 等待中、并行只读段中时，app 侧 `TurnContext.clearPending()` 会丢弃尚未取得 result 的 pending tool call，而 runtime 在 `executeToolCall()` 之后必然先 `throwIfAborted` 再回调 `onToolResult`。两侧叠加的结果是：模型已经发起的调用在持久化 transcript 里**成对消失**，后续 provider 请求再也看不到"模型调用过哪个工具"。

只保留 `tool_call` 也不可行：Anthropic Messages 对没有 `tool_result` 的 `tool_use` 直接报错，OpenAI 侧也会失去可配对的调用事实。因此需要在中断收尾时补一个合成的失败 result，让遗留调用以合法 pair 收尾。

## What Changes

- Esc 中断 active assistant turn 时，对仍在 pending（已播报、未取得 result）的 tool call，成对补写 `tool_call` + 合成 `tool_result`：`ok: false`、`details: {kind: 'generic'}`、文本 `Tool execution was interrupted by the user before it returned a result.`。
- 补齐记录 SHALL 以单个 journal batch 原子落盘，避免进程中断留下真正的孤儿 `tool_call`。
- 中断 transcript 顺序固定为：partial reasoning（如有）→ partial assistant（如有）→ 补齐的工具 pairs → 本地中断提示 record。
- 覆盖工具执行中、审批 surface 等待中、`ask_user_questions` 等待中、并行只读段与 `run_subagent`（`pair_after_execute`）执行中；同轮尚未播报的兄弟调用不补写。
- 非中断失败路径、BTW 侧 turn、headless `--once` 的既有行为不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `agent-loop-interruption`: "中断后不产生孤儿工具记录" 由"未完成调用只做 pending 清理"改为"未完成调用成对补齐 interrupted tool result"。
- `response-interruption`: "中断后的 transcript 结果" 增加未完成工具调用成对收尾与 record 顺序条款。
- `tool-message-rendering`: "并行工具完成后的成对历史投影" 的中断 scenario 由"不伪造 pair"改为"pending 清空 + 由 app 状态层补写稳定 pair"。

## Impact

- `src/tools/tool-transcript-record.ts`：新增中断 `tool_result` record 构造与文案常量。
- `src/app/state/turn-context.ts`：`TranscriptTurnBridge` 增加批量追加；`interruptActiveAssistantTurn()` 消费 pending tool calls 并返回补齐 records。
- `src/app/main.ts`：中断收尾渲染顺序增加补齐的 tool pairs。
- `docs/tui-architecture.md`：中断收尾顺序与 tool record 来源描述同步。
- 测试：`test/tools/tool-transcript-record.test.js`、`test/app/app-context.test.js`、`test/app/assistant-turn-runner.test.js`。
