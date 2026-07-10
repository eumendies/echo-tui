## Context

当前 `assistant-turn-runner` 负责把 agent callbacks 翻译成 app 状态、footer redraw 和 transcript append；`agent-loop-runtime` 负责 provider-neutral 的配置读取、context compaction、tool call continuation、tool approval 和 tool executor 调用。现有 `AgentCallbacks` 是内部控制流契约，其中部分 callback 会直接影响工具审批、用户提问工具和响应中断语义，不适合作为用户可配置 hooks API 暴露。

hooks 的主要使用者是希望在 TUI 生命周期事件旁路执行本地自动化的用户。第一版应优先保证主对话路径稳定：hooks 不拦截、不显示、不持久化、不影响 provider continuation。

## Goals / Non-Goals

**Goals:**
- 支持用户在 `~/.echo/config.json` 中为 lifecycle 事件配置本地 hook 命令。
- 覆盖 assistant turn、tool call 和 compaction 的关键事实事件。
- hook 执行与结果对 TUI 主界面不可见，不污染 transcript、session persistence 或模型上下文。
- hook 失败、超时或配置错误不阻断 assistant turn、tool execution、approval、compaction 或退出清理。
- 保持 hook 机制独立于 `AgentCallbacks`，避免把内部 app/runtime callback contract 固化为外部扩展 API。

**Non-Goals:**
- 不支持可拦截 hooks：hook 不能拒绝工具、修改用户输入、改写 provider 请求、替代审批或向模型注入结果。
- 不提供 hook stdout/stderr 的实时 TUI 展示。
- 不保证 CLI 退出时 drain 所有排队 hooks；第一版 hooks 是 best-effort。
- 不新增第三方任务队列、daemon、插件系统或跨进程持久事件总线。

## Decisions

### Decision 1: 新增 `HookDispatcher`，不复用 `AgentCallbacks`

选择：新增 `src/hooks/` 模块，包含 hooks 配置解析、事件 payload 构造、异步执行和失败隔离。`main.ts` 在启动时创建 dispatcher，并分别注入 `runAssistantTurn` 和 `createAgentLoopRuntime`。

理由：`AgentCallbacks` 目前既承载 UI 状态更新，也承载 tool approval 和 `ask_user_questions` 这类会改变控制流的 callback。把用户 hooks 挂进这个类型会模糊“内部控制流 callback”和“外部观察者”的边界，并增加未来兼容负担。独立 dispatcher 可以把 hooks 限制为旁路观察者。

替代方案：只在 `assistant-turn-runner` 中追加 hooks callback。该方案实现最少，但无法覆盖工具执行前后、risk/approval 后的实际执行结果和 compaction runtime 状态，且会把 hooks 绑定到 UI 翻译层。

### Decision 2: hooks 使用 fire-and-forget 队列，主流程不等待结果

选择：事件发生时同步 enqueue hook jobs，然后由 dispatcher 在后台执行。每个 hook job 有独立 timeout；stdout/stderr 直接忽略，不调用 renderer，不追加 transcript。

理由：hooks 不应拖慢 token streaming、tool continuation 或 footer redraw。best-effort 语义也降低了 hook 进程卡住、失败或输出过大时影响主流程的风险。

替代方案：事件点 `await` hook 完成。该方案便于测试顺序，但会让用户脚本直接影响响应延迟，与不可拦截目标冲突。

### Decision 3: payload 通过 stdin 传递结构化 JSON

选择：hook 进程启动后通过 stdin 接收 JSON payload；环境变量只提供小型上下文，例如 `ECHO_HOOK_EVENT` 和 `ECHO_HOOK_CWD`。payload 包含 `event`, `timestamp`, `cwd`, `interactionMode` 以及事件相关数据，例如 tool call id、tool name、arguments text、tool result ok 状态、assistant turn status 和 compaction activeStartIndex。

理由：stdin 避免 shell 字符串拼接和环境变量长度限制，也方便 Node、Python、shell 等脚本读取。payload 可测试且 provider-neutral。payload 不包含 LLM provider apiKey、headers 或 client 配置；事件相关文本来自本地 transcript/tool 数据，属于用户主动配置 hook 后允许传给本地脚本的内容。

替代方案：把 payload 注入命令参数或单个环境变量。参数和环境变量都容易遇到 quoting、长度和敏感信息暴露问题。

### Decision 4: 配置缺失或无效时禁用 hooks，不阻断启动

选择：从用户级配置读取可选 `hooks` 节点。缺失、类型错误、未知事件、无效 command 或无效 timeout 的 hook entry 会被忽略；可选的诊断信息只保存在 dispatcher 内部或调试日志，不作为 TUI transcript 显示。

理由：hooks 是可选增强能力，不应像 LLM 必要配置那样阻断核心聊天能力。静默禁用符合“hooks 不显示到 TUI”的要求。

替代方案：配置错误追加本地 error record。该方案可见性更强，但会污染 transcript，并可能在每轮对话重复打扰用户。

### Decision 5: 第一版事件集保持小而稳定

选择：先支持 `assistant_turn_start`、`assistant_turn_end`、`assistant_turn_error`、`assistant_turn_cancelled`、`tool_call_start`、`tool_call_end`、`compaction_end`。

理由：这些事件覆盖用户提出的 assistant lifecycle 与工具执行需求，同时都对应现有代码中明确的事实发生点。暂不加入 token 级 hooks，避免高频事件造成性能和进程风暴。

替代方案：提供所有内部 callback 对应事件，包括 `onToken`、`onContextUsage`、`onReasoningSummary`。这会让第一版事件面过大，且 token 级 hook 对性能风险明显。

## Risks / Trade-offs

- [Risk] hook 脚本无限运行或输出过大 → Mitigation：每个 hook job 设置 timeout，超时后终止子进程；stdout/stderr 使用 ignore，不进入进程内存或 TUI。
- [Risk] hook 执行顺序和主流程事实顺序不完全一致 → Mitigation：事件 enqueue 顺序稳定；文档声明 hook 执行为 best-effort，不作为状态同步强一致机制。
- [Risk] payload 中包含用户消息或工具参数，hook 脚本可能外传 → Mitigation：不包含 provider 密钥或 headers；用户显式配置 hooks 才会执行；配置文档提醒 hooks 能读取本地事件 payload。
- [Risk] fire-and-forget 导致测试不稳定 → Mitigation：dispatcher 提供可注入 executor 和 flush 方法供单元测试使用，生产路径不等待 flush。
- [Risk] hook 失败完全不可见导致排障困难 → Mitigation：保留内存诊断或 debug log 扩展点，第一版不把诊断显示在主 TUI。

## Migration Plan

1. 新增 hooks 模块和配置解析，默认无配置时完全禁用。
2. 在 app 和 agent runtime 的事实发生点注入 dispatcher 调用。
3. 添加测试确认未配置 hooks 时行为不变，配置 hooks 时事件会 enqueue，失败/超时不会影响主流程。
4. 如需回滚，移除 dispatcher 注入即可恢复原有主流程；用户配置中的 `hooks` 节点会被忽略。

## Open Questions

- 是否需要在后续版本提供只读 `/hooks` 诊断命令查看最近 hook 失败原因。
- 是否需要为 payload 增加用户可配置的文本裁剪上限，避免大型 tool result 传入 hook 脚本。
