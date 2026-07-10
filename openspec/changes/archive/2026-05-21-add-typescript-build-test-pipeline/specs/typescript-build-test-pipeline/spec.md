## ADDED Requirements

### Requirement: TypeScript 编译输出 CommonJS 产物
系统 SHALL 提供 TypeScript 编译管线，将仓库中的应用、测试和少量类型源码编译或复制到 `dist/` 下的 CommonJS JavaScript 产物。编译管线 SHALL NOT 要求运行时通过 ts-node、tsx、自定义 loader 或 bundler 执行源码。

#### Scenario: build 生成 dist 产物
- **WHEN** 开发者运行 TypeScript build 命令
- **THEN** 系统 SHALL 使用 `tsc` 读取仓库级 TypeScript 配置
- **THEN** 系统 SHALL 在 `dist/` 下生成可由 Node.js 直接执行的 CommonJS JavaScript 产物

#### Scenario: 运行时不依赖 TS loader
- **WHEN** 开发者运行 TUI 或测试命令
- **THEN** Node.js SHALL 执行 `dist/` 下的 JavaScript 产物
- **THEN** 系统 SHALL NOT 依赖 ts-node、tsx、自定义 ESM loader 或 bundler runtime

#### Scenario: dist 不进入源码版本控制
- **WHEN** build 命令生成 `dist/` 目录
- **THEN** `dist/` SHALL 作为生成产物被忽略
- **THEN** 源码仓库 SHALL 以 `bin/`、`src/`、`test/` 和 TypeScript 配置作为可复现输入

### Requirement: TypeScript 类型检查入口
系统 SHALL 提供独立的 TypeScript 类型检查命令，用于在不生成产物的情况下验证新增 TypeScript 类型文件和迁移后的 TypeScript 源码。

#### Scenario: typecheck 不写入 dist
- **WHEN** 开发者运行类型检查命令
- **THEN** 系统 SHALL 调用 TypeScript 编译器执行 `--noEmit` 检查
- **THEN** 类型检查 SHALL NOT 修改或生成 `dist/` 产物

#### Scenario: 初始阶段允许 JS 参与编译
- **WHEN** 当前仓库仍包含既有 JavaScript 源码和测试
- **THEN** TypeScript 配置 SHALL 允许这些 JavaScript 文件参与编译输出
- **THEN** 系统 SHALL NOT 要求本阶段一次性把所有 JavaScript 文件改名或重写为 TypeScript

### Requirement: 测试运行编译产物
系统 SHALL 通过 Node 内置 test runner 运行编译后的测试产物，以验证 TypeScript 编译输出与真实运行路径一致。

#### Scenario: npm test 先构建再运行 dist 测试
- **WHEN** 开发者运行 `npm test`
- **THEN** 系统 SHALL 先生成最新 `dist/` 产物
- **THEN** 系统 SHALL 使用 `node --test` 运行 `dist/test` 中的测试文件

#### Scenario: 测试框架保持不变
- **WHEN** TypeScript 管线启用后执行测试
- **THEN** 系统 SHALL 继续使用 Node.js 内置 `node:test` 测试框架
- **THEN** 系统 SHALL NOT 引入 Jest、Vitest 或其他第三方测试框架作为本变更的一部分

### Requirement: 核心协议纯类型定义
系统 SHALL 提供少量纯 TypeScript 类型定义，用于描述跨模块共享的核心协议形状，并为后续逐步迁移源码到 TypeScript 提供稳定引用。

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
