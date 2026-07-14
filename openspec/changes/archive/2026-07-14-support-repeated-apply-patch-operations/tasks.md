## 1. 虚拟状态模拟

- [x] 1.1 重构 `simulatePatch`，以规范化绝对路径维护首次快照与当前虚拟文件状态，移除同路径操作的直接拒绝。
- [x] 1.2 让 add、update、delete 按 patch 声明顺序基于虚拟存在性和内容执行，并保留首次读取时的文本、安全与大小校验。
- [x] 1.3 将模拟结果归并为每个路径一次最终写盘状态，同时保留操作级 display metadata。

## 2. 写盘与回退边界

- [x] 2.1 调整 `applyPatch` 写盘输入与 changed-files summary，使每个最终变化路径只捕获快照、写盘和标记一次。
- [x] 2.2 确保已有文件的 delete→add 被记录为可恢复更新，新增后删除的无最终变化路径不产生写盘或 change history 条目。

## 3. 自动化测试

- [x] 3.1 增加 Begin Patch 和 unified diff 的 delete→add 同路径成功用例，断言最终文件内容、摘要和 display metadata。
- [x] 3.2 增加同路径 update→update、add→update 及相对/绝对路径混用的顺序模拟用例。
- [x] 3.3 增加无效虚拟状态迁移与后续操作失败时零写盘的回归用例。
- [x] 3.4 增加 delete→add 的 change history 与 `/undo` 恢复原始内容用例。

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`。
- [x] 4.2 运行 `npm test`。
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
