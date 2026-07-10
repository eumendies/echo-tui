## Context

当前真实 agent 工具循环由 `agent-loop-runtime` 统一编排：provider agent 返回 `ToolCall`，runtime 追加 tool call transcript record，随后立即调用 `ToolExecutor.execute(call)` 执行本地工具，再把结果追加为 tool result。`apply_patch` 已具备受控 parser、all-or-nothing 写入和 TUI display metadata，但它仍然是写文件工具，执行前没有用户授权点。

这次变更跨越 agent loop、app 输入事件、footer surface 和 transcript 记录。设计目标是在工具执行边界前增加一个 app 可控的授权 modal，同时保持 provider adapter、tool handler 和 command runtime 的职责边界清晰。

## Goals / Non-Goals

**Goals:**

- 第一版只拦截 `apply_patch` 工具调用。
- 在执行 `apply_patch` handler 前暂停 agent loop，等待用户选择。
- 授权 UI 使用 select surface，第一版提供 `Allow once` 与 `Deny`。
- 用户拒绝或按 Esc 时不执行工具，并生成模型可消费的失败 tool result。
- 内部决策模型预留 `allow tool for session`、`allow all tools for session` 和用户反馈文本等后续扩展。
- 不让 tool handler、OpenAI provider adapter 或 slash `CommandRuntime` 承担授权 UI 职责。

**Non-Goals:**

- 不实现完整工具权限配置系统。
- 不拦截 bash、grep、glob、read_files、web_fetch 或 web_search。
- 不实现本会话允许全部工具、本会话允许某个工具或用户输入反馈；只保留类型和 UI 结构上的扩展空间。
- 不在授权面板中展示完整 diff preview 或 dry-run 结果。
- 不改变 `apply_patch` 的 patch 语法、路径策略、hunk 匹配或写盘行为。

## Decisions

### Decision 1: 在 agent loop runtime 中设置执行前 gate

选择：`agent-loop-runtime` 在 `state.executor.execute(toolCall)` 之前判断 `toolCall.toolName === 'apply_patch'`，需要授权时调用新的 `AgentCallbacks.onToolApprovalRequest(call)`，根据返回的结构化决策决定执行工具或生成拒绝结果。

理由：agent loop runtime 是 provider-neutral 的 tool call continuation 编排点，已经拥有 tool call、tool executor 和回调链路。这里拦截可以覆盖所有 provider，同时不污染具体工具 handler。

替代方案：在 `apply_patch` handler 内部询问用户。该方案会让工具层依赖 TUI 输入和渲染，破坏工具 handler 的纯执行边界。

替代方案：在 OpenAI provider adapter 中拦截。该方案只覆盖 OpenAI 且让 provider 边界知道具体本地工具策略，不符合现有 provider-neutral tool loop 设计。

### Decision 2: 授权决策使用结构化 union，而不是 boolean

选择：新增 `ToolApprovalDecision`，第一版实际产生 `{kind: 'allow_once'}` 和 `{kind: 'deny'}`。agent loop 根据决策判断是否执行；拒绝决策生成 `ok: false` 的 synthetic tool result。

理由：用户已经明确后续会有 “allow all tools during this session” 和 “输入文本告诉模型怎么做” 等选项。boolean 会很快失效；结构化 union 能让第一版保持简单，同时让后续扩展不需要重写 callback 协议。

替代方案：返回 boolean。实现最小，但后续新增授权范围和用户反馈时需要破坏性修改协议。

### Decision 3: App 层管理独立 ToolApprovalContext

选择：新增或等价实现 app 侧 tool approval context，负责当前授权请求、select 选项、选中索引、Promise resolver、输入事件处理和 session policy 预留状态。`main.ts` 在 `createRenderState()` 中让 approval surface 优先于 command surface，在 `handleEvent()` 中优先把事件交给 approval context。

理由：tool approval 是 agent turn 内部的 modal decision，不是 slash command session。独立 context 可以避免刚收窄过的 `CommandRuntime` 重新承担业务 modal 职责，也能避免污染主 composer。

替代方案：复用 command runtime session。虽然可以复用 select 渲染，但会让 command runtime 管理非 slash 命令流程，边界不清。

替代方案：把状态放进 turn context。turn context 管理 response lock、pending preview 和 spinner；授权 modal 涉及输入事件和用户决策，单独 context 更清晰。

### Decision 4: 第一版 UI 使用 select surface

选择：授权面板使用现有 select surface 渲染结构。第一版选项为 `Allow once` 和 `Deny`，Enter 选择当前项，Esc 等价拒绝。

理由：select surface 天然支持多选项，后续可以增加本会话授权、所有工具授权和反馈入口，不需要从 confirm UI 迁移。当前 footer 已支持 select surface，可复用渲染能力。

替代方案：使用 confirm surface。二元交互实现更小，但后续扩展为多选项时会出现 UI 和状态模型迁移。

### Decision 5: 拒绝仍写入 tool_result transcript

选择：用户拒绝执行时，agent loop 生成 `ToolExecutionResult`：`ok: false`、`toolName` 和 `callId` 保持原值，`text` 明确说明用户拒绝执行。该 result 继续走 `callbacks.onToolResult`、`appendPendingToolResult` 和 continuation record 流程。

理由：provider function calling 协议需要每个 tool call 有对应 tool result，拒绝也应该作为模型可见事实回传。这样 agent loop 不会卡住，模型可以继续解释或调整方案。

替代方案：拒绝时抛错中断本轮。该方案会把用户拒绝误表现为本地异常，并阻断模型基于拒绝原因继续响应。

## Risks / Trade-offs

- [Risk] agent loop 在等待用户授权时如果输入事件没有被 modal 消费，主 composer 可能被误编辑 → Mitigation：approval active 时输入事件优先级高于 command runtime、slash suggestion 和 composer。
- [Risk] 拒绝结果是工具失败，模型可能尝试再次调用同一 patch → Mitigation：拒绝文本明确说明用户未授权；后续 feedback 选项可进一步指导模型。
- [Risk] 第一版不展示完整 diff，用户只能基于工具调用摘要决策 → Mitigation：保留现有 pending apply_patch 摘要；后续可抽 apply_patch preview/dry-run 能力扩展授权面板。
- [Risk] 复用 command surface 类型可能造成命名语义偏差 → Mitigation：仅复用 select surface DTO 和 footer 渲染，不复用 `CommandRuntime`；未来出现更多非 command modal 时再抽中性 surface 类型。

## Migration Plan

1. 扩展 agent callback 和 tool approval decision 类型。
2. 在 agent loop runtime 的 apply_patch 执行前加入 approval gate 和拒绝 synthetic result。
3. 增加 app 侧 tool approval context，并接入 render state 与输入事件优先级。
4. 更新 TUI、agent loop 和 app 测试，覆盖允许、拒绝、Esc 拒绝和非 apply_patch 不拦截。
5. 运行 typecheck、test 和 JS syntax check。

## Open Questions

- 后续 diff preview 是只解析 patch 展示，还是执行 dry-run simulate 后展示更可靠的匹配/失败信息？第一版暂不解决。
- 后续 “Tell model what to do instead” 是否使用 approval context 自带 mini composer，还是抽通用临时输入 surface？第一版暂不解决，但不应复用主 composer 状态。
