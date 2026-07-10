## MODIFIED Requirements

### Requirement: 核心协议纯类型定义
系统 SHALL 提供少量纯 TypeScript 类型定义，用于描述跨模块共享的核心协议形状，并为后续逐步迁移源码到 TypeScript 提供稳定引用。系统同时 SHALL 支持首批低风险运行源码模块迁移为 TypeScript，并保持编译后 CommonJS 产物与现有测试路径兼容。

#### Scenario: 命令协议类型可复用
- **WHEN** 后续迁移 slash command handler 或 command runtime 到 TypeScript
- **THEN** 系统 SHALL 提供可复用的 command effect、command session、command surface 和 handler 协议类型
- **THEN** 这些类型 SHALL 覆盖当前支持的 reset/open/update/close/clear/load/append 等 command effect 形状

#### Scenario: 输入和渲染状态类型可复用
- **WHEN** 后续迁移输入解析、composer 或 render state 相关模块到 TypeScript
- **THEN** 系统 SHALL 提供可复用的 input event、composer、transcript record、pending state 和 render state 类型
- **THEN** 这些类型 SHALL 表达当前运行时使用的对象字段，而不是引入新的运行时数据格式

#### Scenario: 类型文件不改变运行行为
- **WHEN** 新增纯类型定义文件
- **THEN** 系统 SHALL 保持当前 TUI 用户可见行为、transcript 持久化格式和 command runtime effect 语义不变
- **THEN** 类型定义 SHALL 作为编译期约束，不要求新增运行时依赖

#### Scenario: 首批运行源码模块可迁移为 TypeScript
- **WHEN** 开发者选择把低风险纯逻辑模块从 JavaScript 迁移为 TypeScript
- **THEN** 系统 SHALL 允许 `src/input/event-types`、`src/input/composer` 和 `src/input/key-parser` 这类运行源码模块迁移为 `.ts`
- **THEN** 迁移后的模块 SHALL 继续通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: 运行源码模块迁移后测试路径保持兼容
- **WHEN** `src/input` 中的运行源码模块迁移为 TypeScript
- **THEN** 编译后的测试文件 SHALL 继续能够通过原有相对路径加载 `dist/src/input` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: 运行源码模块迁移不改变输入行为
- **WHEN** `src/input/event-types`、`src/input/composer` 或 `src/input/key-parser` 被迁移为 TypeScript
- **THEN** 输入事件常量值、composer state 形状、Unicode/中文字符编辑语义和控制键解析行为 SHALL 保持不变
- **THEN** 迁移 SHALL NOT 因类型约束引入新的运行时数据格式或用户可见输入行为变化
