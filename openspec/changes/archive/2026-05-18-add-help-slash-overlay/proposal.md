## Why

当前 TUI 的输入区已经支持多行编辑、历史浏览和常见控制键，但仍缺少一种适合在终端内承载“临时帮助信息”的轻量交互。若把 `/help` 当作普通消息发送给 agent，不仅语义不对，也会把帮助内容混入 transcript 和输入历史，破坏命令式交互应有的短生命周期体验。

现在先做一个最小版 `/help` 是合适的：它可以复用现有 footer/composer 重绘架构，在不引入命令参数、命令补全或命令列表的前提下，先验证“纯 slash 命令触发覆盖式临时面板、Esc 退出”的交互模型是否成立。

## What Changes

- 增加一个最小版 slash 命令入口，只识别纯 `/help`，用于显示当前输入和控制键说明；命令识别与执行通过独立的 slash 模块承载，而不是把解析细节直接堆进 `src/app/main.js`。
- 明确 slash 识别规则：仅当提交内容精确等于 `/help` 时进入命令交互；若 `/help` 后还带其他文本，则按普通 user message 提交给 agent。
- 增加一个覆盖在 composer/footer 区域的临时 help overlay，用来显示按键说明，而不是把帮助内容追加到 transcript。
- 增加 Esc 退出 help overlay 的交互；退出后恢复普通 composer 输入态。
- 明确 `/help` 不进入 session 输入历史，也不触发 agent thinking / streaming 生命周期。
- 更新相关提示和测试，覆盖纯 `/help`、带后缀文本时的普通提交流程、overlay 打开/关闭，以及历史隔离行为。

## Capabilities

### New Capabilities
- 无

### Modified Capabilities
- `terminal-tui-prototype`: 扩展输入区交互，支持纯 `/help` 触发的临时 help overlay，并定义其与普通消息提交、Esc 退出和输入历史之间的边界。

## Impact

- 受影响代码：`src/app/main.js`、新增 slash 命令解析/执行模块、footer/composer 相关 render 模块、输入事件定义与按键解析，以及对应测试。
- 受影响行为：Enter 提交前的 slash 判定、composer 区域的临时覆盖内容、Esc 在 overlay 模式下的退出语义、`/help` 与输入历史/agent 生命周期的隔离。
- 本次不新增运行时依赖，不实现 slash 参数、命令补全、命令选择器或新的 transcript role。
