## Why

`apply_patch` 现在只能新增或更新文本文件，遇到 `*** Delete File:` 或 unified diff 删除语法会直接拒绝。此前拒绝删除主要是因为缺少明确的用户审批 UI；现在 apply_patch 已经在执行前请求授权，可以在用户确认后安全地支持删除文件，减少模型绕行 bash/rm 的需求。

## What Changes

- `apply_patch` 支持通过 `*** Begin Patch` / `*** Delete File: <path>` / `*** End Patch` 删除普通 UTF-8 文本文件。
- `apply_patch` 支持 unified diff 删除文件语法，包括 `+++ /dev/null` 和常见 `deleted file mode` 元数据。
- 删除文件继续遵守现有路径校验、文本文件校验、文件数量/文件大小限制、all-or-nothing 写入、change history 和 undo 语义。
- apply_patch result display metadata 增加 deleted 文件展示，TUI 渲染应以 removed 行展示被删除内容。
- apply_patch 执行前授权 preview 需要突出删除操作，让用户在 permission gate 中能明显看到哪些文件会被删除。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `local-tool-execution`: `apply_patch` 从只支持新增/更新文本文件扩展为支持新增、更新或删除普通 UTF-8 文本文件。
- `tool-approval`: apply_patch 授权 preview 需要突出删除文件，而不是只显示普通路径摘要。
- `streaming-llm-service-adapter`: apply_patch tool result diff-style rendering 需要接受并展示 deleted display metadata。
- `undo-command`: apply_patch 删除已有文件后应进入 change history，`/undo` 可恢复被删除文件。

## Impact

- 影响 `src/tools/apply-patch-tool-handler/` 的 parser、simulator 和写盘逻辑。
- 影响 `src/types/tool.ts` 与 `src/render/tool-message-renderers/apply-patch.ts` 的 display metadata 类型和渲染校验。
- 影响 `src/tools/tool-risk-classifier.ts` / `src/tools/apply-patch-tool-handler/tool-handler.ts` 中 apply_patch approval preview 的路径摘要。
- 影响 apply_patch、renderer、approval preview、undo/change history 相关测试。
- 不引入第三方依赖，不改变 bash、MCP、hooks 的执行语义。
