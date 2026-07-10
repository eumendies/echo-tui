## Why

app 编排层、语义 context 和源码 bin shim 使用 TypeScript 源码。app、command、render、agent 与 transcript 协议类型覆盖顶层状态编排和入口 shim 边界，同时运行产物使用 CommonJS JavaScript，用户可见行为保持稳定。

## What Changes

- `src/app/` 下运行源码模块使用 TypeScript：`main`、`app-context`、`command-runtime`、`composer-context`、`model-context`、`render-context`、`transcript-context`、`turn-context`。
- 源码 CLI entry shim 位于 `bin/echo-tui.ts`，编译产物输出并运行 `dist/bin/echo-tui.js`。
- 复用 `src/types/` 中的 app、command、agent、render、transcript 协议类型，并在外部输入边界对终端事件、命令 effect、agent 错误和 transcript session 值做显式收窄。
- app 编排、slash command runtime、thinking / streaming lifecycle、transcript 持久化、input history、destructive resize recovery 和测试注入行为保持稳定。
- 运行时输出为 CommonJS JavaScript，由 `tsc` 编译到 `dist/`，不引入 bundler、loader、ts-node、tsx 或新的运行时依赖。
- 架构文档和 OpenSpec 主规格使用 `bin/echo-tui.ts` 与 `src/app/*.ts` 路径引用。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `typescript-build-test-pipeline`: 约束 app 运行源码模块和源码 bin shim 使用 TypeScript，并约束编译后 app / commands / render 测试路径兼容。
- `terminal-tui-prototype`: 模块组织使用 `bin/echo-tui.ts` 与 `src/app/*.ts` 路径，并明确 app 编排、command runtime、context 边界和 TUI 行为。
- `app-context-state-container`: 约束 `AppContext` 与各语义子 context 的实现路径、实例级状态隔离、门面职责和基础状态操作语义。

## Impact

- Affected code: `bin/echo-tui.ts`、`src/app/main.ts`、`src/app/app-context.ts`、`src/app/command-runtime.ts`、`src/app/composer-context.ts`、`src/app/model-context.ts`、`src/app/render-context.ts`、`src/app/transcript-context.ts`、`src/app/turn-context.ts`。
- Affected tests: `test/app/*`、`test/commands/slash-command.test.js`、`test/render/app-renderer.test.js`，以及编译后 `dist/test` 运行路径。
- Affected docs/specs: `docs/tui-architecture.md`、`openspec/specs/typescript-build-test-pipeline/spec.md`、`openspec/specs/terminal-tui-prototype/spec.md`、`openspec/specs/app-context-state-container/spec.md`。
- No dependency changes: 不新增运行时依赖、测试框架、bundler、数据库或持久化后端。
