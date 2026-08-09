## Context

当前 TUI 有两类输出：transcript record 通过 `app-renderer` 执行“clear footer → append block → redraw footer”，而 assistant/reasoning streaming draft 只存在于 footer pending，由 activity tick（约 100ms）反复重绘。长 draft 超过 footer 预算后会折叠头部，导致用户在生成期间看不到已经流出的历史。

把 streaming 前缀写入 terminal scrollback 是不可逆操作。它比“reasoning summary 最终只提交一次”还需要更强的不变量：后续 token、provider 校正、工具 segment 切换和 terminal resize 都不能改变已写出的内容或顺序。

约束：不切换 alternate screen；不引入第三方 TUI 库或新运行时依赖；transcript record 仍是事实源；in-flight committed projection 只是 turn 状态；resize 仍走 destructive full replay。

## Goals / Non-Goals

**Goals:**
- 正常长正文不再折叠：稳定前缀进入 terminal scrollback，footer 只显示尚未 visibly committed 的尾部；已稳定但仍 queued 的 source 在 drain 成功前也留在 footer。
- reasoning 按当前完整 preview 的纯文本视觉行边界增量确定；最终显示顺序始终位于对应正文/tool block 之前。
- 每个 assistant segment 独立维护确定进度，工具循环中不重复、不串段。
- token 高频更新继续节流，结构性事件不会遗漏尚未 drain 的内容。
- 完成、中断、失败、偏好切换、resize、BTW 切换前后可见投影与 records 一致。

**Non-Goals:**
- reasoning 最后一个仍可能增长的视觉行继续留在 footer；其余完整视觉行不等待 provider done。
- 不保证单个未闭合的超长 Markdown 块零折叠。
- 不改 transcript schema 或持久化格式。
- 不把 in-flight committed projection 提前写成 transcript record。

## Invariants

1. **Source-prefix invariant**：只推进 source offset；物理行只按当前 width/theme 临时投影，不作为跨 resize 的事实。
2. **Stable-projection invariant**：已确定 source prefix 在追加后续 source 时，其完整 record 投影前缀不变。
3. **Segment invariant**：正文 committed cursor 仅属于当前 provider segment；`onAssistantSegment` 落盘后重置。
4. **Ordering invariant**：第一个正文 token 到达时 reasoning 显示阶段已经结束；系统先把最后一个 reasoning 视觉行写入 scrollback，再开始正文尾部。reasoning record 是否已落盘不阻止正文显示。
5. **Drain invariant**：queued commit 只在成功 append 到当前可见 projection 后推进 visible cursor；在此之前 queued source 仍属于 footer 可见尾部，不能提前从 preview 消失；record finalize 使用完整内容直接补齐尾部，插入型 record 前同步 drain。
6. **Projection-owner invariant**：任一时刻 terminal 只接受 main 或 BTW owner 的增量 append；隐藏 owner 只更新状态。
7. **Record invariant**：正常完成或 partial record 保存完整对应 draft；增量确定只改变渲染方式，不改变事实文本。

## Decisions

### 1. Markdown 使用共享判定的 source boundary scan

streaming 边界不能只依赖当前私有 `parseMarkdownBlocks()` 的 block kind。实现提供语义等价的 source boundary scan API，并与最终 renderer 共享 fence/table 判定，不维护第二套 block AST。

以下内容不可确定：
- draft 最后一个 block；
- 未闭合 code fence；
- table header candidate、header + 不完整 delimiter、仍可扩展的 table；
- table 后只有空白行而没有后续非空 block；
- 任何 parser 标记为 incomplete 的 block。

只有 table 后出现非空 block，table 才成为稳定前缀。这样后续 row 不会改变已提交列宽。`markdown` fence 内 table 也使用相同递归口径。

### 2. TurnContext 只保存当前 assistant segment 草稿

agent loop 每次 provider `runTurn` 的 `draft` 都从空字符串开始。工具调用前 `onAssistantSegment(draft)` 提交的是当前 segment，下一次 provider run 是新的 segment。

`TurnContext` 只保存当前 assistant 与 reasoning 的完整草稿。Markdown 稳定边界由 renderer 在 activity tick 中按当前草稿临时计算；已经写入终端历史区的文本也由 renderer 按 main/BTW owner 分别维护。segment finalize 时使用完整草稿创建 record，并通知 renderer 按内容类型补写尚未显示的部分，之后清空草稿。禁止把正文显示进度跨 segment 延续。

### 3. Reasoning 使用纯文本视觉行边界

reasoning 使用纯文本 renderer。provider-neutral reasoning update 只需表达当前全文和最终 complete；app 按当前 terminal width 把除最后一个仍可能增长的视觉行外的 source 前缀视为可提交，不要求 adapter 暴露额外稳定边界。

- OpenAI Responses：delta/done 更新当前完整 preview；`response.output_item.done` 可用完整 item 校正 preview；`response.completed` 才发唯一 complete。
- OpenAI Chat：reasoning content 在正文/tool delta 前结束；该边界可先 complete/finalize。
- Anthropic：thinking block stop 后该 block 完成；之后可 complete/finalize。

reasoning 使用纯文本 renderer，不存在 Markdown table/fence 的重新解释。app 按当前宽度扫描 source，提交最后一个视觉行之前的全部前缀；最后一行留在 footer 继续增长。根据 provider 协议约束，reasoning draft 只追加，不维护修正检测或恢复分支。

### 4. Reasoning record 只由 provider complete 创建

正常流程只在 reasoning `complete` 到达时创建 reasoning summary record。`onAssistantSegment`、`onToolCall` 和 `onComplete` 只处理各自事件，不再兜底消费 reasoning 草稿。provider adapter 负责在协议确定的 reasoning 结束边界发送唯一 complete。

第一个正文 token 到达时先结束 reasoning 显示阶段，把当时已有 reasoning 的最后视觉行写入终端历史区；这一步不创建 record。正文开始后，迟到的 reasoning draft 仍更新完整事实草稿，但 renderer 不再把新增部分追加到当前历史区。provider 的唯一 complete 到达后，使用完整 reasoning 文本创建 reasoning summary record；若正文已开始，该 record 只结束 reasoning 显示状态而不补写迟到尾部。只有 provider 失败或用户中断时，runner 才使用尚未完成的 reasoning 草稿创建 partial record。

### 5. Activity tick 批量追加，record 渲染直接完成流式内容

`onToken` 与 reasoning draft callback 只更新完整草稿，不直接计算 Markdown 边界。app 组合根持有唯一约 100ms 的 activity timer；每个 tick 只把当前可见且仍在计时的 Main 或 BTW `RenderState` 交给 renderer。renderer 根据完整草稿、当前宽度和自己记录的已显示文本，计算本次可追加内容，并在同一终端帧中追加稳定行、更新 footer。

`onReasoningUpdate(complete)`、`onAssistantSegment`、`onComplete` 和失败收尾把已经落盘的 assistant/reasoning record 传给统一 `render` 入口。assistant record 使用完整内容直接补写未显示尾部；reasoning record 在正文尚未开始时补写尾部，正文开始后只清理显示状态，避免迟到 reasoning 插入正文。普通输入、状态变化、首个正文 token 以及 provider retry/compaction notice 前也调用同一入口；普通 records 继续由 `renderRecords` 成组投影，以保留 tool pair 语义。

只有 renderer 成功完成 terminal write 后才更新其已显示文本。BTW 活跃时主会话仍可更新草稿，但 main 不把状态交给 renderer；退出 BTW 后清屏重绘会根据主会话最新草稿重新计算当前可显示内容。

### 6. 正文投影差分与 record suffix 分离

source prefix 使用最终 record 的**正文消息 renderer**，包括角色前缀、ANSI 样式、wrap 和 Markdown block 空行，但不包含只有 record finalize 时才成立的尾部 spacer。增量 append 是“新正文投影减去已确定正文投影”的差分；如果提前写入 record suffix，后续正文会需要插到 suffix 之前，违反 append-only。

pending tail 需要知道自己位于 record 中间：首行 continuation prefix 与样式必须与完整正文投影对应位置一致，不能重新显示第二个角色前缀。record finalize 时先补写剩余正文，再恰好追加一次最终 block renderer 所需的尾部 spacer。测试比较“分批正文 append + finalize suffix”的完整行序列与“一次性最终 record block 投影”。

### 7. Renderer 管理终端显示进度，不持有 transcript 事实

`app-renderer` 提供统一 `render(renderState)`。调用方只传入当前完整渲染状态；renderer 负责计算稳定文本、与已显示文本比较、清除旧 footer、按需追加新行并恢复 footer。renderer 按 main/BTW owner 保存的只是终端显示进度，不是 transcript 事实。

`renderDestructive` 从 records 与当前完整 pending 状态，在当前 width/theme 下重新计算完整界面和流式显示进度；不得保存或复用旧宽度下的物理行数。

### 8. 完成、segment、失败与中断

- 正常完成：reasoning record 已由 provider complete 创建；若 complete 晚于正文开始，它不会在实时投影中补写迟到尾部。随后追加完整 assistant record，只补写剩余正文行。
- 工具 segment：完成当前 assistant segment 后追加 tool records；下一 provider run 从新 segment 状态开始，不消费 reasoning 草稿。
- 中断/失败：使用尚未完成的 reasoning 草稿创建 partial reasoning summary record，使用完整当前 assistant 草稿创建 partial assistant record；若正文尚未开始则补写 reasoning 尾部，正文已开始则只保存事实，随后补写正文尾部并追加 notice/error。
- 若 reasoning 从未可见或为空，不创建 partial reasoning record。

这保证已经给用户展示的内容在 resize/persistence 后仍有对应事实，也不会丢弃未确定但已经在 footer 展示的尾部。

### 9. `showReasoningSummary` 语义

偏好关闭时：
- reasoning 不增量确定到 terminal scrollback；
- 现有 transient footer preview 可继续有界显示；
- reasoning summary record 照常提交，但 transcript/destructive replay 不渲染。

运行中从 true 切到 false 时，现有 destructive recovery 移除已焊入 reasoning 投影并使可见 cursor 与隐藏状态脱钩；从 false 切到 true 时，同一次 destructive recovery 按当前视觉行边界重投影 reasoning，并把 visible cursor 同步到该边界，后续 activity drain 只追加新增 source。spec 不承诺“屏幕完全不出现 transient reasoning”。

### 10. Main 与 BTW 的终端显示隔离

renderer 分别保存 main 与 BTW 的流式显示进度。BTW 激活后终端只显示 BTW：
- side activity 可以把 BTW 稳定内容写入终端历史区；
- 后台 main callback 继续更新 main 草稿，但不得调用 main 的 renderer activity 入口；
- 退出 BTW 后清屏重绘使用最新 main records 与完整 pending 草稿，并同步 renderer 的 main 显示进度；
- 关闭 BTW 会丢弃 side records 与草稿，迟到 callback 由 identity 检查忽略；下一次打开 BTW 时清屏重绘会重置 BTW 显示进度。

### 11. 性能与失败边界

多数 token 只更新末块，不跨稳定边界；跨界 commit 仍由 activity tick 合并。parser 可以扫描全文作为首版实现，但测试应覆盖长 draft；只有出现实际性能问题后再引入增量 parser cache。

terminal writer 异常不应提前消费 source cursor。现有 stdout API 没有异步确认，本 change 以同步 `write()` 不抛错作为成功边界。

## Risks / Trade-offs

- reasoning preview 依赖 provider 的追加顺序约束；若 provider 会回写已展示前缀，需要另行引入显式稳定边界。
- Markdown boundary scan 与最终 renderer 判定分叉会破坏稳定性：通过共享 fence/table 判定函数和逐 token fixtures 约束。
- record renderer 的尾部 spacer 容易重复：通过完整最终投影等价测试约束。
- BTW 隐藏 main commit 会推迟显示：退出 BTW 的 destructive replay 会恢复完整主投影。
- 状态比原 footer-only draft 更复杂：source cursor、segment reset、owner 和 drain 不变量集中在 turn context/controller，不让 renderer 持有业务事实。
