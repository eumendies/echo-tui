## 1. 扩展输入事件与按键映射

- [x] 1.1 更新 `src/input/event-types.js` 与 `src/input/key-parser.js`，为 Up/Down 和 `Ctrl+A/E/U/K/W` 增加语义事件与按键映射，同时保持当前无缓冲 parser 行为不变。
- [x] 1.2 更新输入层测试，覆盖新增 escape sequence / control character 的解析结果，并明确本次不处理跨 chunk 序列缓冲。

## 2. 扩展 composer 与 app 状态机

- [x] 2.1 扩展 `src/input/composer.js`，补充多行垂直移动、删除到行首/行尾、删除前一个词等 helper，并保持现有字符数组光标模型。
- [x] 2.2 更新 `src/app/main.js`，增加 session 级输入历史与显式历史浏览状态，只在 composer 为空且 agent 不在 thinking/streaming 时让 Up/Down 进入历史浏览。
- [x] 2.3 在 `src/app/main.js` 中实现 Down 退出历史时清空 composer、成功提交后追加历史记录，以及 composer 非空时 Up/Down 走垂直移动而不是历史浏览。

## 3. 补充验证与交互文案

- [x] 3.1 更新 `test/app/main.test.js`、`test/input/key-parser.test.js` 及相关 composer 测试，覆盖历史浏览边界、响应活跃期间禁用历史、垂直移动和 `Ctrl+A/E/U/K/W` 行为。
- [x] 3.2 更新 footer hint 或相关文档中的控制说明，并运行 `npm test`、`find bin src test -name '*.js' -exec node --check {} \;` 验证新增输入能力。
