## 1. Inline parser 拆分

- [x] 1.1 新增 `src/render/markdown-inline.ts`，迁移现有 `TextStyle`、`StyledSpan`、`parseInlineSpans()` 和 inline helper，保持现有 inline code、bold、italic、link 行为不变。
- [x] 1.2 修改 `src/render/markdown.ts` 复用 `markdown-inline.ts`，删除重复 inline 私有实现，并保持 paragraph、list、blockquote、heading 的渲染输出稳定。
- [x] 1.3 更新或新增 inline 相关测试，确认拆分后 ANSI 样式闭合、display width 和中文宽字符行为不回归。

## 2. 表格解析与模型

- [x] 2.1 新增 `src/render/markdown-table.ts`，实现 table model、alignment enum、escaped pipe aware 的 row splitting 和 delimiter parsing。
- [x] 2.2 在 `markdown.ts` 的 block scanner 中识别连续 header + delimiter + body rows，并委托 table 模块生成 table block；未确认 table 的 pipe 文本保持普通文本。
- [x] 2.3 支持有外侧 pipe、无外侧 pipe、escaped pipe、row cell count 归一化和 invalid table 安全降级。
- [x] 2.4 保证普通 fenced code block 内的 table-like 文本不被解析为 table。

## 3. 表格渲染与宽度

- [x] 3.1 实现无外框 + Unicode 内部分隔线（`│`、`─`、`┼`）的 table rendering，保持 assistant role 前缀和 continuation indentation 语义，且不使用 ASCII pipe 作为可见表格分隔符。
- [x] 3.2 实现列宽计算、left/right/center alignment、cell padding 和中文宽字符 display width 支持。
- [x] 3.3 实现 cell 内容 wrap；同一 row 多个 cell 高度不一致时补齐空 cell 行，确保输出行不超过 safe render width。
- [x] 3.4 实现极窄终端 fallback，无法容纳最小 table layout 时降级为普通文本或 pipe row projection 且不抛错。
- [x] 3.5 在 table cell 中复用 `parseInlineSpans()`，支持 inline code、bold、italic 和 links，并确保 ANSI 不污染后续 cell/row。

## 4. Markdown fence unwrap

- [x] 4.1 实现 `md` / `markdown` fenced code block 的保守 table unwrap：仅当 fence 内容包含有效 table header + delimiter 时按 table 渲染。
- [x] 4.2 确保 `md` / `markdown` fence 中非 table 内容继续按 code block 显示，非 markdown fence 永远不 unwrap。
- [x] 4.3 覆盖 blockquote 或缩进等常见 fence 输入边界，保证 unwrap 不误伤普通代码块。

## 5. Assistant/pending 集成与测试

- [x] 5.1 新增 Markdown table renderer 单元测试，覆盖基础表格、无外侧 pipe、escaped pipe、alignment、中文宽字符、wrap、fallback 和 invalid table。
- [x] 5.2 新增 table cell inline Markdown 测试，覆盖 inline code、bold、italic、link 和 ANSI display width。
- [x] 5.3 更新 assistant block 测试，验证 final assistant transcript 使用 table-aware projection，user/error 仍不解析 Markdown table。
- [x] 5.4 更新 pending/footer 测试，验证 streaming table projection、partial table 容错、terminal rows 折叠预算和最终 transcript 原文不变。
- [x] 5.5 新增 markdown fenced table unwrap 测试，覆盖 `md`/`markdown` fence unwrap、非 table markdown fence 保持 code、非 markdown fence 保持 code。

## 6. 文档、OpenSpec 与验证

- [x] 6.1 更新 `docs/README.md` 和 `docs/tui-architecture.md`，说明表格支持范围、无外框样式、inline cell、fence unwrap、非目标和手工验证方式。
- [x] 6.2 运行 `npm run build`、`npm run typecheck`、`npm test`、JS syntax check、相关 OpenSpec strict validate 和 `git diff --check`。
- [x] 6.3 使用 `npm start` 做轻量手工验证：普通表格、宽表格、中文表格、markdown fenced table、streaming pending 折叠和 resize replay 行为均正常。
