## Context

`src/app/main.ts` 当前同时承担生产依赖装配、render/terminal 生命周期、composer 提交状态机和输入事件分发。pending message 加入后，`submitComposer()`、`submitDraft()`、`dispatchPendingMessage()` 已共享一个明确的提交不变量；`handleChunk()` 与 `handleEvent()` 也维护一套明确的 surface 和 Esc 优先级。继续把这些状态机留在 composition root 会扩大闭包共享状态，并使提交路由与输入优先级难以直接测试。

现有 `assistant-turn-runner.ts`、`AppContext`、command runtime、各 state context 和 renderer 边界保持有效。本次重构必须遵守 CommonJS TypeScript 构建、无第三方 TUI 库、当前终端 ANSI 重绘、不增加 `createApp()` 测试注入参数等约束。

## Goals / Non-Goals

**Goals:**

- 提取一个有状态的 `ComposerSubmissionController`，集中保护 composer 消费、pending dispatch 和文本提交路由不变量。
- 提取一个 `InputEventController`，集中保护 key chunk 解析和输入事件优先级不变量。
- 让 `main.ts` 继续作为可读的生产 composition root，显式装配真实 runtime collaborators。
- 为两个控制器建立直接测试 seam，补足 pending file mention、queued command、Esc 优先级等当前难以稳定覆盖的行为。
- 保持现有运行行为、协议、持久化格式和渲染布局不变。

**Non-Goals:**

- 不重写 `AppContext`、command runtime、assistant turn runner、shell runner 或 renderer。
- 不改变 `handleChunk()` 对同一 chunk 中异步事件的现有等待方式。
- 不改变 pending message 容量、claim 时序、file mention 的发送时展开语义或 conversation reference 语义。
- 不新增通用 event bus、依赖注入容器、surface manager 或仅为测试存在的 production hooks。
- 不继续拆分 resize、MCP bootstrap、config watcher、render append、shell execution 或 process exit。

## Decisions

### 1. 使用两个粗粒度 controller，而不是继续拆成多个函数文件

新增 `src/app/composer-submission-controller.ts` 和 `src/app/input-event-controller.ts`。前者持有 pending dispatch 的同步锁并执行完整提交状态机，后者持有 key parser 并执行完整输入优先级状态机。二者都有真实状态和顺序不变量，不是为了减少 `main.ts` 行数而存在的无状态 wrapper。

备选方案是只移动现有闭包函数到多个 helper 文件。该方案仍需反复传递局部状态，并会产生只转发一两个调用的细碎模块，因此不采用。

### 2. ComposerSubmissionController 只准备和路由提交，不接管 agent/renderer 装配

控制器公开 `submitComposer()` 和 `dispatchPendingMessage()`，内部保留 `submitDraft()`。它直接使用 `AppContext`、command runtime 的最小提交能力、conversation reference port、shell submission callback、footer redraw callback 和 reference error callback。

控制器通过一个具名、必填的 `StartAssistantTurn` 运行边界提交最终 `AssistantTurnSubmission`，该对象只包含 user text、display text、metadata、model/effort override 和 attachments。`main.ts` 将此边界绑定到真实 `runAssistantTurn()`，并继续装配 runAgent、approval、question、hooks、debug、append 和 render collaborators。这样控制器不需要复制 assistant runner 的大依赖集合，也不会引入测试专用可选参数。

Shell command 的进程控制、输出收尾和 AbortController 继续留在 `main.ts`；submission controller 只通过真实的 `submitShellCommand(command)` 边界触发它。

### 3. InputEventController 拥有解析器和事件优先级，不拥有业务状态

控制器公开 `handleChunk()` 和 `handleEvent()`，内部创建并持有 key parser。它直接协调现有 user question、tool approval、file picker、command runtime 和 `AppContext`，并通过必填 action callbacks 调用 submit、exit、shell interrupt、assistant interrupt、reference cancellation 和 footer redraw。

`referenceErrorSurface` 与 `mcpDiagnosticSurface` 继续由 `main.ts` 持有，因为它们同时参与 render state 组合和启动生命周期。控制器通过一个最小的 local surface port 读取并关闭当前 surface，不新增第三个状态类。

事件顺序按当前实现逐项迁移，不借重构合并或重排：active modal/surface 优先，然后 reference preparation 和本地 info surface，再处理 tuning、shortcut、file picker trigger、slash suggestions、mode Tab、composer 编辑，最后处理移动、新行、Esc、Submit 和 Exit。

### 4. main.ts 保留 composition root 和跨控制器业务收尾

`main.ts` 继续创建 terminal、renderer、stores、AppContext、command host/runtime、approval/question/file picker 与两个 controller；继续负责 render state、append/redraw、resize、MCP bootstrap、config watcher、shell execution、assistant interruption、start 和 exit。

assistant interruption 完成 partial/notice/hook 收尾后，仍由 main 的 interruption action 调用 submission controller 的 `dispatchPendingMessage()`。这保持跨 assistant lifecycle 的事实追加顺序，同时避免 InputEventController 理解 transcript 或 hooks。

### 5. 测试直接覆盖 controller 公共行为，不扩展 createApp API

控制器构造参数只包含生产运行真正需要且全部必填的协作边界。测试使用真实 `AppContext`、command runtime/context 组合或与公开协议一致的最小 fake；不得向 `createApp()` 增加 terminal、renderer、store 或 process 的可选替换参数。

`ComposerSubmissionController` 测试覆盖 composer 消费、pending 自动发送、queued slash、file mention/图片附件、后续草稿隔离、reference 失败恢复和 dispatch lock。`InputEventController` 测试覆盖 surface 优先级、Esc 顺序、command interception、file picker trigger、slash suggestions、composer 编辑以及 Submit/Exit 路由。

## Risks / Trade-offs

- [Risk] 移动闭包函数时遗漏局部状态或改变 callback 调用顺序。→ 先提取 submission controller 并通过现有测试，再提取 input controller；逐项对照当前函数顺序，不同时做逻辑清理。
- [Risk] controller 构造参数变成新的“大依赖袋”。→ 使用具名且必填的领域协作边界，assistant turn 通过 `StartAssistantTurn` 收窄；禁止可选测试替身和泛化依赖容器。
- [Risk] class method 作为 stdin listener 传递时丢失 `this`。→ controller 对外 handler 使用稳定绑定，或由 main 在装配时只绑定一次；增加 chunk 入口测试。
- [Risk] local surface 所有权在 main、事件消费在 controller，形成隐含耦合。→ 使用一个同时提供 active surface 读取和 dismiss 的小端口，并保持 render state 仍由 main 组合。
- [Trade-off] shell execution 与 interruption 仍留在 main，因此 main 不会变成纯声明式装配文件。→ 这些流程与 process、renderer、transcript 和 hooks 强耦合，保留它们比继续扩展 controller 职责更清晰。

## Migration Plan

1. 定义最终 assistant submission 与 controller collaborators 的内部类型，提取 `ComposerSubmissionController`，保持 main 通过真实 callback 装配 assistant/shell/reference error 行为。
2. 迁移 pending dispatch 锁和提交函数，增加 controller 测试并运行现有提交、command、runner、file mention 测试。
3. 提取 `InputEventController` 和 key parser，逐项迁移事件优先级，main 改为注册 controller 的稳定 handler。
4. 增加输入优先级与 Esc 路由测试，更新架构文档，执行完整验证和真实终端回归。
5. 若发生回归，可按 controller 为单位回退到原 main 闭包实现；不涉及持久化迁移。

## Open Questions

- 无。local surface、shell execution 和 assistant interruption 的所有权按现有 composition root 语义保留。
