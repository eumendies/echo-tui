## Why

change history 目前以"每次重写整份数组"的形态持久化：一轮 assistant loop 结束时，journal 会追加一个包含**整个 checkpoint 栈**的 `set_change_history` 操作。这让 change history 的 journal 体积随轮次二次增长，而其中绝大部分字节是被后续写入覆盖的死数据。

本机实测（146 个真实会话，共 870.8 MiB journal）：

| op | 体积 | 占比 |
| --- | --- | --- |
| `append_records` | 701.4 MiB | 80.6% |
| `set_change_history` | **167.8 MiB** | **19.3%** |
| 其余 | 1.5 MiB | 0.1% |

其中 **154.5 MiB 来自同一个会话**。该会话 291 次写入累计序列化了 41910 个 checkpoint，而恢复后栈里只需要 287 个 —— **146× 冗余**，因为第 N 次写入必须重复携带前 N-1 个 checkpoint。若改为只写本轮新增的 checkpoint，同一份事实只需 2.16 MiB（**71×**）。

这不是个例，而是"轮次还没堆够"：27% 的会话死数据占比已超过 90%，17% 超过 50×，只是绝对量停留在 KB 级。触发条件是"长会话 + 发生过压缩 + 大量带文件变更的轮次"三者叠加。

代价不只在磁盘：

- 恢复一个 158.5 MiB 的 journal 时，应用侧 heap 峰值 122 MiB、RSS 高水位 230 MiB，其中最大的单行就是 2.16 MiB 的 `set_change_history`。合成实验显示解析峰值几乎由**最大单行**决定：同样 ~145 MiB 的文件，切成 72 行 × 2.1 MiB 时 heap 峰值 +109 MiB，切成 20000 行 × 7.6 KiB 时只有 +8 MiB。
- 每轮写入还要对整份栈做两次深拷贝并序列化一次，CPU 开销同样是 O(栈规模)。

本变更只改变**后续写入**的形态：已经写在磁盘上的整份数组不会被缩小，恢复这些文件时仍要解析它们的大行。

## What Changes

- change history 改为**增量持久化**：新增 `push_change_checkpoint`（追加本轮 checkpoint）与 `pop_change_checkpoint`（弹出栈顶）两个 journal 操作。
- `set_change_history` 保留但**降级为整份替换**，只用于两种自包含语义必需的场合：失效边界重置（栈被重置为单个 invalid checkpoint）和 `/fork` 的初始快照。
- 写入侧不再"每次取整份栈"：`ChangeHistoryContext` 内部记录本轮产生的增量，`TranscriptContext` 只把增量写进 journal；状态未变化的轮次 SHALL NOT 追加 change history 操作（今天会重复写一份完整数组）。
- `/undo` 在同一 batch 内用 `pop_change_checkpoint` 替代整份 change history，`truncate_records`、compaction 回退与栈弹出仍保持单行原子。
- 恢复侧同时支持两种形态：旧 journal（整份替换）、新 journal（增量）与混合 journal 都能恢复出等价的栈；`pop_change_checkpoint` 遇到空栈按语义失败处理，使该 session 不可恢复，而不是静默错位。
- 兼容性：`schemaVersion` 保持 1，新版本可读全部历史 journal。降级到旧版本的行为已实测：末尾 ≥2 行无法识别的条目、或它们之后还有正常行时，旧版本判定会话不可恢复且**不改写文件**；但**末尾恰好 1 行**时，旧版本会把它当作可修复尾部并**重写 journal、物理删除该行**。此外 index 指纹有效时旧版本 `/resume` 会列出该会话、选中后才加载失败。因此本变更**不提供安全回滚保证**，其代价由"旧版本不会读取新格式会话"这一前提兜住（已确认）；该前提若变化需重新评估提升 `schemaVersion` 的方案，见 design 决策 6。
- 语义不变：change checkpoint 的结构、`/undo` 与 `/diff` 的用户可见行为、`/fork` 的自包含快照、invalid 边界语义、replay 容错与尾行修复规则全部保持。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `transcript-journal-persistence`：操作集合增加 change history 的两个增量操作，并新增"增量写入与写入量上界"要求（单轮写入字节由本次新增 checkpoint 决定，不随栈规模增长）；「复合会话变化的单行原子操作」的 undo 场景改为记录 `pop_change_checkpoint`；「journal replay 与恢复容错」补充两个增量操作的重放语义与空栈弹出判定。

## Impact

- `src/persistence/transcript-journal.ts`：新增两个操作类型、结构校验、序列化与 replay 分支；`set_change_history` 语义不变。
- `src/app/state/change-history-context.ts`：新增本轮增量（push / pop / reset）的记录与消费入口，覆盖 `finalizeCheckpoint`、`invalidate`、`markLastUsed` 三条改动路径。
- `src/app/state/transcript-context.ts`：`setChangeHistory` 改为"只接收增量"；`createPendingOperation` 按增量类型生成对应操作；`restoreToBoundary` 的 change history 参数从"整份数组"改为"弹出意图"；`forkSession` 保持整份替换。
- `src/app/state/app-context.ts`：`syncChangeHistory` 传递增量；`executeUndo` 适配新的回退意图。
- 不改 journal 文件位置、`schemaVersion`、checkpoint 结构与 `/undo`、`/diff` 的用户可见语义；不新增配置项、不新增依赖。
- 测试：新增增量与整份重写的等价性、混合 journal、失效边界、空栈弹出、未变化轮次不写入、写入量线性度等断言；既有 `/undo`、`/diff`、`/fork`、`/resume` 测试保持通过。
- 明确不做（留给后续变更）：不做 `compactionBefore` 摘要的内容去重（实测 166 个 checkpoint 只有 3 份不同摘要，可在本变更之上再降约 36×）、不做栈深上限、不做 journal 压缩或 squash、不改 `append_records` 的形态。
