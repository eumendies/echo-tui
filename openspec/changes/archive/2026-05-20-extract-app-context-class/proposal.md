## Why

`src/app/main.js` 当前同时承担依赖装配、运行时状态持有、上下文派生、持久化辅助和事件编排，局部变量与 helper 已明显膨胀。继续在这个文件里叠加状态与命令上下文，会让后续命令扩展、测试维护和职责边界越来越难控制。

现在需要把这些“属于 app 实例、但不属于 command runtime / renderer / agent adapter 的状态与上下文逻辑”收拢到一个实例级 `AppContext` 类中，在不改变现有 CLI、slash runtime 和 transcript persistence 契约的前提下，降低 `main.js` 的复杂度，并顺手移除只为测试服务的 `getState()` 观察口。

## What Changes

- 新增实例级 `AppContext` 类，统一持有 `createApp()` 里的运行时状态，例如 composer、transcript records、session 指针、response lock、pending、spinner、input history 等。
- 把当前散落在 `main.js` 中的状态派生与基础操作迁移到 `AppContext`，包括 cwd/banner/render state 生成、`/model` 信息读取与脱敏、session 持久化/恢复、transcript 清空等。
- 保持 `createApp(options).runAgent`、`createApp(options).resolveSlashCommand` 等真正有价值的注入 seam，不再为了旧测试继续保留 `getState()` 之类的测试专用状态快照接口。
- 保持 `command-runtime` 继续负责命令会话与 effect interpreter，不把 app 级状态机逻辑下沉进去。
- 更新架构文档，明确 `main.js`、`AppContext`、`command-runtime` 的职责边界。

## Capabilities

### New Capabilities
- `app-context-state-container`: 定义实例级 `AppContext` 对 app runtime 状态、上下文派生和基础状态操作的职责边界。

### Modified Capabilities
- `terminal-tui-prototype`: 调整 app orchestration 的模块边界要求，使 `main.js` 可通过实例级状态容器组织共享状态与上下文，但对外行为与既有交互契约保持不变。

## Impact

- 受影响代码：`src/app/main.js`，以及新增的 `src/app/app-context.js`（或等价命名模块）；必要时会波及 `src/app/command-runtime.js` 的依赖装配方式和相关测试。
- 受影响测试：`test/app/main.test.js` 需要去掉对 `getState()` 的依赖，改为验证公开行为；必要时新增 `AppContext` 单测覆盖原先通过快照断言的状态逻辑。
- 受影响文档：`docs/tui-architecture.md` 需要同步新的 app 内部模块边界。
- 不引入新的运行时第三方依赖，不改变终端可见行为、slash 命令契约、持久化 schema 或真实 LLM adapter 对外接口。
