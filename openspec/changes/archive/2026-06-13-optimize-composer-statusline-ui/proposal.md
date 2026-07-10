## Why

当前普通输入态 footer 的 composer 只是裸文本行，status line 也是线性拼接文本；随着模型、推理等级、context usage、模式和快捷键信息增加，视觉层级不够清晰，也不易和现有 cyan 系列命令面板保持一致。现在已经有 demo 验证了 boxed composer 与 segmented status line 的方向，可以在不改变交互语义的前提下优化 TUI 底部信息架构。

## What Changes

- 将普通 composer 渲染为顶满终端安全宽度的 cyan 边框输入框，保留当前项目的 `> ` 输入前缀。
- composer 空内容时在输入框内显示辅助 placeholder，包含 `/` 命令入口、`Ctrl+J` 换行和 Enter 发送等提示；输入非空后 placeholder 消失。
- composer 边框不显示 `Message` 或其他标题文字，保持纯输入框外观。
- 将普通 status line 改为 segmented 单行状态条，左侧优先显示模型、推理等级和目录，右侧显示真实 context usage 与当前状态。
- status line 暂不显示 git branch。
- 将 reasoning effort 从模型文本中拆为独立 segment，并使用固定 cyan 圆点展示。
- 保留 command、approval、user-question surface 替换普通 composer/status line 的既有语义；不改变 transcript、agent、session 或 provider 行为。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 调整普通 footer composer 与 status line 的可见渲染、信息分组、placeholder 和 effort 色彩契约。

## Impact

- 影响 `src/render/footer/composer-surface.ts`、`src/render/layout.ts`、`src/render/footer/scale-surface.ts` 或相邻 footer helper 的渲染逻辑。
- 可能需要扩展 `StatusLineState` 与 App/RenderContext 派生状态，以携带独立 reasoning effort 而不是把 effort 拼进模型标签。
- 需要更新 footer renderer、AppContext/render state 相关测试，以及 README/architecture 中的 footer/status line 描述。
- 不新增第三方依赖，不切换 alternate screen，不改变 raw mode 输入处理和 transcript persistence。
