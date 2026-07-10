## Context

当前 app 的 transcript 已经是本地会话事实源：普通用户消息、assistant 完成消息会被追加到 records 并持久化，`/resume` 会恢复完整 records，`/clear` 会清空当前可见 records 并解绑旧 session。但 agent 调用仍只接收当前提交的用户文本，导致普通连续对话和 `/resume` 后继续对话都无法让模型看到历史上下文。

本次 change 的关键约束是保持现有本地 transcript/session 语义，不引入 provider conversation id、不引入 tool 支持，也不新增与 `TranscriptRecord` 同构的中间 `AgentMessage` 类型。OpenAI API 的请求格式差异由 OpenAI adapter 内部的转换边界承担。

## Goals / Non-Goals

**Goals:**

- 普通提交时，agent 接收当前 transcript records；其中包含本轮刚提交的 user record 和此前已完成的 user / assistant / system records。
- `/resume` 恢复 session 后继续提交时，agent 请求携带恢复出的历史 transcript 上下文。
- `/clear` 后继续提交时，agent 请求只携带清空后的新 transcript 上下文，不继承旧 session。
- 扩展 `TranscriptRecord` 已知 role，支持 `system` 与 `error`；本地失败反馈使用 `error` role 可见且持久化。
- OpenAI adapter 内部提供 transcript 到 Responses API input 的转换边界，`error` records 不进入模型请求。

**Non-Goals:**

- 不支持 tool role、tool call、tool result 或工具调用 schema。
- 不引入 OpenAI conversation id、previous response id、服务端会话状态或 provider-specific session 持久化。
- 不做 token 预算、上下文裁剪、摘要压缩或长期记忆。
- 不新增独立 `AgentMessage` 类型或与 `TranscriptRecord` 同构的跨层模型。
- 不改变 slash command runtime、输入编辑、pending preview 或 resize recovery 的现有语义。

## Decisions

### 1. TranscriptRecord 作为 agent 输入事实源

`RunAgent` 的输入 SHALL 从单个 `string` 调整为 `TranscriptRecord[]`。`main.ts` 在 `beginUserTurn(userText)` 之后调用 agent，因此当前 user record 已经存在于 transcript 中；随后把当前 transcript records 交给 agent。这样 `main.ts` 不需要拼接历史，也不会重复追加当前用户消息。

替代方案是新增 `AgentMessage[]`。本次不采用，因为当前 agent 所需字段与 `TranscriptRecord` 高度重叠，额外类型会制造一层低收益映射，并与项目“直接、少抽象”的风格冲突。

### 2. OpenAI 转换器属于 agent/provider 边界

OpenAI adapter 内部 SHALL 提供 transcript-to-OpenAI input 转换器，把本地 `TranscriptRecord[]` 投影为 OpenAI Responses API 需要的 message JSON。转换器属于 provider-specific 边界，不放入 `TranscriptContext`，避免 app/persistence 层知道 OpenAI request shape。

转换策略：

- `user` -> OpenAI `user` message
- `assistant` -> OpenAI `assistant` message
- `system` -> OpenAI `system` message
- `error` -> 跳过，不发送给模型
- unknown role -> 跳过，避免未来/旧 transcript 污染请求

### 3. error role 表示本地失败反馈

agent reject 后，`TurnContext` SHALL 产生 `role: 'error'` 的 transcript record，而不是把本地错误伪装成 assistant message。render 层需要让 `error` record 可见；OpenAI 转换器负责过滤它，避免下一轮模型误以为 assistant 说过错误提示。

替代方案是继续使用 assistant role 并加 `agentVisible: false` metadata。本次不采用，因为 role 直接表达“这是本地错误记录”的语义，测试和转换也更清晰。

### 4. 暂不加入 tool role

虽然 transcript 未来可能需要表达 tool call/result，但 tool 需要 call id、tool name、arguments、output 等额外结构，不能只靠 `{role, text}` 准确建模。本次 change 明确不加入 tool 支持，避免在多轮上下文之外提前设计工具 schema。

## Risks / Trade-offs

- [Risk] 每次请求发送完整 transcript，长会话可能超出模型上下文或增加成本。→ Mitigation: 本次保持简单 stateless 方案；后续单独设计 token 裁剪/摘要能力。
- [Risk] `TranscriptRecord[]` 直接作为 agent 输入，使 agent 层能看到 UI/persistence 字段。→ Mitigation: OpenAI 转换器只读取 role/text，并过滤不支持 role；不把额外字段透传到 OpenAI 请求。
- [Risk] `error` role 如果只改数据不改 render，会导致失败反馈不可见。→ Mitigation: tasks 中明确更新 render 投影和测试。
- [Risk] unknown role 跳过可能隐藏未来记录。→ Mitigation: 本次只规范 user/assistant/system/error；未来新增 role 时必须同步 converter spec 和测试。

## Migration Plan

1. 扩展 transcript/agent 类型，调整 fake agent 与测试 harness 输入形态。
2. 增加 OpenAI transcript converter，并更新 OpenAI request 构造与测试。
3. 调整 app 提交流程，让 agent 接收当前 transcript records。
4. 将失败反馈改为 `error` record，并更新 render 可见投影。
5. 补齐多轮、resume、clear、error 过滤等测试。

旧 session JSON 中的 `user` / `assistant` records 保持兼容；新 `error` records 仍符合当前 transcript store 的 records 持久化结构，无需 schemaVersion 迁移。

## Open Questions

- `system` record 的来源暂未定义；本次只保证 converter 支持其进入 OpenAI input，后续若增加 system prompt 管理需另开 change。
