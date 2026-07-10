## Context

`echo_tui` 当前把 provider 流式文本、function tool call 和本地工具结果投影为 append-only transcript。OpenAI Responses reasoning 模型可以在工具调用之间产生不可见 reasoning tokens；当模型只输出 tool call 而没有普通文本时，用户只能看到连续工具调用，缺少对模型意图的可见解释。

OpenAI Responses API 支持显式 `reasoning.summary`，并通过 stream 事件返回 `response.reasoning_summary_text.delta` / `response.reasoning_summary_text.done`。同时，OpenAI 文档建议在 function calling continuation 中把服务端返回的 reasoning output item 随后续 tool result 一起回传，以保留模型内部推理上下文。项目现有边界是 provider-neutral agent loop + OpenAI provider adapter，因此需要区分“给用户看的 reasoning summary”和“只给 OpenAI continuation 使用的 provider-private reasoning item”。

## Goals / Non-Goals

**Goals:**
- 通过模型 profile 的 `reasoning.summary` 配置显式开启 OpenAI reasoning summary。
- 在 TUI transcript 中展示并持久化 summary，使工具循环中也能看到模型思考摘要。
- 保证 summary 不被当作 assistant/user 内容回灌 provider，不影响后续对话语义。
- 在同一 agent run 的 OpenAI tool continuation 内保留 reasoning output item，并在下一次 Responses input 中回传。
- 保持现有 append-only transcript、工具审批、上下文压缩和 terminal redraw 语义。

**Non-Goals:**
- 不展示 raw `reasoning_text`，不暴露 chain-of-thought。
- 不默认开启 reasoning summary；未配置时请求形态保持现有行为。
- 不为非 OpenAI provider 设计通用 reasoning item 协议；provider-private continuation 状态只在 OpenAI adapter 边界内解释。
- 不改变工具调用审批规则，不新增第三方依赖，不切换 alternate screen。

## Decisions

### Decision 1: 新增可见 `reasoning_summary` transcript role

reasoning summary 是模型提供的可见摘要，但不是 assistant final answer，也不应作为 provider-facing assistant message 回放。因此新增 `reasoning_summary` role，并在 renderer 中使用低强调样式展示。

备选方案：把 summary 合并进 assistant 文本。放弃原因是会污染 provider 输入、破坏 assistant 回复语义，并让用户难以区分“思考摘要”和“最终回答”。

### Decision 2: summary 由 provider turn 结果返回，runtime 负责落盘顺序

OpenAI adapter 负责解析 stream 并返回 `reasoningSummary`；agent loop runtime 在每个 provider turn 后统一决定先追加 summary，再处理 assistant segment、tool calls 或 final answer。这样可保证工具循环中的顺序稳定：

```text
reasoning_summary? -> assistant segment? -> tool_call -> tool_result -> continuation
reasoning_summary? -> assistant final
```

备选方案：OpenAI adapter 直接触发 app callback。放弃原因是 provider adapter 不应知道 app transcript 落盘策略，也会绕过 runtime 的 continuation 顺序控制。

### Decision 3: provider-private reasoning item 不进入可见 transcript

OpenAI 返回的 `type: "reasoning"` output item 用于后续 Responses continuation。该 item 可能包含 provider-specific 字段，和 TUI 可见 transcript 不是同一层概念。runtime 可在内部 continuation records 中保留一个不可见 provider-private record，OpenAI transcript converter 识别后把原始 item 放回 Responses input；app callbacks 不会收到该 record，session persistence 不会保存它。

备选方案：把完整 reasoning item 持久化。放弃原因是它是 provider-specific 且可能包含 encrypted/private continuation payload；当前需求只需要同一工具循环内延续，不需要作为用户可见或跨 session 事实保存。

### Decision 4: 配置沿用 `reasoning` 对象

配置读取保持现有模型 profile 形态，在 `reasoning.effort` 旁新增 `reasoning.summary`。只有配置了 summary 时才发送请求参数；只配置 effort 时保持当前请求结构。

```json
{
  "reasoning": {
    "effort": "medium",
    "summary": "auto"
  }
}
```

备选方案：新增顶层 `reasoningSummary` 字段。放弃原因是 OpenAI API 本身把 summary 放在 `reasoning` 对象中，沿用该结构更直观。

### Decision 5: compaction 和 provider input 过滤 summary

`reasoning_summary` 是本地可见记录，不作为 provider input，不进入 compaction summary 输入，也不参与本地 token 估算。这样避免 summary 和后续 assistant answer 互相重复，也避免压缩摘要把 reasoning summary 当成事实依据。

## Risks / Trade-offs

- [模型或组织不支持 summary] → 只有用户显式配置时才发送；若服务端拒绝，沿用现有错误反馈路径，不做静默降级。
- [summary 过长导致 transcript 噪音] → 使用低强调渲染；显示层可以按现有宽度 wrap，不修改原始记录。
- [provider-private item 泄露到 session] → runtime 内部 record 不触发 app callback，persistence 只保存 app transcript records。
- [tool continuation 顺序错误影响 OpenAI] → 在 tests 中覆盖 reasoning item、function_call、function_call_output 的 input 顺序。
- [多段 summary delta/done 重复] → adapter 按 `output_index` + `summary_index` 累积，`done` 事件作为权威全文覆盖对应 part。

## Migration Plan

- 现有配置不包含 `reasoning.summary` 时行为不变。
- 旧 session 没有 `reasoning_summary` role；resume 继续按现有记录显示。
- 新 session 中的 `reasoning_summary` 是普通 append-only record，旧版本 TUI 若遇到未知 role 会忽略或无法显示；本 change 实现后提供正式渲染。
- 回滚时移除配置中的 `reasoning.summary` 即可停止请求 summary；已有 session 中的 summary records 仍是历史事实。

## Open Questions

- 是否需要后续提供 UI 开关来折叠/隐藏 reasoning summary？本次不做，保持总是显示已返回的 summary。
- 是否需要支持 `include: ["reasoning.encrypted_content"]` 以覆盖 `store: false` 或零数据保留场景？当前配置没有 `store`/ZDR 控制，本次仅回传服务端实际返回的 reasoning item。
