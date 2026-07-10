## Why

当前 TUI 的 transcript、pending preview 和最终 assistant block 视觉布局不一致，assistant streaming 完成时会从“同一行输出”跳变成“标签换行输出”，影响稳定感和专业度。该变更聚焦提升视觉一致性，让原型更接近可长期使用的终端交互体验。

## What Changes

- 统一 user、assistant、pending assistant 的消息布局：符号前缀和文本在同一行开始，多行内容按文本列对齐。
- 移除 transcript 中的 `user:` / `assistant:` 文本标签，改用更轻量的视觉符号区分角色。
- 用户消息使用与 composer 一致的 `>` 作为前缀，并使用克制的灰色背景或灰色强调。
- assistant 完成消息使用 `◆` 前缀，pending assistant 使用 `◇` 前缀。
- assistant thinking 阶段增加 spinner 动画，并在 thinking 期间持续重绘 pending preview。
- 统一 pending preview 和最终 assistant block 的布局，避免 streaming 完成时发生视觉跳版。
- 优化 hint 和 banner 的视觉层级，降低装饰感，强调 session 信息和操作提示。
- 保持当前终端运行、append-only transcript、footer 局部重绘、不切 alternate screen 等既有约束。

## Capabilities

### New Capabilities

无。

### Modified Capabilities
- `terminal-tui-prototype`: 修改 transcript、pending preview、assistant thinking、banner 和 hint 的视觉呈现要求。

## Impact

- 主要影响 `src/render/blocks.js`、`src/render/footer.js`、`src/render/layout.js` 和 `src/app/main.js`。
- 可能需要在 `src/terminal/ansi.js` 增加背景色或样式 helper。
- 可能需要调整 `src/agent/fake-agent.js` 或 app 层 callback，以驱动 thinking spinner 的定时刷新。
- 更新 `docs/README.md` 和 `docs/tui-architecture.md` 中的视觉行为说明。
