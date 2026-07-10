## 1. 高亮主题与配置

- [x] 1.1 定义语法 token kind、默认主题和 token style 类型，覆盖 keyword、string、number、comment、function、operator、punctuation、plain 等通用类别。
- [x] 1.2 扩展 ANSI 样式边界，提供从命名色和 `bold` / `dim` 组合生成 `TextStyle` 的能力，并确保每个 span 样式闭合。
- [x] 1.3 增加可选 `tui.syntaxHighlight` 用户配置读取与归一化，支持 `colors` 局部覆盖；配置缺失或无效时安全回退，不改变现有 LLM 配置错误语义。
- [x] 1.4 将有效语法高亮配置接入 app/render state，避免在 streaming render hot path 中重复读取配置文件。

## 2. 通用跨行高亮器

- [x] 2.1 新增 render 层语法高亮模块，提供 `highlightCodeBlock(lines, theme)` 形式的 block-level API，输出每行 `StyledSpan[]`。
- [x] 2.2 实现通用 scanner，识别字符串、行注释、块注释、数字、通用关键字、函数名、操作符、标点和普通文本。
- [x] 2.3 实现跨行状态维护，使未闭合字符串和块注释能延续到后续行，并在遇到闭合 delimiter 后恢复 normal 状态。
- [x] 2.4 确保高亮器对 unknown language、空 language、partial token、超长行和未闭合 block 都线性扫描、安全降级且不抛错。

## 3. Markdown 渲染集成

- [x] 3.1 更新 `renderCodeFence()`，用语法高亮 spans 替换统一 `ansi.white` span，同时保持代码块不画框、不显示语言标签、不解析 inline Markdown。
- [x] 3.2 保持 `md` / `markdown` fenced table unwrap 的优先级；只有未 unwrap 为 table 的 code fence 才进入语法高亮。
- [x] 3.3 确认 final assistant transcript、streaming pending preview、resize replay 和 `/resume` 恢复都通过同一 Markdown/highlight 投影路径。
- [x] 3.4 保持高亮后的 wrapping、缩进和样式闭合行为与现有代码块布局一致。

## 4. 测试

- [x] 4.1 为语法高亮模块新增单元测试，覆盖通用 token 识别、跨行字符串、跨行块注释、unknown language 降级和 partial token 容错。
- [x] 4.2 更新 Markdown renderer 测试，验证 fenced code block 输出包含 token 样式、保留缩进、不显示语言标签、不解析 inline Markdown。
- [x] 4.3 增加 wrapping/display width 测试，确认 ANSI 样式不计入可见宽度且长高亮代码行安全换行。
- [x] 4.4 增加配置测试，覆盖默认主题、局部颜色覆盖、未知颜色/错误类型安全回退，以及不写 transcript error 的行为。
- [x] 4.5 增加 streaming pending preview 或未闭合 fence 测试，确认 partial Markdown 下跨行高亮不崩溃并继续受高度预算限制。

## 5. 文档与验证

- [x] 5.1 更新 `docs/README.md`，说明 fenced code block 使用通用跨行语法高亮和 `tui.syntaxHighlight` 配置示例。
- [x] 5.2 更新 `docs/tui-architecture.md`，记录语法高亮模块、主题配置边界和 render-only 事实模型。
- [x] 5.3 运行 OpenSpec 校验：`npx -y @fission-ai/openspec@latest validate add-code-syntax-highlighting --strict`。
- [x] 5.4 运行项目验证：`npm run typecheck`、`npm test`、`git diff --check`。
