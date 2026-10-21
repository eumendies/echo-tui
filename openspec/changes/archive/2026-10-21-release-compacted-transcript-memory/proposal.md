## Why

当前 compaction 只缩短 provider 请求，应用和 Agent runtime 仍长期持有已压缩 transcript；每轮还会复制这些旧记录，使长 session 的内存占用持续增长。需要直接释放已被摘要替代的记录，而不是引入新的存储格式、分页系统或通用内存预算。

## What Changes

- 自动压缩和手动 `/compact` 成功后，内存只保留当前 compaction 状态及边界之后的 transcript；完整历史仍保存在现有 JSONL journal。
- 引入内存记录起点偏移，区分完整历史的逻辑位置与内存数组下标，保持 compaction、Undo、审批和日志计数语义。
- 同时裁剪应用、Agent runtime 及本轮输入快照中的旧记录引用；后续轮次仅复制活跃记录。
- 恢复 session 后立即按压缩边界裁剪；允许恢复及显式历史操作暂时全量加载，不承诺这些操作的峰值有界。
- `/fork`、`/copy`、历史子 Agent 回看及跨边界 Undo 等仍能访问完整有效历史，临时加载结果不得留在后台缓存或重新装入主会话常驻数组。
- 压缩后的全量重绘只展示压缩提示与活跃记录，不从 journal 重放已压缩原文；已写入终端 scrollback 的内容不在压缩时主动清除。
- 不调整压缩阈值，不限制单次请求或输出，不改变 Undo 文件快照、输入历史及 shell-local 的现有策略。

## Capabilities

### New Capabilities

- `compacted-transcript-residency`：定义活跃 transcript 的驻留范围、逻辑位置、恢复与历史访问，以及释放旧记录的验收边界。

### Modified Capabilities

- `context-compression`：区分完整持久化历史与裁剪后的内存记录，明确偏移后的压缩状态及请求投影语义。
- `terminal-tui-prototype`：明确压缩会话的重绘范围和已压缩历史提示，不因 resize、主题或视图切换重新驻留旧历史。

## Impact

- 影响 `src/app/state/transcript-context.ts`、`app-context.ts`、Agent session 类型、compaction 核心及主/子 Agent runtime。
- 需要审计 `records.length`、`activeStartIndex` 和 `transcriptStartIndex` 的消费路径，包括审批、session 摘要更新、BTW、恢复、分支、复制和子 Agent 回看。
- 渲染层需要接收当前 compaction/驻留起点，并限定破坏性重绘的记录范围。
- JSONL schemaVersion、journal 操作、完整历史原文和文件位置保持不变；不增加第三方依赖或新配置项。
- 本变更仅消除已压缩 transcript 的长期驻留，不承诺整个进程严格有界，也不消除全量恢复、显式历史读取等操作的临时峰值。
