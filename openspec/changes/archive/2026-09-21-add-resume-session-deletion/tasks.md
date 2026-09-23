## 1. 删除持久化边界

- [x] 1.1 在 transcript 协议、store 与 context 中定义受控 session 删除结果及操作，校验当前 cwd、目标存在性和当前 session 保护。
- [x] 1.2 实现 JSONL journal 删除和 index 原子更新/可重建自愈，且仅操作当前项目分区的目标 session。
- [x] 1.3 为 session model settings store 增加 sidecar 清理，并由 AppContext 在 journal 删除成功后以尽力语义编排调用。
- [x] 1.4 扩展 transcript command port，使 `/resume` 能查询当前 session 并请求受控删除，而不直接访问文件系统。

## 2. Resume 确认交互

- [x] 2.1 扩展 `/resume` 命令状态与 surface 投影，支持 `d` 删除意图、当前 session 保护提示和目标快照。
- [x] 2.2 使用确认 surface 实现 `Enter` 确认、`Esc` 取消、删除失败提示及成功后重新枚举候选的流程。
- [x] 2.3 在确认、取消、失败、成功和关闭路径失效预览请求及删除目标缓存；成功后按新列表恢复选择和预览或显示空状态。
- [x] 2.4 更新 `/resume` 的按键提示与中文用户可见文案，保持现有终端宽度和高度约束。

## 3. 自动化验证

- [x] 3.1 为 transcript store/context 添加测试：成功删除、当前 session/不存在/跨 cwd 拒绝、index 更新失败后的枚举自愈。
- [x] 3.2 为 session model settings store 与 AppContext 添加测试：sidecar 正常清理、缺失 sidecar 和清理失败不复活会话。
- [x] 3.3 为 `/resume` handler 添加测试：`d` 不立即删除、Enter 确认、Esc 取消、最后一项空状态、当前 session 提示、失败处理及迟到预览隔离。
- [x] 3.4 运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`，并在交互式 TUI 手动验证 `/resume` 删除确认流程。

## 4. 删除性能回归

- [x] 4.1 删除前仅校验 session_start header，不同步读取或 replay 完整 journal；补充回归测试并完成验证。
- [x] 4.2 取消删除确认时，若原选中项仍存在，恢复进入确认前的焦点与预览滚动位置；补充回归测试并完成验证。
