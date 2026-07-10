## Context

当前应用已经保存最近一次 provider 返回的真实 context usage，并在 status line 中以 `ctx <used>/<window>` 的短文本展示。该 usage 来自 agent loop 中 provider 返回的 `usageInputTokens`，语义是“最近一次真实 provider request 的 input tokens”，不是本地实时估算。

`/context` 需要在此基础上展示更细的分类构成。难点在于 provider 只返回总 input tokens，不返回 system prompt、tools、messages、reasoning 的分项；同时 system prompt、工具定义、压缩摘要和 reasoning carry-over 都是 runtime/provider request 层临时组装的内容，并不完整存在于 app transcript 中。

因此本设计把 `/context` 定义为“最近一次 provider request 的真实总量 + 本地估算分类占比”：总量以 provider usage 为准，分类以 request 快照估算后校准到真实总量。

## Goals / Non-Goals

**Goals:**

- 提供 `/context` 命令，展示最近一次 provider context usage 的分类占用。
- 保持 status line 现有短文本语义不变。
- 将 breakdown 计算放在 agent request 构造附近，避免 command handler 重建 provider request。
- 将分类 token 总和校准为 provider `usageInputTokens`，保证 UI 数字一致。
- 复用 demo 的视觉结构：总量 header、窗口占用 gauge、分类 composition bar、分类明细、任意键关闭。
- 无 provider usage 时只提示暂无真实 usage，不做实时估算冒充真实值。

**Non-Goals:**

- 不实现 provider tokenizer 级别的精确审计。
- 不显示额外 `Overhead` 分类；协议包装开销按估算占比分摊到五类。
- 不改变 compaction 阈值策略。
- 不把 `/context` 输出写入 transcript。
- 不为 agent bash tool 或 shell live output 引入额外 context 统计。

## Decisions

### 1. 总量使用 provider 真值，分类使用估算后校准

`usedTokens` 继续来自 provider 返回的 `usageInputTokens`。分类先通过本地 `estimateTextTokens` 对 request component 估算，再按比例缩放到 `usedTokens`，最后用 largest-remainder 修正取整误差，保证 segment token 总和等于 `usedTokens`。

备选方案是直接展示估算总量，但这会与 status line 的真实 usage 不一致，也会让用户误以为本地估算是 provider 真实计费口径。

### 2. breakdown 绑定“最近一次 provider request”

`/context` 展示缓存的最近一次 provider usage，而不是执行命令时重新估算当前 transcript。这样它与 status line 语义一致，也避免在模型切换、配置变化、mode 变化后产生没有 provider 真值支持的数字。

当模型切换、配置保存、清空 transcript、恢复 session 等已有路径清理 context usage 时，详细 breakdown 同步失效。

### 3. 分类口径固定为五类

- `System prompt`：agent loop 临时注入的内置 system prompt，包括 AGENTS.md 和 mode 约束。
- `Skills`：被拼入 system prompt 的 skill catalog。
- `Tools`：本轮可用工具定义，以及历史 provider-visible `tool_call` / `tool_result` 记录。
- `Messages`：provider-visible user / assistant records、compaction summary 注入消息，以及 `includeInContext !== false` 的 shell records。
- `Reasoning`：provider-visible reasoning carry-over，当前主要是 OpenAI Responses 的 `openai_reasoning` encrypted item。

`reasoning_summary` 是本地可见摘要，现有 provider converter 会过滤它，因此不计入 Reasoning。

### 4. 第一版采用 provider-neutral 估算

breakdown 计算基于 `buildProviderRecords(...)` 的 provider records 和当前 registry definitions。工具定义使用 provider-neutral `ToolDefinition` JSON 估算；历史工具记录使用本地 record 的 provider-visible文本/参数估算。

备选方案是为每个 provider adapter 暴露 provider-specific request projection，然后按实际 API payload 分类估算。该方案更精确，但需要扩大 provider interface，收益不足。由于最终会按 provider 总量校准，第一版 provider-neutral 估算足以表达分类占比。

### 5. CommandHost 暴露受控 context usage 能力

新增 `/context` handler 不直接访问 `AppContext`。CommandHost 增加 context 领域能力，例如 `context.getUsage()`；handler 根据 usage 是否存在打开详情 surface 或 info surface。

这延续现有 command-host-runtime 的受控 facade 约束，避免 CommandRuntime 增加业务 effect 分支。

### 6. 使用专用 context command surface

虽然可以用 `info` surface 拼文本，但 demo 包含 composition bar、window gauge、分类 swatch 和卡片边框，普通 info surface 难以表达。新增 `kind: 'context'` command surface，携带 `ContextUsage` 快照，由 render/footer 专用函数渲染。

该 surface 是只读、可关闭面板；任意非中断键或 Esc 均可关闭，关闭后不产生 transcript record。

## Risks / Trade-offs

- [Risk] 分类 token 与 provider 内部 tokenizer 不完全一致。 → 使用 provider 总量校准，并在数据结构中保留 `estimatedTokens` 供调试/测试，不在 UI 中声明精确 tokenizer 计数。
- [Risk] 工具 schema 的 provider-neutral JSON 与 OpenAI strict schema 或 Anthropic schema 有差异。 → 第一版接受差异；如后续出现明显误导，再引入 provider-aware estimator。
- [Risk] context surface 行数较多，在小终端中可能撑爆 footer。 → 渲染层复用 footer maxLines 约束，必要时裁剪分类行但保留 header/gauge/footer。
- [Risk] 用户可能误解为实时 context。 → 文案强调“最近一次 provider usage”，无 usage 时不展示估算。
- [Risk] Reasoning 对非 OpenAI provider 可能长期为 0。 → 这是 provider 可见输入事实；分类为 0 时可以不显示该行或显示 0，具体以 UI 简洁为准。
