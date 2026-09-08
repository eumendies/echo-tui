## Context

Provider adapter 的 turn result 已使用 `toolCalls: ToolCall[]`，OpenAI Responses、OpenAI Chat、Codex 和 Anthropic stream reader 也都具备收集多个调用的基础。但主 `agent-loop-runtime` 当前在一个 `for` 循环中对每个调用立即 `await executeToolCall`，因此多个互不依赖的观察工具仍串行累加延迟。

App callback 桥接和渲染状态同样建立在单调用假设上：`TurnContext` 与 BTW controller 只暂存一个 pending call，footer 的 `PendingState` 只表达一个 tool preview；稳定历史区则依赖相邻且 call id 匹配的 call/result pair。工具审批和用户问题 surface 也是单例交互资源，不能被并发请求竞争。

该变更横跨 provider、agent loop、工具安全分类、app state 和 ANSI footer 渲染。设计必须保持 provider-neutral executor、现有风险审批、append-only transcript、Esc 中断和无 alternate screen 约束。

## Goals / Non-Goals

**Goals:**

- 并行执行同一 provider turn 中连续出现的确定只读工具，降低多次文件读取、检索和网络观察的墙钟时间。
- 让写入、状态更新、用户交互、审批和未知副作用调用保持确定的串行顺序。
- 直接并行同一连续段内的全部已证明只读调用，同时保持 transcript、callback 和 provider continuation 的稳定原始顺序。
- 在主 TUI 与 BTW footer 中准确保存并显示多个运行中 tool call。
- 保持现有专属 tool pair renderer、session persistence、resize 重放和中断行为。

**Non-Goals:**

- 不并行执行 `run_subagent`，也不修改 subagent loop runtime。
- 不根据 MCP 描述或 server 信任配置推断 MCP tool 为只读。
- 不并行审批请求、自动审批 reviewer 或 `ask_user_questions` surface。
- 不引入用户可配置并发数或缺少实际观测依据的固定本地上限。
- 不流式展示每个工具的中间 stdout、局部结果或精确完成状态。

## Decisions

### 1. 并发分类与风险分类分离

新增 provider-neutral 的 tool call 并发分类器，返回 `parallel_read` 或 `exclusive`。分类器使用明确白名单识别 `glob`、`grep`、`read_files`、`web_fetch`、`web_search` 和 `use_skill`；Bash 只有在 `isPlanReadonlyBashCommand` 严格通过时才是 `parallel_read`。其他调用默认 `exclusive`。

风险分类回答“是否允许或需要审批”，并发分类回答“是否能与其他调用重叠”，两者不能合并。现有 `risk: safe` 包含 todo 等会话状态工具，也可能包含无法证明只读的低风险 Bash；直接复用会产生状态竞争。

备选方案是给每个 `ToolHandler` 增加静态 concurrency metadata。该方案对 Bash 的参数级动态分类仍需额外分支，并会让 MCP adapter 容易误声明只读，因此第一版采用集中、fail-closed 的 call classifier；后续若工具目录扩展明显，再评估把静态部分下沉到 handler policy。

### 2. Agent loop 直接扫描连续只读调用

Runtime 按 provider 原始顺序直接扫描 calls，不创建 `ToolWave`、`ExecutionWave` 或 planner 结果等额外领域模型。实现只维护当前索引：遇到 `parallel_read` 时收集随后连续的同类调用并使用一次 all-settled 边界同时执行；遇到 `exclusive` 时直接等待该单个调用。执行顺序示例：

```text
R1 R2 W1 R3 W2 W3 R4 R5
└─并行─┘ │  │  │  │  └─并行─┘
         串行   串行 串行
```

同一连续只读段的全部调用在一个 all-settled 边界内启动；独占调用直接等待单个执行。代码可以使用 `pendingReadonlyCalls`、`executeConcurrentReadonlyCalls` 或等价的具体命名表达当前动作，但不应把“wave”固化为类型、公共 API 或跨层状态。只有当前连续只读调用全部 settled 后，扫描才继续，因此写前读取、写调用和写后读取之间存在明确 happens-before 边界。

备选方案一是设置固定并发上限，但在缺少资源压力观测时会引入任意常量、分批循环，并造成 footer 显示全部 pending 而实际仅部分运行的语义偏差。备选方案二是对 provider 整批调用直接 `Promise.all`，它会让写工具与读取重叠并产生不可预测观察。当前方案只同时执行已由 fail-closed 分类器证明只读的连续段，继续由各 handler 自身的 timeout、abort 和输出上限保护执行边界。

### 3. 连续只读调用完成后按 provider 顺序提交相邻 pairs

一组连续只读调用启动前，runtime 依次发布这些调用的 `onToolCall`，使 app 建立多调用 pending 状态。执行结果在内存中按输入索引收集；全部调用 settled 后，runtime 才按原始顺序把 `callRecord, resultRecord` 相邻写入 record region，并依次调用 `onToolResult`。这样实际完成顺序不会改变 transcript、持久化、compaction 索引或下一轮 provider input，也无需改变现有 pair-aware 历史 renderer。

这意味着较快调用在同组最慢调用结束前仍显示为运行中。第一版接受该延迟，以避免新增高频 progress callback 和“部分调用已落盘、部分仍 pending”的恢复状态。后续可在不改变 transcript 提交顺序的前提下增加纯瞬时完成状态。

### 4. 使用 all-settled 边界处理失败和取消

普通 handler 异常继续由 `ToolExecutor` 归一化为失败 result，不影响同时运行的其他只读调用。执行连续只读调用时使用 all-settled 风格等待所有已启动任务；若 turn abort，先确保已启动 promise settled，再让 abort 结束当前 loop，不向 app 提交这组未完成调用的 call/result。非取消的意外 rejected promise 按既有 agent error 边界处理。

Observation 的 `tool_call_start` 在每个任务实际启动前发布，`tool_call_end` 可在每个任务真实结束时发布，因此 hook 结束顺序可能反映墙钟完成顺序；app transcript callback 则固定为 provider 顺序。测试应明确区分这两类顺序。

### 5. App pending 状态按 call id 管理

`TurnContext` 和 BTW controller 将单一 pending call 改为有序集合，内部按 call id 查找并保留 provider 顺序。`PendingState` 增加多工具形态。单工具 pending 继续使用现有专属 preview；两个及以上调用统一投影为一个 compact 活动块：共享一个 `N tools · running` 标题，每个工具按 provider 顺序最多占一个树形列表行，行内保留工具名及最有辨识度的 query、路径、URL 或参数摘要，不重复各工具的 searching/fetching 状态。

Footer 继续使用现有窗口预算。compact 列表超预算时保留标题和可容纳的前序工具行，末行使用 `… +N more` 表达实际隐藏数量；若只剩一行则仅保留活动标题，不允许挤掉 composer 或 status line。该样式不根据高度切换回完整卡片堆叠，避免 resize 时视觉结构跳变。Destructive repaint 直接从有序 pending 状态重建，Esc 中断则一次清空整个集合。

备选方案一是继续堆叠完整专属 preview，但重复 marker、rail 和运行状态会造成视觉噪声，并使首个工具在矮终端中占据过多预算。备选方案二是只显示“Running N tools”，实现简单但用户无法判断模型正在访问哪些路径或 URL。compact 分组列表在稳定视觉结构下保留了必要目标信息。

### 6. Provider 按协议开启并提取多调用

OpenAI Chat 普通带工具请求由显式禁用改为允许 parallel tool calls；Codex 保持已启用状态。OpenAI Responses 在当前 SDK/兼容类型支持时显式启用，否则至少保持现有多 function-call 事件收集；Anthropic 沿用同一 message 中多个 `tool_use` block 的协议行为。Compaction 请求继续不发送 tools 或 parallel 参数。

各 stream reader 必须保留 tool index/output index 顺序并按 call id 去重。Continuation 沿用稳定的相邻 pair transcript；各 converter 为每个 pair 生成正确 call id 的协议结果。第一版不引入新的 transcript batch id 或迁移旧 journal。

## Risks / Trade-offs

- [只读分类误判导致副作用并发] → 使用明确白名单、严格只读 Bash parser 和默认 exclusive；MCP、subagent、unknown 一律不并行。
- [较大的只读调用段占用更多文件描述符、CPU 或网络连接] → provider 单 turn 调用数构成自然边界，并复用每个 handler 现有 timeout、截断和 abort 机制；只有出现实际资源压力证据后再引入可观测的调度策略。
- [一个慢调用阻塞同组较快结果展示] → 第一版等待当前连续只读调用全部完成后统一稳定提交；footer 持续展示所有调用，后续可增加瞬时 progress。
- [Abort 后 promise 迟到污染新 turn] → 等待已启动任务 settled，复用 turn identity 检查，并在 app 中原子清空 pending 集合。
- [审批 surface 被并发请求替换] → 所有 approval-required、交互和未知副作用调用固定 exclusive，绝不与其他工具同时执行。
- [Provider-compatible endpoint 不接受 parallel 参数] → 只在对应 adapter 已支持的协议字段上发送，并为 request shape 增加测试；压缩请求保持无工具形态。
- [Hook 结束顺序与 transcript 顺序不同] → 将 hook 视为实时生命周期事实，将 transcript 视为 provider 稳定顺序，并在测试与文档中固定该区别。

## Migration Plan

1. 先加入并发分类器和 agent loop 顺序扫描辅助逻辑的纯单元测试，默认 provider 请求行为暂不切换。
2. 更新 agent loop 对连续只读调用的并发执行和稳定提交，同时保持单调用路径行为不变。
3. 更新主 TUI、BTW pending state 与 footer renderer，并覆盖中断和 resize。
4. 最后开启 provider 并行请求字段并增加真实协议 request/stream fixture 测试。
5. 运行 typecheck、完整测试和 JS syntax check，再手工验证主 TUI、BTW、审批、用户问题和 Esc 清理。

该变更不需要持久化数据迁移。若上线后出现兼容问题，可回滚 provider parallel 开关和连续只读段并发执行逻辑；旧 transcript 没有新必填字段，仍可正常恢复。

## Open Questions

- OpenAI Responses 当前依赖版本和所有受支持兼容 endpoint 是否接受显式 `parallel_tool_calls` 字段；实现前应以 SDK 类型和现有 request fixture 验证。
- 是否在后续版本消费 MCP `readOnlyHint` 等可信 annotations；本变更明确不做。
