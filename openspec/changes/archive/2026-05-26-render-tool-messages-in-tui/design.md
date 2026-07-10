## Context

当前 transcript record 类型允许未知 role 和额外字段，但 TUI 渲染分发只识别 `user`、`assistant`、`error`，未知 role 会被渲染为空。后续 tool call 接入前，需要先让 TUI 能把工具调用和工具结果作为可见 transcript 消息展示出来，并保持现有 append-only transcript、snapshot 重绘、resize recovery 和 session 恢复模型不变。

## Goals / Non-Goals

**Goals:**

- 在 transcript role 类型中明确表达 `tool_call` 与 `tool_result`。
- 在 render 层为这两类 record 提供可见投影。
- 工具消息使用与 assistant 相同的 `◆ ` 前缀和多行缩进规则，避免引入新的视觉语言。
- 覆盖最终 transcript 渲染、resize/snapshot 重绘和 session 恢复后的可见显示。

**Non-Goals:**

- 不实现真实工具注册、调用、执行或权限控制。
- 不解析 OpenAI Responses API 的 tool call stream events。
- 不把 tool result 回传给模型，也不设计 provider input 映射。
- 不改变 assistant Markdown 渲染能力或 syntax highlighting 行为。

## Decisions

### Decision 1: 使用独立 transcript role 表示工具阶段

选择：新增一等 role：`tool_call` 与 `tool_result`。

理由：调用意图和执行结果是两类不同事实；独立 role 让渲染分发、未来 agent 转换和测试断言都更明确。

替代方案：使用 `assistant` role 加 metadata 标记工具消息。该方案会让工具过程看起来像模型自然语言回复，后续也更容易被 agent converter 错误透传为普通 assistant 内容。

### Decision 2: 工具消息复用 assistant 前缀和基础文本投影

选择：tool 消息使用 `◆ ` 前缀，并沿用 assistant 的多行 continuation 缩进。实现上可以复用现有 assistant message line/block renderer，或提供只改变语义名称的薄封装函数。

理由：用户明确要求 tool 消息前缀和 assistant 保持一致；复用现有 wrap/Markdown 投影可降低 UI 行为差异和维护成本。

替代方案：为 tool 消息设计 `◇`、`↪`、`✓` 等新前缀。该方案更易区分工具状态，但超出本次需求，也会扩大视觉设计范围。

### Decision 3: 本次只保证 TUI 可见性，不改变 agent input

选择：本次改动聚焦 transcript 类型和 render 层；OpenAI transcript converter 仍按现有策略只发送可支持的 provider input，tool role 的 provider 映射留给后续 tool call change。

理由：tool result 回传模型依赖具体 provider item schema 和 tool execution loop，提前在 TUI change 中设计会扩大范围并增加错误抽象风险。

替代方案：同步把 tool records 映射进 OpenAI input。该方案会把 TUI 展示变更和 agent 协议变更耦合，不适合作为准备性改动。

## Risks / Trade-offs

- [Risk] tool 消息与 assistant 使用相同前缀，视觉上不易区分来源 → Mitigation：本次满足用户明确要求；后续如需更强区分，可在 tool 执行 change 中增加状态文本或样式，但不改变本次 role 语义。
- [Risk] tool_result 可能很长，直接显示会增加 transcript 高度 → Mitigation：沿用现有 transcript block wrap 与 resize 重绘能力；结果截断、折叠或摘要策略留给后续真实 tool 接入设计。
- [Risk] 仅 TUI 识别可能让用户误以为工具已可执行 → Mitigation：proposal、design 和 tasks 明确非目标，不改变 agent/tool 执行流程。
