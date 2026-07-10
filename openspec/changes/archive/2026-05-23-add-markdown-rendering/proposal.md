## Why

当前 assistant 输出以纯文本投影，LLM 常见的 Markdown 回复（标题、列表、代码块、引用、inline code）在终端里可读性不足。项目已经具备 append-only transcript、resize replay 和自有 ANSI/wrap 能力，现在可以在 render 层增加 Markdown-ish 终端投影，让最终消息和 pending preview 更接近用户预期。

## What Changes

- 为 assistant 消息增加 Markdown 渲染支持，覆盖标题、段落、无序/有序列表、引用、分割线、inline code 和 fenced code block 的终端投影。
- transcript record 仍保存原始 Markdown 文本；Markdown 只影响 render 层根据当前终端宽度生成的可见输出。
- 代码块不额外画边框、卡片或语言标签，只按代码内容直接高亮显示，并保留原始缩进；代码块内部不解析 inline Markdown。
- streaming pending preview 需要保持容错：未闭合 fenced code block 不应导致渲染失败，长 Markdown preview 仍受当前 terminal rows 的动态高度预算限制。
- 不追求完整 CommonMark 兼容，不支持 HTML 渲染、复杂表格布局、嵌套列表完美排版或语法级代码高亮；语法高亮后续独立 change 再讨论。

## Capabilities

### New Capabilities
- `markdown-terminal-rendering`: 定义 assistant Markdown 内容在当前终端中的解析、投影、样式、宽度计算和降级行为。

### Modified Capabilities
- `terminal-tui-prototype`: assistant transcript 与 pending preview 的可见渲染从纯文本扩展为 Markdown-aware 终端投影，同时保持 append-only transcript、resize replay 和 footer 高度预算语义。

## Impact

- 影响 `src/render/`：预计新增 Markdown 投影模块，并让 `blocks.ts` 在渲染 assistant/pending 内容时调用它。
- 影响 `src/terminal/ansi.ts`：可能需要补充 underline 或更细的语义样式 helper，但不改变终端控制模型。
- 影响 `test/render/`：新增 Markdown 纯函数测试，并更新 assistant/pending 渲染断言。
- 影响 `docs/README.md`、`docs/tui-architecture.md` 和 OpenSpec specs：补充 Markdown 渲染范围、非目标和手工验证点。
- 不引入第三方 TUI 库、bundler、数据库或持久化格式变化；如需 Markdown parser 依赖应单独评估，但本 change 默认采用项目内轻量 subset parser。
