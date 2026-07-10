## 1. Undo 状态模型与 transcript 回退能力

- [x] 1.1 新增 undo 类型定义，描述 checkpoint、file entry、状态和执行结果。
- [x] 1.2 新增 `UndoContext`，支持 begin/finalize/invalidate、记录文件 snapshot 与写入状态、读取栈顶 checkpoint、标记 used 和维护 checkpoint 栈。
- [x] 1.3 为 `TranscriptContext` 增加受控截断/恢复方法，按 checkpoint 边界恢复 records 和 compaction，并立即持久化当前 session。
- [x] 1.4 将 `UndoContext` 组合进 `AppContext`，暴露 begin/finalize/invalidate、文件记录和执行 undo 的 facade 方法。
- [x] 1.5 在 `runAssistantTurn()` 生命周期中创建 checkpoint，并在完成、失败或中断时 finalize；下一轮 assistant turn 开始时保留旧 ready checkpoint 以支持连续 undo。

## 2. 受控文件工具 journal 接入

- [x] 2.1 扩展 tool execution options 或受控回调，使工具 handler 能在写盘前后访问 undo recorder，而不直接依赖完整 app 状态。
- [x] 2.2 扩展 `apply_patch` 执行路径，在模拟成功后、写盘前记录目标文件 snapshot，每个文件写盘成功后立即标记 `created` / `updated` 状态。
- [x] 2.3 保证同一 loop 多次修改同一文件时仅保留第一次 snapshot 状态，并在写入成功后保持已写入状态。
- [x] 2.4 确保 `apply_patch` 解析/校验/模拟失败不新增 undo file entry；写盘阶段失败时只保留已成功写入文件的可回退状态。
- [x] 2.5 对不可追踪写入型 `run_bash_command` 标记 checkpoint invalid；只读 inspection bash 不单独使 checkpoint 失效。

## 3. /undo command 与 CommandHost 集成

- [x] 3.1 扩展 `CommandHost` 的 undo 领域能力，提供读取 undo 摘要、执行 undo、关闭 surface 后触发 redraw/recovery 的受控入口。
- [x] 3.2 新增 `UndoCommandHandler`，匹配纯 `/undo`，无可回退 checkpoint 或 invalid checkpoint 时展示 info surface。
- [x] 3.3 为 ready checkpoint 展示 confirm surface，用三行短文案描述回退范围、文件修改/新增文件数量和手动修改覆盖风险。
- [x] 3.4 确认 undo 时 all-or-nothing 恢复文件，最后截断 transcript 和恢复 compaction。
- [x] 3.5 将 `/undo` 注册到默认 slash command handlers，并更新 slash descriptor 测试和用户文档。

## 4. 测试与验证

- [x] 4.1 增加 `UndoContext` 单元测试，覆盖新增文件、更新文件、多次修改同一文件、used/invalid/ready 状态转换。
- [x] 4.2 增加 `apply_patch` + undo journal 测试，覆盖成功记录 snapshot 与写入状态、失败不记录、loop 后手动修改仍恢复。
- [x] 4.3 增加 transcript 回退测试，覆盖多 tool call loop、compaction 状态恢复、中断 partial assistant 和 interruption notice 回退。
- [x] 4.4 增加 `/undo` command handler/runtime 测试，覆盖无 checkpoint、invalid checkpoint、确认、取消、成功后不追加 transcript record。
- [x] 4.5 运行 `npm run typecheck`。
- [x] 4.6 运行 `npm test`。
- [x] 4.7 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.8 手工验证非 Git 目录中 `apply_patch` 修改后 `/undo` 恢复文件和 transcript，包含新增文件删除、已有文件恢复、loop 后手动修改覆盖恢复和写入型 bash invalid 提示。

## 5. 多轮 undo 扩展

- [x] 5.1 将 `UndoContext` 从单个 last checkpoint 改为当前进程内 checkpoint 栈。
- [x] 5.2 invalid checkpoint 作为不可回退边界，并在 invalid 时丢弃该 checkpoint 之前的历史。
- [x] 5.3 增加连续 undo、invalid 边界和 AppContext transcript 多轮回退测试。

## 6. /undo 确认文案收敛

- [x] 6.1 将确认面板从 transcript record 数量改为三行短文案。
- [x] 6.2 从 command summary 中移除 `transcriptRecordCount`，避免后续 UI 误用内部记录粒度。

## 7. Undo 文件状态收敛

- [x] 7.1 移除 `UndoFileEntry.after` 快照，改用 `pending` / `created` / `updated` 状态表达写入结果。
- [x] 7.2 `captureFileAfter()` 只标记写入状态，不再读取或保存 after 文件内容。
- [x] 7.3 增加 pending entry 不参与摘要和恢复的测试。

## 8. Undo 文件快照字段命名

- [x] 8.1 将 `UndoFileEntry.before` 字段重命名为 `snapshot`。

## 9. apply_patch 写盘失败语义

- [x] 9.1 `apply_patch` 每成功写入一个文件就立即标记该文件为 `created` / `updated`。
- [x] 9.2 `apply_patch` 写盘失败不再使 undo checkpoint invalid。
- [x] 9.3 增加部分写盘成功、后续写盘失败时只标记成功文件的测试。
