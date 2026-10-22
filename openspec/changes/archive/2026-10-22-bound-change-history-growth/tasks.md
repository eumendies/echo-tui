## 1. journal 操作与重放

- [x] 1.1 在 `src/persistence/transcript-journal.ts` 定义 `push_change_checkpoint` 与 `pop_change_checkpoint` 的操作类型、类型守卫与序列化入口，并加入导出；`set_change_history` 的类型与语义保持不变。
- [x] 1.2 `applyTranscriptJournalOperation` 增加两个分支：`push` 把 checkpoint 追加到 replay 时当前栈顶；`pop` 弹出栈顶，栈为空时返回失败使本次 replay 判定不可恢复。不引入"期望弹出的 checkpoint id"校验。
- [x] 1.3 复核既有判定不受影响：seq 连续性、`truncate_records` 越界、`session_start` 校验、尾行容错与"未知操作"判定保持原行为（新操作走已知操作路径，旧版本视角下的未知操作语义不变）。

## 2. 写入侧增量

- [x] 2.1 `src/app/state/change-history-context.ts` 新增 `ChangeHistoryDelta` 类型与私有 `pendingDelta`，并在 `finalizeCheckpoint()`（recording → `push`，invalid → `reset`）与 `invalidate()`（仅在 `current` 存在时清空栈，不写 delta，由随后 finalize 产生 `reset`）更新它；提供消费语义的 `takePendingDelta()`。`current` 为空时 `invalidate()` 保持既有的空操作行为，不放宽守卫，也不改动已完成 checkpoint 的状态。
- [x] 2.2 `markLastUsed()` 不产生 delta，并在注释中写明 undo 路径单独写入 `pop`，避免后续改动误以为漏记。
- [x] 2.3 `src/app/state/transcript-context.ts` 用 `pendingChangeHistoryDelta` 替换 `pendingChangeHistory`，新增 `stageChangeHistoryDelta(delta)`：把 delta 应用到镜像栈并记下待写增量；删除只服务于"整份写入"的 `setChangeHistory`。
- [x] 2.4 `createPendingOperation` 按 delta 类型生成 `push_change_checkpoint` / `pop_change_checkpoint` / `set_change_history`（`reset`），无 delta 时不产生 change history 子操作。
- [x] 2.5 `AppContext.syncChangeHistory` 改为搬运 `takePendingDelta()` 的结果；复核 `clearRecords`、`loadSession`、`applyCompaction`、`updateTodoState` 路径不再依赖整份写入。
- [x] 2.6 `forkSession` 保持 `set_change_history` 整份写入，并确认 fork 后镜像栈与 context 栈一致。

## 3. 回退路径

- [x] 3.1 `TranscriptContext.restoreToBoundary` 不再接收"整份数组"（undo 是唯一生产调用点，语义固定为弹出栈顶一个 checkpoint），batch 内改用 `pop_change_checkpoint`。
- [x] 3.2 `AppContext.executeUndo` 适配新参数：不再构造回退后的整份数组；跨边界预读、文件恢复失败时不回退 transcript、失败返回语义保持不变。
- [x] 3.3 复核 `executeUndo` → `restoreToBoundary` → `markLastUsed()` 的调用顺序，确认镜像栈、context 栈与 journal 三者在 undo 后一致。

## 4. 测试

- [x] 4.1 等价性：同一轮次序列分别用"每轮整份重写"和"每轮增量"生成 journal，断言 `replayTranscriptJournal` 结果在 records、compaction、todoState 与 changeHistory 上深相等；同时覆盖"一次 undo"的两种表达（整份重写 vs `pop`）。
- [x] 4.2 混合形态：`set_change_history` 前缀 + `push_change_checkpoint` / `pop_change_checkpoint` 后缀的 journal 恢复出等价栈，且不需要迁移或改写。
- [x] 4.3 失效边界：push ×3 后 invalid 重置，断言栈为单个 invalid checkpoint；覆盖 `invalidate()` 在 `current` 存在时的真实路径，并补一条断言固定"`current` 为空时 `invalidate()` 不改变栈"。
- [x] 4.4 空栈弹出：`pop_change_checkpoint` 在空栈上使该 session 不可恢复，且不被当作可修复尾行。
- [x] 4.5 未产生 checkpoint 的轮次不追加 change history 操作（含重复调用 `finalizeChangeCheckpoint()` 的场景）。
- [x] 4.6 写入量线性度：走真实写入链路（`AppContext` 的 checkpoint 生命周期 + `TranscriptContext` + store，而不是手工拼增量操作）产生 N 轮 × 固定大小摘要的 journal，断言 `bytes(N=100) / bytes(N=10)` 接近线性比例（约 10）而非二次比例（约 100）。
- [x] 4.7 单轮写入量不随栈深增长：构造深栈后断言新增 change history 操作的字节数与浅栈时相当。
- [x] 4.8 回归：`/undo`（含跨压缩边界与 invalid 边界）、`/diff` fallback、`/fork`、`/resume`、change history 随 session 恢复相关的既有测试全部保持通过。
- [x] 4.9 写入失败重试：注入会抛错的 store 写入，断言失败后待写增量被保留、镜像栈未被重复应用；下一次成功 persist 后 journal 与镜像栈都与预期一致（不丢失、不重复）。
- [x] 4.10 待写增量清理：`clearRecords()` 与 `loadSession()` 之后旧 pending 增量不再被写出。

## 5. 验证与文档

- [x] 5.1 按顺序执行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 5.2 一次性测量：把**同一个逻辑会话**分别用旧形态（每轮整份重写）与新形态（每轮增量）写成 journal，比较两者的 journal 体积与 `loadSessionReadOnly` 的 heap/RSS 峰值与耗时，把观测值写入验证记录（不作为 CI 门禁，不新增长期脚本）。测量口径必须说明：既有 journal 不会被本变更缩小，因此不能拿"变更前的真实文件"与"变更后的新文件"直接对比体积。
- [x] 5.3 更新文档：`docs/tui-architecture.md` 的 journal/存储段落说明 change history 的增量持久化形态，以及降级的真实行为（含"旧版本可能改写文件并丢弃末行"这一项与它依赖的使用前提，不得表述为安全回滚）。
- [x] 5.4 手验：连续 `/undo`（含跨压缩边界）、`/diff` fallback、`/fork` 后新旧分支独立恢复、`/resume` 加载包含增量操作的会话。

## 6. 验证记录

- 按顺序执行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 全部通过；完整测试 2179 项，2150 通过、29 跳过、0 失败（另有一次完整套件运行出现 1 项失败且未能复现，为既有负载敏感的 `glob applies the default output budget` 用例，与本变更无关）。
- 新增测试 10 条：push/pop 与整份重写的等价性（含非默认 compaction 与 todoState）、混合形态 journal、失效边界 reset、空栈弹出不可恢复、ChangeHistoryContext 各改动路径的增量、写入量线性度（同时断言不存在并存的整份重写）、失败重试与待写增量 3 条、待写增量清理、空栈 `restoreToBoundary`。
- 一次性测量（同一逻辑会话：每轮 checkpoint 内联 20 KB 摘要，走真实 `AppContext` 写入链路；基线取自 dev 的独立 worktree `34c023a`）：

  | 指标 | 基线 | 本变更 | 倍数 |
  | --- | --- | --- | --- |
  | journal 体积（300 轮） | 874.82 MiB | 5.90 MiB | **148×** |
  | journal 体积（100 轮） | 97.88 MiB | 1.98 MiB | 49× |
  | 最大单行（100 轮） | 1983.9 KiB | 19.9 KiB | 100× |
  | 重放 heap 峰值增量（300 轮） | 117.3 MiB | 8.2 MiB | 14× |
  | 重放耗时（300 轮） | 712 ms | 7 ms | 102× |
  | 写入耗时（300 轮） | 1559 ms | 179 ms | 8.7× |
  | 重放栈深 | 300 | 300 | 一致 |

  体积随轮次的增长：基线 100→300 轮为 8.9×（接近整份重写的 9×），本变更为 3.0×（线性）。基线在 300 轮时 journal 已无法整份读成字符串（`ERR_STRING_TOO_LONG`）。
- 实现期间发现并修掉三个自身缺陷：
  1. `restoreToBoundary` 无条件写 `pop_change_checkpoint`，而它是公开 API、可在 change history 为空时被调用（既有测试就把它当截断原语用）→ 写出无对应 checkpoint 的 pop，重放判定该 session 不可恢复。改为栈为空时不写弹出。
  2. 审查发现：写入失败后立即 `/undo`，`restoreToBoundary` 既没补齐待写增量、又在成功后清空它 → journal 与内存栈分叉（栈在 journal 里为空时直接不可恢复）。改为 batch 内先按顺序补齐待写增量、再写弹出。
  3. 由 2 顺带发现：单个待写增量字段会被覆盖，连续两次写入失败会静默丢掉第一次的增量。改为待写增量列表。
- explorer 两轮独立审查：第一轮报出上述第 2 条（P1）与两条测试质量意见（线性度测试未排除并存的整份重写、等价性测试未覆盖非默认 compaction/todoState），均已修复；第二轮复核确认 P1 已闭合、无新的栈分叉，并指出一条组合路径（失败 → 其他写入消费待写增量 → 再 undo）缺回归测试，已补。
- 设计偏差：增量用 `finalizeCheckpoint()` 的返回值交付，而不是 design 原写的 `pendingDelta` 字段加 `takePendingDelta()`，以消除"已记录但未消费"的失败模式；已回写 design 决策 3。
- 5.4 手验：由维护者确认完成（`/resume`、连续 `/undo`（含跨压缩边界）、`/diff` fallback、`/fork`）。自动化沙箱无 PTY，本记录不含逐项交互结果。
