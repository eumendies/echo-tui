## Context

shell mode 当前的可见投影只有两条通道：运行期是 footer 里的临时 pending preview（`renderShellOutputPendingLines`），结束后才由 `renderRecords` 把一条 `shell` record 一次性渲染成完整 block 追加进终端历史区（`renderShellBlock`）。由此产生三个问题：

1. `TurnContext.beginShellCommand` 只写入 `shellOutputDraft` 却不进入 pending 态，而 `getPending()` 以 `pendingKind` 为门槛，因此提交后的首帧没有任何 shell 反馈；命令要等第一个输出 chunk 才出现，静默长命令运行期间只剩 spinner。
2. 输出再长也只体现为反复重绘的预览窗口：预览按 footer 预算做尾部截断，`$ command` 首行在输出变长后被摘要行替换；滚出预览的中间内容在运行期没有任何可回看形态。
3. 唯一真正进入终端历史区的内容是完成后的整块 record，所以"命令与输出"在执行结束前不会出现在滚动区。

assistant 正文与 reasoning 已经有一套成熟纪律（`incremental-streaming-commit`）：stable 前缀在 activity tick 中增量确定到 terminal scrollback，footer 只保留尚未成功 drain 的尾部，destructive recovery 按当前宽度把 records 与 in-flight source 一起重投影。本变更把同一纪律扩展到 shell 输出，并复用既有 owner 隔离与单帧单写约束。

关键既有事实（实现依据）：

- `shell` record 的 `text` 由 `formatShellRecordText` 生成：`$ <command>`（shell-local 追加 ` [local]`）+ 空行 + 合并输出 + error/timeout/truncated/exit 尾注；ctx 超限时输出部分换成 `formatShellOutput` 的 marker + 尾部。
- record 展示前统一经过 `sanitizeRecordDisplayText` → `sanitizeTerminalText`（CRLF 归一、孤立 CR 删除）；而 shell 的 pending preview 有意保留原始 CR 以播放进度条语义（`sanitizePendingDisplayText` 对 `shell_output` 原样放行）。
- activity tick 由 `main.ts` 的 100ms 共享时钟驱动，`render()` 已在同一入口完成 assistant/reasoning 的稳定前缀确定；footer 的清理、内容追加与新帧绘制是单次 `output.write()`。
- shell 命令是独占的：response lock 生效期间只可能有一条在跑的 shell 命令；运行期不会产生其他 transcript record。
- shell 提交只从 main composer 进入（`ComposerSubmissionController`），BTW 只继承 normal/plan 回答语义（`btw-conversation-controller.ts` 的 `interactionMode: 'normal' | 'plan'`）。

## Goals / Non-Goals

**Goals:**

- 命令提交后首帧即把 `$ <command>` 投影写入终端历史区，不再依赖第一个输出 chunk。
- 运行期由 activity tick 把输出中已稳定的完整行增量确定到终端历史区；footer pending preview 只保留尚未确定的尾部。
- 保持"分批投影 == 一次性渲染最终 record block"的显示等价性：正常完成、Esc 中断、失败路径都只产生一条 append-only `shell` record，且历史区投影不重复、不丢失。
- destructive recovery（列宽变化、BTW 往返等）按当前宽度重投影 records 与 shell in-flight source。
- 运行期输出仍不进入 provider context，shell ctx/local 上下文边界、runner 捕获/截断/offload 语义、bash tool 行为全部不变。

**Non-Goals:**

- 不修改 runner 的捕获上限、offload 触发与 marker 文本，也不修改 `formatShellRecordText` 的 record 结构。
- 不引入"回改已写行"能力：历史区只允许追加，分歧场景不删除已投影内容。
- 不改变 shell ctx/local 的 provider context 边界；运行中输出仍只本地可见。
- 不改变 footer 对未确定尾部保留原始 CR 的播放语义。
- 不引入 record 级渲染缓存等无关优化；不新增第三方依赖。

## Decisions

### 1. 三阶段投影模型：echo → 稳定行增量确定 → completion 补写

一次 shell 执行的可见投影固定分三步，历史区写入序列恒为最终 record block 投影的连续前缀：

1. **echo（结构性，即时）**：`beginShellCommand` 之后的首个 `render()` 中，renderer 检测到 shell pending 且尚未 echo，就把 `$ <command>[ [local]]` 连同 block 的前导空行写入历史区，并记录 echo 已写。
2. **运行期增量确定（activity tick）**：每个 tick 计算"已稳定"边界（见决策 2），把边界之后新增的行投影追加到历史区；footer pending preview 只渲染边界之后的原始文本（未确定尾部）。
3. **completion 补写（结构性，即时）**：`renderRecords` 收到该 `shell` record 时按决策 4 补写后缀投影，并恰好追加一次 record 尾部 spacer。

等价性不变量：把每一步写入的投影依次拼接，SHALL 等于 `renderShellBlock(record.text)` 的一次性完整投影（ctx 超限分歧例外见决策 4）。该不变量是测试的字节级主判据。

替代方案：把整段输出攒到 completion 再追加（即现状的超集）不解决"运行期不可回看"；只在 footer 折叠里做文章（方案 A）无法让内容进入滚动区。均不采纳。

### 2. 稳定边界按"净化文本的最后一个完整行"定义，raw/sanitized 双游标维护

- **确定口径**：进入历史区的文本使用与 record 相同的 `sanitizeTerminalText` 口径（CRLF 归一、孤立 CR 删除）。稳定边界 = 净化后文本中最后一个 `\n`（含）之前的内容；最后一行可能继续增长或被 CR 覆盖，必须留在 footer。
- **预览口径**：footer 未确定尾部保留原始文本（CR 不净化），维持既有进度条播放语义。
- **双游标**：shell commit 状态记录 `{sanitizedCommittedLength, rawCommittedOffset}`。净化是流式删除变换，对累积文本存在前缀单调性（`sanitize(acc₁)` 恒为 `sanitize(acc₂)` 前缀）；增量扫描只处理自上次边界之后的 delta，并用 1 个字符 carry 处理跨 chunk 的 CRLF，tick 成本 O(delta)。
- 未确定尾部的 raw 起点 = `rawCommittedOffset`，renderer 通过 `prepareRenderState` 注入 pending（与 assistant/reasoning 注入 `historyText` 同构），footer 只渲染该起点之后的原始文本。

替代方案一：直接把 raw 文本写入历史区（保留 CR 播放）。终端回放 CR 会覆盖当前行，历史区最终可见结果与 record/replay 的净化口径不一致，且可能破坏已写行的视觉稳定性；否。

替代方案二：预览也渲染净化文本（单一游标）。实现更简单，但进度条类输出会在 footer 里退化成 `50%60%100%` 的拼接噪声；否。

### 3. shell commit 状态由 renderer 持有，按投影 owner 隔离

状态落在 `DefaultAppRenderer`（与 `streamingByOwner` 同构，按 owner 键控），不放进 `TurnContext` 或 footer：

- 只有 renderer 同时掌握"已写入终端的投影"与"最终 record block 渲染"两侧知识，才能保证补写等价；
- `TurnContext` 保持纯状态语义（draft/pending），footer 保持纯投影语义；
- 只有 pending 进入当前可见投影（owner=main）时才写历史区；BTW/view 期间只保留状态不写入，恢复时由 destructive replay 重建，与 `incremental-streaming-commit` 的 owner 隔离要求语义一致。

状态最小形态：`{echoCommitted: boolean, sanitizedCommittedLength: number, rawCommittedOffset: number}`，在 shell record completion 或 destructive replay 后按决策 4/5 校准。

前置修复（同层）：`TurnContext.beginShellCommand` 进入 `pendingKind='shell_output'`，并让 pending 携带 `commandLine`（`src/tools/shell-transcript-record.ts` 的 `formatShellCommandLine` 是命令行文本的唯一来源），保证首帧 echo 条件成立且 echo 文本与 record 首行逐字节一致。

### 4. completion 补写规则与 ctx 超限分歧

`renderRecords` 处理 shell record 时（此时 pending 已被 `finishShellCommand` 清空，状态只在 renderer）：

1. 无 commit 状态（快速命令早于首个 tick、或 replay/fork 后由 `renderRecords` 直接追加）→ 按既有行为完整渲染 block，一次性投影。可见结果与今天一致。
2. 有状态且 `sanitize(record.text)` 以已确定文本为前缀 → 只补写该前缀之后的部分（剩余输出 + error/timeout/truncated/exit 尾注），并恰好追加一次 record 尾部 spacer。
3. 有状态但前缀校验失败——当前唯一成因是 ctx 模式输出超过 64 KiB 触发 offload：已确定的是**头部**（accepted chunk 直到上限），而最终 record 是 marker + **尾部**。此时以 echo 边界为基准补写最终 record 的剩余投影（marker + 尾部 + 尾注），已确定头部保留为运行期投影，不重复命令行也不删除已写行。

分歧场景是本变更唯一允许的"运行期投影 ≠ record 投影"偏差，与今天"预览显示头部、record 显示尾部"的信息缺口同源；transcript、replay、provider 投影仍严格以 marker + 尾部为准，并在 shell-mode spec 中显式声明。

替代方案：分歧时在历史区插入"记录视图开始"之类的本地提示行。会让滚动区出现 record 中没有的行，破坏 replay 一致性；不采纳（列为 Open Question 待评审）。

### 5. destructive recovery 纳入 shell in-flight source

`renderDestructive` 的完整快照扩展为：records + （存在活跃 shell commit 状态时）echo + 已确定文本投影；并把 footer 的未确定尾部继续交给 pending preview。文本游标（sanitized 长度/raw 偏移）与宽度无关，重投影后不变量保持：

- 恢复后滚动区文本内容与恢复前一致（物理行数随新宽度重排）；
- 后续 tick 从同一游标继续增量确定，不重复、无空洞；
- 列宽变化时 `\n` 之前的已确定文本按新宽度重排即可，因为确定边界只落在逻辑行边界上。

### 6. 时钟与写入纪律不变

- echo 与 completion 补写属于结构性状态变化，即时绘制；
- 运行期增量确定只发生在 activity tick 触发的 `render()` 路径，沿用 footer 的单次 `output.write()` 帧写入，不新增逐 chunk redraw；chunk 回调仍只更新 `TurnContext` 的 draft。

### 7. 测试策略

- **等价性主判据（renderer 级）**：用 fake output 捕获写入序列，驱动"echo → 多次 tick → completion"，断言滚动区文本等于一次性 `renderShellBlock(record.text)` 投影；覆盖：仅命令无输出、`printf` 无换行、多行输出跨 chunk、CR 进度条、Esc 中断尾注、ctx offload 分歧。
- **状态级**：`beginShellCommand` 后 `getPending()` 立即返回 shell pending；pending 的 `commandLine` 与 record 首行一致。
- **清理与回放**：快速命令无 tick 直接 completion；destructive replay（列宽变化、BTW 往返）后不重复/不丢失；`/resume`、`/fork`、`/undo` 等 replay 路径不触发增量状态。
- **既有测试适配**：`blocks`/`footer` 中"preview 含命令行"的断言按新口径更新为"仅未确定尾部"。

## Risks / Trade-offs

- [ctx 超限时历史区头部与最终 record（marker + 尾部）不一致] → 限定为唯一允许偏差，completion 按最终 record 呈现且不重复 echo；spec 显式声明；transcript/replay/provider 投影不受影响
- [raw/sanitized 双游标映射错误导致重复或丢失行] → 增量推进 + 1 字符 carry；以"分批 == 一次性"字节级等价测试兜底；completion 前缀校验失败时不再信任游标而按分歧路径处理
- [tick 扫描大输出造成性能回退] → 只处理 delta、只搜索新增文本中的最后一个 `\n`，不做全量 join/净化；与 assistant streaming 的 tick 成本量级一致
- [footer 预览不再显示命令行，用户可能误以为命令丢失] → echo 在提交后首帧即进入历史区，命令始终可见；footer 只在有未确定尾部时占行
- [预览宽度与历史区宽度口径不同（原始 CR 文本）导致视觉跳跃] → 未确定尾部本就只在 footer 播放且完成时按净化口径落入历史区，与既有 completion 行为一致
- [既有测试大量断言 preview 内容] → 在实现任务中集中更新 `test/render/blocks.test.js`、`test/render/footer.test.js`、`test/app/app-context.test.js`

## Migration Plan

1. 前置状态修复：`TurnContext.beginShellCommand` 进入 pending 态并携带 `commandLine`（唯一格式化点迁至 `src/tools/shell-transcript-record.ts`）；`main.ts` 提交时传入 includeInContext。
2. renderer 增量确定：新增 shell commit 状态与 echo/稳定前缀投影；`prepareRenderState` 注入未确定尾部起点。
3. completion 补写与分歧处理；destructive replay 纳入 shell in-flight source。
4. footer/blocks 预览口径改为"仅未确定尾部"。
5. 测试：等价性主判据、状态级、清理/回放、边界用例；更新既有断言。
6. 文档：`docs/tui-architecture.md` shell 子流程与渲染路径。
7. 验证：`npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`、`openspec validate stream-shell-output-into-terminal-history --strict`；交互式手工验证见 tasks。

回滚：改动集中在 `turn-context`、`types/render`、`main.ts`、`app-renderer`、`blocks`、`footer` 六个文件，无持久化格式、配置或 CLI 变化，回滚只需还原代码。

## Open Questions

- ctx 超限分歧时是否需要在新投影前加一行本地提示（如"[output truncated: 以下为记录视图]"）？当前决策为不加，保持"历史区只包含 record 投影与运行期前缀"的最小口径，待评审确认。
