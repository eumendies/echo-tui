## Context

当前工具调用已经进入 append-only transcript，并可在 `/resume` 后重建 OpenAI provider input。现有 TUI 渲染把 `tool_call` 和 `tool_result` 都当作 assistant block 显示，因此 bash tool result 会把给模型使用的完整执行摘要暴露给用户，包括 exit code、duration、timeout、truncated、stdout/stderr section header 等内部信息。这个展示对调试有用，但对日常阅读噪音过大。

这次变化的关键约束是：不能为了 UI 简洁而丢失模型 continuation 所需的事实信息。`tool_result.text` 仍应作为完整 provider-facing output 保存并回传模型；TUI 应在渲染层派生更友好的可见投影。

## Goals / Non-Goals

**Goals:**

- bash tool call 在 transcript 中显示为 `Bash('command')`。
- bash tool result 紧跟调用显示，使用灰色弱化样式和 `⎿` 前缀，只展示命令输出或简洁状态。
- tool result 的 TUI 展示过长时截断，截断只影响显示，不影响 transcript 事实内容或 OpenAI `function_call_output`。
- renderer 能按 `toolName` 分发到不同工具的展示逻辑，为后续 edit diff view 等专属展示方式留入口。
- 旧 session 或缺少 metadata 的 tool records 仍有安全 fallback，不中断渲染。

**Non-Goals:**

- 不改变 bash tool 的真实执行行为、timeout、输出捕获或 provider-facing result 格式。
- 不实现 edit 工具或 diff view，只为后续接入保留清晰扩展点。
- 不引入交互式展开/折叠 UI、快捷键或可配置显示上限。
- 不改变 transcript 持久化格式中已有字段的语义。

## Decisions

### Decision 1: provider-facing text 与 TUI projection 分离

选择：`tool_result.text` 继续保存完整工具结果，供 OpenAI converter 回传模型；TUI 渲染使用工具专属 renderer 从 metadata 和可选 display 字段派生可见内容。

理由：模型需要 exit code、stderr、timeout、truncated 等信息判断下一步；用户默认只需要看命令输出。把两者分离可以同时保留模型能力和终端可读性。

替代方案：直接把 bash handler 的 result text 改成只包含 stdout/stderr。该方案实现简单，但会削弱模型处理失败命令的能力，也会让 `/resume` 后 provider input 丢失执行语义。

### Decision 2: 在 render 层按 toolName 分发，而不是在 app 层固化视觉

选择：`renderRecordBlock()` 对 `tool_call` / `tool_result` 使用 tool-aware renderer，优先根据 `toolName` 选择 bash 专属展示，未知工具 fallback 到通用展示。

理由：app/turn-context 负责记录事实，render 层负责可见投影。后续 edit tool 需要 diff view 时，只需新增对应 renderer，不需要改变 agent loop 或 transcript lifecycle。

替代方案：在 `TurnContext.appendToolCall()` / `appendToolResult()` 中直接写入最终展示文本。该方案会把视觉策略散落到 app 状态层，也不利于后续按终端宽度重新投影。

### Decision 3: bash result 显示使用 stdout/stderr 摘要和 display-only 截断

选择：bash result 的可见内容优先展示 stdout；stdout 为空且 stderr 非空时展示 stderr；两者都为空时显示 `(no output)`；timeout 等特殊状态可显示简洁状态行。显示层按有限行数截断，并显示截断提示。

理由：这覆盖最常见的成功、失败、无输出和长输出场景，同时避免把完整执行摘要显示给用户。

替代方案：同时显示 stdout 和 stderr。该方案信息更完整，但常规成功命令中 stderr 为空，失败命令中 stderr 通常更重要；第一版可以用优先级减少噪音，后续如有需要再调整为双 section 展示。

## Risks / Trade-offs

- [Risk] 只显示 stdout 或 stderr 可能隐藏另一个 stream 的有用信息 → Mitigation：完整信息仍保存在 transcript text 并回传模型；TUI fallback 可在无 stdout 时显示 stderr。
- [Risk] 从旧 `tool_result.text` 解析 bash stdout/stderr 可能依赖格式 → Mitigation：优先使用新增 display-only 字段或 metadata；旧 session 解析失败时 fallback 到原始 text 的截断灰色显示。
- [Risk] 过早抽象 tool renderer registry 增加复杂度 → Mitigation：第一版使用小型 `toolName` 分发函数；等第二个真实工具接入后再考虑 registry 化。
- [Risk] display-only 截断让用户看不到完整输出 → Mitigation：截断只影响显示；transcript 和 provider input 仍保留执行层已截断后的完整 tool result。

## Migration Plan

1. 保持现有 transcript schema 兼容，新增字段时只作为可选 display hint。
2. 调整 render 层 tool message 投影和测试断言。
3. 更新 README 和 OpenSpec specs，说明 bash tool 的新可见展示。
4. 旧 session 中缺少新 display hint 的 tool records 使用 metadata 或原始 text fallback 渲染。
