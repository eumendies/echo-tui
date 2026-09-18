## Why

`src/render/app-renderer.ts` 已增长到 778 行（上一轮 shell 实时投影变更 +19%），单文件同时承载 6 类职责：transcript records → block 分组渲染、assistant/reasoning 运行期增量确定状态机、shell 运行期增量确定状态机、subagent append 状态与并行过滤、门面生命周期与快照拼帧、展示净化。`src/render/blocks.ts` 同样达到 1053 行，其中包含与"渲染函数"无关的 shell 运行期扫描状态机。继续扩展（新增 live 通道、新增 record role）会持续堆叠在同一个文件里，评审与定位成本上升。

## What Changes

- render 层按职责拆分模块，`app-renderer.ts` 收敛为单一门面，对外契约（`createAppRenderer`、`sanitizePendingDisplayText`、`types/render.ts` 的 `AppRenderer`）保持不变：
  - `src/render/transcript-renderer.ts`：稳定 records → blocks（tool pair 聚合、subagent run 分组、role dispatch、record 展示净化、subagent append 状态与过滤）。
  - `src/render/live/streaming-renderer.ts`：assistant 正文/reasoning 运行期增量确定状态机（owner 键控、footer 尾部注入、快照重算）。
  - `src/render/live/shell-renderer.ts`：shell 运行期增量确定状态机，并把 `blocks.ts` 中的扫描/确定 helper（`ShellLiveOutputState`、`scanShellLiveOutput`、`takeShellStableContent` 等）迁入该模块。
- `blocks.ts` 只保留消息行/block 渲染 primitives，为 live 模块导出 `renderShellMessageLines` 与 `renderShellBlockLines`。
- destructive 路径的调用顺序（推进 shell 游标 → 计算 streaming 稳定文本 → 拼帧）保持不变；不新增生产分支或测试专用参数。
- 不改变任何可见行为、终端语义、transcript/持久化格式、provider 投影与配置格式。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `terminal-tui-prototype`：「模块边界」需求新增 render 层内部按职责拆分与命名约束，并把新模块纳入建议目录结构；同时保留"app 层通过单一 renderer 门面触发渲染"与"视觉与终端行为稳定"的既有约束。

## Impact

- 受影响代码：`src/render/app-renderer.ts`、`src/render/blocks.ts`，新增 `src/render/transcript-renderer.ts`、`src/render/live/streaming-renderer.ts`、`src/render/live/shell-renderer.ts`。
- 受影响测试：`test/render/app-renderer.test.js` 与 `test/render/subagent-renderer.test.js` 的 `renderTranscriptLines` 导入迁移；`test/render/blocks.test.js` 中 shell 运行期用例迁入新增 `test/render/shell-renderer.test.js`；`test/app/app-context.test.js` 的 shell pending 断言随 `commandLine` 字段更新。
- 保持不变：`test/app/fixtures/main-*-scenario.js` 对 `createAppRenderer` 的注入、`AppRenderer` 契约、全部可见输出。
- 文档：`docs/tui-architecture.md` 的 render 模块表与渲染路径描述同步。
