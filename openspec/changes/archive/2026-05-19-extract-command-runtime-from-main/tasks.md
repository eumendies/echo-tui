## 1. Command runtime 模块

- [x] 1.1 新增 `src/app/command-runtime.js`，实现 `createCommandRuntime()`，保存 `activeCommandSession` 和 `commandSessionConfig`。
- [x] 1.2 将 slash command effect interpreter 从 `src/app/main.js` 迁移到 `command-runtime.js`，保持所有现有 effect type 的行为和显式错误不变。
- [x] 1.3 在 command runtime 中实现 `startFromText(text)`，负责调用 `resolveSlashCommand(text)`、执行 handler `start(text, context)` effects，并在命中时消费提交。
- [x] 1.4 在 command runtime 中实现 `handleEvent(event)`，负责活跃 command session 的事件分发、Exit 处理和 effects 后 footer redraw。
- [x] 1.5 暴露 `hasActiveSession()`、`getSurface()`、`getConfig()` 和 `getSnapshot()`，供 `main.js` 组装 render state 与测试状态。

## 2. App 集成

- [x] 2.1 修改 `src/app/main.js` 创建并使用 command runtime，移除内联 `activeCommandSession`、`commandSessionConfig`、`createCommandContext()`、`applyEffects()` 和 `handleActiveCommandSessionEvent()`。
- [x] 2.2 保持 `submitComposer()` 的行为不变：活跃 command session、response lock 和空输入仍阻止普通提交；slash 命中仍不写入历史、不启动 fake agent。
- [x] 2.3 保持 `createRenderState()` 和 `getState()` 对外形状兼容，继续暴露 `commandSurface`、`activeCommandSession` 和 `commandSessionConfig` 的快照。

## 3. 测试覆盖

- [x] 3.1 新增 `test/app/command-runtime.test.js`，覆盖启动命令、未命中回退、session config、追加 transcript、更新/关闭 session、reset composer 和未知 effect 错误。
- [x] 3.2 更新或保留 `test/app/main.test.js` 中 `/help`、`/model` 和自定义 slash handler 集成测试，确认用户可见行为不变。
- [x] 3.3 运行受影响测试文件，确认 command runtime 与 app orchestration 测试通过。

## 4. 文档与验证

- [x] 4.1 更新 `docs/tui-architecture.md`，将 effect interpreter 和 command runtime 的归属从 `src/app/main.js` 调整为 `src/app/command-runtime.js`。
- [x] 4.2 运行 `npm test`，确认全量自动化测试通过。
- [x] 4.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确认所有 JavaScript 文件语法通过。
- [x] 4.4 如实现影响交互式 TUI，使用 `npm start` 手工验证 `/help`、`/model` 和普通消息提交路径。
