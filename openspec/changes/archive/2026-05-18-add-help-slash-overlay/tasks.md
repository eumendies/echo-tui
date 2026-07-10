## 1. 扩展输入事件与提交分流

- [x] 1.1 更新 `src/input/event-types.js` 与 `src/input/key-parser.js`，补充 bare Esc 的语义事件与解析测试，同时保持当前长 escape sequence 优先、无跨 chunk 缓冲的 parser 行为不变。
- [x] 1.2 新增独立的 slash 命令解析/执行模块（如 `src/commands/parse-slash-command.js`、`src/commands/run-slash-command.js`），只识别纯 `/help`，并返回结构化结果供 app 层消费。
- [x] 1.3 更新 `src/app/main.js`，在 Enter 提交前调用 slash 模块并根据结果切换 help overlay 状态，而不是直接堆命令特判；同时确保 `/help` 不追加 transcript、不进入输入历史、带后缀文本时仍按普通消息提交。

## 2. 扩展 footer/composer 区域的 help overlay

- [x] 2.1 更新 footer/layout 相关渲染逻辑，为普通 composer surface 之外增加 help overlay surface，并让帮助内容显示在 composer/footer 区域而不是 transcript。
- [x] 2.2 接入 overlay 的 Esc 退出与光标可见性规则：overlay 活跃时隐藏光标，退出后恢复普通空 composer，并确保 resize / 普通 footer redraw 仍走现有渲染路径。

## 3. 补充测试与验证

- [x] 3.1 更新 `test/app/main.test.js`、`test/input/key-parser.test.js`、新增 slash 模块测试及相关 render 测试，覆盖纯 `/help` 命中、`/help` 带后缀文本的普通提交流程、Esc 关闭 overlay、历史隔离和 overlay 渲染分支。
- [x] 3.2 运行 `npm test` 与 `find bin src test -name '*.js' -exec node --check {} \;`，确认最小版 `/help` overlay 行为和语法检查全部通过。
