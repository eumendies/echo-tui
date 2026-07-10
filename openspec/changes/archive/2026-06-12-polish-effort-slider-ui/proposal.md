## Why

当前 `/effort` 的 scale surface 已经具备功能，但视觉仍偏普通文本控件，无法体现 reasoning effort 是一个有层级、有强弱方向的调节器。

参考 `terminal_reasoning_slider_neon.py` 的静态视觉样式，将 `/effort` 做成更完整的 cyan slider 面板，可以显著提升控件辨识度，同时不改变现有 Left/Right/Enter/Esc 交互语义。

## What Changes

- 将 `scale` command surface 的视觉改为接近 `terminal_reasoning_slider_neon.py` 的 rounded frame slider。
- 复刻 UI 元素：圆角边框、cyan 标题、`[live]` 状态、`◂` / `▸` 方向箭头、`●` 档位点、`◉` 当前 knob、已选轨道与未选轨道的明暗区分。
- 在轨道下方显示大写缩写档位：`NONE`、`MIN`、`LOW`、`MED`、`HIGH`、`XHIGH`，并高亮当前档位。
- 在面板左下方显示当前真实 effort 值、进度条和状态，例如 `medium  ██████░░░░  active`。
- 增加 RGB 前景色 ANSI helper，用于更接近 demo 的 cyan gradient 和柔和轨道颜色。
- 不复刻 demo 的 raw mode、按键读取、独立渲染循环或额外快捷键；`/effort` 仍只使用现有 input event pipeline，Left/Right 调整，Enter 确认，Esc 取消。

## Capabilities

### New Capabilities

### Modified Capabilities
- `terminal-tui-prototype`: `/effort` 的 `scale` command surface 视觉从简易文本刻度升级为 rounded cyan slider 面板，并保留现有交互语义。

## Impact

- `src/render/footer.ts`：重写 `renderScaleSurface()` 的视觉输出，增加 rounded frame、slider track、labels、meter 和 help line。
- `src/terminal/ansi.ts`：增加 RGB 前景色 helper，供 slider 渐变和柔和颜色使用。
- `src/commands/effort-command-handler.ts`：为 scale options 提供真实值和大写缩写显示文本；不改 key handling。
- `src/types/command.ts`：如需要，可为 scale option 复用现有 `description` 作为显示短标签，不增加业务专用类型。
- `test/render/footer.test.js`、`test/commands/slash-command.test.js`：更新视觉断言，覆盖 rounded frame、`◂` / `▸`、`●` / `◉`、大写 label、meter 和无冗余文案。
- `docs/README.md`、`docs/tui-architecture.md`、`openspec/specs/terminal-tui-prototype/spec.md`：更新 `/effort` UI 描述。
