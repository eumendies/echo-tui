## Context

交互式 TUI 把 transcript 作为 append-only 历史区，把 pending preview、composer 和 status line 作为可重复擦除的 footer。普通 footer redraw 会先根据上一帧的高度和逻辑光标位置清除旧 footer，再从同一顶部位置输出新布局并恢复光标。

当前响应期间同时存在两套刷新源：spinner 以 100ms 周期调用 `renderFooter()`，assistant token 与 shell output chunk 又通过 50ms streaming timer 调用同一路径。高频阶段因此会重复解析最新 Markdown draft、清除整块 footer 并输出新布局。与此同时，`createFooterRenderer().render()` 先由 `clearPrevious(true)` 写出清除序列，再单独写出新布局，终端模拟器可能观察到两次 stdout write 之间的短暂空白。

该调整必须继续遵守当前终端、ANSI 控制序列、无 alternate screen、footer 高度有界、resize 可 destructive recovery，以及完成/失败/中断时 pending draft 不丢失的约束。

## Goals / Non-Goals

**Goals:**

- 将 assistant token 与 shell chunk 的高频更新合并到单一 100ms 活动刷新时钟，避免两套 timer 对同一 footer 重复重绘。
- 在每个周期 tick 投影最新 pending 快照，允许一个周期内到达的多个增量自然合并。
- 保持结构性事件的即时刷新与流式收尾正确性。
- 让一次普通 footer redraw 通过一次 `output.write()` 连续发送旧帧清理和新帧绘制序列。
- 用稳定的 controller/renderer 测试覆盖刷新次数、最终状态、光标和高度变化，不依赖脆弱的完整终端快照。

**Non-Goals:**

- 不实现逐行 diff、cell diff 或终端帧缓存算法。
- 不使用 alternate screen、DEC synchronized output 等支持度不一致的终端扩展。
- 不改变 provider 的 token callback 频率、draft 累积方式或 transcript 持久化格式。
- 不改变 Markdown、表格、代码块、主题或 footer 布局的可见样式。
- 不承诺一次 stdout write 在所有终端模拟器中具备严格的显示原子性。

## Decisions

### 1. 复用单一活动刷新时钟处理高频 pending 更新

移除独立的 50ms streaming render timer 及其窗口锚点。assistant `onToken` 和 shell `onOutput` 只更新 `TurnContext` 中的最新 draft；响应期间已经运行的 100ms activity/spinner timer 负责调用 `renderFooter()`。spinner 帧本身也是按 100ms 推导，因此该时钟可以同时推进动效和输出最新 pending 快照。

选择 100ms 而不是保留 50ms，是因为终端中的流式文本在 10 FPS 下仍具有连续感，并可把当前高频阶段最多两套并行刷新源收敛为一套。一个 tick 之间的所有 token/chunk 都只保留在最新状态中，下一帧直接显示累计结果。

备选方案是保留 `scheduleStreamingRender()` 并把间隔调大到 100ms；该方案仍维护两套 timer 和取消状态，无法消除时钟竞争与重复 tick，因此不采用。另一备选方案是使用每个增量触发的 debounce；持续流可能不断推迟尾帧，且 spinner 仍需要独立 interval，因此也不采用。

### 2. 仅合并高频数据事件，结构性事件继续即时绘制

tool call、approval、user question、reasoning summary、assistant segment、complete、error、interrupt 和 resize 会改变 footer surface、transcript 边界或响应生命周期，继续沿用即时 append/redraw。模型解析和 usage 等低频状态更新也不依赖下一次 token 才显示。

assistant 完成、失败或中断时先停止活动时钟，再通过现有 transcript append 或显式 footer render 绘制最终状态。shell 完成同样通过最终 shell record append 重绘。这样即使响应在首次周期 tick 前结束，最终内容仍会可见。

备选方案是所有响应事件都等待周期 tick；该方案会让审批 surface、工具状态和完成反馈产生不必要延迟，并增加 timer 停止时遗漏最后一帧的风险，因此不采用。

### 3. 将 footer 清理改为无副作用的 ANSI 序列生成

footer renderer 保留 `previousHeight` 与 `previousCursorRow`。旧 footer 的清理逻辑改为只构造字符串，不在内部写 stdout：隐藏光标、移动到旧 footer 顶部、逐行清除、再回到顶部。`render()` 将该清理字符串与新布局字符串、光标恢复字符串拼接后一次传给 `output.write()`，最后更新 remembered layout。

独立 `clear()` 仍调用同一序列生成逻辑，但自己执行一次 write 并重置 remembered layout。新旧 footer 高度不同时，仍按旧高度清除全部旧行，再从旧 footer 顶部写新布局，避免残留。

备选方案是让 `output.write()` 继续分两次调用但依靠 `cork()/uncork()` 合并；这会把行为依赖于具体 stream 实现，测试替身和非标准输出流不一定支持，因此不采用。

### 4. 暂不引入行级增量绘制

行级 diff 可以进一步减少输出字节，但必须处理 ANSI 样式、宽字符、自动换行、footer 高度变化、逻辑光标和 resize recovery，风险显著高于本次目标。当前方案只改变调度和写入边界，复用已经验证的整块 footer 定位算法，便于回滚与验证。

## Risks / Trade-offs

- [首个流式增量最多等待约 100ms 才显示] → 保留用户提交后的 thinking/working 状态即时绘制；完成路径仍同步绘制最终内容。若手动验证认为首字延迟不可接受，再单独评估仅首 token 立即 flush，而不恢复持续 50ms timer。
- [活动 timer 的语义与 spinner 生命周期耦合] → 在命名和注释中把它表述为响应活动刷新时钟，测试 assistant 与 shell 生命周期都会启动该时钟；不让 token callback 隐式负责 timer 生命周期。
- [一次 write 不等于严格终端原子帧] → 本次只承诺减少 stdout 写入边界和中间空窗，不引入兼容性不确定的 synchronized-output ANSI 扩展。
- [完整 Markdown draft 每 100ms 仍会重新解析] → 刷新频率已减半并移除重复时钟；增量 Markdown 解析不在本次范围，后续用性能数据决定是否优化。
- [旧 trailing timer 在结构性事件后晚到并覆盖 surface] → 删除独立 streaming timer 及相关取消状态，从根源消除该类晚到 callback；结构性事件仍同步绘制当前快照。

## Migration Plan

1. 先调整 footer renderer 的序列生成和单次 write，并用 renderer 测试确认光标及高度行为不变。
2. 再移除 streaming render timer 状态和配置，将 assistant token、shell chunk 改为仅更新 pending draft。
3. 增加 turn/controller 测试，确认周期 tick 合并增量，完成、失败和中断均绘制最终内容。
4. 运行完整自动验证，并由用户在真实终端中比较高吞吐 streaming、shell 输出和交互 surface 的频闪情况。

如需回滚，可分别恢复 footer 双阶段 write 和 streaming timer；两部分不改变持久化数据或外部配置，无数据迁移要求。

## Open Questions

- 100ms 首字延迟是否在目标终端中可接受，需要通过 fake/real streaming 手动验证确认。
- 单次 write 后若仍有明显频闪，下一阶段应优先评估行级 redraw，还是终端支持探测后的 synchronized output，需要基于实际终端和输出 trace 决定。
