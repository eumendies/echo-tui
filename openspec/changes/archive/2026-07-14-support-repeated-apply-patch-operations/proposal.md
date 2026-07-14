## Why

`apply_patch` 当前拒绝同一规范化路径在单个 patch 中出现多次。大模型常以“先删除、再新增同名文件”的方式重建文件，这会使本应有效的编辑在写盘前失败。

## What Changes

- 允许单个 `apply_patch` 请求按声明顺序对同一解析后路径执行多个文件操作。
- 让后续操作基于同一请求中该路径的前序模拟结果，而非始终读取真实文件系统。
- 保持现有路径安全校验、文本文件约束、hunk 匹配规则和 all-or-nothing 模拟语义。
- 对每个最终发生文件系统变化的路径只执行一次写盘与 change history 记录，确保 `/undo` 可恢复请求前状态。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 扩展 `apply_patch` 对同一路径顺序操作的应用与失败语义。
- `undo-command`: 明确单个 `apply_patch` 内替换同一已有文件时的快照和回退行为。

## Impact

- 主要影响 `src/tools/apply-patch-tool-handler/simulator.ts` 的内存模拟模型，以及其返回给写盘和展示层的最终文件状态。
- 可能调整 `tool-handler.ts` 的变更摘要与写盘输入；不改变 provider 工具参数、第三方依赖或终端交互流程。
- 需要扩展 `test/tools/tool-execution.test.js`，并覆盖 change history 的 `/undo` 语义。
