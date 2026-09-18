## Context

`app-renderer.ts` 778 行内的职责分布（行号基于重构前文件）：

| 职责 | 位置 | 约行数 | 形态 |
| --- | --- | --- | --- |
| block/pending/streaming/shell/subagent 类型定义 | 22–70 | ~50 | 纯类型 |
| pending & record 展示净化 | 73–152 | ~80 | 纯函数（`sanitizePendingDisplayText` 对外导出） |
| assistant/reasoning 增量确定状态机 | 173–245 + `render()` 相关段 | ~100 | owner 键控状态 + 提交/补写 |
| shell 增量确定状态机 | 247–331 | ~85 | owner 键控状态 + 提交/补写 |
| subagent append 状态与并行过滤 | 418–426、564–629 | ~90 | 跨批次共享可变状态 |
| 门面与快照 | 333–502 | ~170 | 生命周期 + destructive 帧 ANSI 拼装 |
| transcript 分组/渲染（role dispatch） | 520–778 | ~260 | 纯函数 |

`blocks.ts` 1053 行中，约 170 行属于 shell 运行期扫描/确定（`ShellLiveOutputState`、`scanShellLiveOutput`、`takeShellStableOutput`、`getShellCommittedOutputText`、`createShellEchoText`、`renderShellEchoContent`、`takeShellStableContent`、`renderShellCommittedLines`、`renderShellCompletionContent`），与消息行渲染混在一起。

对外契约与耦合点（决定拆分边界）：

- 门面契约：`createAppRenderer`、`sanitizePendingDisplayText`、`types/render.ts` 的 `AppRenderer`；4 个 `test/app/fixtures/main-*-scenario.js` 会 monkey-patch `createAppRenderer`。
- 测试直接依赖：`renderTranscriptLines`（`app-renderer.test.js`、`subagent-renderer.test.js`）、`sanitizePendingDisplayText`（`control-chars.test.js`）、shell live helper（`blocks.test.js`、`app-context.test.js`）。
- destructive 调用顺序：先推进 shell 确定游标，再计算 streaming 稳定文本，最后拼帧；顺序错误会破坏 shell 尾部注入与快照一致性。

## Goals / Non-Goals

**Goals:**

- 把 render 层按"投影对象"拆分为职责单一、命名自解释的模块，`app-renderer.ts` 收敛为组合门面（目标 ~310 行）。
- 让 shell 运行期状态机与其扫描 helper 同址，`blocks.ts` 回到"只负责把文本渲染成行"的边界。
- 行为零变化：可见输出、终端序列、transcript/persistence、provider 投影与配置格式全部保持字节级等价。

**Non-Goals:**

- 不引入通用 live 通道抽象或注册表：streaming 与 shell 的稳定边界与补写语义不同（Markdown 前缀 vs 整行边界），统一抽象属于过度设计。
- 不改变 `AppRenderer` 契约、不移动 `createAppRenderer`、不新增测试专用入口。
- 不做与本次无关的重构（例如 `markdown.ts`、footer surface 的进一步拆分）。
- 不改变渲染顺序、视觉样式或任何用户可见文案。

## Decisions

### 1. 门面保留契约，内部按投影职责拆分

拆分后依赖方向单向：

```
app-renderer.ts（门面）
  ├─ live/streaming-renderer.ts ─┐
  ├─ live/shell-renderer.ts ─────┼─→ blocks.ts / control-chars / layout
  ├─ transcript-renderer.ts ─────┴─→ blocks / tool-message-renderer / subagent-renderer
```

`blocks.ts` 不再包含运行期状态机；`live/*` 与 `transcript-renderer` 不反向依赖 `app-renderer`，无环。

### 2. `live/` 子目录 + `-renderer.ts` 命名

两个运行期投影模块放入 `src/render/live/`（`streaming-renderer.ts`、`shell-renderer.ts`），与仓库既有的 `footer/`、`tool-message-renderers/` 家族目录风格一致；文件名带 `-renderer` 后缀，明确其渲染职责。`transcript-renderer.ts`、`snapshot-renderer.ts` 与既有 `subagent-renderer.ts`、`tool-message-renderer.ts` 同级平铺。

### 3. 状态实例归属：live 类各自持有，subagent append 状态由门面持有

- `StreamingLiveRenderer` 持有 owner 键控 `Map`（主会话与 BTW 都有流式通道）；`ShellLiveRenderer` 持有单实例状态：shell 命令只从 main composer 提交，BTW 仅继承 normal/plan，`shell_output` pending 不会进入其他 owner 的投影，owner 键控属于无收益的抽象。两者对外暴露 `commitDeltas`、`injectHistory`、`snapshotLines`（shell 另有 `takeCompletion`、`reset`）。门面在 `render()` / `renderDestructive()` / `renderRecords()` 中按既有顺序调用，`prepareRenderState` 变为两个 `injectHistory` 的组合。
- `SubagentAppendRenderState` 的语义是"增量批次之间共享的可变状态"，继续由门面持有单一实例，`transcript-renderer.ts` 只提供 `createSubagentAppendRenderState`、`trackParallelSubagentRecords`、`rebuildSubagentAppendState`、`filterParallelSubagentRecords` 等函数，避免引入无收益的状态类。
- `snapshotLines` 内部先推进确定游标再返回快照行，消除门面"调用并丢弃返回值"的写法；调用顺序约束（先 live 快照、后 footer 注入）由门面保持。

### 4. `blocks.ts` 只保留渲染 primitives

为 live 模块导出两个低层渲染函数：`renderShellMessageLines`（消息行渲染）与 `renderShellBlockLines`（block 行结构）；shell 运行期状态机、echo/输出分片 content、completion 补写与分歧判定整体迁入 `live/shell-renderer.ts`。record 展示净化（`sanitizeRecordDisplayText`）随 transcript 投影迁入 `transcript-renderer.ts`；`sanitizePendingDisplayText` 留在门面作为输入边界守卫（对外导出，位置不变）。

### 5. 快照帧拼装保留在门面内联（撤销独立模块）

destructive 全屏帧（清屏 + 逐行写出 + 光标定位）与 banner 行拆分只服务门面自身，没有第二个调用方。实现阶段曾抽成独立 `snapshot-renderer.ts`，复核后按"避免无收益抽象"的口径收回 `app-renderer.ts` 内联，并一并删除无调用方的 `renderFinal` 契约（`AppRenderer.renderFinal`、`RenderFinalOptions`、实现、测试 wrapper 与 4 个 fixture 桩）。若未来出现独立演进需求（alternate screen 变体、分区重绘、更细的尺寸恢复策略），再按当时收益重新评估。

### 6. 行为等价用既有测试做护栏，分四步搬运

每步只做"代码搬家 + 导入更新"，不修改任何文案与输出；每步结束运行 `npm run typecheck`、`npm test`、`node --check`。测试迁移遵守"测试适配运行时代码"：`blocks.test.js` 的 shell 运行期用例迁入新 `test/render/shell-renderer.test.js`，`renderTranscriptLines` 的导入改到新模块（不做 forwarding re-export）。

## Risks / Trade-offs

- [搬运过程中行为漂移] → 分四步、每步全量测试；不顺手改文案/格式；`test/render/app-renderer.test.js` 的集成用例覆盖 render/renderRecords/renderDestructive 全路径
- [模块间循环依赖] → 依赖方向写死在门面（见决策 1），`blocks.ts` 不引用 `live/*`；`npm run typecheck` 与 `node --check` 兜底
- [`blocks.ts` 导出面扩大] → 只新增两个已被 `renderShellBlock` 使用的低层渲染函数，语义与既有 `renderAssistantMessageLines` 等一致
- [测试导入迁移遗漏] → 逐文件 `grep` 校验 `renderTranscriptLines`/shell helper 引用点；typecheck 会直接暴露遗漏
- [新模块首版职责再次膨胀] → 每个模块在 design 中限定职责范围；后续新增 live 通道时按同一结构扩展，不回到门面堆叠

## Migration Plan

1. `live/shell-renderer.ts`：搬入 shell 状态机与 `blocks.ts` 扫描/确定 helper；`blocks.ts` 导出两个 primitives；门面改为委托。
2. `live/streaming-renderer.ts`：搬入 streaming 类型、状态与 `render()` 内相关计算；门面 `prepareRenderState` 变为注入组合。
3. `transcript-renderer.ts`：搬入 block 分组/role dispatch/record 净化/subagent append 状态函数；更新测试导入。
4. 快照帧拼装与 banner 行拆分保留在 `app-renderer.ts` 内联（复核后撤销独立模块），并删除无调用方的 `AppRenderer.renderFinal` 契约。
5. 测试迁移与文档同步（`docs/tui-architecture.md` 模块表与渲染路径描述），运行完整验证。

回滚：逐步骤独立可回滚（每步只涉及模块搬迁），无持久化、配置或 CLI 变化。
