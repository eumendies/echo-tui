## Context

当前 assistant 正文 streaming 走的是 transient footer pending preview：`onToken` 更新完整 assistant draft，但直到 provider turn 成功完成后才追加最终 `assistant` transcript record。reasoning summary 则在 provider adapter 内部聚合，provider turn 结束后由 agent loop runtime 在 `onComplete` 前追加 `reasoning_summary` record。因此用户会先看到正文在 footer 中流动，随后 reasoning summary 才突然出现在 transcript 区域。

现有 provider 已经能在 stream 中看到不同形态的可读 reasoning 内容：OpenAI Responses 的 `response.reasoning_summary_text.delta/done`、OpenAI Chat compatible 的 `choices[].delta.reasoning_content`、Anthropic 的 `thinking_delta`。这些内容目前只被聚合成最终 summary，没有实时传给 app 层。与此同时，OpenAI encrypted reasoning item、Anthropic redacted thinking 等 provider-private continuation 数据不能作为明文 reasoning preview 展示。

## Goals / Non-Goals

**Goals:**

- 在不改变 transcript append-only 模型的前提下，让可读 reasoning 内容到达时实时显示在 footer pending preview 中。
- 使用顺序互斥的 reasoning preview 与 assistant 正文 preview；reasoning 完成后立即转为 transcript，再进入正文或工具阶段。
- 保持最终落盘顺序：`reasoning_summary` 始终先于同一 provider turn 的最终 assistant record 或 tool call；adapter 必须在自己的 stream 边界内发出唯一 complete。
- 兼容 OpenAI Responses、OpenAI Chat compatible 和 Anthropic 的可读 reasoning stream；对不可读、加密或 redacted 的 provider-private reasoning 安全降级为不展示。
- 继续遵守 footer 高度预算、Markdown/table projection、局部 redraw、resize recovery、取消和失败恢复约束。

**Non-Goals:**

- 不展示 raw chain-of-thought 或 provider 明确标记为 encrypted/redacted/private 的推理数据。
- 不把进行中的 reasoning preview 写入 transcript、session journal 或 provider-facing transcript input。
- 不改变 `reasoning.summary` 配置语义；没有配置或 provider 不返回可读 reasoning 时不强造内容。
- 不引入第三方 TUI 库、状态管理框架或新的渲染后端。
- 不尝试让 headless `--once` 提供交互式 reasoning preview；headless 仍以最终输出和现有可见记录为主。

## Decisions

### 1. 新增带阶段的“reasoning 更新”事件，而不是复用 `onToken`

provider 与 app 共用一个 reasoning 更新回调，使用 `draft` / `complete` discriminated union 传递当前 provider turn 的最新可见 reasoning draft 或权威完成文本。它与 assistant 正文 `onToken(delta, draft)` 分离：正文 token 只更新 assistant draft，reasoning draft 只更新 preview，reasoning complete 由 agent runtime 记录到内部 `recordRegion` 后原样转发给 app 提交 transcript。

选择“更新完整 draft”的语义，而不是只传 delta，是因为 OpenAI Responses 的 `reasoning_summary_text.done` 事件可能用权威全文覆盖之前的 delta 聚合结果；多 summary part 也需要按 `output_index` 和 `summary_index` 重新合并后给出稳定预览。若只传 delta，app 层需要理解 provider-specific 覆盖语义，违背 provider-neutral contract。

`AgentCallbacks.onReasoningUpdate(update)` 与 provider-turn callback 使用同一个事件类型。agent runtime 只负责在 complete 到达时记录内部 transcript 上下文并原样转发；app 根据 `kind` 把 draft 投影到 pending，或把 complete 追加为 `reasoning_summary`。不再使用单独的 summary callback、result 字段或去重状态。

### 2. provider adapter 只暴露可读 summary/thinking，不暴露 private reasoning

OpenAI Responses adapter 基于 `response.reasoning_summary_text.delta/done` 更新 preview，并在 reasoning `response.output_item.done` 到达时以该 item 的完整 summary 触发 complete；encrypted reasoning item 继续作为 provider continuation record 处理。OpenAI Chat compatible adapter 基于 `choices[].delta.reasoning_content` 更新 preview，并统一在首个正文或 tool call 输出前触发 complete；若整个 stream 只有 reasoning，则在 `finish_reason` 到达时触发 complete。Anthropic adapter 基于明文 `thinking_delta` 更新 preview，并在对应 thinking `content_block_stop` 到达时触发 complete；redacted thinking 只保留 provider 所需结构，不展示明文。

这样可以复用 provider 已承诺可展示的 summary/thinking 通道，同时避免把不可读或不应展示的数据误当成用户可见内容。

### 3. app 使用顺序互斥的 reasoning 与正文 pending 状态

assistant 响应期间使用两个明确状态：

- `reasoning_streaming`：当前可见 reasoning draft。
- `streaming`：当前 assistant 正文 draft。

reasoning draft 只更新 `reasoning_streaming`；complete 立即追加 transcript 并清空该状态；随后正文 token 或 tool call 进入各自 pending。provider adapter 必须在转发首个非 reasoning 输出前发出 complete，因此 app 不需要组合状态或共享预算。

### 4. reasoning 完成边界到达后立即落盘

reasoning draft 是 transient UI，不直接追加 transcript。provider adapter 发出 complete 后，agent loop runtime 把记录加入当前运行时上下文并将同一 complete 事件转发给 app；app 追加 `reasoning_summary` 并清空 reasoning pending。`AgentTurnResult` 不再返回相同 summary，runtime 不保存去重标记，也不在 provider turn 返回后补发完成事件。

这保留了 append-only、恢复和续传语义，同时让用户在正文仍在 streaming 时就能看到已完成的 `reasoning_summary` transcript。若完成后的正文流失败，已确认完成的 reasoning 与既有 partial assistant 一样作为已发生事实保留。

### 5. reasoning preview 独立接受 footer 高度预算

footer 继续由剩余高度预算约束当前单一 pending preview。reasoning 与正文分别使用各自现有的尾部折叠规则，不需要组合预算分配。

## Risks / Trade-offs

- [Risk] 某些不规范 Chat compatible 服务在正文后继续返回 reasoning。→ Mitigation: adapter 以首个非 reasoning 输出作为阶段边界，后续 reasoning delta 不再改变已提交 summary；这是 `reasoning_content` 扩展的统一本地契约。
- [Risk] OpenAI Responses `done` 全文与之前 delta 不完全一致，preview 可能短暂变化。→ Mitigation: callback 传递最新完整 draft，done 事件按权威文本重算 preview。
- [Risk] 长 reasoning preview 占用过多 footer 高度。→ Mitigation: reasoning preview 独立使用现有有界尾部折叠策略。
- [Risk] reasoning complete 后正文失败或取消。→ Mitigation: 已完成 reasoning 已作为 transcript 事实保留；尚未 complete 的 partial reasoning 仍只存在于 pending，并在失败/取消时清理。
- [Risk] 不同 provider 的 reasoning 字段语义并不完全一致。→ Mitigation: provider adapter 只输出“可读 reasoning preview draft”这一弱语义，最终 summary/continuation 仍由各 provider 适配器按原协议处理。
