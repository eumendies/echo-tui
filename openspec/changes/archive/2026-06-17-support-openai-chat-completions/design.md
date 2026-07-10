## Context

当前运行时已经把 app/TUI 与 provider adapter 分离：`agent-loop-runtime` 负责 system prompt、工具循环、授权、上下文压缩和回调编排，底层 `ProviderAgent` 只负责单次 provider turn。现有真实 adapter `agentType: "openai"` 使用 OpenAI Responses API，相关请求构造、transcript 转换和 tool schema 转换平铺在 `src/agent` 目录。

Chat Completions 与 Responses 都可通过 OpenAI SDK 调用，但二者协议形状不同：Responses 使用 `input` item、`function_call` / `function_call_output` item 和 reasoning item；Chat Completions 使用 `messages`、assistant message 的 `tool_calls`、后续 `tool` message，并通过 streaming chunk 的 `delta` 分片返回文本和 tool arguments。因此它更适合新增独立 provider agent，而不是在现有 Responses adapter 内增加分支。

## Goals / Non-Goals

**Goals:**

- 新增 `agentType: "openai-chat"`，让用户可以接入 OpenAI Chat Completions 兼容服务。
- 保持 `agentType: "openai"` 的 Responses API 行为和配置语义不变。
- 保持 `agent-loop-runtime` 的 provider-neutral 工具循环、授权、上下文压缩和 app callbacks 契约不变。
- 将每个 agent 与其协议专属 converter 放到同一个子目录，降低后续维护时的协议混淆。
- 为 Chat Completions 覆盖流式文本、tool calls、tool results、abort、错误脱敏和 prompt token usage 捕获。

**Non-Goals:**

- 不引入新的 SDK、TUI 库、build 工具或测试框架。
- 不把 Chat Completions 设计成 Responses API 的兼容层，也不修改 transcript 持久化 schema。
- 不支持 Responses-only reasoning summary、private reasoning continuation 或 encrypted reasoning item 在 `openai-chat` 中续传。
- 不改变现有工具执行、风险分类、审批 UI 或 slash command 行为。

## Decisions

### 1. `openai` 保持 Responses，新增 `openai-chat`

保留 `agentType: "openai"` 指向现有 Responses adapter，新增 `agentType: "openai-chat"` 指向 Chat Completions adapter。

备选方案是把 `openai` 重新解释为 Chat Completions，或增加 provider 字段如 `api: "chat" | "responses"`。前者会破坏已有配置；后者会让 config 解析和 agent 装配产生组合状态。新增 agent type 更直接，也符合当前 `createConfiguredAgent(config)` 的分发模型。

### 2. 按协议子目录组织 agent 文件

目标结构：

```text
src/agent/
  agent-loop-runtime.ts
  agent-setup.ts
  agent-errors.ts
  system-prompt.ts
  context-compaction.ts
  agent-instructions.ts
  fake/
    agent.ts
  openai-responses/
    agent.ts
    transcript-converter.ts
    tool-converter.ts
  openai-chat/
    agent.ts
    transcript-converter.ts
    tool-converter.ts
```

Responses adapter 从旧 `openai-*` 文件迁移到 `openai-responses/`，fake agent 迁移到 `fake/`。`agent-setup.ts` 是唯一装配点，app 和 runtime 不直接依赖具体 agent 文件路径。

备选方案是保留平铺目录，只新增 `openai-chat-agent.ts`。这对首版改动更小，但随着两个 OpenAI 协议都需要 transcript/tool converter，文件名会变长且协议边界不清晰。

### 3. Chat converter 独立实现，不复用 Responses converter

Chat Completions 的历史消息要求与 Responses input item 不同。`openai-chat/transcript-converter.ts` 负责把本地 transcript 投影为 Chat messages：

```text
Transcript records                     Chat messages
────────────────────────────────       ────────────────────────────────
system/user/assistant            ───▶   system/user/assistant message
assistant + following tool_call  ───▶   assistant message with tool_calls
tool_result                      ───▶   tool message
error/local_notice/reasoning     ───▶   filtered
```

converter 需要处理 agent-loop 当前的平铺 tool records。若出现 assistant segment 后接一个或多个 tool_call，再接对应 tool_result，Chat converter 应把连续 tool_call 聚合到前一个 assistant message 的 `tool_calls` 上，并把 tool_result 映射为独立 `tool` message。缺少 call id、tool name 或 arguments 的旧记录应跳过，避免构造无效 Chat 请求。

### 4. Chat stream reader 聚合 tool call arguments

Chat streaming 文本来自 `chunk.choices[].delta.content`。tool call 可能以多 chunk 返回，需要按 choice/tool index 聚合 `id`、`function.name` 和 `function.arguments`。当 stream 结束或 choice `finish_reason` 为 `tool_calls` / `stop` 时，adapter 返回本 turn 的 `draft` 与完整 provider-neutral `ToolCall[]`。

如果同一 stream 同时产生文本和 tool calls，仍由现有 agent loop 在 tool call 前提交 assistant segment，Chat agent 只返回 `draft` 和 `toolCalls`，不直接执行工具。

### 5. `openai-chat` 不发送 reasoning 配置

`reasoning.effort` 和 `reasoning.summary` 是当前 Responses adapter 的请求语义。Chat Completions 第一版不发送这些字段，也不生成 `reasoningSummary` 或 provider private reasoning records。

实现时应明确防止用户误以为配置生效：可以在 config 层拒绝 `openai-chat` 选中模型带 `reasoning`，或在 agent 层启动前抛出明确错误。优先选择 config 层校验，因为错误更早、更贴近用户配置。

## Risks / Trade-offs

- Chat 工具历史重组出错 → 用 converter 单元测试覆盖单 tool、多 tool、缺 metadata、assistant 文本为空和历史工具结果续传。
- Chat stream tool arguments 分片不完整 → 只在收齐 call id、name、arguments 后返回 tool call；对缺字段的 tool call 抛明确 provider stream 错误，避免执行半成品工具。
- 目录重组引入 import 路径回归 → 先迁移 Responses/fake 并保持既有测试通过，再新增 Chat agent；测试覆盖 `agent-setup` 分发。
- `reasoning` 在 Chat 下静默失效 → 对 `openai-chat` + `reasoning` 配置给出明确错误，不静默忽略。
- OpenAI SDK Chat stream usage 可能缺失 → 缺失时不阻断；存在 `usage.prompt_tokens` 时才回传 `usageInputTokens`。
