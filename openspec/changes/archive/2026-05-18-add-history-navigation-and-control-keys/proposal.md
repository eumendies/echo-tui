## Why

当前 TUI 已经具备基本的字符编辑、左右移动、Home/End、提交和多行输入能力，但仍缺少更接近终端 readline 习惯的控制按键。用户无法用上下键回看历史输入，也不能用 Ctrl+A/E/U/K/W 快速完成行级导航和删除，这让连续交互时的编辑效率明显偏低。

现在补上这组按键是合适的，因为现有输入链路已经具备清晰的 parser → app event → composer 操作分层，适合继续沿着语义事件扩展；同时本次范围可以刻意保持克制，不引入持久化历史、draft 恢复或跨 chunk escape sequence 缓冲等额外复杂度。

## What Changes

- 为输入层增加上下键语义，用于在指定条件下浏览本次 session 内的已提交历史输入。
- 增加 Ctrl+A、Ctrl+E、Ctrl+U、Ctrl+K、Ctrl+W 五组控制按键，支持快速移动到行首/行尾，以及删除到行首/行尾/前一个词。
- 明确上下键的优先级规则：只有在 composer 为空且 agent 不处于 thinking / streaming 时才浏览历史；当 composer 中已有内容时，上下键用于在多行 composer 中移动光标，而不是进入历史浏览。
- 保持历史能力为进程内 session 级状态，不做落盘持久化，不引入 draftBeforeHistory 恢复模型。
- 保持当前 key parser 的无缓冲实现不变；本 change 不解决跨 chunk escape sequence 缓冲问题。
- 更新 hint 与测试，覆盖新增控制按键、历史浏览边界和多行 composer 下的上下移动语义。

## Capabilities

### New Capabilities
- 无

### Modified Capabilities
- `terminal-tui-prototype`: 扩展输入编辑与历史浏览行为，为 footer/composer 增加 session 内历史输入导航和常见 readline 风格控制按键。

## Impact

- 受影响代码：`src/input/key-parser.js`、`src/input/event-types.js`、`src/input/composer.js`、`src/app/main.js` 以及相关测试。
- 受影响行为：composer 的上下键语义、session 内历史浏览、Ctrl+A/E/U/K/W 快捷编辑、footer hint 文案。
- 不新增运行时依赖，不改变现有 fake agent 生命周期、render 架构和 transcript append-only 模型。
