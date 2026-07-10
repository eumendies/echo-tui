## 1. Command effect 与 runtime 能力

- [x] 1.1 在 `src/commands/command-effects.js` 新增清空 transcript 的 effect type 和 helper，保持现有 create*Effect 命名风格。
- [x] 1.2 在 `src/app/command-runtime.js` 解释清空 transcript effect，通过 app 注入的窄回调执行真实清空，并保持未知 effect 显式报错。
- [x] 1.3 在 `src/app/main.js` 提供清空 transcript records 的 runtime dependency，确认只清空 transcript、不修改 input history。

## 2. /clear slash handler 与注册

- [x] 2.1 新增 `src/commands/clear-command-handler.js`，只匹配纯 `/clear`，启动 `confirm` command surface，并支持 Enter 确认、Esc 取消。
- [x] 2.2 将 `/clear` handler 注册到默认 slash resolver，保持 `/help`、`/model` 和自定义 resolver 行为不变。
- [x] 2.3 确认 `/clear more` 等带后缀输入回退普通消息路径，不进入 command session。

## 3. 渲染与 app 集成

- [x] 3.1 清空 transcript 后使用现有 app renderer 能力重绘当前 app snapshot，确保旧 transcript 内容不再可见。
- [x] 3.2 保持 `/clear` 打开、确认和取消时不写入输入历史、不启动 fake agent、不追加 transcript record。
- [x] 3.3 保持 `/clear` 确认后 Up/Down 历史浏览仍可回到清空前成功提交的普通消息。

## 4. 测试覆盖

- [x] 4.1 补充 `test/render/footer.test.js`，直接覆盖 `confirm` command surface 的渲染、确认/取消提示和隐藏光标行为。
- [x] 4.2 补充 command handler / resolver 测试，覆盖 `/clear` 匹配、surface、确认 effects、取消 effects 和普通消息回退。
- [x] 4.3 补充 command runtime 测试，覆盖清空 transcript effect 的解释和未知 effect 回归。
- [x] 4.4 补充 app 集成测试，覆盖 `/clear` 打开、Enter 清空 transcript、Esc 保持 transcript、response 期间阻止 `/clear`、以及输入历史保留。

## 5. 文档与验证

- [x] 5.1 更新 `docs/tui-architecture.md`，把 `/clear` 加入已接入 slash 命令，并将 `confirm` surface 示例更新为 `/clear`。
- [x] 5.2 更新 OpenSpec 主 spec 同步所需的 delta 内容，确保 `/clear` 行为可归档。
- [x] 5.3 运行 `npm test`，确认全量自动化测试通过。
- [x] 5.4 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确认所有 JavaScript 文件语法通过。
- [x] 5.5 使用 `npm start` 手工验证 `/clear`：打开确认面板、Enter 清空 transcript、Esc 取消、`/clear more` 普通提交、清空后 Up/Down 历史保留。
- [x] 5.6 强化 `confirm` command surface 的视觉确认感：在原布局上高亮 Enter 确认操作，并更新渲染测试与文档/spec。
