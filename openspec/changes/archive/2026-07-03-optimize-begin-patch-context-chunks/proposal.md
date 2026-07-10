## Why

当前 `apply_patch` 的 Begin Patch 解析只支持每个 `@@` hunk 自身包含新增或删除行，无法处理模型常生成的 context-only chunk。该限制会把本可安全定位的 patch 判为语法失败，增加工具失败率和模型重试成本。

## What Changes

- 扩展 Begin Patch update 解析，支持仅包含上下文行的 `@@` chunk 作为后续修改 chunk 的定位锚点。
- 为 Begin Patch update 引入顺序定位语义，使后续修改 chunk 可在前序 context-only chunk 定位之后继续匹配。
- 支持 `@@ <context>` 形式的单行上下文锚点，用于表达“在该上下文之后插入或继续匹配”。
- 保留现有安全边界：无上下文的纯插入不得猜测位置，匹配失败或匹配歧义仍应拒绝并保持 all-or-nothing。
- 不改变 unified diff 解析语义，不新增删除、移动、重命名或二进制 patch 支持。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 调整 `apply_patch` Begin Patch update 的有效语法和 hunk 定位语义，支持 context-only chunk 与顺序锚定。

## Impact

- 影响 `src/tools/apply-patch-tool-handler/parser.ts` 的 Begin Patch update 解析模型。
- 影响 `src/tools/apply-patch-tool-handler/simulator.ts` 的 Begin Patch update 匹配/应用流程和 display metadata 位置计算。
- 需要新增或更新 `test/tools/tool-execution.test.js` 覆盖 context-only chunk、`@@ <context>`、歧义匹配、无锚点插入拒绝和 display metadata。
- 不引入第三方依赖，不改变 tool schema、approval、undo/change history 或 TUI rendering contract。
