## Why

`src/input` 和 `src/commands` 已完成 TypeScript 迁移，下一批低风险运行源码自然落在 render 与 terminal 边界。迁移这些模块可以让现有 `src/types/render.ts`、command surface、composer state 和 terminal control helper 类型真正覆盖到渲染链路，同时保持 CommonJS 产物和当前 TUI 行为不变。

## What Changes

- 将 `src/render/` 下的运行源码模块迁移为 TypeScript：`layout`、`blocks`、`footer`、`app-renderer`。
- 将 `src/terminal/` 下的运行源码模块迁移为 TypeScript：`ansi`、`tty`。
- 保持 ANSI 控制序列、display width/wrap 计算、footer redraw、destructive recovery、raw mode setup/cleanup 和 app renderer 门面行为不变。
- 保持运行时输出为 CommonJS JavaScript，继续由 `tsc` 编译到 `dist/`，不引入 ts-node、tsx、loader、bundler 或第三方 TUI 库。
- 更新架构文档和 OpenSpec 主规格中的源码路径说明，使 render/terminal 模块扩展名与迁移结果一致。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `typescript-build-test-pipeline`: 增加 render 与 terminal 运行源码模块可分批迁移为 TypeScript 的要求，并约束编译后测试路径保持兼容。
- `terminal-tui-prototype`: 更新模块组织要求中的 render/terminal 源码路径，并明确迁移不得改变终端控制、渲染布局、footer redraw 或 destructive recovery 行为。

## Impact

- Affected code: `src/render/layout.js`、`src/render/blocks.js`、`src/render/footer.js`、`src/render/app-renderer.js`、`src/terminal/ansi.js`、`src/terminal/tty.js`。
- Affected tests: `test/render/*`、`test/app/main.test.js`、`test/app/command-runtime.test.js`，以及编译后 `dist/test` 运行路径。
- Affected docs/specs: `docs/tui-architecture.md`、`openspec/specs/typescript-build-test-pipeline/spec.md`、`openspec/specs/terminal-tui-prototype/spec.md`。
- No dependency changes: 不新增运行时依赖、测试框架、bundler 或 TUI 库。
