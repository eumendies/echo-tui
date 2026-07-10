## Context

仓库使用 TypeScript 编译、类型检查和编译后测试运行。app 运行时边界和源码 bin shim 均使用 TypeScript：`main` 负责顶层依赖装配、输入事件分发和 assistant lifecycle；`command-runtime` 负责 slash command session 与 effect interpreter；`app-context` 以及 composer / model / render / transcript / turn 五个子 context 负责共享状态组合和语义边界；`bin/echo-tui.ts` 负责定位编译后的 app main。

运行输出是 CommonJS，`package.json` 为 `type: commonjs`，运行时不得依赖 ts-node、tsx、自定义 loader、bundler、第三方 TUI 库、数据库或新的持久化后端。app 层运行时 shape 由显式类型边界表达，slash command runtime 语义、pending/thinking/streaming 生命周期、transcript 持久化、resize destructive recovery、输入历史和测试注入行为保持稳定。

## Goals / Non-Goals

**Goals:**

- `bin/echo-tui`、`src/app/main`、`src/app/app-context`、`src/app/command-runtime` 和五个语义子 context 使用 TypeScript，并由 `tsc` 输出 CommonJS JavaScript 到 `dist/`。
- 复用或补齐 `src/types/app.ts`、`src/types/command.ts`、`src/types/render.ts`、`src/types/agent.ts`、`src/types/transcript.ts` 中的协议类型，让顶层 app 编排、context 和 command runtime 依赖显式协议而不是隐式对象形状。
- 无扩展名 `require('../app/...')` 等加载路径在编译后可用，编译后 app / commands / render 测试路径兼容。
- 架构文档和主规格使用 `bin/echo-tui.ts` 与 `src/app/*.ts` 路径引用。

**Non-Goals:**

- 不重构 app 状态机，不调整 slash command 注册、effect 语义或 transcript 持久化格式。
- 测试文件不改写为 TypeScript，也不新增仅供测试使用的 runtime seam。
- 不改变 `createApp`、`AppContext`、`createCommandRuntime`、各 context class 的公开导出名和运行时契约。
- 不引入新的运行时依赖、日志层、状态管理框架、数据库或持久化抽象。

## Decisions

1. **`src/app/` 作为一个整体类型边界维护。**
   - 选择原因：app 目录中的模块彼此强耦合，`main`、`command-runtime`、`AppContext` 与五个子 context 共享大量对象 shape；作为整体维护可以避免临时跨边界和文档同步成本。

2. **导出名称、顶层装配顺序和生命周期语义保持稳定。**
   - 保留 `createApp`、`AppContext`、`createCommandRuntime`、`ComposerContext`、`ModelContext`、`RenderContext`、`TranscriptContext`、`TurnContext` 等导出与行为。
   - 选择原因：CLI、测试和文档都围绕这些稳定入口构建；变更风险应限制在类型声明和源码组织边界，而不是混入架构重构。

3. **优先复用已有协议类型，在信任边界补局部窄类型。**
   - `main` 与 `command-runtime` 应复用 command effect、command session、input event、render state、agent callback 和 transcript record 等协议类型。
   - `app-context` 与五个子 context 应尽量复用 app / render / transcript / agent 相关协议类型；对 `unknown` 错误、terminal size、slash session patch、transcript session 值和事件对象使用局部收窄，而不是引入宽泛 `any`。
   - 选择原因：类型表达 runtime shape，同时保留对外部值的显式校验与最小信任面。

4. **验证基线覆盖构建、类型检查、编译后测试和语法检查。**
   - 运行 `npm run build`、`npm run typecheck`、`npm test`，并运行 `find bin src test -name '*.js' -exec node --check {} \;` 与 `node --check dist/bin/echo-tui.js`。
   - 使用 `rg` 复核 docs/specs/源码中的 app 与 bin 路径引用。
   - 选择原因：app 行为由 `test/app/*`、commands 测试和 render 集成测试覆盖；测试应适配 runtime code，而不是反向约束 production code。

## Risks / Trade-offs

- [Risk] `main` 同时串接 terminal、input、render、agent、persistence 和 command runtime，容易把隐式状态顺手重构。→ Mitigation：保持函数分层、依赖装配顺序和回调 contract 稳定，只添加类型与必要收窄。
- [Risk] `command-runtime` 直接解释 command effects，若对 session / patch shape 做错误假设，可能破坏 `/help`、`/clear`、`/resume` 行为。→ Mitigation：复用 command 协议类型，保持对无效 effect 的显式错误，并依赖 app / commands 测试回归。
- [Risk] `AppContext` 与各子 context 共享大量对象引用，若误改 getter / setter / facade 语义，可能破坏实例级状态隔离。→ Mitigation：保持导出、字段门面与基础状态操作顺序稳定，并复用 `test/app/app-context.test.js` 覆盖。
- [Risk] 文档和主规格路径引用与源码组织不一致。→ Mitigation：同步 `docs/tui-architecture.md`、相关主规格，并用 `rg` 扫描路径引用。
