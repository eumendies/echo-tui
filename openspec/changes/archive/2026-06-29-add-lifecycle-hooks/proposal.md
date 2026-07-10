## Why

当前 TUI 已经有稳定的 assistant turn、tool call、compaction 和 transcript 生命周期，但外部脚本无法在这些关键事件发生时做轻量自动化，例如记录审计日志、触发本地通知或同步外部开发工具状态。用户希望支持 hooks，同时明确第一版 hooks 不应拦截主流程，也不应把执行结果显示到 TUI 或写入会话上下文。

## What Changes

- 新增用户级 lifecycle hooks 配置，允许用户为指定事件配置一个或多个本地命令。
- hooks 以 best-effort 旁路方式执行：不可拦截、不改变 assistant turn / tool execution / compaction / approval 结果。
- hooks 的 stdout、stderr、退出码和失败默认不显示到 TUI，不写入 transcript，不持久化到 session，也不回传模型。
- hooks 接收结构化事件 payload，包含事件名、cwd、timestamp 以及事件相关的非敏感上下文。
- 第一版覆盖 assistant turn、tool call 和 compaction 的关键事件，不支持 provider 请求改写、工具拒绝、用户审批替代或 hook 结果注入上下文。

## Capabilities

### New Capabilities
- `lifecycle-hooks`: 定义用户级 lifecycle hooks 的配置、事件、执行隔离、payload 和不可见结果语义。

### Modified Capabilities
- 无。

## Impact

- 新增 `src/hooks/` 相关模块，用于读取 hooks 配置、派发事件和执行本地 hook 命令。
- `src/app/assistant-turn-runner.ts` 在 assistant turn lifecycle 事实发生点派发 hooks。
- `src/agent/agent-loop-runtime.ts` 在 tool call/result 和 compaction 事实发生点派发 hooks。
- `src/app/main.ts` 或顶层装配入口创建并注入 hook dispatcher。
- 用户级 `~/.echo/config.json` 增加可选 `hooks` 配置；缺失或无效 hooks 不影响现有启动和对话能力。
- 测试覆盖配置解析、事件派发、执行隔离、失败静默、transcript/session 不污染和 hooks 不阻断主流程。
