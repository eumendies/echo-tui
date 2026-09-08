## Why

当前 provider adapter 已能在单次模型响应中收集多个 tool call，但主 agent loop 仍逐个等待执行，导致互不依赖的文件读取、检索和网络观察工具累加延迟。TUI 同时只保存一个 pending tool call，也无法准确展示并行执行中的多个调用。

## What Changes

- 为 provider 单次返回的多个 tool call 增加直接调度：同一连续段内所有只读调用并行执行，写入型、状态型、交互型、需要审批及未知副作用的调用作为独占屏障串行执行。
- 引入独立于风险审批的并发分类，默认未知工具为独占；第一版不并行执行 MCP tool 或 `run_subagent`。
- 严格复用现有只读 Bash 判定，仅允许通过只读检查的 Bash 调用进入并行批次。
- 保持 tool result 按 provider 原始调用顺序进入 transcript 和 continuation，不让实际完成顺序改变会话事实。
- 让支持并行 tool call 的 provider 请求开启对应能力，并验证多调用提取与 continuation 转换。
- 将主 TUI 与 BTW 的单一 pending tool 状态扩展为多调用 pending 投影；多个调用统一使用紧凑分组列表，同时保持单工具预览、既有相邻 call/result 历史渲染、resize 重放和中断清理语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 增加只读工具并行分类、连续只读段并发调度、独占执行边界、稳定结果顺序和取消语义。
- `streaming-llm-service-adapter`: 允许支持该能力的 provider 在单次响应中产生多个 tool call，并保持多调用 continuation 的协议结构。
- `tool-message-rendering`: 增加多个运行中 tool call 的 footer 投影，并保持完成后 call/result 成对历史展示。

## Impact

- 主要影响 `src/agent/loop-runtime/agent-loop-runtime.ts`、工具并发分类与类型、OpenAI/Codex/Anthropic provider 请求及 transcript converter。
- 影响 `TurnContext`、assistant turn callback 桥接、BTW controller、pending render 类型和 footer/tool preview 渲染。
- 需要扩展 agent loop、provider adapter、app state、footer、resize/恢复和中断相关测试。
- 不引入第三方依赖，不切换 alternate screen，不改变现有工具审批决策、MCP 配置或 subagent 执行模型。
