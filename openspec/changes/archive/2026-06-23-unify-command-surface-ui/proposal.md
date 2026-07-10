## Why

当前多个 command surface 各自定义 cyan 色值、焦点高亮、选中 marker 和默认文案，导致 `/resume`、通用 select/checkbox、choice card、`/config`、`/mcp`、`/skills`、`@` 文件选择器和 status line 在同一个 footer 区域里呈现出多套 UI 语言。现在已有较成熟的 `▌` 焦点条、cyan active 背景和 `●/○` marker 风格，应把这些模式沉淀为统一规则，减少后续 surface 继续分叉。

## What Changes

- 统一 footer command surface 的 cyan palette：将重复散落的 cyan/deep/bright/frame/muted/success/warn/danger 等颜色收敛到共享 footer theme。
- 统一焦点高亮语言：聚焦行 SHALL 使用项目现有的粗竖条 `▌`、统一 active 背景和 cyan 高亮文本；不再用 `▸`、`›` 或 inverse 表达焦点。
- 统一 marker 语言：有 toggle/boolean 状态语义的启用/禁用、checked/unchecked 等状态优先使用 `●/○`；没有 toggle 语义的普通 select 只使用 `▌` 焦点条，不强行添加 `●/○`。
- 统一用户可见文案：footer 操作提示、空状态和默认说明以中文为主；命令名、按键名、路径、协议名、模型名和产品名保留英文。
- 保持现有交互语义、输入事件、footer 高度约束、安全宽度和 ANSI/raw-mode 实现不变。

## Capabilities

### New Capabilities
- `command-surface-ui-language`: 定义 footer command surfaces 的共享视觉语言，包括颜色、焦点行、marker 和用户可见文案语言规则。

### Modified Capabilities
- `terminal-tui-prototype`: command surface 的可见 footer 行为需要遵循统一 UI 语言，不再允许同类 surface 使用互相冲突的焦点和 marker 表达。
- `interactive-choice-surface`: choice card 的选中态需要与共享焦点条、active 背景和 marker 规则保持一致。

## Impact

- 主要影响 `src/render/footer/` 下的 surface renderer：`colors.ts`、`command-surfaces.ts`、`composer-surface.ts`、`choice-surface.ts`、`file-picker-surface.ts`、`resume-surface.ts`、`config-surface.ts`、`mcp-surface.ts`、`skills-surface.ts`、`scale-surface.ts`、`context-surface.ts`。
- 可能影响部分 command handler 提供的默认 title、dismiss hint、empty lines 和状态文案，例如 `/resume`、`/mcp`、`/skills`、`/config`、`/context`、`/model`、`/mode`。
- 需要更新 footer 渲染测试中对 marker、焦点样式、ANSI 颜色或文案的断言；优先使用去 ANSI 后的可见文本和宽度约束断言，避免过度绑定具体 escape sequence。
- 不引入第三方 TUI 库，不改变 command runtime、输入事件、session data schema 或 transcript 持久化语义。
