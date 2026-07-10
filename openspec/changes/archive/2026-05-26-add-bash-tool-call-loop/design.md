## Context

当前真实 OpenAI adapter 的边界是纯文本流：`TranscriptRecord[]` 经 `openai-transcript-converter` 转成 `user` / `assistant` / `system` message，`openai-agent` 只消费文本 delta，并通过 `onThinking` / `onToken` / `onComplete` 回调驱动 app。前一版已经让 TUI 能显示 `tool_call` 与 `tool_result` records，但这些 records 还没有 provider 映射，也没有真实工具执行。第一版 tool call 的核心是建立可扩展分层，而不是把 bash 执行逻辑硬编码进 OpenAI adapter。

## Goals / Non-Goals

**Goals:**

- 引入 provider-neutral tool 分层：`ToolDefinition`、`ToolHandler`、`ToolRegistry`、`ToolExecutor`。
- 提供首个工具 `run_bash_command`，通过非交互 bash 命令执行当前工作区命令。
- 真实 OpenAI adapter 能发送 function tool schema、解析 function call、执行本地工具、回传 `function_call_output` 并继续生成最终 assistant 回复。
- `tool_call` / `tool_result` records 进入 append-only transcript，参与显示、持久化、`/resume` 后上下文重建。
- 工具执行具备最小运行边界：timeout、输出上限、错误脱敏。

**Non-Goals:**

- 不做每次工具调用前的交互式用户确认。
- 不做 shell 沙箱、权限系统、命令白名单或网络隔离。
- 不支持交互式命令、TTY、stdin 输入或后台长任务。
- 不新增除 bash 之外的其他工具。
- 不抽象多 provider tool protocol；本次 provider 映射只覆盖 OpenAI Responses API。
- 不设计 tool result 折叠 UI，继续复用已有 tool record 可见投影。

## Decisions

### Decision 1: provider-neutral tools 与 OpenAI 映射分离

选择：在 `src/tools/` 和 `src/types/tool.ts` 定义工具目录、handler 和执行结果；在 `src/agent/` 内单独做 OpenAI tools schema / transcript input item 映射。

理由：bash 执行是本地能力，OpenAI `function_call` / `function_call_output` 是 provider 协议。二者分离后，后续增加工具或调整 provider item 形态不需要改 bash handler。

替代方案：在 `openai-agent.ts` 中直接匹配 `run_bash_command` 并执行。该方案实现最快，但会把协议解析、工具目录、安全限制和 shell 执行混在一个模块里，后续扩展成本高。

### Decision 2: tool call loop 由 agent adapter 编排，tool 执行由 executor 完成

选择：`openai-agent` 负责读取 stream、发现 function call、调用 `ToolExecutor`、发送 continuation request；`ToolExecutor` 负责找 handler、解析参数、执行限制和结果归一化。

理由：是否继续请求模型取决于 provider 协议，而如何执行工具是本地策略。这个分界能让 app 层只接收语义化 callbacks，不需要知道 OpenAI item 细节。

替代方案：让 app 层在 `onToolCall` 后执行工具，再把结果交回 agent。该方案让 response lock 生命周期更显式，但会把 provider continuation 状态泄漏到 app，增加主流程复杂度。

### Decision 3: transcript 是本地事实源，不依赖 previous_response_id

选择：每次 OpenAI 请求都从本地 transcript records 重建 input，包括 `tool_call` 和 `tool_result` 对应的 provider items；不把远端 `previous_response_id` 作为恢复必需状态。

理由：项目已有 append-only transcript 和 `/resume` 恢复模型。依赖远端 response id 会让本地 session 不再自包含，也会降低离线恢复和测试可控性。

替代方案：保存并使用 `previous_response_id`。该方案可能减少 request payload，但引入远端状态依赖和 session 恢复复杂度。

### Decision 4: bash tool 作为已开发工具默认可用，并采用运行限制，不做每次确认

选择：真实 OpenAI adapter 暴露当前已开发的 `run_bash_command`；执行时强制非交互、timeout 和 max output bytes。

理由：项目约定是开发完成的工具即可使用，不再额外提供启用/关闭开关。每次确认需要新的 mid-turn 交互 UI 和暂停/恢复状态机，超出第一版；本版用执行限制控制复杂度。

替代方案：每次确认。每次确认更安全但需要额外 TUI 交互设计。

### Decision 5: tool result 非零退出码是工具结果，不是 app error

选择：bash 命令非零退出、stderr 输出或超时应生成 `tool_result` record，并把结果回传模型；只有 provider 请求失败、stream 崩溃或 executor 基础设施异常等系统性问题才追加 `error` record。

理由：命令失败是模型可处理的信息，应该让模型基于失败输出继续解释或修正，而不是中断整个 turn。

替代方案：非零退出直接 reject agent。该方案简单但会把正常诊断失败误报成本地错误，削弱 tool call 的实用性。

## Risks / Trade-offs

- [Risk] bash tool 可以执行危险命令 → Mitigation：执行限制为非交互、timeout 和输出上限；文档明确不提供沙箱保证。
- [Risk] 模型反复调用工具导致长循环 → Mitigation：单次工具执行仍受 timeout 和输出上限约束；loop 按模型停止请求工具自然结束。
- [Risk] 大量 stdout/stderr 影响 transcript 和 provider input 大小 → Mitigation：executor 截断输出并标记 `truncated`，tool result 文本只包含截断后的可回传内容。
- [Risk] assistant 文本被工具调用切成多个 segment 后重复提交 → Mitigation：agent/app callback 需要区分当前 segment draft 与已落盘 assistant segment；工具调用前先提交非空 segment，再清 pending。
- [Risk] OpenAI Responses stream 事件形态变化 → Mitigation：把 event guard 和 extraction 限制在 OpenAI converter/helper 内，测试覆盖 `response.function_call_arguments.done`、`function_call` output item 和 continuation request。

## Migration Plan

1. 新增 tool 类型、registry、executor 和 bash handler，默认 registry 注册已开发的 bash tool。
2. 扩展配置读取，支持 timeout 和 max output。
3. 扩展 agent callbacks 和 app turn lifecycle，支持 append `tool_call` / `tool_result`。
4. 扩展 OpenAI converter 和 agent loop，registry 非空时发送 tools，遇到 tool call 时执行并 continuation。
5. 更新测试和文档。

## Open Questions

- 第一版配置字段是否放在 root `tools.bash`，还是放在 `llm.tools.bash`？设计默认采用 root `tools.bash`，因为工具是本地运行能力，不是某个 provider 的配置。
- `tool_result.text` 是否保存完整截断文本，还是保存显示摘要并另存 provider output？设计默认让 `text` 等于回传模型的截断结果，保持 transcript 自包含。
