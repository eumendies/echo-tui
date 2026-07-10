## MODIFIED Requirements

### Requirement: TypeScript 编译输出 CommonJS 产物
系统 SHALL 提供 TypeScript 编译管线，将仓库中的应用源码、测试和类型定义编译或复制到 `dist/` 下的 CommonJS JavaScript 产物。编译管线 SHALL NOT 要求运行时通过 ts-node、tsx、自定义 loader 或 bundler 执行源码。系统 MAY 引入官方 MCP SDK 运行时依赖，但源码仍 SHALL 通过现有 TypeScript 编译管线输出可由 Node.js 直接执行的 CommonJS 产物。

#### Scenario: build 生成 dist 产物
- **WHEN** 开发者运行 TypeScript build 命令
- **THEN** 系统 SHALL 使用 `tsc` 读取仓库级 TypeScript 配置
- **THEN** 系统 SHALL 在 `dist/` 下生成可由 Node.js 直接执行的 CommonJS JavaScript 产物

#### Scenario: 运行时不依赖 TS loader
- **WHEN** 开发者运行 TUI 或测试命令
- **THEN** Node.js SHALL 执行 `dist/` 下的 JavaScript 产物
- **THEN** 系统 SHALL NOT 依赖 ts-node、tsx、自定义 ESM loader 或 bundler runtime

#### Scenario: MCP SDK 依赖不破坏 CommonJS 输出
- **WHEN** 项目引入官方 MCP SDK 并运行 `npm run build`
- **THEN** TypeScript 编译 SHALL 成功
- **THEN** 编译后的 TUI 入口 SHALL 能由 Node.js 以现有 CommonJS 运行路径加载

#### Scenario: dist 不进入源码版本控制
- **WHEN** build 命令生成 `dist/` 目录
- **THEN** `dist/` SHALL 作为生成产物被忽略
- **THEN** 源码仓库 SHALL 以 `bin/`、`src/`、`test/` 和 TypeScript 配置作为可复现输入
