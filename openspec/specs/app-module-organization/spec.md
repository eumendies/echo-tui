# app-module-organization Specification

## Purpose
定义 `src/app/` 的粗粒度目录组织和 `main.ts` 拆分边界，确保 app 主流程更清晰，同时避免过度拆分和行为变化。

## Requirements

### Requirement: App 主流程保持粗粒度清晰
系统 SHALL 将 `src/app/main.ts` 保持为 app 的生产装配与主流程入口，并通过抽出高内聚 assistant turn 生命周期逻辑降低其复杂度。系统 MUST NOT 为了降低行数而把 render 协调、surface 优先级、shell mode、输入路由等强耦合主流程拆成大量细碎文件。

#### Scenario: main 保留装配与主流程
- **WHEN** 开发者阅读 `src/app/main.ts`
- **THEN** 文件 SHALL 继续展示 terminal、renderer、AppContext、command runtime、tool/user state context、MCP manager 与 agent runtime 的生产装配关系
- **THEN** 文件 SHALL 保留输入事件优先级、MCP bootstrap、shell mode 分流和退出清理等主流程控制

#### Scenario: assistant turn 生命周期独立
- **WHEN** 普通用户消息需要驱动一次 agent 响应
- **THEN** assistant turn 的 `runAgent` callback 翻译、streaming pending、tool call/result、complete、abort/error 收尾 SHALL 位于独立的粗粒度 `assistant-turn-runner.ts` 模块
- **THEN** 该模块 SHALL 作为 `main.ts` 的同级 app 模块保留在 `src/app/` 根下，不为单个文件单独创建 lifecycle 目录
- **THEN** `main.ts` SHALL 只负责提交前路由并调用该 assistant turn runner 模块

### Requirement: App 内部文件按少量职责子目录归类
系统 SHALL 将 `src/app/` 内部模块按少量自然职责子目录组织，而不是继续平铺所有 app 运行文件。目录划分 MUST 表达真实职责边界，并保持文件数量克制。

#### Scenario: state contexts 归类
- **WHEN** 开发者查找 AppContext、ComposerContext、TranscriptContext、TurnContext、RenderContext、ModelContext、slash suggestion、tool approval 或 user question 状态实现
- **THEN** 这些 app 状态模块 SHALL 位于 app 内部 state 子目录或等价粗粒度状态目录中

#### Scenario: command runtime 归类
- **WHEN** 开发者查找 app 内部 command host 或 command runtime
- **THEN** 这些模块 SHALL 位于 app 内部 command 子目录或等价粗粒度命令运行目录中
- **THEN** 它们 SHALL 与仓库顶层 `src/commands/` 的具体 slash command handlers 保持职责区分

#### Scenario: tool/user surface state 归类
- **WHEN** 开发者查找 tool approval 或 user question 这类占用 footer surface 的交互状态
- **THEN** 这些模块 SHALL 与其他 app 状态 context 一起位于 app 内部 state 子目录或等价粗粒度状态目录中
- **THEN** 系统 SHALL NOT 为这两个模块单独创建 interaction 子目录

### Requirement: 重组不改变交互行为
系统 SHALL 在拆分 `main.ts` 和迁移 app 文件路径后保持现有 TUI 行为不变。重组 SHALL 是结构性重构，不得改变 transcript record 追加顺序、response lock、surface 优先级、shell 命令记录、MCP diagnostic 展示或响应中断语义。

#### Scenario: surface 优先级保持
- **WHEN** user question、tool approval、MCP diagnostic 或 command runtime surface 同时可能影响 footer
- **THEN** 渲染选择 SHALL 保持既有优先级：user question 优先于 tool approval，tool approval 优先于 MCP diagnostic，MCP diagnostic 优先于 command runtime

#### Scenario: 响应生命周期保持
- **WHEN** agent 产生 thinking、streaming token、reasoning summary、assistant segment、tool call、tool result、complete、abort 或 error
- **THEN** app SHALL 维持既有 pending preview、spinner、transcript append、partial commit 和 response lock 释放语义

#### Scenario: shell mode 保持
- **WHEN** app 处于 shell interaction mode 且用户提交非 slash command 文本
- **THEN** app SHALL 继续将文本作为本地 bash 命令执行并记录 shell transcript
- **THEN** Esc 中断 shell 进程的行为 SHALL 保持不变
