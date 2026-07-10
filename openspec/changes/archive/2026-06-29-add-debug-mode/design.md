## Context

当前应用已经有 lifecycle hooks，可在 assistant turn、tool call 和 compaction 等事件上执行外部命令，但 hooks 面向用户自动化，事件粒度有限，并且通过子进程执行，不适合作为开发者内部流程日志。应用的装配根在 `src/app/main.ts`，CLI 入口在 `src/cli/main.ts`，assistant turn 的 app 状态转换集中在 `src/app/assistant-turn-runner.ts`，provider 请求构造、tool continuation 和 compaction 位于 `src/agent/agent-loop-runtime.ts`。

本变更需要一个仅面向开发者启动路径的 debug 模式。普通 `npm start` 和用户安装后的 `echo-tui` 不应默认启用 debug；开发者需要通过 `npm start:debug` 显式进入 debug 模式。debug 模式只显示短提示，不能引入新的渲染布局或 footer 逻辑。

## Goals / Non-Goals

**Goals:**

- 提供 `npm start:debug`，构建后以 debug 模式启动 TUI。
- 保持 `npm start` 不启用 debug 模式。
- 在 debug 模式下写入结构化 JSONL 日志，覆盖启动、用户提交、assistant turn、provider 请求快照、tool call、compaction、错误和退出等关键流程。
- 通过短提示告知 debug 已启用和日志路径。
- 保证 debug 日志不进入 transcript、不进入 provider 请求、不影响工具执行和生命周期状态机。

**Non-Goals:**

- 不新增用户可见的 `echo-tui --debug` 帮助入口。
- 不新增 `/debug` slash command 或运行时开关。
- 不改动现有 footer/render 布局。
- 不用 lifecycle hook 子进程作为 debug 日志写入机制。
- 不默认记录完整用户消息、provider prompt、API key、headers 或完整工具输出。

## Decisions

### 使用内部 DebugContext，而不是扩展 AppContext 状态

Debug 日志是旁路观察能力，不属于 TUI 的可渲染业务状态。实现应新增一个小型 debug 模块，提供 `enabled`、`logPath`、`emit(event, payload)`、`close()` 之类的窄接口。`run()` 或 app 装配根读取环境开关后创建 DebugContext，并作为依赖传给需要记录事件的模块。

替代方案是把 debug 字段放进 `AppContext` 并由 debug 模块主动读取状态。该方案容易让 debug 代码依赖内部可变状态，也容易在错误时记录过大的 app snapshot。因此不采用。

### 通过 `npm start:debug` 设置环境变量启用 debug

`package.json` 中 `npm start` 保持构建后直接运行 `node dist/bin/echo-tui.js`。新增 `npm start:debug`，构建后设置 debug 环境变量再运行同一入口。运行时代码只识别环境变量，例如 `ECHO_TUI_DEBUG=1` 和可选 `ECHO_TUI_DEBUG_LOG`。

这样可以让开发者启动方式和用户 CLI 解耦；用户安装后的 `echo-tui` 默认不会看到或触发 debug 能力。

### 使用 JSONL 文件作为日志格式

Debug writer 将每个事件写成一行 JSON，包含 `timestamp`、递增 `seq`、`event`、`sessionId` 或 `turnId`、`mode` 和事件 payload。JSONL 便于 tail、grep、脚本分析，也避免为了追加事件反复读写整份 JSON。

日志路径默认由 runtime 自动生成，可放在用户 debug 目录或项目内临时 debug 目录中；若设置 `ECHO_TUI_DEBUG_LOG`，则使用显式路径。writer 应 best-effort 追加，写入失败不能中断 TUI。

### 在状态提交和分支决策边界发事件

Debug 事件应在关键事实已经发生或关键分支即将执行时发出，而不是每次 redraw 或每个 token 都记录。第一版建议覆盖：

- app 启动、debug 启用、退出
- 用户提交进入 assistant turn
- assistant turn start/end/error/cancelled
- provider request 构造完成后的记录数量、role 序列、hash、tool schema hash、interaction mode 和 compaction 边界
- provider usage 返回后的 token/cache usage 元数据
- tool call start/end、risk/approval/result 摘要
- compaction end
- transcript append 和 session load/clear 的摘要
- resize destructive recovery

Provider request snapshot 默认只记录 role 序列、长度和 hash，不记录完整 prompt。

### 显示短提示，不改渲染逻辑

Debug 模式启动时只追加或输出一个短提示，说明 debug 已启用和日志路径。提示应尽量复用现有本地 notice 或启动提示路径，不新增 footer layout、status line segment、render block 类型或复杂 UI。

## Risks / Trade-offs

- [Risk] Debug 日志泄露用户输入或工具输出。→ 默认只记录长度、hash、截断预览和结构化元数据；API key、headers 和 provider client 配置必须排除。
- [Risk] 日志写入影响 TUI 性能。→ 使用 append-only JSONL writer，事件粒度避开 token 级和 redraw 级热路径；写入失败 best-effort 忽略。
- [Risk] Debug 代码侵入主状态机。→ 通过窄接口传递 DebugContext，在已有生命周期边界 emit，不让 debug 模块主动读取 AppContext 私有状态。
- [Risk] `npm start:debug` 的跨平台环境变量语法在 Windows 上不可用。→ 当前项目和开发环境以 Node.js/Unix shell 路径为主；如需跨平台可后续改为 Node wrapper script。

## Migration Plan

本变更不需要数据迁移。实现后，开发者继续使用 `npm start` 获得非 debug 启动；需要流程日志时使用 `npm start:debug`。若 debug writer 发生问题，可删除 `start:debug` 或取消环境变量，普通启动路径不受影响。

## Open Questions

- 第一版默认日志目录放在项目内临时目录还是用户级 `~/.echo` debug 目录，需要实现时结合现有持久化目录约定决定。
- Provider cache usage 是否在本变更第一版完整暴露，取决于各 adapter 当前能否稳定提供 cache read/create token 字段。
