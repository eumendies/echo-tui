## Context

`echo_tui` 的 Markdown 渲染目前是 render-only terminal projection：assistant 原始文本仍保存到 transcript，最终消息和 streaming pending preview 会在 render 层投影为可见 ANSI 行。现有实现位于 `src/render/markdown.ts`，使用轻量 line scanner 支持 heading、paragraph、list、blockquote、rule、fenced code block 和 inline code/bold/italic/link。

表格渲染会显著增加 Markdown renderer 的局部复杂度：需要识别 GFM pipe table、处理 escaped pipe、delimiter alignment、列宽分配、cell wrap、inline cell styles、partial streaming 和 markdown fenced table unwrap。继续把所有逻辑堆到 `markdown.ts` 会削弱当前模块边界，因此本 change 需要拆出 inline 和 table 专用模块。

## Goals / Non-Goals

**Goals:**
- 支持 assistant final transcript block 和 streaming pending preview 中的 Markdown pipe table。
- 表格使用无外框 + Unicode 内部分隔线的轻量终端样式，保持可读同时避免 box/card 视觉重量。
- 表格 cell 支持现有 inline Markdown 样式，并与普通段落复用同一 inline parser。
- 支持 escaped pipe、left/right/center alignment、中文宽字符、窄屏 cell wrap 和极窄 fallback。
- 支持保守 markdown fence unwrap：仅 `md` / `markdown` fence 且内容包含有效 table 时 unwrap。
- 不改变 transcript、persistence、agent input 或 user/error 纯文本渲染语义。

**Non-Goals:**
- 不实现完整 CommonMark/GFM table 兼容。
- 不支持 HTML table、rowspan、colspan、nested block elements in table cell 或多段落 table cell。
- 不新增第三方 Markdown parser 或 TUI dependency。
- 不实现 Codex 风格 streaming table holdback、scrollback reflow 或 history cell consolidation。
- 不在普通 code fence 内解析表格；非 `md` / `markdown` fence 继续按代码显示。

## Decisions

### Decision 1: 新增 `markdown-table.ts` 承载表格逻辑

新增 `src/render/markdown-table.ts`，负责 table detection、row parsing、alignment parsing、column width calculation、cell wrapping 和 table line rendering。`markdown.ts` 继续作为 block scanner 和总调度，只在遇到 table candidate 时委托 table 模块解析连续行。

替代方案：直接在 `markdown.ts` 内实现表格。拒绝原因是表格逻辑代码量中等且相对独立，放在同一文件会让 Markdown renderer 难以维护。

### Decision 2: 新增 `markdown-inline.ts` 复用 inline parser

将现有 `parseInlineSpans()`、inline match helper 和 `StyledSpan`/`TextStyle` 类型从 `markdown.ts` 拆到 `src/render/markdown-inline.ts`。普通 paragraph/list/quote 和 table cell 都使用同一 inline parser，避免 table cell 与普通文本在 inline code、bold、italic、link 上行为不一致。

替代方案：表格 cell 第一版只渲染纯文本。拒绝原因是用户明确要求 table cell 支持 inline Markdown，且复用现有 parser 成本可控。

### Decision 3: 表格使用无外框 + 内部分隔线

表格 SHALL 不输出完整 box/card 外框。推荐投影形态为首行 header、第二行分隔线、后续 body rows，列之间使用 Unicode 内部分隔线 `│`，header 与 body 之间使用 `─` / `┼` 分隔。实现 SHALL 不使用 ASCII pipe 作为渲染分隔符；必要时可以用 ANSI 弱化 Unicode 分隔线。

示意：

```text
◆ Name   │ Count │ Notes
  ───────┼───────┼────────────────
  alpha  │     1 │ short
  beta   │    23 │ longer wrapped note
```

替代方案：完整 box drawing table。拒绝原因是外框增加复制噪声和 pending preview 高度，且不符合当前 Markdown renderer 的轻量投影方向。替代方案：使用 ASCII pipe 分隔符。拒绝原因是用户明确要求使用 Unicode 分隔符而不是 ASCII pipe。

### Decision 4: 借鉴 Codex 的 table detection，不借 streaming holdback

表格 detection 借鉴 Codex PR 中的 `parse_table_segments` / delimiter detection 思路：去掉首尾 pipe、仅按未转义 `|` 分列、支持无外侧 pipe、delimiter segment 支持 `---` / `:---` / `---:` / `:---:` 且至少三个 dash。

不借 Codex streaming table holdback。Codex 需要 holdback 是因为 streaming 内容可能已经写入 transcript/scrollback，后续 table rows 到达会改变列宽并使已写内容错位。本项目 pending preview 是临时 footer 区域，每次从完整 draft 重新投影，final transcript 也从原始文本重渲染，因此不需要 holdback/reflow/consolidation。

### Decision 5: 宽度分配优先保证可读和稳定

表格 renderer 先计算每列 natural width，再判断是否能放入 `safeRenderWidth(width) - displayWidth(prefix)`。若超宽，优先压缩 narrative columns，再压缩 structured columns；cell 内容按列宽 wrap。极窄场景下如果连最小列宽和 Unicode separators 都无法容纳，安全降级为普通文本投影，不抛错。

可借鉴 Codex 的列分类思想：平均 words per cell 较高或平均 cell width 较长的列视为 narrative，短 token/数字/状态列视为 structured。第一版可以实现简化启发式，避免过早引入复杂 shrink cost 模型。

### Decision 6: 保守支持 markdown fence unwrap

当 fenced code block 的 info string 是 `md` 或 `markdown`，且 fence 内容包含有效 table header + delimiter 时，renderer SHALL unwrap 该 fence 并按 Markdown table 渲染。其他 fence 仍按 code block 渲染；`md` / `markdown` fence 若不包含有效 table，也保持 code block 语义。

替代方案：所有 code fence 都不解析内部表格。拒绝原因是 LLM 经常把 Markdown 表格包在 `markdown` fence 中；保守 unwrap 能显著改善常见输出，同时避免误解析语言代码块。

## Risks / Trade-offs

- [Risk] 表格 parser 与完整 GFM 行为不一致 → Mitigation: 明确非目标，只覆盖 header + delimiter + body rows 的高频 pipe table，并为边界行为写测试。
- [Risk] 表格宽度分配在窄终端下不稳定 → Mitigation: 基于现有 `displayWidth`/`charWidth` 计算可见宽度，先实现可预测的 wrap/fallback，再逐步优化 shrink 策略。
- [Risk] streaming partial table 从普通文本跳变为表格 → Mitigation: 仅在 header + delimiter 确认后渲染为表格；pending preview 每帧重投影，跳变可接受且不污染 transcript。
- [Risk] markdown fence unwrap 改变 code fence 行为 → Mitigation: 仅对 `md`/`markdown` fence 且内部存在有效 table 时 unwrap，非 markdown fence 和非 table markdown fence 保持代码块。
- [Risk] inline parser 拆分带来模块边界变化 → Mitigation: 只移动现有逻辑，不改变现有 paragraph/list/quote inline 行为；用现有测试防回归。

## Migration Plan

这是 render-only change，不需要数据迁移。实现后通过现有 transcript 原文重新投影即可获得表格渲染；旧 session 文件不需要修改。若出现问题，可回滚到普通 Markdown renderer，transcript 内容不受影响。

## Open Questions

- 极窄终端 fallback 是保留原始 Markdown pipe 行，还是按“每行一个 cell label”的 row-card 形式显示；当前默认建议保留原始 pipe 行，避免引入新视觉模型。
