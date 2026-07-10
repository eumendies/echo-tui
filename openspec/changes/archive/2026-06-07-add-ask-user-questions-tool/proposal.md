## Why

当前模型在遇到缺失需求、用户偏好或不应自行决定的分支时，只能通过普通 assistant 文本提问；这会打断 tool-call continuation，也无法复用 TUI 中已经为高优先级选择开发的 choice surface。

需要新增一个 `ask_user_questions` 交互式工具，让模型在必须获得用户选择时暂停当前 agent turn，通过 choice surface 收集答案，再把结构化 tool result 回传给模型继续执行。

## What Changes

- 新增 `ask_user_questions` function tool definition，允许模型请求用户回答一个或多个选择题。
- 第一版支持 `questions[]`，每个问题逐题显示；每题必须提供 options，且第一版只支持单选。
- App 层新增用户问题交互上下文，复用通用 `choice` surface 显示问题、选项和 option description。
- Agent loop 将 `ask_user_questions` 识别为 interactive tool：不通过普通 tool executor 执行，而是通过 app callback 等待用户选择并生成 tool result。
- 用户按 Enter 确认当前题，Up/Down 移动选项，Esc 取消整个工具请求；取消 SHALL 作为失败 tool result 回传模型，而不是本地 error。
- 第一版不支持多选、Other 自定义输入、开放文本输入或专属 transcript 渲染。

## Capabilities

### New Capabilities
- `ask-user-questions-tool`: 定义 `ask_user_questions` 交互式工具的参数、用户选择流程、取消语义和 tool result 格式。

### Modified Capabilities
- `interactive-choice-surface`: choice surface 将被 `ask_user_questions` 作为非 tool approval 场景复用，逐题展示用户问题和选项。
- `local-tool-execution`: 默认工具 registry SHALL 暴露 `ask_user_questions` 工具定义，但该工具的执行由 agent loop/app 交互回调处理。
- `streaming-llm-service-adapter`: agent loop SHALL 支持 interactive tool continuation，在工具调用期间暂停模型续写并在用户回答后继续。

## Impact

- 影响 `src/types/agent.ts`，新增用户问题交互 callback。
- 影响 `src/agent/agent-loop-runtime.ts`，为 `ask_user_questions` 增加 interactive tool 分支。
- 影响 `src/app/main.ts`，新增用户问题上下文、surface 优先级、输入事件优先级和 callback wiring。
- 新增 `src/app/user-question-context.ts`，管理逐题选择状态和 choice surface 投影。
- 新增或扩展 `src/tools/ask-user-questions-tool-handler.ts`，提供 tool definition、参数解析和 tool result 构造。
- 影响 `src/tools/tool-registry.ts`，默认注册 `ask_user_questions` 工具定义。
- 影响测试：agent loop interactive tool、app 用户选择流程、取消语义、registry/tool schema 和 choice surface 复用。
