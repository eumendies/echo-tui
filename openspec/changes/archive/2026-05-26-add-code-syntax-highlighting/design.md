## Context

当前 Markdown 渲染已经在 `src/render/markdown.ts` 中解析 fenced code block，并保留 `language` 字段；但 `renderCodeFence()` 目前只把每一行作为统一 `ansi.white` span 渲染。代码块仍然遵循“直接显示代码内容”的体验约束：不画边框、不显示语言标签、不解析代码块内部 inline Markdown，且 transcript 保存原始 Markdown。

现有 render 管线已经有合适的承载点：Markdown block 被渲染为 `StyledSpan[]`，再经过 display-width aware wrapping 和 ANSI 样式闭合。因此语法高亮不需要改变 transcript、agent、persistence 或 slash command runtime，只需要在 code fence 渲染阶段把纯代码行转换为带 token 样式的 spans。

```text
assistant raw Markdown
        │
        ▼
parseMarkdownBlocks()
        │
        ▼
codeFence(language, lines)
        │
        ▼
highlightCodeBlock(lines, theme)
        │
        ▼
StyledSpan[][]
        │
        ▼
renderStyledLine() -> ANSI terminal lines
```

## Goals / Non-Goals

**Goals:**

- 为 fenced code block 提供简单、通用、跨行的语法高亮。
- 所有语言第一版使用同一套通用 lexical rules；`language` 只用于保留未来扩展入口，不决定第一版规则分支。
- 高亮器以整个 code block 为输入，维护跨行状态，支持未闭合字符串和块注释在后续行继续保持样式。
- 语法高亮只影响 render projection，不改变 transcript 原文、agent input 或 session persistence。
- 支持用户在 `~/.echo/config.json` 中通过可选 `tui.syntaxHighlight` 覆盖 token kind 的颜色样式；无配置时使用内置默认主题。
- 配置错误或高亮失败时安全降级到默认主题或 plain code 渲染，不阻断核心聊天能力。

**Non-Goals:**

- 不实现完整语言 parser、AST 级高亮或 IDE 级准确性。
- 不引入 Shiki、Prism、highlight.js、tree-sitter 等第三方高亮依赖。
- 不实现 per-language 自定义主题、per-language keyword 列表配置或 truecolor 主题导入。
- 不改变代码块外观约束：不画框、不显示语言标签、不增加代码块工具栏。
- 不增加代码复制、保存、折叠、执行等交互能力。

## Decisions

### 1. 高亮器放在 render 层，并输出 semantic spans

新增独立 render 模块承载语法高亮，例如 `src/render/syntax-highlight.ts`。它接收 code block lines 和有效主题，输出每行 `StyledSpan[]`。`markdown.ts` 的 `renderCodeFence()` 只负责把这些 spans 交给现有 `renderStyledLine()`。

```text
code text ──▶ generic lexer ──▶ token kind ──▶ theme ──▶ StyledSpan
```

选择原因：

- 符合现有 Markdown renderer 的纯投影模型。
- 复用已有 wrap、宽字符处理和 ANSI 样式闭合逻辑。
- 避免让高亮逻辑泄漏到 transcript、agent 或 persistence。

替代方案：直接在 lexer 中拼 ANSI 字符串。该方案短期简单，但会绕过 `StyledSpan` 管线，容易破坏 display width 计算和长行换行，因此不采用。

### 2. 第一版使用通用跨行 lexer，而不是语言专用 lexer

用户明确希望先“对所有语言使用通用的高亮规则”。第一版 lexer 不按 `js`、`python`、`json` 等语言分支，而是识别一组跨语言常见 token：

- `comment`: `//`、`#`、`--` 行注释，以及 `/* ... */` 块注释
- `string`: 单引号、双引号和反引号字符串，支持跨行延续
- `number`: 常见整数、小数和十六进制数字
- `keyword`: 通用关键字集合，例如 `const`、`let`、`function`、`return`、`if`、`else`、`for`、`while`、`class`、`import`、`export`、`from`、`def`、`true`、`false`、`null` 等
- `function`: 紧邻 `(` 的标识符
- `operator` / `punctuation`: 常见操作符和标点
- `plain`: 其他文本

选择原因：

- 实现和测试成本低。
- streaming 期间可以稳定容错。
- 对 LLM 常见代码片段已经能显著提升可读性。

替代方案：第一版直接支持多语言 lexer。该方案效果更好，但会放大范围，并引入各语言准确性争议，不适合作为简单起步。

### 3. 高亮 API 以 code block 为单位，内部维护跨行状态

对外 API 使用 block-level 形状：

```text
highlightCodeBlock(lines, theme) -> StyledSpan[][]
```

内部 scanner 按行推进，但状态会跨行保留：

```text
normal
  ├─ ' / " / ` ─────────▶ string(delimiter)
  ├─ /* ─────────────────▶ blockComment
  └─ other tokens ───────▶ normal

string(delimiter)
  ├─ escaped char ───────▶ string(delimiter)
  ├─ delimiter found ────▶ normal
  └─ end of line ────────▶ string(delimiter)  // 第一版允许跨行延续

blockComment
  ├─ */ ─────────────────▶ normal
  └─ end of line ────────▶ blockComment
```

选择原因：

- 能满足“跨行高亮”的核心诉求。
- 未来如果要引入语言专用 lexer，调用点不需要变化。
- 未闭合 fence 或 partial streaming draft 也能安全渲染到当前文本末尾。

替代方案：逐行无状态高亮。实现更简单，但无法满足用户明确提出的跨行要求，因此不采用。

### 4. 颜色配置映射 semantic token kind，而不是语言规则

用户配置建议放在现有用户级配置文件的可选 `tui.syntaxHighlight` 下：

```json
{
  "tui": {
    "syntaxHighlight": {
      "colors": {
        "keyword": { "foreground": "magenta", "bold": true },
        "string": { "foreground": "green" },
        "number": { "foreground": "yellow" },
        "comment": { "foreground": "gray" },
        "function": { "foreground": "cyan" }
      }
    }
  }
}
```

第一版只支持内置命名色，例如 `black`、`red`、`green`、`yellow`、`blue`、`magenta`、`cyan`、`white`、`gray`，以及 `bold` / `dim`。用户配置只覆盖默认主题中的部分 token kind；未配置 token 使用默认主题。

选择原因：

- token kind 主题比 per-language 主题更稳定，符合“所有语言通用规则”。
- 只支持命名 ANSI 色能保持实现轻量，避免 truecolor 探测和主题导入复杂度。
- 配置形状未来可兼容新增 token kind。

替代方案：直接配置 ANSI 数字或 truecolor。该方案更灵活，但更难校验，也更容易产生不可读配色，第一版不采用。

### 5. 配置读取保持非阻塞，LLM 配置行为不被改变

语法高亮配置是展示增强，不应像 LLM 配置那样阻断普通消息提交。实现时应新增或复用一个读取用户级 root config 的边界，但保持以下语义：

- `llm` 配置错误仍按现有 LLM 路径报错。
- `tui.syntaxHighlight` 缺失时使用默认高亮主题。
- `tui.syntaxHighlight.colors` 局部错误时忽略错误条目或回退默认主题，不向 transcript 写入本地 error record。

选择原因：

- 语法高亮不是核心聊天功能。
- 避免用户因为配错颜色导致整个 TUI 无法使用。
- 保持现有 `llm-config.ts` 对敏感字段和错误路径的行为稳定。

## Risks / Trade-offs

- [Risk] 通用 lexer 对具体语言的高亮不准确，例如 `#` 在某些语言中不是注释。→ Mitigation: 文档明确第一版是通用轻量高亮；无法识别或误识别不改变原文，只影响颜色。
- [Risk] 跨行字符串策略可能把后续多行都染成字符串。→ Mitigation: 这是满足跨行高亮的有意识取舍；scanner 必须线性、可终止，并在闭合 delimiter 后恢复 normal 状态。
- [Risk] 配置读取如果放在 render hot path，streaming 时会频繁读文件。→ Mitigation: 启动时或 AppContext/RenderContext 创建时读取一次，并把有效主题随 render state/options 传递。
- [Risk] ANSI 样式嵌套和 reset 不当会污染后续输出。→ Mitigation: 使用现有 `StyledSpan` 渲染管线，并在新增 ANSI style builder 中保证每个 span 闭合样式。
- [Risk] 高亮长代码块增加 streaming preview 渲染成本。→ Mitigation: lexer 只做单次线性扫描，不做回溯或 AST 构建；继续复用 pending preview 高度预算折叠。

## Migration Plan

这是纯渲染增强，无数据迁移。已有 transcript session 保存的是原始 Markdown；升级后 `/resume` 或 resize replay 会按新 renderer 重新投影，因此历史代码块也会获得高亮。

回滚策略是回退到旧的 plain code style 渲染路径。

## Open Questions

- 第一版是否需要在 UI 中暴露当前主题信息？建议先不暴露，避免扩大 TUI surface。
