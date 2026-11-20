## Context

现有的流式信号只有两条，而且都绑定"可见文本"：

- `onToken(delta, draft)`：正文增量。三个 adapter 都在拿到正文 delta 时调用。
- `onReasoningUpdate({kind: 'draft' | 'complete', text})`：reasoning 摘要，`kind === 'draft'` 时携带**全文**而不是增量。

工具调用参数分片在三个 adapter 里都被累积，但没有任何回调对外暴露：

- `openai-chat/agent.ts` 的 `mergeToolCallDelta()` 累积 `delta.tool_calls[].function.arguments`。
- `anthropic/agent.ts` 的 `input_json_delta.partial_json` 累积到 `argumentsText`。
- `openai-responses/agent.ts` 目前**只**在 `response.output_item.done` 时通过 `extractFunctionToolCall()` 一次性取完整参数，没有监听 `response.function_call_arguments.delta`。

精确 token 数只在 stream 结束时由 provider 返回（`usage.outputTokens`），流进行中拿不到。项目已有 `estimateTextTokens()`（CJK 1.5 字符/token，其余 4 字符/token）用于本地估算。

渲染侧已经具备条件：

- `ACTIVITY_REDRAW_INTERVAL_MS = 100` + `renderCoordinator.renderTimedActivity()` 每 100ms 重绘一次，无需新增定时器。
- `StatusLineActivityState = {kind: 'thinking' | 'working', elapsedMs}` 由 `TurnContext.getWorking()` / `resolveStatusLineActivity()` 派生，`createActivitySegment()` 负责渲染 `${spinner} working mm:ss`。
- `TurnContext.canInterruptAssistantTurn()` 已经能区分"真实 assistant turn"与"仅占用 response lock 的本地活动"（手动压缩、shell 命令）。

## Goals / Non-Goals

**Goals:**

- 让用户在流式期间看见"模型还在出词、当前多快"，从而区分正常生成与卡死。
- 让工具调用参数生成阶段也有进度反馈，而不只是正文。
- 速率统计不引入新的 provider 请求、不增加 transcript 或 journal 记录、不影响 token 预算。
- 默认开启即用，关闭后与当前行为完全等价。

**Non-Goals:**

- 不追求数值精确。流式期间的 token 数是本地估算，真实 usage 仍只在 turn 结束时由 provider 给出。
- 不做每 token 的时间戳记录或吞吐直方图，不做历史速率曲线。
- 不在 status line 之外（pending preview、working 行、`/status` 卡片）复制速率信息。
- 不为 subagent 视图和并行子运行增加速率显示。
- 不把速率写进 usage store，也不参与 `/usage` 统计。

## Decisions

### 决策 1：新增 `onStreamDelta(text)` 而不是复用 `onToken`

`onToken(delta, draft)` 的语义是"assistant 正文草稿推进"，`draft` 是全量拼接结果，调用方依赖它驱动 streaming preview。把工具参数分片塞进去会污染正文草稿，也会让 `assistant-turn-runner` 的 `startsWithAssistant` 判定误触发。

`onStreamDelta(text)` 只表达"模型又输出了这一段原始文本"，不携带草稿、不承诺顺序语义，唯一消费者是速率统计。

备选：从 `onReasoningUpdate` 的全文差量 + `onToken` 推断速率（不碰 provider 层）。放弃原因：工具参数生成阶段完全没有信号，而这正是耗时最长、最需要反馈的阶段。

### 决策 2：Responses adapter 新增监听 `response.function_call_arguments.delta`

Chat 与 Anthropic 只需在既有累积点加一行上报。Responses 当前只在 `output_item.done` 取完整参数，因此必须新增一个事件分支。

该分支只用于上报字符数，**不**改变工具调用提取路径（仍由 `extractFunctionToolCall` 在 `output_item.done` 时一次性构建），所以失败重试与工具协议语义不变。

### 决策 3：滑动窗口 3 秒，最小跨度 1 秒

统计器保存 `[{at, tokens}]` 样本序列。`getRate(now)`：

1. 丢弃 `at < now - 3000` 的样本。
2. 无样本时返回 `0`。
3. 跨度取 `max(now - 最早样本时刻, 1000)` 毫秒，返回 `round(窗口内 tokens / 跨度秒数)`。

备选 A：整轮累计平均。放弃原因：长 turn 的累计平均对当前卡顿完全不敏感，正是本需求要解决的问题。

备选 B：指数移动平均。实现同样简单，但参数（半衰期）不直观，且无法自然表达"最近 3 秒完全没有 token"这一事实。滑动窗口在无样本时直接归零，语义更硬。

1 秒下限用于避免"首个样本到达瞬间速率爆表"（比如 3 个 token 在 40ms 内被算成 75 t/s）。

### 决策 4：速率只挂在 assistant turn 上

`working` 状态同时被 shell 本地执行、MCP 初始化、会话引用总结、手动压缩复用。这些场景没有模型 token 到达，若统一显示会变成一串无意义的 `0 t/s`。

因此速率由 app 层决定是否投影：`assistant-turn-runner` 在 provider step 期间把 tracker 的当前值写入 render state；`canInterruptAssistantTurn()` 为假时不投影。工具本地执行仍在 assistant turn 内，`working` 继续存在但窗口无样本，因此显示 `0 t/s`——这正是需要的行为。

### 决策 5：`rate` 作为第 7 个 `ui.statusLine` 开关

刚落地了 6 个 segment 的可配置能力，速率段沿用同一套 schema、归一化、保存与子面板机制，不引入第二套开关语义。默认 `true`；关闭后 activity 段只保留 spinner 与 elapsed。

### 决策 6：主会话与 BTW 各持一个统计器

两个 owner 的 `working` 独立计时，共用一个 tracker 会让 BTW 的 token 污染主会话速率。tracker 是纯内存对象，构造成本可忽略，直接各持一个。

## Risks / Trade-offs

- **估算值与真实 usage 有偏差。** CJK 与代码的字符/token 比例差异很大，估算可能偏高或偏低 20% 以上 → 在文档与注释里明确它是"节奏指示"，不用于计费；不把它写进 usage store，避免与 `/usage` 冲突。
- **`0 t/s` 可能被误读为"模型故障"。** → 与 spinner、elapsed 同段展示，用户仍能看见 turn 在推进；工具执行完成后速率会自然恢复。
- **状态行变长，窄终端更早触发右侧丢弃。** → `rate` 是可关闭段；activity 段本身仍在右侧，与 `ctx` 的降级顺序不变。
- **Responses 新增的事件分支可能带来未知事件形态。** → 上报逻辑只读 `delta` 字段并做字符串判定，不解析、不落盘、失败不影响主流程。
- **重试期间速率不清零。** → 瞬时统计在 attempt 重试时不重置，避免重试时速率闪断；仅 turn 边界清零。

## Migration Plan

无数据迁移。`ui.statusLine.rate` 缺失时按 `true` 读取，行为等价于"新增一段短文本"；关闭后与旧版本完全一致。回退到旧版本时该字段作为未识别数据保留，旧版本忽略它。
