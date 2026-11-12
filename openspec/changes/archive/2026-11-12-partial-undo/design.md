## Context

当前 change recorder 仅记录受控编辑前的文本快照；bash 白名单之外的命令直接 invalidate 并清空历史。transcript 回退通过单个 journal batch 截断记录、恢复 compaction 并 pop checkpoint。

## Goals / Non-Goals

目标是继续提供受控文件恢复、明确未追踪范围、避免覆盖受控编辑后的新变化，并允许逐轮恢复更早历史。不扫描工作区，不捕获任意 shell 文件变更，不提供强制覆盖或合并冲突界面。

## Decisions

1. `ChangeCheckpoint.untrackedReason` 仅记录本轮事实。`markUntracked` 只标记 recording checkpoint，继续记录工具编辑；真正快照失败及与活动后台写任务重叠的 checkpoint 仍使用原 invalid 语义。后台失败/取消按 `handle.pid !== undefined` 决定 `mayHaveExecuted`；PID 存在的 error 不能作为结束证据，runner 等真实 close，manager 以 `processFinished` 决定保护，清理超期保留保护，迟到 close 可释放保护。交接失败显示上下文错误与未知进程状态。
2. `change-file-state.ts` 同一次读取生成 snapshot 和指纹，统一哈希实现，并将核验时读取的 snapshot 复用为恢复备份。记录 `beforeFingerprint` 和最后成功编辑的 `afterFingerprint`；已有符号链接跟随目标，目标身份也进入指纹，换链即冲突。非 UTF-8 内容使用 `contentBase64` 保存原始字节，恢复与备份不再有损转码；文本 diff 明确跳过此类基线。本变更开发期间产生的中间态 journal 可能只有结束指纹，此时从 snapshot 计算基线兼容值；已发布的旧记录没有结束指纹，不进入此分支。`describeUndoAvailability` 共供摘要与执行，不依赖展示投影；存在未追踪风险且旧记录缺少结束指纹时继续拒绝恢复。当前状态等于编辑后指纹或基线指纹时允许恢复，支持 journal 失败后的重试。
3. 有限恢复成功后弹出该 checkpoint，向剩余栈顶传递独立 `untrackedEffects` 元数据，不改写其 `untrackedReason`。`notice` 只在紧接有限恢复的确认中展示一次说明，继续回退后为 `retained`，仅保留旧记录核验保护；新轮不继承这两种历史状态。复用 journal 的本轮 pop 及剩余栈顶 pop + push，在同一 batch 中截断 transcript、恢复 compaction 并更新元数据。内存仅在写盘成功后更新；resume/fork 保留元数据。历史为空时无需保留硬边界。
4. 确认标题统一为“/undo 回退上一轮”，正文用一行摘要说明撤回对话及恢复、删除文件，省略零计数；只追加影响用户决定的风险。本轮 shell 操作显示“Shell 操作不会完整撤销”，历史提醒仅在没有本轮提示时显示，旧记录保留无法检查后续修改及覆盖当前内容的提醒。不展示内部原因、指纹术语及一般冲突机制说明。不可用面板只显示原因，执行中只显示标题和“请稍候”。冲突结果先说明总数、未执行回退和省略数量，最多列出五条路径。活动后台写任务仍在摘要及执行入口阻止恢复。
5. 前台 `runBashCommand` 在超时或取消后再等待最多 1 秒。期限内没有真实 close 时返回“无法确认进程终止”，封闭输出并解除子进程及管道的事件循环引用，使 TUI 和 headless 调用都能继续；底层 `handle.wait()` 仍只表示真实结束。未确认进程按工作目录保留内存保护，摘要及执行入口均阻止 undo，真实 close 后释放；Esc 的 turn 可先于工具 Promise 收尾，所以取消事件内立即建立保护，期间开始的新轮记录未追踪事实。后台清理超期仍占并发槽位，达到上限时说明需等待实际退出，不再要求停止已收尾条目。

`notice` 不总能简化为 `retained`：先撤销一轮 shell，在保留该 notice 的旧栈上添加正常轮及第二轮 shell，再撤销第二轮 shell，会产生相邻 notice；继续撤销时必须保留下一层尚未展示的独立提醒。
5. 不追加 undo 成功消息，维持现有 transcript 语义；剩余 checkpoint 的独立元数据承载未追踪风险及一次性提醒。
6. undo 确认后同步进入 executing 状态，恢复完成前消费重复确认与 Esc，避免同一输入批次重入异步回退及错误关闭后续面板。

## Risks / Trade-offs

- 无法区分工具编辑之间混入的同路径 shell/人工修改 → 仅承诺记录路径的快照恢复，不承诺逐操作反向撤销；最后一次受控编辑之后的变化通过指纹阻止覆盖。
- 未追踪但实际只读的命令仍显示范围提示 → 不凭命令文本宣称不存在副作用，但有指纹的更早文件可继续恢复。
- 外部进程可在核验后再次写入 → 同步核验与写入缩短窗口，活动受管理后台写任务继续阻断；不宣称文件系统事务。
- 旧记录缺少指纹 → 存在未追踪影响时阻止恢复，不猜测其结束状态。旧 invalid 不转换为可回退状态。
