## Context

`use_skill` 工具的职责是把单个 skill 的完整 `SKILL.md` 内容按需加载给模型。当前 tool execution result 的 `text` 会包含 skill 名称、来源、可选 arguments、正文和资源列表，并作为普通 tool result 进入 transcript、session 和 provider continuation。

终端 transcript 渲染层目前没有 `use_skill` 专属投影，因此它会走通用 tool renderer，把完整 skill 正文展示给用户。这个展示对模型有价值，但对用户而言通常只是噪音；用户只需要知道系统正在使用哪个 skill。

现有工具消息渲染架构已经支持两类扩展点：

- pair-aware renderer：同时读取相邻且 `toolCallId` 匹配的 call/result，适合把完成态投影成专属摘要。
- record-level renderer：分别渲染单条 call 或 result，适合 pending preview、孤立记录和 fallback。

## Goals / Non-Goals

**Goals:**

- 成功加载 `use_skill` 时，transcript 只显示 `Using skill · <skill-name>` 或等价摘要。
- 不展示 `use_skill` 的 arguments、source path、skill 正文、resources 或成功 result body。
- footer pending preview 和单独 tool call 使用同样的 `Using skill` 摘要语言。
- 失败时保留简短诊断信息，让用户知道 skill 加载失败原因。
- 保留原始 transcript record 和 provider-visible tool result，确保模型仍能获得完整 skill 指令。

**Non-Goals:**

- 不修改 `use_skill` tool definition。
- 不修改 `createUseSkillToolHandler()` 的 result 文本格式。
- 不改变 direct slash skill invocation 的 user record 语义。
- 不新增可配置开关或主题 token。
- 不改变 context compaction、provider adapter 或 session persistence 的输入内容。

## Decisions

### Decision: 在 render 层新增 `use_skill` 专属投影

选择在 `src/render/tool-message-renderer.ts` 的工具 renderer 分发中接入 `use_skill` 专属 renderer，并优先新增独立模块，例如 `src/render/tool-message-renderers/use-skill.ts`。

理由：问题只存在于人类可见 transcript，不存在于 tool execution 或 provider 输入。render 层已有专属工具投影模式，新增模块能保持职责局部化。

替代方案：修改 `use_skill` handler 返回短文本，并把完整 skill 内容放到其他字段。该方案会改变 provider-visible tool result 语义，风险高且不必要。

### Decision: 成功 call/result pair 使用 pair-aware renderer 压缩为单行

相邻且 `toolCallId` 匹配、`toolName` 均为 `use_skill`、result `ok !== false` 的 pair SHALL 渲染为单行摘要：

```text
◆ Using skill · <skill-name>
```

该路径不渲染 result body，因此不会显示 skill 正文。

理由：用户明确只需要看到正在使用哪个 skill；单独渲染 call 和 result 会产生不必要的第二行。

替代方案：call 显示摘要，result 显示 `loaded`。该方案仍然多出一行，信息价值低。

### Decision: skill 名称主要来自 call arguments

renderer SHALL 优先从 `tool_call.argumentsText` 的 JSON object 中读取非空 `name` 字符串。pending preview 和单独 tool call 也使用该解析逻辑。

如果无法解析名称，renderer 可以显示 `Using skill`，避免回退到完整 JSON arguments。对于孤立成功 result，可从 result 文本中的 `skill: <name>` 头部做保守解析；解析失败时仍可显示 `Using skill` 而不展示正文。

理由：`name` 是用户关心的唯一可见信息；arguments 不需要展示，source path 和正文更不应展示。

替代方案：展示 `use_skill({"name":"..."})`。该方案暴露内部工具协议且违背“不展示 arguments”的目标。

### Decision: 失败结果保留短诊断

当 `use_skill` result `ok === false` 时，renderer SHALL 显示 `Using skill · <skill-name>` 或 `Using skill` 调用摘要，并使用既有工具结果样式显示 bounded failure text。该文本来自原始 result，但仍受现有换行/截断预算约束。

理由：失败信息对用户有实际诊断价值，例如 skill 不存在或被禁用。隐藏失败 result 会让用户只看到“正在使用 skill”，但不知道失败了。

替代方案：失败也只显示调用摘要。该方案过度隐藏，降低可理解性。

### Decision: 原始记录保持不变

专属 renderer 只返回可见行，不改写 `TranscriptRecord`。`tool_result.text` 中的完整 skill 正文继续用于 provider continuation、session persistence、compaction 和 skill usage 识别。

理由：这延续现有 tool-message rendering 的安全边界：渲染投影不改变事实内容。

## Risks / Trade-offs

- [Risk] 用户无法在 transcript 中直接看到 skill 正文，排查 skill 内容时少了一个入口。→ Mitigation：skill 正文仍在 skill 文件中，`/skills` 和文件路径可用于管理；transcript 本来不应承担展示完整系统指令的职责。
- [Risk] malformed legacy records 无法解析 skill 名称。→ Mitigation：显示 `Using skill` 的安全摘要，避免为了名字回退展示大段正文；失败场景仍显示 bounded failure text。
- [Risk] 过度隐藏成功 result 可能让用户误以为 tool 没有结果。→ Mitigation：调用行使用明确的 `Using skill` 文案，并通过成功/失败调用标记颜色沿用既有 tool 状态反馈。
- [Risk] 新 renderer 与通用 tool fallback 行为不一致。→ Mitigation：仅对 `toolName === "use_skill"` 生效，并增加覆盖成功、失败、pending、孤立 result 和记录保持不变的测试。
