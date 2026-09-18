## 1. shell 运行期投影模块

- [x] 1.1 新建 `src/render/live/shell-renderer.ts`，搬入 `ShellLiveOutputState`、`createShellLiveOutputState`、`scanShellLiveOutput`、`takeShellStableOutput`、`getShellCommittedOutputText`、`createShellEchoText`、`renderShellEchoContent`、`takeShellStableContent`、`renderShellCommittedLines`、`renderShellCompletionContent`。
- [x] 1.2 在 `src/render/blocks.ts` 导出 `renderShellMessageLines` 与 `renderShellBlockLines` 两个渲染 primitive，并删除已迁出的 shell 运行期代码。
- [x] 1.3 在 `live/shell-renderer.ts` 实现 `ShellLiveRenderer` 类：`commitDeltas`、`injectHistory`、`snapshotLines`、`takeCompletion`、`reset`（单实例状态，shell 只从 main composer 提交）。
- [x] 1.4 `app-renderer.ts` 改为委托 `ShellLiveRenderer`，删除原有 shell 私有方法与 `ShellLiveCommitState`；`prepareRenderState` 组合 shell 注入。
- [x] 1.5 迁移测试：`test/render/blocks.test.js` 中的 shell 运行期用例与 `test/app/app-context.test.js` 的 shell pending 断言随 `commandLine` 字段更新。

## 2. streaming 运行期投影模块

- [x] 2.1 新建 `src/render/live/streaming-renderer.ts`，搬入 `DisplayedStreamingText`、`StreamingDisplayState`、稳定文本计算、`finalizeRecord` 补写与 owner 状态管理。
- [x] 2.2 实现 `StreamingLiveRenderer`：`commitDeltas(options, finalizeRecord)`、`injectHistory`、`snapshotLines`，保持既有 spacing 与 reasoning 关闭语义。
- [x] 2.3 `app-renderer.ts` 改为委托该模块，`render()` 与 `renderDestructive()` 保持原调用顺序（live 快照 → footer 注入 → 拼帧）。
- [x] 2.4 运行 `npm run typecheck` 与 `npm test`，确认 streaming/终断/失败路径行为不变。

## 3. transcript 投影模块

- [x] 3.1 新建 `src/render/transcript-renderer.ts`，搬入 block 类型、`sanitizeRecordDisplayText`、`renderTranscriptLines`、`renderTranscriptBlocks`、`groupTranscriptRecords`、`renderTranscriptBlock`、`renderRecordBlock`、`getUserDisplayText`、`splitRenderedBlock`。
- [x] 3.2 搬入 subagent append 状态与过滤：`SubagentAppendRenderState`、`createSubagentAppendRenderState`、`trackParallelSubagentRecords`、`rebuildSubagentAppendState`、`prepareSubagentAppendRecords`、`filterParallelSubagentRecords`、`collectParallelSubagentRunIds`、`createSubagentToolCallKey`。
- [x] 3.3 `app-renderer.ts` 保留 `subagentAppendState` 实例并改为调用模块函数；`renderRecords`/`renderDestructive` 行为不变。
- [x] 3.4 更新 `test/render/app-renderer.test.js` 与 `test/render/subagent-renderer.test.js` 的 `renderTranscriptLines` 导入到新模块（不做 forwarding re-export）。

## 4. 快照帧拼装（复核后撤销独立模块）

- [x] 4.1 （已撤销）曾新建 `src/render/snapshot-renderer.ts` 承载 banner 行、destructive 帧序列与 final 渲染；复核后按"避免无收益抽象"收回 `app-renderer.ts` 内联并删除该模块。
- [x] 4.2 一并删除无调用方的 `renderFinal`（`AppRenderer.renderFinal` 契约、`RenderFinalOptions`、实现、测试 wrapper 与 4 个 fixture 桩）。
- [x] 4.3 确认 `renderDestructive` 的 live 行顺序为 streaming 行在前、shell 行在后，且光标行计算与重构前一致。

## 5. 验证与文档

- [x] 5.1 `npm run typecheck`
- [x] 5.2 `npm test`
- [x] 5.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.4 `openspec validate refactor-render-module-decomposition --strict`
- [x] 5.5 `docs/tui-architecture.md` 同步 render 模块表（新增模块行、app-renderer/blocks 职责收敛）与渲染路径描述。
- [x] 5.6 交互式手工验证（真实 TTY）：assistant 流式正文与 reasoning 增量确定、shell 实时投影与 completion 补写、resize destructive replay、BTW 往返、`/resume` 回放。
