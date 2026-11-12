## Why

composer 目前只支持字符级左右移动（`Left`/`Right`）和「删除前一个词」（`Ctrl+W`），编辑多行长 prompt 时只能逐字符挪动光标，删除后半段也要靠 `Ctrl+K` 分段操作。

同时，多数终端在按下 `Ctrl+←/→`、`Alt+←/→`、`Ctrl+Delete`、`Alt+Delete` 时已经发出带修饰键的 CSI 序列，但这些序列当前被解析器当作终端报告静默丢弃——用户按键完全没有反应，也没有任何提示。

## What Changes

- composer 新增按词移动：向前移动到上一个词边界、向后移动到下一个词边界
- composer 新增「删除后一个词」，与既有 `Ctrl+W`（删除前一个词）对称
- key parser 识别 6 个 CSI 修饰键序列：`Ctrl/Alt + Left`、`Ctrl/Alt + Right`、`Ctrl/Alt + Delete`
- key parser 同时识别 4 个 ESC 前缀序列：`ESC b`、`ESC f`、`ESC d`、`ESC DEL`。macOS 的 iTerm2 与 Terminal.app 默认把 `Option+←/→` 映射为 readline 风格的 `ESC b`/`ESC f`，只支持 CSI 形式会让这些键在 macOS 上完全不可用
- 修正 CPR 前缀探测过宽导致的误吞：带修饰键的方向键序列不再被当作 cursor position report
- 修正 ESC 前缀按键当前的有害行为：`Option+⌫` 与 `Option+B` 等不再先触发 Esc 的中断路径、再把字母插入 composer
- `/help` 与 README 的按键表同步新增条目
- 本次不改变词边界判定规则，沿用既有的「连续空白 / 连续非空白」切分；中日韩文本仍按整段处理

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `terminal-tui-prototype`: 「composer 字符级编辑」requirement 扩展为覆盖按词移动与按词删除，并把 CSI 修饰键序列纳入输入解析的既定契约

## Impact

- `src/input/event-types.ts`：新增按词移动与删除后一词的语义事件
- `src/input/key-parser.ts`：注册 CSI 修饰键序列，并收紧 cursor position report 的识别条件
- `src/input/composer.ts`：新增词级移动与向后删除函数，并接入 `applyComposerEditEvent` 分发
- `src/commands/help-command-handler.ts`、`README.md`：按键说明同步
- `test/input/key-parser.test.js`、`test/input/composer.test.js`：新增序列解析与词级编辑用例
- 不影响 transcript、session 持久化、provider 请求或 `--once` 无终端路径
