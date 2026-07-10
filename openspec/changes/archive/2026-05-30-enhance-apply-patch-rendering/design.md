## Context

当前 `apply_patch` handler 已经在同一个文件内解析 unified diff 和 `*** Begin Patch` 格式，并把 hunk 归一成 `oldLines` / `newLines` 后用于精确匹配和写盘。TUI 渲染层目前只有 bash 专属渲染，`apply_patch` call/result 走 generic fallback：调用行可能展示很长的 JSON patch，结果行只显示灰色 `Applied patch` 摘要，无法直接确认实际编辑内容。

本变更只优化可见渲染，不改变 patch 解析、匹配、写盘、tool schema 或 provider-facing tool result 文本。用户明确希望：结果区域不显示 diff header、file header 或 hunk header，只显示实际编辑内容；新增/删除使用背景色，而不是文字前景色。

## Goals / Non-Goals

**Goals:**

- 复用现有 `apply_patch` parser，在原有 hunk 解析路径上记录用于渲染的 context / removed / added 行。
- 将渲染所需信息作为 display-only metadata 从 handler 传到 transcript `tool_result` record。
- 为 `apply_patch` tool pair 增加专属 TUI 投影：简化 call 行，result 区域只显示编辑内容。
- 对 removed 行使用红色背景，对 added 行使用绿色背景；上下文行保持中性样式。
- 为 `apply_patch` 使用更大的 display-only 截断预算，让用户一次看到更多编辑内容。
- 保持 `/resume` 后可稳定重放历史渲染，不依赖当前文件系统状态。

**Non-Goals:**

- 不拆出独立 patch parser 模块。
- 不引入通用 diff 算法，不从 `oldLines` / `newLines` 反推 diff。
- 不在渲染层读取文件或重新匹配 hunk。
- 不把完整 diff 内容加入 provider-facing `result.text`。
- 不支持删除文件、rename/move、binary patch 等当前 `apply_patch` 不支持的 patch 类型。
- 不调整其他工具的通用结果截断预算。

## Decisions

### Decision: 在现有 hunk parser 中直接记录 display lines

`PatchHunk` 增加 `displayLines`，每行形如 `{ kind: 'context' | 'removed' | 'added', text: string }`。`parseHunk()`、`parseBeginPatchHunk()` 和新增文件解析路径在处理 ` ` / `-` / `+` 行时同步填充该数组。

选择该方案是因为 parser 已经逐行识别 patch 语义，此时记录 display line 不会重复解析，也不会丢失原始顺序。备选方案是从 `oldLines` / `newLines` 再跑 diff 或在 renderer 重新 parse patch；前者复杂且可能和输入表达不一致，后者会让解析逻辑分散。

### Decision: display metadata 随 tool result 持久化

`ToolExecutionResult` 增加 display-only metadata 字段，`TurnContext.createToolResultRecord()` 将其复制到 transcript record。metadata 只供 TUI renderer 使用，OpenAI transcript converter 仍只读取 `record.text` 作为 function call output。

这样 `/resume` 和历史 transcript 重绘可以复用当时 handler 产出的 display lines，不需要重新读取文件或重新解析当前工作区状态。对于旧 transcript 或缺少 metadata 的记录，renderer 继续回退 generic 渲染。

### Decision: 失败结果也尽量携带 display metadata

当 patch 参数 parse 成功但 simulate/apply 失败时，handler 仍返回 display metadata，同时 `ok: false` 和 `result.text` 保持现有失败原因。这样 TUI 可以显示“模型尝试编辑的内容”和简洁失败原因，帮助用户判断是上下文过期、歧义还是路径问题。

如果 patch 在 parser 阶段失败，则没有可靠 display metadata，使用 generic 失败渲染。

### Decision: result 区域过滤所有 patch/header 元信息

渲染层只消费 `displayLines`，因此天然不会展示 `diff --git`、`---`、`+++`、`@@`、`*** Begin Patch`、`*** Update File`、`*** Add File`、`*** End Patch` 等语法行。新增文件内容全部作为 `added` 行显示；更新 hunk 中 context 行来自 patch 本身，不从文件系统补齐。

### Decision: 背景色只应用到内容区

新增 `bgRed` / `bgGreen` 或等价背景色 helper，并只包裹内容文本，不覆盖 `⎿` 和 continuation prefix。这样工具消息的左侧结构仍保持稳定，新增/删除内容也更接近 diff 高亮。

### Decision: apply_patch 使用专属截断预算

保留 generic/bash 当前 12 行预算，新增 `APPLY_PATCH_RESULT_MAX_DISPLAY_LINES`，首版建议 120 行。截断只影响可见投影，不改变 transcript、handler result 或 provider input；截断提示使用 apply_patch 专属文案，例如 `[patch display truncated]`。

## Risks / Trade-offs

- [Risk] transcript metadata 体积增加 → Mitigation: 只保存 context/added/removed 文本和类型，不保存 header、行号或完整 raw patch；仍受现有 patch size/hunk/file 数量限制。
- [Risk] display metadata 类型未来变化影响旧 session → Mitigation: renderer 对 metadata 做结构校验，不符合预期时回退 generic 渲染。
- [Risk] 背景色在不同终端主题上对比度不一致 → Mitigation: 使用现有 ANSI helper 封装，测试只断言语义 ANSI 码和 plain text；后续可集中调整样式。
- [Risk] 多文件 patch 不在 result 区域显示文件 header 后定位性下降 → Mitigation: call 行展示 `ApplyPatch(<file>)` 或 `ApplyPatch(<n> files)`；result 仍按 patch 顺序展示编辑内容。
