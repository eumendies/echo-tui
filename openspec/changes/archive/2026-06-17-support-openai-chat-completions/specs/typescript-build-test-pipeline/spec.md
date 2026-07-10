## MODIFIED Requirements

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
- **THEN** 系统 SHALL 支持 `src/agent/fake/agent`、`src/agent/openai-responses/agent`、`src/agent/openai-responses/transcript-converter`、`src/agent/openai-responses/tool-converter`、`src/agent/openai-chat/agent`、`src/agent/openai-chat/transcript-converter`、`src/agent/openai-chat/tool-converter` 和 `src/persistence/transcript-store` 使用 `.ts`
- **THEN** agent 和 persistence 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: Agent 和 persistence 测试路径保持兼容
- **WHEN** `src/agent` 或 `src/persistence` 中的运行源码模块使用 TypeScript
- **THEN** 编译后的 agent、persistence、app 和 commands 测试 SHALL 能够通过相对路径加载 `dist/src/agent` 与 `dist/src/persistence` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: Agent 和 persistence 语义稳定
- **WHEN** `src/agent` 或 `src/persistence` 中的运行源码模块使用 TypeScript
- **THEN** LLM config 读取与校验、错误脱敏、SDK stream 归一化、fake agent 行为、OpenAI Responses adapter 行为、OpenAI Chat Completions adapter 行为、cwd hash 分区、session JSON schema 和 atomic write 语义 SHALL 稳定
- **THEN** 类型约束 SHALL NOT 引入新的运行时数据格式、外部存储依赖或用户可见行为变化

#### Scenario: App 运行源码模块使用 TypeScript
- **WHEN** 开发者维护 `src/app` 中的运行源码模块
- **THEN** 系统 SHALL 支持 `src/app/main`、`src/app/app-context`、`src/app/command-runtime`、`src/app/composer-context`、`src/app/model-context`、`src/app/render-context`、`src/app/transcript-context` 和 `src/app/turn-context` 使用 `.ts`
- **THEN** app 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: App 测试路径保持兼容
- **WHEN** `src/app` 中的运行源码模块使用 TypeScript
- **THEN** 编译后的 app、commands 和 render 测试 SHALL 能够通过相对路径加载 `dist/src/app` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: App 编排与状态语义稳定
- **WHEN** `src/app` 中的运行源码模块使用 TypeScript
- **THEN** 顶层依赖装配、输入事件分发、slash command runtime、thinking / streaming lifecycle、input history、resize destructive recovery 和 transcript 持久化语义 SHALL 稳定
- **THEN** 类型约束 SHALL NOT 引入新的运行时数据格式、测试专用 seam 或用户可见行为变化
