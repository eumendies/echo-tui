## Why

当前 TUI 已经通过 Tab 在 normal、plan、shell ctx、shell local 四种用户可见模式之间切换，但 slash 命令仍只有 `/plan`，只能覆盖 normal/plan 两态。随着 shell mode 和 shell local 行为加入，单独的 `/plan` 命令已经不能表达完整模式模型，需要统一为 `/mode`。

## What Changes

- **BREAKING**: 删除 `/plan` slash 命令入口，不再支持 `/plan`、`/plan on`、`/plan off`。
- 新增 `/mode` slash 命令，用于查看和切换四种 interaction mode：`normal`、`plan`、`shell`、`shell-local`。
- `/mode` 无参数时打开选择 surface，用户可用上下键和 Enter 选择目标模式。
- `/mode <mode>` 支持直接切换到指定模式，例如 `/mode plan`、`/mode shell-local`。
- plan mode system prompt 中的退出指引从 `/plan off` 更新为 `/mode normal`。
- Tab 循环切换四种模式的行为保持不变。

## Capabilities

### New Capabilities

- `app-mode-command`: 定义 `/mode` 命令的外部行为、四态模式选择和 `/plan` 移除语义。

### Modified Capabilities

- `terminal-tui-prototype`: 更新 plan mode 引导文案和 slash 命令入口要求，使用户通过 `/mode normal` 退出 plan mode。
- `command-host-runtime`: 更新默认 slash command 集合，使用 `/mode` 替代 `/plan`。

## Impact

- 影响 slash command handler：新增 `/mode` handler，移除 `/plan` handler 注册和实现。
- 影响 interaction mode 模型：`InteractionMode` 从三态扩展为四态，并移除独立 shell context policy 的必要性。
- 影响 prompt：plan mode system prompt 的退出命令改为 `/mode normal`。
- 影响测试：slash command、app main、footer/status line、prompt 相关测试中 `/plan` 预期需要改为 `/mode`。
