## Why

`apply_patch` 当前在 TUI 中走通用工具渲染，成功结果只显示灰色摘要，无法直接看出实际新增、删除和上下文内容；同时 raw JSON patch 参数在调用行中噪音很大。优化渲染可以让用户像看 diff 一样快速确认本次编辑，同时不改变工具执行语义或回传模型的 tool output。

## What Changes

- 为 `apply_patch` 解析结果增加 display-only metadata，复用现有 parser 在 hunk 解析阶段记录 context、removed、added 行。
- `apply_patch` 可见渲染改为工具专属投影：隐藏 raw JSON patch、隐藏 diff/header/hunk 元信息，只显示实际编辑内容。
- 删除行使用红色背景展示，新增行使用绿色背景展示，上下文行保持中性展示。
- `apply_patch` 专属 display truncation 行数上限提高，以便一次看到更多编辑内容；不影响 bash、grep、read_files、web_fetch 等其他工具的通用截断预算。
- 保持 transcript/provider-facing 文本不变：模型继续接收现有 `Applied patch` / `Patch failed` 摘要，新增 metadata 只用于 TUI 可见渲染和历史恢复。
- 当 patch 解析成功但应用失败时，TUI 仍可显示模型尝试编辑的内容，并保留简洁失败原因。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `local-tool-execution`: `apply_patch` handler 需要在不改变执行语义和 result 文本的前提下，产出用于渲染的 patch display metadata。
- `streaming-llm-service-adapter`: app 可见层需要为 `apply_patch` tool call/result pair 提供专属渲染，使用背景色展示新增/删除行，并提高该工具的 display-only 截断预算。

## Impact

- 主要影响 `src/tools/apply-patch-tool-handler.ts`、`src/types/tool.ts`、`src/app/turn-context.ts`、`src/render/tool-message-renderer.ts` 和相关渲染/工具测试。
- 不新增运行时依赖，不改变 `apply_patch` tool schema，不改变 provider input 中的 tool result 文本。
- 需要更新文档中关于 tool message rendering 和 `apply_patch` 可见表现的描述。
