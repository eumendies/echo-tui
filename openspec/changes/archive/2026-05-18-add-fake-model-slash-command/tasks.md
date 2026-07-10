## 1. 命令运行时实现

- [x] 1.1 新增 `src/commands/model-command-handler.js`，定义写死的 fake model 候选项、纯 `/model` 匹配逻辑和 `select` surface 构造逻辑。
- [x] 1.2 在 `/model` handler 中实现 command session 事件处理：Up/Down 循环移动选中项，Enter 确认并追加本地 assistant 提示，Esc 取消并关闭会话。
- [x] 1.3 将 `/model` handler 注册到 `resolve-slash-command.js` 的默认 handler 列表，保持未命中 slash 输入回退为普通 user message。
- [x] 1.4 确认实现只复用现有 command effect types 和 `select` surface，不新增 renderer 对 `/model` 的特殊分支。

## 2. 测试覆盖

- [x] 2.1 更新 `test/commands/slash-command.test.js`，覆盖 `/model` 的精确匹配、非纯 `/model` 不匹配、初始 surface、方向键移动、Enter 确认和 Esc 取消 effects。
- [x] 2.2 更新 `test/app/main.test.js`，覆盖提交纯 `/model` 后进入 command session、不写入历史/普通 transcript、不启动 fake agent。
- [x] 2.3 增加 app orchestration 测试，覆盖 `/model` session 中 Up/Down 更新 `selectedIndex`、Enter 追加 assistant 提示并关闭 session、Esc 关闭且不追加 transcript。
- [x] 2.4 如现有 footer select surface 测试不足，补充或调整 `test/render/footer.test.js`，确保模型候选列表按统一 `select` surface 渲染且没有命令名特殊逻辑。

## 3. 文档与验证

- [x] 3.1 更新 `docs/tui-architecture.md`，说明 `/model` 作为选择型 slash 命令如何验证当前 handler/effect/surface 扩展路径。
- [x] 3.2 运行 `npm test`，确认所有自动化测试通过。
- [x] 3.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确认所有 JavaScript 文件语法通过。
- [x] 3.4 如实现影响交互式 TUI，使用 `npm start` 手工验证 `/model` 打开、方向键移动、Enter 确认、Esc 取消和普通输入回退路径。
