## Why

`src/app/main.ts` 同时承担生产装配、渲染协调、输入路由、assistant turn 生命周期、shell mode 和 MCP bootstrap，主流程阅读成本偏高。与此同时 `src/app/` 下的 state context、command runtime/host 等文件都平铺在同一目录，职责边界已经出现但目录结构没有表达这些边界。

## What Changes

- 拆分 `main.ts` 中最重的 assistant turn 生命周期逻辑，让 `main.ts` 保留为粗粒度 app 装配与主流程入口。
- 对 `src/app/` 内现有文件按自然职责归类到少量子目录，避免继续平铺增长。
- 将可以整合的同类 app 文件放到同一个子目录中，但避免把职责拆得过细、引入大量小文件或回调 glue。
- 更新相关 import 路径与测试引用，保持现有 TUI 行为、命令行为、工具审批、用户提问、shell mode、MCP bootstrap 和响应中断语义不变。
- 不引入新的第三方依赖、不恢复测试专用 options/dependencies 注入点。

## Capabilities

### New Capabilities
- `app-module-organization`: 约束 `src/app/` 的粗粒度目录归类、`main.ts` 拆分边界，以及重组后行为保持不变。

### Modified Capabilities
- `app-context-state-container`: 放宽并更新 AppContext 及相关子 context 的源码路径要求，使其可以位于 `src/app/` 的职责子目录中。
- `composition-root-simplicity`: 明确 main/app 装配入口瘦身时仍不得通过泛化 options/dependencies 或过细 wrapper 转移复杂度。

## Impact

- 主要影响 `src/app/main.ts` 以及 `src/app/` 下 context、command runtime/host、tool approval、user question 等 app 内部模块路径。
- 需要更新引用这些模块的源码与测试 import/require 路径。
- TypeScript 编译输出路径会随源码目录变化而变化，但不改变 CLI 入口、公开运行行为或用户配置格式。
- 验证范围包括 `npm run typecheck`、`npm test` 和 JS syntax check；交互式行为以现有 app/runtime 测试与必要手工检查建议覆盖。
