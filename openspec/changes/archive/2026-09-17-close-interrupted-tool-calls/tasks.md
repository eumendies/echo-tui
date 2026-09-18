## 1. 合成结果记录

- [x] 1.1 `src/tools/tool-transcript-record.ts` 新增中断结果文案常量 `Tool execution was interrupted by the user before it returned a result.`
- [x] 1.2 新增 `createInterruptedToolResultTranscriptRecord(call)`，直接构造 `tool_result` record（`ok: false`、`details: {kind: 'generic'}`），不经过 `ToolExecutionResult` 联合类型
- [x] 1.3 `test/tools/tool-transcript-record.test.js` 覆盖该 record 的完整形状与文本

## 2. 中断收尾补齐

- [x] 2.1 `src/app/state/turn-context.ts` 的 `TranscriptTurnBridge` 暴露 `appendRecords`，使 call/result 可在同一 journal batch 落盘
- [x] 2.2 `interruptActiveAssistantTurn()` 在 partial assistant 落盘之后、本地中断提示之前消费 `pendingToolCalls`，成对构造并一次性追加补齐 records
- [x] 2.3 `InterruptAssistantTurnResult` 增加 `interruptedToolRecords`；无 pending 调用时不产生该字段，保持既有返回值形状
- [x] 2.4 `src/app/main.ts` 中断渲染顺序改为 reasoning → partial → 补齐 pairs（`renderRecords`）→ notice

## 3. 测试

- [x] 3.1 更新 `test/app/app-context.test.js` 既有 pending 中断用例：断言 transcript 出现相邻 `tool_call`+合成失败 `tool_result`、随后才是本地中断提示
- [x] 3.2 新增多 pending 调用（并行顺序与 provider 顺序一致）与"无 pending 调用不受影响"用例
- [x] 3.3 `test/app/assistant-turn-runner.test.js` 增加执行中 Esc 集成用例：补齐 pair 出现在 transcript，迟到真实 result 不再追加
- [x] 3.4 断言补齐 call/result 以单次批量追加落盘（journal 只出现一次 records 追加）
- [x] 3.5 新增 `test/app/fixtures/main-interrupted-tool-pair-scenario.js` 与 `test/app/main.test.js` 用例，在真实组合根上验证 Esc 收尾顺序与 journal 单批落盘

## 4. 文档与归档

- [x] 4.1 `docs/tui-architecture.md` 同步中断收尾顺序、tool record 来源与 mermaid 中断分支描述
- [x] 4.2 实现与验证完成后归档 change，把三个 delta 合并进 `openspec/specs/`

## 5. 验证

- [x] 5.1 `npm run typecheck`
- [x] 5.2 `npm test`
- [x] 5.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.4 手工验证：长命令执行中 Esc、审批等待中 Esc、并行只读段中 Esc、`/resume` 后 pair 可见且下一条 provider 请求正常
