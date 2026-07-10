## Context

当前 `openai-chat` adapter 已经负责 OpenAI Chat Completions compatible 协议的 transcript 转换、流式文本、工具调用和图片输入处理。配置层目前只为 OpenAI Responses 和 Anthropic 保留 `reasoning.effort`，Chat compatible provider 会忽略该字段；stream 层也只读取 `choices[].delta.content` 和 `choices[].delta.tool_calls`。

多家 OpenAI Chat compatible 推理模型服务会通过请求参数 `reasoning_effort` 控制推理强度，并在流式 chunk 的 `choices[].delta.reasoning_content` 中返回 reasoning 增量。Echo TUI 已有 provider-neutral 的 `AgentTurnResult.reasoningSummary` 和 app 层展示链路，因此可以直接复用，不需要引入新的 UI 或 transcript 可见 role。

## Goals / Non-Goals

**Goals:**

- 让 `openai-chat` model profile 保留合法的 `reasoning.effort`。
- 在 Chat Completions compatible 请求中以 `reasoning_effort` 字段直传 Echo TUI 的 effort 值，`none` 不发送。
- 聚合 `choices[].delta.reasoning_content` 为 `AgentTurnResult.reasoningSummary`，复用既有 reasoning summary 展示链路。
- 保持 `openai-chat` 不发送 Responses API 的 `reasoning` 对象，也不发送 Anthropic thinking 配置。
- 覆盖配置解析、请求构造和 stream 聚合测试。

**Non-Goals:**

- 不为 Chat compatible reasoning 新增 provider-only transcript role。
- 不把 `reasoning_content` 回放到后续 Chat messages。
- 不支持 Chat compatible 的 `reasoning.summary` 配置；该字段继续仅属于 OpenAI Responses。
- 不为不同 Chat-compatible provider 做 effort 档位映射或能力探测。

## Decisions

1. **effort 采用直传，不做本地映射**

   `openai-chat` 请求发送 `reasoning_effort: config.reasoningEffort`，只排除 `none` 和未配置。这样与 OpenAI Responses adapter 的直传语义一致，也避免状态栏展示值与实际请求值不一致。若某个兼容服务不支持 `minimal` 或 `xhigh`，让服务端明确返回错误，而不是本地静默降级。

2. **请求字段使用 `reasoning_effort`，不使用 `reasoning`**

   Chat Completions compatible 生态通常使用 snake_case 顶层字段 `reasoning_effort`。`reasoning: { effort }` 是 Responses API 风格，继续禁止在 Chat request 中出现，避免破坏现有 compatible providers。

3. **reasoning stream 只进入 `reasoningSummary`**

   `choices[].delta.reasoning_content` 代表展示用推理内容，不具备 Anthropic signed thinking 或 OpenAI Responses encrypted reasoning item 的 continuation 语义。因此只聚合并返回 `reasoningSummary`，不生成 `providerRecords`，也不写入下一轮 provider request。

4. **保持现有 text/tool 聚合路径不变**

   `delta.content` 仍追加到 `draft` 并触发 `onToken`；`delta.tool_calls` 仍按 tool index 聚合。新增 reasoning 聚合不改变完成条件，`finish_reason === 'stop' | 'tool_calls'` 仍表示 stream 完成。

## Risks / Trade-offs

- **部分兼容 provider 不支持所有 Echo effort 档位** → 采用直传会让这些服务端返回错误；这是可接受的显式失败，后续如有真实 provider 需求再引入 preset 级映射。
- **不同兼容 provider 的 reasoning 字段名可能不同** → 本次只支持常见的 `delta.reasoning_content`，避免为未知字段做过度兼容。
- **reasoning 内容可能很长** → 复用现有 reasoning summary 展示和持久化策略；本次不新增截断策略。
- **spec 中旧描述提到非 Responses provider 忽略 reasoning 配置** → delta spec 需要修改该 requirement，使 `openai-chat` 和 `anthropic` 的 effort 行为与当前实现一致，同时保留 summary 只属于 Responses。
