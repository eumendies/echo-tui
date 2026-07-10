## Why

当前 TUI 只能把用户输入作为自然语言消息交给模型，用户如果想直接执行本地命令，需要让模型调用 bash tool 或切到外部终端，交互路径不够直接。支持 shell mode 可以让用户在同一个会话里快速运行 bash 命令，并把命令结果作为后续对话可引用的上下文。

## What Changes

- 新增 shell mode：用户可通过 Tab 在普通模式、plan mode、shell mode 之间切换。
- shell mode 下，用户输入的文本在 Enter 后作为本地非交互 bash 命令执行，不经过模型决策，也不使用工具审批弹窗。
- shell mode 使用新的 transcript role 记录用户执行的 bash 命令及终端输出，界面按 message 风格展示，而不是 tool call / tool result 风格。
- bash 执行底层逻辑从 bash tool handler 中抽取为共享 runner，bash tool handler 和 shell mode 共用执行、超时、截断能力。
- shell 输出按 stdout/stderr 到达顺序合并为终端输出展示，同时 bash tool handler 仍保留原有面向模型工具结果的结构化格式。
- shell transcript 在发送给大模型时投影为 user message，并明确说明这是用户执行的 bash 命令和终端输出。
- 不同模式使用不同 composer 前缀和边框颜色：普通模式沿用青色，plan mode 使用紫色，shell mode 使用经典终端绿色。

## Capabilities

### New Capabilities
- `shell-mode`: 覆盖 shell mode 的模式切换、bash 命令执行、shell transcript 展示、上下文投影和 composer 视觉区分。

### Modified Capabilities
- `local-tool-execution`: bash 命令执行逻辑从 tool handler 内部抽取为可被 tool handler 与 shell mode 复用的共享执行 runner。

## Impact

- 影响输入分发、interaction mode 状态、composer/footer 渲染和状态栏展示。
- 影响 transcript 类型、transcript 渲染、session 持久化后的恢复展示，以及 OpenAI Responses / OpenAI Chat / Anthropic transcript converter。
- 影响 bash tool handler 的内部结构，但不改变现有 `run_bash_command` tool schema 和工具结果语义。
- 不新增第三方依赖，不引入 PTY 或交互式终端模拟器。
