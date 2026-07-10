## Context

当前真实 agent 请求完全由用户消息、历史 transcript 和工具 continuation records 构成。`TranscriptRecord` 已支持 `system` role，OpenAI transcript converter 也会把 `system` record 转换为 Responses API input message，但系统没有稳定来源来注入默认 system prompt。

近期 agent 架构已经拆分为 provider-neutral 的 `agent-loop-runtime` 和底层 provider turn adapter。`agent-loop-runtime` 是真实 agent 的统一编排层，负责读取配置、初始化 provider、维护 continuation records 和执行本地工具；OpenAI agent 只负责一次 provider turn。system prompt 应该遵循这个边界：作为 agent runtime 的固定策略注入 provider 上下文，而不是由 OpenAI adapter 或 app 层持久化 transcript 决定。

## Goals / Non-Goals

**Goals:**

- 为默认真实 agent 添加一个源码内置 system prompt。
- system prompt 在每次真实 agent 调用中作为 transient `system` record 注入 provider records。
- system prompt 对用户不可配置、不可覆盖、不可关闭。
- 保持 `RunAgent(records, callbacks)`、app callbacks、transcript persistence 和 `/resume` 行为不变。
- 保持 OpenAI provider agent 只处理 provider request/stream/tool call 提取，不拥有 prompt 来源策略。

**Non-Goals:**

- 不新增用户配置字段、环境变量、slash 命令或模型 profile prompt override。
- 不新增 runtime message / agent message 中间模型。
- 不把 system prompt 写入本地 transcript session。
- 不改变 fake agent 行为；fake/stub `RunAgent` 仍由测试或调用方自行决定上下文。
- 不在本次变更中引入多 provider 专属 prompt 模板。

## Decisions

### Decision 1: system prompt 由 agent loop runtime 注入

选择：`agent-loop-runtime` 在每次 `RunAgent(records, callbacks)` 开始时，把内置 prompt prepend 成一条 transient `{role: 'system', text: ...}` record，并以该 provider records 作为后续 provider turn 与 tool continuation 的上下文主干。

理由：system prompt 是 agent 行为策略，不是 OpenAI 协议细节，也不是 app 可见会话事实。放在 runtime 层可以让后续 provider 共享同一行为边界，同时避免污染 app transcript ledger。

替代方案：在 `openai-agent.ts` 的 `createRequest` 中注入 system prompt。该方案实现局部简单，但会让 OpenAI adapter 重新拥有 agent policy，后续 provider 需要重复实现。

替代方案：在 app 层追加 system transcript record。该方案会把 prompt 写入持久化 session，并让 `/resume` 复用旧 prompt，违背“内置 prompt 随代码版本生效”的目标。

### Decision 2: prompt 内容源码内置且不可用户覆盖

选择：新增 `src/agent/system-prompt.ts` 或等价模块导出内置 prompt 文本。`readLlmConfig` 不读取 `systemPrompt` 字段，模型 profile 不支持覆盖 prompt。

理由：用户明确要求不允许覆盖。保持 prompt 在源码中也能避免敏感或危险配置误用成 agent 行为策略，并减少 `/model`、配置校验和文档示例的扩散面。

替代方案：允许 `~/.echo/config.json` 配置 `llm.systemPrompt`。该方案灵活，但会扩大配置 schema，并让核心 agent 行为不再稳定。

### Decision 3: 不新增消息模型，继续使用 transient TranscriptRecord

选择：system prompt 注入使用现有 `TranscriptRecord` 的 `system` role，但该 record 只存在于 agent runtime 的 provider context 中，不通过 callbacks 暴露给 app，也不保存到 transcript store。

理由：现有 converter 已支持 `system` role，新增 runtime message 模型会制造无收益的转换层。transient record 足以表达 provider 上下文，同时保留 `TranscriptRecord[]` 作为唯一上下文主干。

替代方案：新增 `RuntimeMessage` 或 provider-neutral message。该方案超出当前架构方向，也会增加 converter 和测试复杂度。

## Risks / Trade-offs

- [Risk] prompt 被错误追加到 app transcript 并持久化 → Mitigation：runtime 单测检查 `onAssistantSegment`、`onToolCall`、`onToolResult` 和传入 records 不包含 system record 追加副作用；app 层不参与 prompt 注入。
- [Risk] continuation 第二轮丢失 system prompt → Mitigation：runtime 单测覆盖工具调用后的第二次 provider records 仍以 system record 开头。
- [Risk] prompt 空白或格式变化导致请求异常 → Mitigation：prompt 常量保持非空，并对空白 prompt 行为设定明确测试或断言。
- [Risk] 用户期望配置 prompt，但本变更禁止覆盖 → Mitigation：文档明确 prompt 是内置 agent policy，不属于用户配置 surface。
- [Risk] OpenAI request 层和 runtime 层重复注入 system prompt → Mitigation：只在 agent-loop-runtime 注入，OpenAI adapter 继续只转换 records。

## Migration Plan

1. 新增内置 system prompt 常量模块，内容聚焦 Echo TUI agent 身份、简洁回答、工具使用和安全边界。
2. 在 `agent-loop-runtime` 中构造 provider records：以 transient system record 开头，再接 app 传入 records。
3. 确保 tool-call continuation 继续基于已注入 system record 的 provider records 追加 assistant/tool records。
4. 增加 runtime 和 OpenAI 集成测试，验证首轮与 continuation 请求都携带 system prompt，且 app transcript/callback 不新增 system record。
5. 更新 docs 和主 spec 的当前契约描述。

## Open Questions

- 内置 prompt 的具体措辞需要在实现时确定；建议保持短而明确，避免包含易过时的模型/provider 细节。
