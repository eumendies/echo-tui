## 1. Display metadata 数据流

- [x] 1.1 在 `src/types/tool.ts` 中为 `ToolExecutionResult` 增加 display-only metadata 类型，覆盖 `apply_patch` 文件列表、hunk 列表和 `context` / `removed` / `added` display lines。
- [x] 1.2 更新 transcript record 创建逻辑，使 `TurnContext.createToolResultRecord()` 将 tool result display metadata 原样保存到 `tool_result` record。
- [x] 1.3 确认 OpenAI transcript converter 和 agent continuation 仍只使用 provider-facing `result.text`，不会把 display metadata 发送给模型。

## 2. apply_patch parser metadata

- [x] 2.1 扩展 `src/tools/apply-patch-tool-handler.ts` 内部 `PatchHunk` / `PatchOperation` 模型，在现有 parser 上记录 `displayLines`，不拆独立 parser 模块。
- [x] 2.2 在 unified diff hunk 解析中为 context、removed、added 行分别写入 display line，并保留原始 patch hunk 顺序。
- [x] 2.3 在 `*** Begin Patch` update hunk 解析中写入相同 display line metadata，并保留真实空 context 行。
- [x] 2.4 在新增文件解析路径中将新增文件内容记录为 `added` display lines，且不记录 patch/header/hunk 语法行。
- [x] 2.5 在 patch parse 成功后构造 apply_patch display metadata；成功应用时随 `ok: true` result 返回，parse 后应用失败时尽量随 `ok: false` result 返回。
- [x] 2.6 保持现有 `Applied patch` / `Patch failed` result 文本、all-or-nothing 写入语义和 patch schema 不变。

## 3. TUI 专属渲染

- [x] 3.1 在 `src/terminal/ansi.ts` 增加红色背景和绿色背景 helper，供渲染层按语义使用。
- [x] 3.2 在 `src/render/tool-message-renderer.ts` 增加 `apply_patch` tool pair 专属渲染分支；缺少或 metadata 无效时回退 generic 渲染。
- [x] 3.3 将 `apply_patch` call 行渲染为简洁 `ApplyPatch` 标签，避免展示 raw JSON patch arguments，并根据 result `ok` 保留 `◆` 成功/失败样式。
- [x] 3.4 将 result 区域渲染为 display metadata 中的实际编辑内容，不显示 `diff --git`、`---`、`+++`、`@@` 或 `*** Begin/Update/Add/End Patch` 等 header。
- [x] 3.5 对 `removed` 行使用红色背景，对 `added` 行使用绿色背景，对 `context` 行使用中性样式；背景只应用到内容区，不覆盖工具缩进前缀。
- [x] 3.6 为 `apply_patch` 使用专属 display-only 截断预算和专属截断提示，预算大于 generic 工具结果的 12 行。
- [x] 3.7 对 `ok: false` 且有 display metadata 的结果保留简洁失败原因，并继续展示尝试编辑内容。

## 4. 测试与文档

- [x] 4.1 补充 `apply_patch` 工具测试，验证 unified diff、Begin Patch、新增文件、解析成功但应用失败时都会产出正确 display metadata，且 result 文本不变。
- [x] 4.2 补充渲染测试，验证 apply_patch call 行隐藏 raw JSON、result 只显示编辑内容、不显示 header、增删行使用背景色、上下文中性展示。
- [x] 4.3 补充渲染测试，验证 apply_patch 专属截断、metadata 无效 fallback、失败原因和尝试编辑内容展示。
- [x] 4.4 更新 `docs/README.md` 和 `docs/tui-architecture.md` 中关于 tool message rendering 与 `apply_patch` 可见表现的描述。
- [x] 4.5 运行 `npm run typecheck`。
- [x] 4.6 运行 `npm test`。
- [x] 4.7 运行 `npx -y @fission-ai/openspec@latest status --change "enhance-apply-patch-rendering"` 确认 artifacts 完整。
