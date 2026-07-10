## Why

当前 slash 命令只有在用户完整输入并提交纯命令后才会生效。用户需要记住 `/help`、`/model`、`/clear`、`/resume` 等命令名，发现性和输入效率都偏弱；在 composer 中输入 `/` 时直接提示可用命令，可以让本地命令更像可探索的 TUI 功能。

## What Changes

- 在 composer 输入以 `/` 开头的命令前缀时，在 footer 内显示 slash 命令提示列表。
- 为默认 slash command handler 增加用户可见描述，用于提示项展示，例如 `/model — 切换模型`。
- 支持通过 Up/Down 在提示列表中移动当前候选项。
- 支持 Tab 将当前候选命令补全到 composer；补全结果保持纯命令文本，不自动追加空格。
- 提示列表只作为 composer 的临时补全 UI，不启动 command session、不写 transcript、不进入输入历史、不触发真实 agent。
- assistant response 进行中或已有 active command session 时不显示 slash 命令提示。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 扩展本地 slash 命令与 composer/footer 行为，增加 slash 命令提示、方向键选择和 Tab 补全的外部可见行为。

## Impact

- `src/input/`: 需要新增 Tab 语义输入事件，并在 key parser 中识别 `\t` / `\x09`。
- `src/types/command.ts` 与 `src/commands/*`: slash handler 需要暴露 `description` 或等价命令元数据。
- `src/app/`: 需要管理 slash suggestion 的选择状态，并在输入事件路由中处理 Up/Down/Tab 的优先级。
- `src/render/`: footer layout 需要在普通 composer 下方渲染临时 slash suggestion 列表，同时保留 composer 光标。
- `test/`: 需要覆盖 Tab 解析、提示显示/隐藏、过滤、选择移动、补全和与 command session / response lock 的互斥关系。
- `docs/` 与 OpenSpec 主规格需要同步说明该交互。
