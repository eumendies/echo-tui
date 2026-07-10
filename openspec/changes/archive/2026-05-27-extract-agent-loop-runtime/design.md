## Context

当前 `openai-agent.ts` 同时承担两类职责：一类是 OpenAI provider 边界，包括创建 OpenAI client、构造 Responses request、解析 stream event、提取文本增量和 function tool call；另一类是 provider-neutral 的 agent turn 编排，包括加载 LLM 配置、创建本地工具目录和执行器、循环执行工具调用、追加 continuation records，并通过 app callbacks 投影 assistant segment、tool call、tool result 和最终回复。

本地工具层已经是 provider-neutral 的：`ToolDefinition`、`ToolCall`、`ToolExecutionResult`、`ToolRegistry` 和 `ToolExecutor` 不依赖 OpenAI。transcript 也已经是本地事实源，OpenAI 只是通过 `openai-transcript-converter` 把 `TranscriptRecord[]` 投影为 Responses input。当前耦合主要集中在 tool loop 被写死在 OpenAI agent 里，后续接其他 provider 时会被迫复制循环逻辑。

本次设计约束是只抽取现有 tool loop 逻辑，不把 `main.ts` 变成工具装配层，不新增 runtime message 对象，也不改变 app 侧 `RunAgent(records, callbacks)` 契约。

## Goals / Non-Goals

**Goals:**

- 新增 agent loop runtime，负责真实 agent 的 provider-neutral tool-call loop 编排。
- agent loop runtime 继续拥有默认真实运行时加载职责：读取 LLM 配置、创建默认 tool registry、创建 tool executor。
- agent loop runtime 接收一个底层 provider agent 参数；每次 `RunAgent` 开始时用当前配置和 tool registry 初始化底层 agent，底层 agent 后续负责单次模型 turn，返回 assistant draft 与 provider-neutral tool calls。
- OpenAI agent 收窄为 OpenAI provider turn adapter，保留 OpenAI client、request、stream parsing、OpenAI converter 与错误归一化逻辑。
- 保持 `RunAgent(records, callbacks)`、`TranscriptRecord[]`、tool callback 顺序、错误脱敏和 `/resume` continuation 语义不变。

**Non-Goals:**

- 不新增 `RuntimeMessage`、`AgentMessage` 或跨 provider 通用 message schema。
- 不让 `main.ts` 直接创建 tool registry、tool executor 或读取工具运行时配置。
- 不改变本地工具定义、bash tool 行为、工具默认启用策略或工具确认交互。
- 不新增除 OpenAI 外的 provider，也不重写现有 OpenAI transcript/tool converter。
- 不改变 fake agent 和测试注入 `RunAgent` 的使用方式。

## Decisions

### Decision 1: 只抽取 tool loop，保持 RunAgent 外部契约

选择：新增 `agent-loop-runtime`，对外仍暴露 `RunAgent` 形态：输入 `TranscriptRecord[]` 和 `AgentCallbacks`，返回最终 assistant 文本。`main.ts` 默认真实启动路径只把底层 OpenAI agent 传入该 runtime，不直接处理 tools。

理由：app 层已经只依赖 `RunAgent` 和 callbacks。保持这个边界可以避免 TUI turn lifecycle、pending preview、partial failure 和 transcript append 逻辑被迫迁移。

替代方案：让 `main.ts` 直接装配 config、tool registry、executor 和 provider agent。该方案看似显式，但会把 app 入口重新膨胀成运行时装配层，违背当前 AppContext/command-runtime 持续收口 main 职责的方向。

### Decision 2: agent loop runtime 拥有配置与工具运行时加载

选择：把当前 `openai-agent.ts` 中加载 LLM config、创建 default tool registry、创建 tool executor 的默认依赖迁入 agent loop runtime；runtime dependencies 仍保留测试注入能力，例如 `loadConfig`、`createToolRegistry`、`createToolExecutor`。

理由：tool loop 和工具执行器是同一层职责。底层 provider agent 只需要知道本次 turn 可用的工具定义，不能拥有工具执行策略；main 也不应知道工具目录细节。

替代方案：OpenAI agent 继续创建 tools，只把 while loop 挪出。该方案会让通用 runtime 依赖 OpenAI agent 内部状态，无法作为后续 provider 的共享循环层。

### Decision 3: 底层 agent 是单次 provider turn adapter

选择：定义一个轻量底层 agent contract：先用当前 `LlmConfig` 和 `ToolRegistry` 初始化 provider agent，再用 `TranscriptRecord[]` 和 token 回调执行一次 provider stream，返回 `{draft, toolCalls}`。它不执行工具、不追加 transcript record、不决定是否 continuation。

理由：一次 provider turn 是 OpenAI / 其他 provider 的自然边界。OpenAI provider 需要持有当前 config 和 registry 来创建 client、判断是否发送 tools schema，但不需要 executor。初始化后再执行 turn，可以避免把 provider 私有运行态作为参数绕回 provider。

替代方案：底层 agent 只接收工具 definitions 数组。该方案更窄，但 OpenAI 现有 `createRequest(records, config, registry)` 已以 registry 为空判断是否发送 tools；保留 registry 可以减少无收益的中间 data object，同时仍不泄漏执行器。

### Decision 4: TranscriptRecord[] 继续作为唯一上下文主干

选择：agent loop runtime 在 continuation 时继续维护 `TranscriptRecord[]`：工具调用前的 assistant draft 追加为 assistant record，tool call 追加为 `tool_call` record，tool result 追加为 `tool_result` record；底层 OpenAI agent 继续在 provider 边界内把这些 records 转为 OpenAI input。

理由：项目当前的多轮上下文、tool record 展示、持久化和 `/resume` 都围绕 transcript ledger。新增 runtime message 层会制造一条额外转换链，但不会提供新的行为能力。

替代方案：引入 provider-neutral runtime message。该方案可能在多 provider 以后看似统一，但当前无法真实覆盖各 provider 的 tool result / function call 差异，容易成为薄而失真的中间模型。

### Decision 5: OpenAI agent 保留 provider 错误与 stream 解析语义

选择：`readResponseStream`、OpenAI completed/failed/incomplete 判断、function call 去重、敏感信息脱敏和 `createRequest` 继续位于 OpenAI agent/provider 模块；agent loop runtime 只消费规范化后的 `{draft, toolCalls}` 或错误。

理由：这些逻辑依赖 OpenAI Responses event shape。把它们放到通用 loop 会污染 runtime；把错误归一化留在 provider 内，也能保持 provider-specific failure 摘要明确。

替代方案：通用 runtime 消费 provider 原始 stream event。该方案会让 runtime 必须理解 OpenAI event 或引入更重的 event adapter 层，超出本次“只加一层”的范围。

## Risks / Trade-offs

- [Risk] 抽取后测试导入路径或历史 helper 导出变化导致回归 → Mitigation：保留现有公开测试依赖的导出，或同步迁移测试到新模块；新增 runtime 单测覆盖原 tool loop 行为。
- [Risk] `onThinking`、`onAssistantSegment`、`onComplete` 的触发层移动后顺序变化 → Mitigation：把 callback 顺序写入 agent loop runtime 单测，并复用现有 OpenAI tool-call continuation 测试作为回归样例。
- [Risk] OpenAI agent 与 runtime 的依赖边界过厚 → Mitigation：底层 agent 不接收 executor，不追加 transcript，不循环；runtime 不接收 provider message，只传 `TranscriptRecord[]`。
- [Risk] 配置读取被重复执行或时机改变 → Mitigation：一次 `RunAgent` 调用只由 agent loop runtime 加载一次 config，并用同一 config 初始化底层 provider agent 和 tool registry。
- [Risk] 后续 provider 的工具协议与 OpenAI 不同 → Mitigation：通用边界只规定 provider-neutral `ToolCall` 输出和 `TranscriptRecord[]` 输入，provider-specific transcript 投影留在各 provider 模块。

## Migration Plan

1. 在 `src/types/agent.ts` 增加底层 provider turn agent 类型，保持现有 `RunAgent` 和 `AgentCallbacks` 不变。
2. 新增 `src/agent/agent-loop-runtime.ts`，迁移现有 tool loop、assistant segment append、tool_call/tool_result record 构造和默认 config/tool runtime 加载逻辑。
3. 收窄 `src/agent/openai-agent.ts`：移除 while tool loop 和 executor 创建，保留 OpenAI client 初始化、request 构造、stream 读取和错误处理，返回单次 turn result。
4. 更新 `src/app/main.ts` 默认真实启动路径为 `createAgentLoopRuntime({agent: createOpenAiAgent()})`；测试注入 `runAgent` 的路径不变。
5. 拆分/迁移 tests：新增 agent loop runtime 单测，保留 OpenAI request/converter/stream parsing 单测，更新完整 OpenAI tool-call continuation 测试以覆盖新装配。
6. 运行 typecheck、`npm test` 和批量 `node --check` 验证编译输出与 CommonJS 测试路径。

## Open Questions

- 底层 provider turn agent 的命名采用 `AgentTurnAdapter`、`StreamingAgent` 还是 `ProviderAgent`？实现时应优先选择能表达“一次 provider turn、不拥有 loop”的名称。
- `createAgentLoopRuntime` 返回对象 `{run}` 还是直接返回 `RunAgent`？如果只有一个公开方法，直接返回 `RunAgent` 更轻；若测试需要检查 runtime 内部依赖装配，对象形态可能更清晰。
