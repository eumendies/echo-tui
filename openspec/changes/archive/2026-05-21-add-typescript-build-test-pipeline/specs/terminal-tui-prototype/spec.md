## MODIFIED Requirements

### Requirement: Node CommonJS 项目
系统 SHALL 提供一个名为 `echo_tui` 的可运行 Node.js 项目，使用 Node.js >= 20。项目源码 MAY 包含 TypeScript 和 JavaScript；运行产物 SHALL 由 TypeScript 编译管线输出为 CommonJS JavaScript。项目 SHALL 不引入运行时第三方 TUI 库依赖。

#### Scenario: start 命令运行编译产物
- **WHEN** 开发者运行 `npm start`
- **THEN** 项目 SHALL 先确保 TypeScript 编译产物可用
- **THEN** 项目 SHALL 执行编译输出中的 TUI 入口文件

#### Scenario: CommonJS 运行产物
- **WHEN** JavaScript 产物被 Node.js 加载
- **THEN** 产物 SHALL 使用 CommonJS 模块语义运行
- **THEN** 项目 SHALL NOT 要求 Node.js 通过 ESM loader、ts-node、tsx 或 bundler runtime 加载源码

#### Scenario: 不需要第三方 TUI 依赖
- **WHEN** 项目被安装并运行
- **THEN** 终端 UI 行为 SHALL 使用 Node.js 内建能力、ANSI 控制序列和 stdin raw mode 实现，而不是依赖 TUI framework

#### Scenario: test 命令运行编译后的测试
- **WHEN** 开发者运行 `npm test`
- **THEN** 项目 SHALL 先通过 TypeScript 编译生成测试产物
- **THEN** 项目 SHALL 使用 Node.js 内置 test runner 运行编译后的测试文件
