## 1. Surface 类型与投影

- [x] 1.1 在 surface 类型定义中新增通用 `choice` surface，包含 title/message、options、selectedIndex 和 dismissHint 等字段。
- [x] 1.2 将 tool approval 当前授权请求投影为 `choice` surface，而不是普通 `select` surface。
- [x] 1.3 保持 `Allow once` / `Deny` 两个选项不带 description，并保持默认选中、Enter、Up/Down、Esc 的现有决策行为。

## 2. Choice surface 渲染

- [x] 2.1 在 footer renderer 中分发并实现 `choice` surface 渲染。
- [x] 2.2 使用边框、留白和高亮选中项让 choice surface 明显区别于普通 select surface。
- [x] 2.3 实现 choice option 的 description 下一行灰色显示；无 description 时不生成空描述行。
- [x] 2.4 保持普通 select surface 的紧凑单行展示不变，避免影响 `/model`、`/resume` 等命令选择。
- [x] 2.5 确保 choice surface 继续参与现有 pending preview 高度预算、footer 局部重绘和 resize destructive recovery。

## 3. 测试与验证

- [x] 3.1 更新 app 层 tool approval 测试，断言授权请求 surface kind 为 `choice` 且选项仍为 `Allow once` / `Deny`。
- [x] 3.2 增加 footer 渲染测试，覆盖 choice surface 边框、选中项高亮、无 description 的简洁选项。
- [x] 3.3 增加 footer 渲染测试，覆盖带 description 的 choice option 在下一行灰色显示，且不使用 `label — description` 单行拼接。
- [x] 3.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
