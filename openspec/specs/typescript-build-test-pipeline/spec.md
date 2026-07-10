# typescript-build-test-pipeline Specification

## Purpose
定义 `echo_tui` 的 TypeScript 编译、类型检查、CommonJS 输出、编译后测试运行和核心协议纯类型定义要求。

## Requirements
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

### Requirement: TypeScript 类型检查入口
系统 SHALL 提供独立的 TypeScript 类型检查命令，用于在不生成产物的情况下验证 TypeScript 源码和类型定义。

#### Scenario: typecheck 不写入 dist
- **WHEN** 开发者运行类型检查命令
- **THEN** 系统 SHALL 调用 TypeScript 编译器执行 `--noEmit` 检查
- **THEN** 类型检查 SHALL NOT 修改或生成 `dist/` 产物

#### Scenario: JavaScript 测试参与编译
- **WHEN** 仓库使用 JavaScript 测试文件
- **THEN** TypeScript 配置 SHALL 允许这些 JavaScript 测试文件参与编译输出
- **THEN** 系统 SHALL NOT 要求测试文件为了运行编译后测试而改名或重写为 TypeScript

### Requirement: 测试运行编译产物
系统 SHALL 通过 Node 内置 test runner 运行编译后的测试产物，以验证 TypeScript 编译输出与真实运行路径一致。

#### Scenario: npm test 先构建再运行 dist 测试
- **WHEN** 开发者运行 `npm test`
- **THEN** 系统 SHALL 先生成最新 `dist/` 产物
- **THEN** 系统 SHALL 使用 `node --test` 运行 `dist/test` 中的测试文件

#### Scenario: 测试框架使用 Node.js 内置 runner
- **WHEN** TypeScript 管线启用后执行测试
- **THEN** 系统 SHALL 使用 Node.js 内置 `node:test` 测试框架
- **THEN** 系统 SHALL NOT 引入 Jest、Vitest 或其他第三方测试框架作为本变更的一部分

### Requirement: 核心协议纯类型定义
系统 SHALL 提供少量纯 TypeScript 类型定义，用于描述跨模块共享的核心协议形状，并让运行源码模块共享稳定类型边界。系统 SHALL 支持运行源码模块使用 TypeScript，并保持编译后 CommonJS 产物与测试路径兼容。

#### Scenario: 命令协议类型可复用
- **WHEN** slash command handler 或 command runtime 使用 TypeScript 实现
- **THEN** 系统 SHALL 提供可复用的 command effect、command session、command surface 和 handler 协议类型
- **THEN** 这些类型 SHALL 覆盖当前支持的 reset/open/update/close/clear/load/append 等 command effect 形状

#### Scenario: 输入和渲染状态类型可复用
- **WHEN** 输入解析、composer 或 render state 相关模块使用 TypeScript 实现
- **THEN** 系统 SHALL 提供可复用的 input event、composer、transcript record、pending state 和 render state 类型
- **THEN** 这些类型 SHALL 表达当前运行时使用的对象字段，而不是引入新的运行时数据格式

#### Scenario: 类型文件只提供编译期约束
- **WHEN** 新增纯类型定义文件
- **THEN** 系统 SHALL 保持 TUI 用户可见行为、transcript 持久化格式和 command runtime effect 语义稳定
- **THEN** 类型定义 SHALL 作为编译期约束，不要求新增运行时依赖

#### Scenario: Input 运行源码模块使用 TypeScript
- **WHEN** 开发者维护输入相关运行源码模块
- **THEN** 系统 SHALL 支持 `src/input/event-types`、`src/input/composer` 和 `src/input/key-parser` 这类运行源码模块使用 `.ts`
- **THEN** 这些模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: Input 测试路径保持兼容
- **WHEN** `src/input` 中的运行源码模块使用 TypeScript
- **THEN** 编译后的测试文件 SHALL 能够通过相对路径加载 `dist/src/input` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: Input 行为稳定
- **WHEN** `src/input/event-types`、`src/input/composer` 或 `src/input/key-parser` 使用 TypeScript
- **THEN** 输入事件常量值、composer state 形状、Unicode/中文字符编辑语义和控制键解析行为 SHALL 稳定
- **THEN** 类型约束 SHALL NOT 引入新的运行时数据格式或用户可见输入行为变化

#### Scenario: Commands 运行源码模块使用 TypeScript
- **WHEN** 开发者维护 slash command 相关运行源码模块
- **THEN** 系统 SHALL 支持 `src/commands/command-effects`、`src/commands/resolve-slash-command` 和默认 slash command handlers 使用 `.ts`
- **THEN** commands 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: Commands slash 行为稳定
- **WHEN** `src/commands` 中的 effect、resolver 或 handler 模块使用 TypeScript
- **THEN** slash command 的匹配规则、command surface 形状、command effect 形状和事件处理语义 SHALL 稳定
- **THEN** 类型约束 SHALL NOT 改变 `/help`、`/model`、`/clear` 或 `/resume` 的用户可见行为

#### Scenario: Commands 测试路径保持兼容
- **WHEN** `src/commands` 中的运行源码模块使用 TypeScript
- **THEN** 编译后的 app、render 和 commands 测试 SHALL 能够通过相对路径加载 `dist/src/commands` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: Render 和 terminal 运行源码模块使用 TypeScript
- **WHEN** 开发者维护 render 或 terminal 相关运行源码模块
- **THEN** 系统 SHALL 支持 `src/render/layout`、`src/render/blocks`、`src/render/footer`、`src/render/app-renderer`、`src/terminal/ansi` 和 `src/terminal/tty` 使用 `.ts`
- **THEN** render 和 terminal 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: Render 和 terminal 测试路径保持兼容
- **WHEN** `src/render` 或 `src/terminal` 中的运行源码模块使用 TypeScript
- **THEN** 编译后的 render、app 和 commands 测试 SHALL 能够通过相对路径加载 `dist/src/render` 与 `dist/src/terminal` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: Render 和 terminal 行为稳定
- **WHEN** `src/render` 或 `src/terminal` 中的运行源码模块使用 TypeScript
- **THEN** ANSI 控制序列、display width/wrap 计算、footer redraw、destructive recovery、raw mode setup/cleanup 和 app renderer 门面语义 SHALL 稳定
- **THEN** 类型约束 SHALL NOT 引入新的运行时数据格式、终端控制行为或用户可见布局变化

#### Scenario: Agent 和 persistence 运行源码模块使用 TypeScript
- **WHEN** 开发者维护 agent 或 persistence 相关运行源码模块
- **THEN** 系统 SHALL 支持 `src/agent/fake/agent`、`src/agent/openai-responses/agent`、`src/agent/openai-responses/transcript-converter`、`src/agent/openai-responses/tool-converter`、`src/agent/openai-chat/agent`、`src/agent/openai-chat/transcript-converter`、`src/agent/openai-chat/tool-converter`、`src/agent/anthropic/agent`、`src/agent/anthropic/transcript-converter`、`src/agent/anthropic/tool-converter` 和 `src/persistence/transcript-store` 使用 `.ts`
- **THEN** agent 和 persistence 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: Agent 和 persistence 测试路径保持兼容
- **WHEN** `src/agent` 或 `src/persistence` 中的运行源码模块使用 TypeScript
- **THEN** 编译后的 agent、persistence、app 和 commands 测试 SHALL 能够通过相对路径加载 `dist/src/agent` 与 `dist/src/persistence` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: Agent 和 persistence 语义稳定
- **WHEN** `src/agent` 或 `src/persistence` 中的运行源码模块使用 TypeScript
- **THEN** LLM config 读取与校验、错误脱敏、SDK stream 归一化、fake agent 行为、OpenAI Responses adapter 行为、OpenAI Chat Completions adapter 行为、Anthropic Messages adapter 行为、cwd hash 分区、session JSON schema 和 atomic write 语义 SHALL 稳定
- **THEN** 类型约束 SHALL NOT 引入新的运行时数据格式、外部存储依赖或用户可见行为变化

#### Scenario: App 运行源码模块使用 TypeScript
- **WHEN** 开发者维护 `src/app` 中的运行源码模块
- **THEN** 系统 SHALL 支持 `src/app/main`、`src/app/state/app-context`、`src/app/command/command-runtime`、`src/app/state/composer-context`、`src/app/state/model-context`、`src/app/state/render-context`、`src/app/state/transcript-context` 和 `src/app/state/turn-context` 使用 `.ts`
- **THEN** app 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: App 测试路径保持兼容
- **WHEN** `src/app` 中的运行源码模块使用 TypeScript
- **THEN** 编译后的 app、commands 和 render 测试 SHALL 能够通过相对路径加载 `dist/src/app` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: App 编排与状态语义稳定
- **WHEN** `src/app` 中的运行源码模块使用 TypeScript
- **THEN** 顶层依赖装配、输入事件分发、slash command runtime、thinking / streaming lifecycle、input history、resize destructive recovery 和 transcript 持久化语义 SHALL 稳定
- **THEN** 类型约束 SHALL NOT 引入新的运行时数据格式、测试专用 seam 或用户可见行为变化

### Requirement: `/config` 运行源码模块使用 TypeScript
系统 SHALL 支持 `/config` 相关 slash command、配置编辑和配置 UI 运行源码模块使用 TypeScript，并通过现有编译管线输出 CommonJS JavaScript 到 `dist/`。

#### Scenario: `/config` 模块参与 build
- **WHEN** 开发者维护 `/config` 相关源码模块
- **THEN** 系统 SHALL 支持 `src/commands/config/handler`、`src/config/provider-presets`、`src/config/llm-config-editor`、`src/render/footer/config-surface` 和 `src/render/footer/command-surfaces` 这类模块使用 `.ts`
- **THEN** 这些模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: `/config` 测试路径保持兼容
- **WHEN** `/config` handler、config editor 或 footer config surface 模块使用 TypeScript
- **THEN** 编译后的 command、render 和 config 测试 SHALL 能够通过相对路径加载 `dist/src/commands`、`dist/src/config` 与 `dist/src/render` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: `/config` 不引入新运行时依赖
- **WHEN** 开发者实现 `/config` 配置面板
- **THEN** 系统 SHALL 继续使用 Node.js、ANSI 控制序列和 stdin raw mode
- **THEN** 系统 SHALL NOT 引入第三方 TUI 库、bundler、ts-node、tsx 或自定义 loader runtime

#### Scenario: `/config` 行为覆盖保持完整
- **WHEN** 开发者维护 `/config` command handler、footer config surface、config editor 或 provider preset runtime/editor 行为
- **THEN** 自动化测试 SHALL 覆盖 `/config` 打开、状态更新、保存、保存失败、取消和 slash suggestion 行为
- **THEN** 自动化测试 SHALL 覆盖 footer config surface 渲染、config editor 读取/校验/保存、provider preset 运行时解析和编辑器展示行为
- **THEN** 自动化测试 SHALL 覆盖模型 profile 缺少展示 label 时仍使用模型 id 或等价稳定文本展示
- **THEN** build、typecheck 和编译后测试验证路径 SHALL 覆盖本变更触及的 command、config、render 和 provider preset 模块

### Requirement: npm 安装使用编译后的 bin 产物
系统 SHALL 让 npm 安装后的 `echo-tui` bin 入口指向编译后的 JavaScript 产物，并确保该产物由现有 TypeScript build 管线生成。

#### Scenario: build 生成可安装 bin 入口
- **WHEN** 开发者运行 TypeScript build 命令
- **THEN** 系统 SHALL 在 `dist/bin/echo-tui.js` 生成带 shebang 的 CommonJS JavaScript bin 入口
- **THEN** 该入口 SHALL 能够定位并加载同一编译输出中的 CLI 应用代码

#### Scenario: package bin 指向 dist
- **WHEN** 开发者检查 package metadata 或执行本地 npm 安装
- **THEN** `package.json` 中的 `bin.echo-tui` SHALL 指向 `dist/bin/echo-tui.js`
- **THEN** npm 安装后的命令 SHALL NOT 直接执行 `bin/echo-tui.ts` 源文件

#### Scenario: pack 内容包含运行所需产物
- **WHEN** 开发者执行本地 pack 或全局安装当前包
- **THEN** 包内容 SHALL 包含 `dist/bin/echo-tui.js` 和其运行所需的 `dist/src/` 编译产物
- **THEN** 包内容 SHALL NOT 依赖用户机器上的源码 TypeScript 文件来启动 CLI

### Requirement: 测试策略适配生产装配入口简化
系统 SHALL 允许删除或迁移依赖测试专用 options/dependencies 的测试，并保持 TypeScript 编译、Node test runner 和 JavaScript 语法检查作为最终验证手段。

#### Scenario: 删除脆弱高层 harness 测试
- **WHEN** 一个测试依赖生产装配入口暴露 fake renderer、fake terminal、fake config loader、fake provider 或 fake tool executor 来断言内部 glue 调用顺序
- **THEN** 实现 MAY 删除该测试
- **THEN** 实现 SHALL NOT 为保留该测试而重新引入测试专用生产 API

#### Scenario: 保留可维护的低层测试
- **WHEN** 行为可以通过低层模块、纯函数、provider adapter 或真实 public seam 测试
- **THEN** 实现 SHALL 保留或迁移对应测试
- **THEN** 测试 SHALL 不要求生产装配入口暴露测试专用 options/dependencies

#### Scenario: 变更后验证命令通过
- **WHEN** 删除测试专用 options/dependencies 并清理测试后
- **THEN** `npm run typecheck` SHALL 通过
- **THEN** `npm test` SHALL 通过
- **THEN** JavaScript 源测试语法检查 SHALL 通过

### Requirement: 开发者 debug 启动脚本
系统 SHALL 提供独立的 npm debug 启动脚本，使开发者可以在构建后以 debug 模式启动 TUI。普通 `npm start` SHALL 保持非 debug 启动路径。

#### Scenario: npm start 不启用 debug
- **WHEN** 开发者运行 `npm start`
- **THEN** 系统 SHALL 先生成最新 `dist/` 产物
- **THEN** 系统 SHALL 启动编译后的 TUI 入口
- **THEN** 系统 SHALL NOT 默认设置 debug 模式环境变量
- **THEN** TUI SHALL 不创建 debug 日志 writer

#### Scenario: npm start:debug 启用 debug
- **WHEN** 开发者运行 `npm start:debug`
- **THEN** 系统 SHALL 先生成最新 `dist/` 产物
- **THEN** 系统 SHALL 使用 debug 模式环境变量启动编译后的 TUI 入口
- **THEN** TUI SHALL 创建 debug 日志 writer 并写入 debug 日志

#### Scenario: debug 启动仍使用编译产物
- **WHEN** 开发者运行 `npm start:debug`
- **THEN** Node.js SHALL 执行 `dist/bin/echo-tui.js`
- **THEN** 系统 SHALL NOT 依赖 ts-node、tsx、自定义 loader 或 bundler runtime
