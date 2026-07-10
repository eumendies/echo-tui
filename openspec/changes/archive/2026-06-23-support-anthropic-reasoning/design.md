## Context

`echo_tui` 已经有统一的 `reasoning.effort` 配置和 `/effort` 命令，但当前配置读取层只对 OpenAI provider 保留 effort，Anthropic model profile 中的 `reasoning` 会被忽略。Anthropic adapter 当前只发送基础 Messages API 字段，并在 stream 中聚合文本、tool_use 和 input token usage；它不会启用 adaptive thinking，也不会读取或回放 thinking/signature blocks。

Anthropic SDK 当前支持 `thinking` 配置和 `output_config.effort`。为了让 Anthropic reasoning 在普通回答与 tool call loop 中都正确工作，本变更需要同时覆盖配置读取、请求构造、stream thinking 聚合、可见 reasoning summary，以及 provider-only thinking block 的 transcript 续传。

## Goals / Non-Goals

**Goals:**

- Anthropic provider 支持读取 model profile 的 `reasoning.effort`，并按 Echo TUI 到 Anthropic 的上移一档映射发送 `output_config.effort`。
- 当 Anthropic reasoning effort 非 `none` 时，请求启用 `thinking: { type: 'adaptive', display: 'summarized' }`，让 Claude 返回可展示的 summarized thinking。
- Anthropic stream 中的 thinking 内容最终显示为现有 `reasoning_summary` block。
- 保存 Anthropic signed thinking 或 redacted thinking 为 provider-only transcript record，并在后续 Anthropic request 中回放，保护 tool call continuation。
- 保持现有 OpenAI reasoning 行为和 Anthropic 基础文本/tool_use 行为不变。

**Non-Goals:**

- 不新增 `max` 到 Echo TUI 的公开 `/effort` 列表；`xhigh` 仅在 Anthropic 边界映射为 `max`。
- 不实现 Anthropic Models API capability 探测；模型不支持 adaptive thinking 或 effort 时由 Anthropic API 返回错误。
- 不调整 Anthropic 默认 `max_tokens`，即使 high/xhigh/max effort 可能需要更大的输出预算。
- 不实现 thinking 的实时逐 token 展示；第一版复用现有 reasoning summary 完成后展示链路。

## Decisions

### Decision: 使用 adaptive thinking 而不是 manual budget thinking

当 `reasoning.effort` 非 `none` 时，Anthropic request 使用：

```json
{
  "thinking": { "type": "adaptive", "display": "summarized" },
  "output_config": { "effort": "..." }
}
```

选择原因：adaptive thinking 是当前 Anthropic 新模型推荐的 effort 控制方式，避免在本地维护 `budget_tokens` 与 `max_tokens` 的比例规则；`display: "summarized"` 明确表达 TUI 需要拿到可展示 thinking。替代方案是 `thinking: { type: "enabled", budget_tokens: N }`，但它需要硬编码预算，且预算必须小于 `max_tokens`，会和现有固定 `4096` 上限产生额外配置复杂度。

### Decision: Echo effort 到 Anthropic effort 上移一档映射

映射规则为：

- `minimal -> low`
- `low -> medium`
- `medium -> high`
- `high -> xhigh`
- `xhigh -> max`
- `none -> undefined`，不发送 thinking/output_config

选择原因：Anthropic 原生存在 `max`，用户期望 Echo TUI 的最高档 `xhigh` 对应 Anthropic 最高档；为了保持等级相对关系，其他等级顺次上移。替代方案是同名映射，但会让 `xhigh` 无法触达 Anthropic `max`。

### Decision: 区分可见 reasoning summary 和 provider-only thinking record

Anthropic stream 中的 `thinking_delta` 聚合为 `AgentTurnResult.reasoningSummary`，复用现有 app/render 链路展示；同时将带 `signature` 的 `thinking` block 或 `redacted_thinking` block 保存为 provider-only transcript record，例如 `anthropic_thinking`。

选择原因：`reasoning_summary` 是给用户看的本地可见事实，不应发送回 provider；Anthropic signed thinking block 则有 provider continuity 语义，特别是在 tool_use 之后继续请求时必须按 Anthropic content block 形式回放。OpenAI Responses 已经采用 provider-only `openai_reasoning` record 模式，Anthropic 可以沿用同类边界设计。

### Decision: Anthropic thinking record 由 Anthropic converter 独占消费

新增的 provider-only Anthropic thinking record SHALL 只由 Anthropic transcript converter 转换为 assistant content block。OpenAI converters、context estimation 和普通展示 SHALL 不把它当作用户可见消息。

选择原因：thinking signature/redacted data 是 provider 私有协议，不应污染其他 provider 的上下文，也不应作为普通 transcript 文本展示。替代方案是把 thinking 内容直接存为 `reasoning_summary` 并回放，但这会丢失 signature，且可能把不可发送的本地展示文本误送给 Anthropic。

## Risks / Trade-offs

- [Risk] 某些 Anthropic-compatible 网关或老模型不支持 `thinking` / `output_config.effort` → Mitigation: 仅在用户配置非 `none` effort 时发送；错误沿用现有 provider 错误脱敏路径展示。
- [Risk] `xhigh -> max` 可能显著增加 token 消耗或导致 `max_tokens` 截断 → Mitigation: 不改变默认上限，后续如有需要再单独设计 per-model `maxTokens` 配置。
- [Risk] Anthropic stream event 形态包含 thinking、signature、redacted thinking、tool_use 多种 block，聚合顺序容易出错 → Mitigation: 以 content block index 聚合 provider block，并用单元测试覆盖 thinking-only、thinking+tool_use、redacted thinking 场景。
- [Risk] provider-only thinking record 泄漏到其他 provider 或可见 transcript → Mitigation: 在 shared transcript 类型中明确 role，在非 Anthropic converter 的过滤列表中加入该 role，并让 renderer 不渲染未知 provider-only role。
