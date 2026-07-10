## Why

当前 theme 系统只覆盖 footer 区域，历史区 block、banner、assistant Markdown、pending preview、tool block 和语法高亮仍散落硬编码 ANSI 颜色或旧的 `tui.syntaxHighlight` 配置。继续扩展时如果保留 footer-only 边界，会让视觉配置分裂成两套模型，也会放大现有 `sgr` 颜色模型的语义问题。

## What Changes

- **BREAKING**：将用户视觉配置统一收敛到 `~/.echo/theme.json`，删除旧的 `~/.echo/config.json` 下 `tui.syntaxHighlight` 读取语义，不提供兼容迁移、schemaVersion 或 legacy fallback。
- **BREAKING**：收窄 theme color 模型，移除 raw `sgr` 颜色输入；通用颜色只支持 hex/RGB 和 `{ "ansi256": number }`，由渲染 helper 根据前景/背景位置生成正确 ANSI。
- 将 `src/render/footer/colors.ts` 提升并收敛为单一 `src/render/colors.ts`，集中承载 footer、block、Markdown 和 syntax highlight 需要的颜色应用 helper，不再拆 footer/block 子 colors 文件。
- 扩展 `TuiTheme`，在现有 `footer` 之外纳入 transcript blocks、banner、pending preview、Markdown structural styles 和 syntax token styles。
- 将 `blocks.ts`、`app-renderer.ts`、Markdown renderer、tool message renderer 和 syntax highlighter 接入 `RenderState.theme`，确保 append、streaming preview、resize destructive replay 和 final render 使用同一 render theme。
- 保留部分事实语义色为代码固定值，不暴露给 theme 配置，例如 apply_patch tool result 的 added/removed 红绿背景。
- 更新内置 theme JSON、用户文档、架构文档和测试，使默认主题保持当前视觉，但所有可配置视觉都走统一 theme 架构。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `footer-theme-config`：从 footer-only theme 扩展为完整 render theme，覆盖 footer、blocks、Markdown 和 syntax highlight，并移除旧 syntax highlight 配置兼容。
- `terminal-tui-prototype`：transcript block、pending preview、banner 和 tool block 的可见投影改为使用 render theme，同时保持 transcript/persistence/agent input 语义不变。
- `markdown-terminal-rendering`：Markdown structural styles、inline styles 和 syntax token styles 统一从 render theme 读取，删除 `tui.syntaxHighlight` 配置语义。

## Impact

- 影响配置读取：`src/config/theme-config.ts` 的 theme 数据模型、默认值、解析和内置 JSON 需要扩展；旧 `readSyntaxHighlightTheme()` 和 `tui.syntaxHighlight` 读取路径应删除。
- 影响渲染路径：`src/render/app-renderer.ts`、`src/render/blocks.ts`、`src/render/markdown.ts`、`src/render/markdown-inline.ts`、`src/render/markdown-table.ts`、`src/render/syntax-highlight.ts`、`src/render/tool-message-renderer.ts` 和 tool message renderer 子模块需要接收或使用 render theme。
- 影响 footer renderer：footer surfaces 应改为从 `src/render/colors.ts` 导入共享 helper，而不是从 `src/render/footer/colors.ts` 导入。
- 影响测试：需要覆盖 theme override 在 banner、user block、assistant prefix、pending preview、Markdown structural styles、syntax highlight 和 tool block 中生效；同时验证 apply_patch added/removed 固定语义色不被 theme 覆盖。
- 影响文档和规格：README、架构文档、OpenSpec theme/Markdown/transcript 规格需要同步为统一 render theme 语义。
