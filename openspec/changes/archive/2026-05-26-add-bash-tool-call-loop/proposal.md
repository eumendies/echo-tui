## Why

当前真实 LLM adapter 只能流式生成文本，无法让模型通过本地工具获取运行时信息或执行简单诊断。前一版 TUI 已能显示 `tool_call` 与 `tool_result` transcript record，本次需要补齐第一版 tool call 闭环，让模型可以调用一个受控的本地 bash 命令工具，并把调用过程与结果纳入同一份 append-only transcript 事实源。

## What Changes

- 新增 provider-neutral tool 分层：tool definition、tool handler、tool registry、tool executor。
- 新增第一版 `run_bash_command` 工具，使用非交互 bash 命令执行，带 timeout、输出截断和结构化结果。
- 扩展 OpenAI Responses adapter：请求中发送 function tool schema，解析 function call stream，执行本地工具，追加 `tool_call` / `tool_result` transcript record，并把 `function_call_output` 回传模型继续生成最终回复。
- 扩展 agent callback / app turn lifecycle，使 tool 调用和工具结果可以在同一响应锁内落盘、显示和持久化。
- 扩展 OpenAI transcript converter，使恢复后的 `tool_call` / `tool_result` records 能按 transcript 顺序重建 provider input；继续过滤本地 `error` records。
- 增加工具运行保护：命令超时、输出大小上限和清晰失败反馈。
- 暂不实现每次用户确认、沙箱、权限系统、多工具、交互式命令、tool result 折叠 UI 或非 OpenAI provider 支持。

## Capabilities

### New Capabilities

- `local-tool-execution`: 定义本地工具 registry、handler、executor 与首个 bash 工具的行为、安全边界和结果语义。

### Modified Capabilities

- `streaming-llm-service-adapter`: 扩展真实 OpenAI adapter，从纯文本流式响应升级为支持 function tool call loop、工具结果回传和 transcript-based provider input 重建。
- `terminal-tui-prototype`: 扩展 transcript 生命周期要求，明确真实 tool call 期间 `tool_call` / `tool_result` records 的追加、持久化和响应锁行为。

## Impact

- 影响 `src/types/agent.ts`、`src/types/transcript.ts` 以及可能新增的 `src/types/tool.ts`。
- 影响 `src/agent/openai-agent.ts`、`src/agent/openai-transcript-converter.ts`，并可能新增 OpenAI tool converter/helper。
- 新增 `src/tools/` 下的 registry、executor 和 bash handler。
- 影响 `src/app/main.ts`、`src/app/turn-context.ts`、`src/app/app-context.ts` 的 agent callback 与 transcript append 流程。
- 影响配置读取：需要为 bash tool 提供运行限制配置。
- 需要新增/更新 agent、tools、app、persistence/render 相关测试；不新增第三方 TUI 库或 bundler。
