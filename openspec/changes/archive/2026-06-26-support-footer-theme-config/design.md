## Context

footer 是当前 TUI 中颜色最集中的区域：`src/render/footer/colors.ts` 已经提供共享 RGB palette 和 active/code 背景样式，多个 footer surface 通过 `FOOTER_COLORS`、`FOOTER_STYLES`、`rgbText()`、`activeBackground()` 复用这些值。与此同时，普通 composer/status line、slash suggestion、command surfaces、choice、file picker、resume、config、mcp、skills、scale、context 和 diff footer surface 都属于用户持续可见的交互区域，最适合作为 theme 系统第一阶段。

现有 `~/.echo/config.json` 已承担 LLM、tool、MCP 和 syntax highlight 配置。theme 属于纯展示配置，且用户希望放在额外文件中，因此应新增独立 `theme.json`，避免 `/config` 面板、LLM 读取和 provider 错误语义被展示配置牵连。

## Goals / Non-Goals

**Goals:**

- 新增独立用户级 theme 配置文件，默认路径为 `~/.echo/theme.json`。
- 支持 footer semantic theme token，并让 footer renderer 从 theme token 取色。
- 默认 theme 保持当前 footer cyan 视觉和默认 ANSI 输出语义。
- 配置缺失、解析失败、局部无效时安全回退默认值，不写 transcript error，不阻断 app 启动或对话。
- 只在 app 创建时读取 theme，并通过 render state 或等价依赖注入传给 footer 渲染路径，避免热路径重复读文件。

**Non-Goals:**

- 本版本不主题化 transcript block、Markdown、syntax highlight、banner、tool result 正文或非 footer 区域。
- 本版本不提供 `/config` 或其他交互面板编辑 theme。
- 本版本不支持运行中热重载 theme 文件。
- 本版本不引入第三方 theming、颜色解析或 TUI 库。
- 本版本不改变 command surface 输入事件、session data、transcript、LLM 请求或持久化语义。

## Decisions

### Decision: 使用独立 `~/.echo/theme.json`

theme 配置放在独立文件中，读取逻辑新增到配置层，例如 `src/config/theme-config.ts` 或等价模块。该模块只负责读取展示配置，和 `readLlmConfig()` 的必填校验语义分离；读取失败返回默认 theme。

替代方案是继续放入 `~/.echo/config.json` 的 `tui.theme`。该方案复用现有 `readOptionalUserConfig()` 更快，但会让 LLM 配置文件继续膨胀，也不符合本次“额外的 theme.json 文件”要求。

### Decision: theme 使用语义 token，不暴露 cyan 命名

footer renderer 使用 `accent`、`accentStrong`、`accentDeep`、`frame`、`text`、`muted`、`success`、`warning`、`danger`、`selectionBackground`、`codeBackground`、`codeForeground` 等语义 token。默认值可以仍是 cyan 风格，但实现不应新增 `MAIN_THEME`、`CYAN_THEME` 这类外观命名。

替代方案是把现有 `FOOTER_COLORS.cyan`、`cyanBright` 等直接做成可配置项。这能减少迁移量，但会把“默认外观”写进长期 API，后续做非 cyan 主题时渲染代码仍在表达错误语义。

### Decision: 保留默认 ANSI 兼容能力

当前 footer 同时使用 24-bit RGB 前景色、256 色背景和显式 256 色前景。theme 内部模型需要能表达这些默认值，以保证缺失配置时现有视觉和关键测试输出不发生无意义变化。用户配置可以先支持简单格式：

```json
{
  "footer": {
    "colors": {
      "accent": "#00c8dc",
      "accentStrong": [90, 230, 245],
      "selectionBackground": { "ansi256": 23 },
      "codeBackground": { "ansi256": 236 },
      "codeForeground": { "ansi256": 117 }
    }
  }
}
```

解析层将 hex、RGB tuple 和 `{ "ansi256": number }` 归一化为内部 `ThemeColor`。renderer 只通过 helper 使用颜色，不直接判断配置格式。

替代方案是只支持 hex/RGB 并把所有背景迁移成 24-bit RGB。该方案用户配置更统一，但默认 ANSI 输出会变化，且 active/code 背景当前依赖 256 色语义。

### Decision: 在 app 装配根读取一次并注入 render state

`createApp()` 启动时读取 theme，和当前 syntax highlight theme 类似存入 `AppContext` / `RenderContext`，再传给 `renderFooterLayout()` 及 footer surface renderer。footer helper 可以提供带 theme 参数的 `rgbText(theme.colors.accent, text)`、`activeBackground(theme, text)`、`renderFocusBar(theme)` 等函数，避免 surface 自己读取文件。

替代方案是在 `src/render/footer/colors.ts` 内部读取全局 theme。该方案参数变少，但会引入渲染层全局 I/O 和测试隔离问题，也不符合当前 render state 可重放架构。

### Decision: 先迁移 footer 共享 helper，再逐步替换 surface 调用

实现顺序应先建立 `DEFAULT_TUI_THEME`、解析器和 footer helper，再迁移 `FOOTER_COLORS` 使用点。迁移过程中可保留兼容别名，但最终 footer surface 不应直接读取硬编码 palette 常量；默认 theme 是唯一默认色值来源。

## Risks / Trade-offs

- [Risk] footer surface 很多，容易漏掉直接 `ansi.cyan()`、`ansi.green()` 或 `FOOTER_COLORS.*` 调用。→ Mitigation：用 `rg` 建立迁移清单，并给普通 composer、status line、skills/config/choice/diff/scale 等主要 surface 加 theme override 测试。
- [Risk] 主题 token 过细会让用户配置难以理解。→ Mitigation：第一版只公开 footer 必需的有限 token，文档说明缺失字段会回退默认值。
- [Risk] 默认输出变化会导致大量快照或 ANSI 断言调整。→ Mitigation：默认 theme 保持现有 RGB/256 色值和 helper 输出语义，测试重点放在“默认不变”和“override 生效”。
- [Risk] 无效 theme 配置如果走 LLM 配置错误路径，会阻断聊天。→ Mitigation：theme 读取使用可选配置语义，错误静默回退并可在后续版本考虑本地 notice。

## Migration Plan

1. 新增 theme 类型、默认值和 `readTuiTheme()` 配置读取。
2. 在 app 创建时读取一次 theme，并加入 render state 或等价 footer render options。
3. 改造 footer color helper，支持从 theme token 渲染前景、背景、focus bar、active background 和 code 背景。
4. 按 surface 迁移 footer 颜色调用，保持默认视觉不变。
5. 增加配置解析、默认回退和 footer override 测试。
6. 更新 README 和架构文档，说明 `~/.echo/theme.json` 当前只影响 footer。

回滚方式：恢复默认 theme 注入和 footer helper 调用到原硬编码 palette；由于 theme 不改变 transcript 或持久化数据，不需要数据迁移。

## Open Questions

- 是否需要支持项目级 theme 覆盖用户级 theme。本版本暂不支持，避免引入配置优先级。
- 是否需要在 `/config` 面板展示当前 theme 路径。本版本暂不支持，保持 theme 只读配置文件能力。
