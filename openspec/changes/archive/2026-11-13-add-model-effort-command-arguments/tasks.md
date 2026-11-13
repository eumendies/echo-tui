## 1. `/model` 参数支持

- [x] 1.1 把 `match` 改为接受 `/model` 与空格分隔参数，保持 `/modelx` 不匹配
- [x] 1.2 实现参数解析与模型名解析：大小写不敏感精确匹配 `models[].model`，命中唯一时返回对应 profile id
- [x] 1.3 实现候选 info surface：列出模型名与 provider 并标出当前项，区分「无法匹配」与「匹配到多个 profile」
- [x] 1.4 在 `start` 中按「配置错误 → 参数解析 → 应用 → 保存失败」顺序分支，无参数保持现有面板

## 2. `/effort` 参数支持

- [x] 2.1 把 `match` 改为接受 `/effort` 与空格分隔参数，保持 `/effortx` 不匹配
- [x] 2.2 实现参数解析：大小写不敏感匹配 `REASONING_EFFORTS`，包含 `none`
- [x] 2.3 实现非法值 info surface：列出全部合法级别与当前模型、当前 effort
- [x] 2.4 在 `start` 中按「配置错误 → 参数解析 → 应用 → 保存失败」顺序分支，无参数保持现有 scale 面板

## 3. 测试

- [x] 3.1 反转 `test/commands/slash-command.test.js` 中三处「带参数不匹配」断言
- [x] 3.2 覆盖 `/model` 参数成功、大小写变体、未命中、多命中、配置错误与保存失败
- [x] 3.3 覆盖 `/effort` 参数成功、大小写变体、`none`、非法值、配置错误与保存失败
- [x] 3.4 覆盖 `/modelx`、`/effortx` 与无参数面板行为不变

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`
- [x] 4.2 运行 `npm test`
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [ ] 4.4 手工验证：`/model <模型名>` 后 footer 状态行更新，`/model <不存在>` 列出候选
- [ ] 4.5 手工验证：`/effort high` 后状态行更新，`/effort med` 列出六个合法值
