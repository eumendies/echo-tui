## Why

assistant 现在已经支持常见 Markdown block 和 inline 样式，但 LLM 输出的 Markdown pipe table 仍会按普通文本显示，列对齐、长单元格和 streaming preview 的可读性不足。表格是 LLM 总结、对比和计划输出的高频结构，适合在现有 render-only Markdown 投影基础上继续补齐。

## What Changes

- 为 assistant Markdown 增加 GFM 风格 pipe table 的终端投影，支持有/无外侧 pipe 的 header、delimiter 和 body rows。
- 表格使用无外框 + Unicode 内部分隔线（如 `│`、`─`、`┼`）的轻量视觉样式，不输出完整 box/card；长单元格在列宽内 wrap，极窄终端下安全降级。
- 表格 cell 支持现有 inline Markdown 样式解析，包括 inline code、bold、italic 和 links；代码块内部仍不解析表格或 inline Markdown。
- 将现有 inline Markdown 解析从 `src/render/markdown.ts` 拆到独立模块，供普通段落、列表、引用和表格 cell 复用。
- 支持保守的 `md` / `markdown` fenced table unwrap：仅当 markdown fence 内容包含有效 table header + delimiter 时，把 fence 内容作为 Markdown table 渲染；非 markdown fence 仍按 code block 显示。
- assistant final transcript block 与 streaming pending preview 都使用 table-aware Markdown projection；transcript 原始文本、persistence 和 agent input 不变。
- 不追求完整 CommonMark/GFM table 兼容，不支持 HTML table、复杂 nested block in table cell、row/col span 或 streaming scrollback holdback。

## Capabilities

### New Capabilities

### Modified Capabilities
- `markdown-terminal-rendering`: 扩展 assistant Markdown 终端投影，增加 pipe table、table cell inline styles、markdown fenced table unwrap 和表格窄屏降级行为。
- `terminal-tui-prototype`: 扩展 assistant transcript 与 streaming pending preview 的 Markdown-aware 投影语义，使 table-aware projection 继续受现有 footer 高度预算和 transcript 原文不变约束。

## Impact

- 影响 `src/render/markdown.ts`：新增 table block 调度，并把 inline parser 拆出后改为复用。
- 新增 `src/render/markdown-inline.ts`：承载 inline Markdown span 解析与类型，供普通 Markdown 和 table cell 共用。
- 新增 `src/render/markdown-table.ts`：承载 table detection、delimiter/alignment parsing、column width calculation、cell wrapping 和 table line rendering。
- 影响 `test/render/`：新增或扩展 Markdown renderer、assistant block 和 pending footer 测试，覆盖表格、inline cell、宽字符、窄屏和 fence unwrap。
- 影响 docs 和 OpenSpec specs：补充表格支持范围、非目标、无外框样式和手工验证点。
- 不新增 runtime dependency，不引入第三方 Markdown parser、TUI library、bundler 或持久化格式变化。
