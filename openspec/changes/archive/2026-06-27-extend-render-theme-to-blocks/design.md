## Context

当前 `~/.echo/theme.json` 已经能驱动 footer 区域，但 render 层仍存在三类割裂：

- `src/render/footer/colors.ts` 同时承担颜色 primitive 和 footer 语义 helper，其他渲染模块如果复用它会产生“非 footer 依赖 footer”的语义反向依赖。
- `src/render/blocks.ts`、Markdown renderer、tool message renderer 和 banner 仍直接调用 `ansi.cyan()`、`ansi.gray()`、`ansi.green()` 等硬编码颜色。
- syntax highlight 仍由 `~/.echo/config.json` 下 `tui.syntaxHighlight` 读取，和新的 `theme.json` 视觉配置入口分离。

这次变更是一次 breaking change：视觉配置统一进入 `theme.json`，不保留旧配置读取、兼容转换、schemaVersion 或 legacy fallback。

## Goals / Non-Goals

**Goals:**

- 使用单一 `src/render/colors.ts` 管理 render 颜色应用 helper，覆盖 footer、blocks、Markdown、syntax highlight 和 tool block 所需颜色能力。
- 扩展 `TuiTheme`，使 `footer`、`blocks`、`markdown`、`syntax` 等语义分组都来自 `~/.echo/theme.json`。
- 删除旧 `tui.syntaxHighlight` 配置入口，让 fenced code block 语法高亮也由 theme 系统驱动。
- 移除 raw `sgr` 颜色输入；通用 `ThemeColor` 只表达 RGB 和 ANSI 256 色，由渲染 helper 根据前景/背景位置生成 ANSI。
- 让 banner、transcript blocks、pending preview、assistant Markdown、tool block 和 destructive replay 使用同一个 render theme。
- 固定 apply_patch tool result 的 added/removed 红绿背景，不允许 theme override 改写这类文件修改事实语义色。

**Non-Goals:**

- 不实现 `/theme` 命令或运行中 theme 热重载。
- 不改变 transcript record、session persistence、agent input、tool result 原始文本或 Markdown 原文。
- 不引入第三方颜色库、TUI 库或按语言 parser 的语法高亮。
- 不保留旧 `~/.echo/config.json` 中 `tui.syntaxHighlight` 的读取、迁移或警告逻辑。

## Decisions

### Decision: 单一 `src/render/colors.ts` 承载所有 render 颜色 helper

将现有 `src/render/footer/colors.ts` 提升为 `src/render/colors.ts`，并直接在该文件内放置 footer、block、Markdown 和 syntax highlight 需要的颜色相关函数。语义分组体现在 `TuiTheme` 类型上，而不是拆成 `footer/colors.ts`、`blocks/colors.ts` 或 `markdown/colors.ts`。

替代方案是保留多个子目录 colors 文件，只在底层共享 primitive。该方案能表达更细粒度边界，但当前项目规模下会产生大量一行转发 helper，增加文件跳转和维护成本。

### Decision: 配置层只定义 theme 数据模型，渲染层负责 ANSI 应用

`src/config/theme-config.ts` 继续负责默认 theme、内置 theme JSON、用户 theme 读取、解析和归一化；`src/render/colors.ts` 负责 `colorText()`、`colorBackground()`、token helper、style helper 和 RGB 插值。配置层不得 import `src/render/colors.ts`，避免 config 反向依赖 render。

替代方案是在 config 模块里直接提供 ANSI 渲染函数。该方案减少 import，但会让配置读取层承担终端渲染职责，破坏模块边界。

### Decision: theme color 模型只保留 RGB 和 ANSI 256

`ThemeColor` 收敛为：

```text
rgb: [r, g, b] / "#rrggbb"
ansi256: { "ansi256": 0-255 }
```

前景使用 `38;5;n`，背景使用 `48;5;n`；RGB 前景/背景分别使用 `38;2` 和 `48;2`。不再支持 `{ "sgr": number }`，也不保留默认 theme 中的 `sgr()` 内部表示。

替代方案是保留 `sgr` 并限制可用范围。该方案仍会让同一个 color kind 在前景、背景和 RGB 插值场景中含义不同，后续扩展 blocks 和 syntax 时更容易制造误用。

### Decision: syntax highlight 并入 `theme.json`

删除 `readSyntaxHighlightTheme()` 对 `~/.echo/config.json` 的读取，`RenderState` 只需要携带完整 `theme`。语法高亮器从 `theme.syntax` 获取 token style，例如 `keyword`、`string`、`comment`、`function`、`plain` 等。

替代方案是保留 `syntaxHighlight` 独立配置直到后续版本迁移。用户明确要求不兼容旧配置，且保持两套视觉入口会让主题系统继续分裂。

### Decision: blocks/Markdown/tool 通过 RenderState theme 进入完整重绘路径

`app-renderer` 当前 append、destructive replay 和 final render 都已经接近拥有完整 render state。实现时应让 `renderTranscriptLines()`、`renderTranscriptBlocks()`、`renderRecordBlock()`、`renderBanner()`、`renderPendingAssistantLines()` 和 tool block renderer 接收 theme。这样 streaming pending、transcript append、resize destructive recovery 和 final render 都会使用同一份启动时读取的 theme。

替代方案是让 `blocks.ts` 自行 import `DEFAULT_TUI_THEME` 兜底。该方案方便直接调用测试，但容易绕过 app 注入路径，并在测试中隐藏遗漏的 theme 传递。

### Decision: 固定事实语义色不进 theme

apply_patch tool result 中 added/removed 行的红绿背景表达文件修改事实，不是普通视觉装饰。它们继续使用代码内固定语义色，theme 只能影响 tool call/status/prefix/neutral output 等非事实色。

替代方案是把所有颜色都做成可配置。该方案“统一”，但会允许用户把 patch 增删事实渲染成不再能表达增删的颜色，降低审查和撤销相关界面的可信度。

## Risks / Trade-offs

- [Risk] 影响面横跨 app renderer、blocks、Markdown、tool renderer 和 tests，容易漏掉硬编码 ANSI。→ Mitigation：用 `rg "ansi\\.(cyan|gray|green|red|yellow|magenta|white|background|bg)" src/render` 建立迁移清单，并按渲染路径补覆盖测试。
- [Risk] 删除 `tui.syntaxHighlight` 是 breaking change，已有用户配置会失效。→ Mitigation：按用户要求不兼容旧配置，文档明确新配置只在 `theme.json` 中生效。
- [Risk] `TuiTheme` token 过细会让 theme JSON 难以理解。→ Mitigation：按区域分组 `footer`、`blocks`、`markdown`、`syntax`，默认值完整，用户可以只覆盖少数 token。
- [Risk] 直接让 Markdown renderer 使用 theme 可能让 syntax highlight 与 Markdown structural styles 混在一起。→ Mitigation：Markdown 结构 token 和 syntax token 分开建模，只共享底层 color/style primitive。
- [Risk] 固定 apply_patch 红绿与主题审美可能不协调。→ Mitigation：这是有意取舍，优先保证文件修改事实的稳定语义。

## Migration Plan

1. 调整 theme 类型和默认值，新增 `blocks`、`markdown`、`syntax` 语义分组，删除 `sgr` kind。
2. 新增或移动为 `src/render/colors.ts`，把颜色 primitive 和所有 render token helper 收敛到单文件。
3. 更新 footer imports，删除 `src/render/footer/colors.ts`。
4. 删除旧 syntax highlight 配置读取，把 syntax highlighter 的 token style 来源改成 `theme.syntax`。
5. 将 theme 传入 banner、transcript block、pending preview、Markdown、tool block 和 final/destructive render 路径。
6. 更新内置 theme JSON、README、架构文档和 OpenSpec。
7. 增加回归测试和 theme override 测试。

回滚方式：恢复旧 `footer/colors.ts` 和 `tui.syntaxHighlight` 读取路径，并将 blocks/Markdown/tool renderer 退回硬编码 ANSI。由于本变更不迁移持久化数据，回滚不需要 transcript/session 数据修复。

## Open Questions

无。当前决策已经明确：不保留旧配置兼容，不拆子 colors 文件，apply_patch 增删语义色固定。
