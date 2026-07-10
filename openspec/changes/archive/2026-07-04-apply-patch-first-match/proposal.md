## Why

`apply_patch` 的 Begin Patch / V4A 风格更新当前在重复上下文场景下会因为 “hunk matched multiple locations” 失败，即使 patch chunk 本身有明确顺序。Codex/V4A 的常见应用语义是从当前搜索游标之后选择第一个匹配并推进游标，因此当前行为会造成不必要的 false negative、降低模型编辑成功率。

## What Changes

- 将 Begin Patch update 的顺序定位规则调整为“从当前搜索游标之后寻找第一个匹配”。
- inline `@@ <context>` anchor 和 context-only chunk 也按游标后的第一个匹配推进搜索位置。
- 保留无锚点纯插入拒绝、无实际修改拒绝、all-or-nothing 写入、路径校验和 display metadata 语义。
- 暂不改变 unified diff 的精确唯一匹配规则，避免在该格式仍忽略 hunk 行号时扩大误改风险。
- 增加重复上下文场景测试，覆盖 Begin Patch 顺序 hunk、inline anchor 和 context-only anchor。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 调整 `apply_patch` Begin Patch update 的顺序定位要求，使其兼容 V4A 风格的游标后 first-match 行为，而不是在剩余文件中存在多个匹配时直接失败。

## Impact

- 影响 `src/tools/apply-patch-tool-handler/simulator.ts` 中 Begin Patch sequential update hunk 的定位逻辑。
- 影响 `test/tools/tool-execution.test.js` 中关于 ambiguous Begin Patch anchor 的预期，并新增重复匹配成功用例。
- 影响 `openspec/specs/local-tool-execution/spec.md` 的 `apply_patch` Begin Patch update 行为要求。
- 不引入新依赖，不改变工具参数 schema，不改变 provider-facing tool result 文本结构。
