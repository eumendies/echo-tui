## 1. 匹配逻辑调整

- [x] 1.1 在 `src/tools/apply-patch-tool-handler/simulator.ts` 中新增游标后 first-match 定位 helper，0 次匹配仍返回失败。
- [x] 1.2 将 `applySequentialUpdateHunks()` 的 inline anchor、context-only chunk 和修改 chunk 定位改为 first-match-after-cursor。
- [x] 1.3 保留 `applyIndependentUpdateHunks()` 的精确唯一匹配行为，确保 unified diff 语义不变。
- [x] 1.4 确认每次匹配、插入或替换后正确推进 `searchStart`，并保持 display metadata 的 `matchedHunks` 位置可信。

## 2. 测试覆盖

- [x] 2.1 更新 Begin Patch ambiguous anchor 相关测试预期，使重复 anchor 按游标后的第一个匹配成功应用。
- [x] 2.2 新增 Begin Patch 重复上下文场景测试，覆盖两个顺序 hunk 分别修改两个相同片段。
- [x] 2.3 新增 context-only chunk 在重复上下文中推进游标的测试。
- [x] 2.4 保留或新增 unified diff 多重匹配失败测试，证明 independent 模式仍拒绝歧义 hunk。

## 3. 验证与收尾

- [x] 3.1 运行 `npm run typecheck`。
- [x] 3.2 运行 `npm test`。
- [x] 3.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 3.4 检查 `git diff --check` 和 OpenSpec artifact 状态。
