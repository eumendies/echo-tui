## Why

子 Agent 在 provider termination、网络中断或其他非取消错误下失败时，已经完成的调查、工具结果和流式回答草稿无法通过外层 `run_subagent` 结果交给主 Agent；主 Agent通常只得到一条失败诊断，只能重复调查或放弃已有进展。现有运行过程已部分结构化并增量持久化，适合在不改变重试策略的前提下生成有界、可继续消费的失败交接。

## What Changes

- 为非取消的子 Agent失败生成确定性的 failure handoff，并继续通过 `ok: false` 的外层 `run_subagent` tool result 返回主 Agent。
- 在交接中明确区分稳定 assistant 输出、已完成工具工作、中断时未完成的 assistant 草稿，以及缺少结果的状态不明工具调用；仅在没有 assistant 输出或草稿时使用最近的稳定 reasoning summary 兜底。
- 对文件编辑、Bash、MCP 等可能产生副作用的已完成或状态不明调用给出明确安全提示，避免主 Agent无条件重复执行。
- 对交接正文设置固定总预算和分区优先级；始终保留失败原因、安全事实、工具过程索引和截断说明，避免完整内部过程挤占主上下文。
- 复用现有 Subagent records 和瞬时 assistant draft 生成交接，不新增 provider 调用、不把本地 `subagent` role records直接暴露给主 provider，也不改变已有 provider 重试、父级取消和成功结果语义。
- 为交接构建、截断、工具配对、草稿保留、headless/TUI一致性和主 provider投影补充自动化测试。

## Capabilities

### New Capabilities
- `subagent-failure-handoff`: 定义子 Agent非取消失败时，如何从稳定过程与未完成 assistant 草稿构建有界、安全、可供主 Agent继续工作的交接结果。

### Modified Capabilities
- `readonly-subagent-delegation`: 将子 Agent失败时的外层失败结果从单一诊断扩展为包含可恢复进展的 failure handoff，同时保持普通工具协议、取消和成功路径不变。

## Impact

- 主要影响 `src/agent/subagent/runtime.ts`、Subagent callback/结果类型、`run_subagent` handler及其纯文本结果格式化逻辑。
- 新增一个同时容纳 run-local accumulator 与纯 builder 的 handoff 模块，并复用 `SubagentTranscriptRecord`、`ToolExecutionResult` 和工具专属 `details`；不新增第三方依赖。
- 外层 `run_subagent` 仍返回普通 tool result，但失败结果正文会从简短诊断变为有界交接；持久化后该正文将参与主 Agent后续 provider上下文和压缩。
- TUI、`--once`、自定义 Subagent、Explorer 与 Worker 共用同一行为；现有 rail 中的失败过程和紧凑外层结果渲染保持不变。
