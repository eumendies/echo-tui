## 1. AppContext 状态容器

- [x] 1.1 新增 `src/app/app-context.js`，实现实例级 `AppContext` 类，并收拢 `createApp()` 当前持有的共享运行时状态字段。
- [x] 1.2 把 cwd/banner/render state 生成、`/model` 信息读取与脱敏、session 持久化/恢复、transcript 清空等高耦合 helper 迁移到 `AppContext` 方法中。

## 2. main.js 与 command runtime 集成

- [x] 2.1 修改 `src/app/main.js`，改为创建并使用 `AppContext` 实例，同时保持 `createApp(options)`、`runAgent`、`resolveSlashCommand` 等现有注入 seam 不变。
- [x] 2.2 调整 `command-runtime` 的依赖装配方式，使其继续通过窄回调访问 app 状态，但不接管 `AppContext` 或 app 顶层状态机职责，并删除 `createApp().getState()`。

## 3. 回归测试与文档

- [x] 3.1 更新 `test/app/main.test.js`，移除对 `getState()` 的依赖；必要时新增 `test/app/app-context.test.js`，把原先依赖状态快照的断言迁移到 `AppContext` 单测和公开行为断言上。
- [x] 3.2 更新 `docs/tui-architecture.md`，说明 `main.js`、`AppContext`、`command-runtime` 的新职责边界。
- [x] 3.3 运行 `npm test` 与 `find bin src test -name '*.js' -exec node --check {} \;`，确认重构后的实现与测试全部通过。
