## Context

当前 session 以单个完整 JSON 快照保存。每次 transcript append、todo 更新、compaction 或 change history 更新都会在 app 层和 store 层重复克隆完整 records 与状态，随后序列化并通过临时文件替换原文件。records 是追加型事实，三个运行时状态的更新频率和体积不同，完整覆盖写会让长会话累计 I/O 接近 O(n²)。

本变更采用每个 session 一个 JSONL 文件。该文件既是 records 的事实日志，也是 todo、compaction 和 change history 的状态变更日志；加载时顺序 replay 为现有 `TranscriptSession` 内存模型。项目仍保留既有 `project.json` 作为 cwd 元数据，session 内容不再有额外 manifest、snapshot 或索引文件。

## Goals / Non-Goals

**Goals:**

- 将正常 transcript 追加的持久化成本降为与新增 records 大小成正比。
- 让 todo、compaction、change history 分别独立写入，不因其中一项变化而复制另外两项。
- 保持当前 `/resume`、provider 上下文、compaction、`/undo`、`/diff` 和 TUI 渲染的恢复结果不变。
- 用单行 batch 表达需要原子提交的多项状态变化，并容忍进程中断留下的最后半行日志。
- 删除完整 JSON session 覆盖写与旧格式读取代码；所有新 journal 和内存 session 的 schemaVersion 均保持 `1`。

**Non-Goals:**

- 不兼容、不迁移或读取既有 `.json` session。
- 不引入 session snapshot、sidecar 索引、多个 session 数据文件或后台压缩 journal。
- 不实现 redo、时间线选择、分支恢复或改变现有按 checkpoint 连续 `/undo` 的语义。
- 不改变 provider transcript 投影、record 内容、工具协议或 change history 的文件恢复机制。
- 不提供断电级 fsync 保证；保持当前同步文件写入的进程级持久化预期。

## Decisions

### 每个 session 使用单一 JSONL journal

路径改为 `~/.echo/echo_tui/projects/{cwd-hash}/sessions/{session-id}.jsonl`。第一行是 `op: "session_start"`，携带 schemaVersion、sessionId、cwd 和 createdAt；后续每行都是带递增 `seq` 与 updatedAt 的操作。

选择单文件而非 manifest/snapshot/日志三文件：本变更的直接目标是移除热路径全量重写，并让状态历史自然保留。代价是加载与 `/resume` 必须扫描 journal；在当前尚无用户数据且会话数量有限的前提下，这比引入多文件原子切换和索引一致性问题更简单。

### 使用明确的操作联合，而非统一 commit 包装

正常行使用以下 `op` 判别值：

- `append_records`：追加一条或一组 transcript records；
- `truncate_records`：将当前 records 截断到指定数量；
- `set_change_history`：替换当前 change history；
- `set_compaction`：设置或清除当前 compaction；
- `set_todo_state`：替换当前 todoState；
- `batch`：在同一物理行按顺序应用多个上述子操作。

三个状态是独立操作，不使用“完整 runtime state”对象。todo 更新不会重复写入 change history，compaction 更新不会重复写入 todo。`batch` 仅用于 compaction 状态与 notice、以及 `/undo` 的截断与状态回退等必须共同可见的逻辑事务；它不是每条日志的固定外层包装。

### 用 reducer 重放 journal，并保留截断语义

replay 从 header 建立空 records、空 todo、空 change history 和 null compaction，按 seq 顺序应用操作。`append_records` 向数组追加，`truncate_records` 立即截断当前数组，三个 `set_*` 操作覆盖各自当前值。

因此 `A → B → C → truncate(1) → D` 恢复为 `A → D`。不能只读取最后的状态操作或所有 append records，因为 `/undo` 会改变 records 的逻辑可见集合。

### 将复合持久化点映射为单行 batch

`setCompaction()` 仅在内存中标记待写入 compaction；紧随其后的 compaction notice append 会形成包含 `set_compaction` 和 `append_records` 的 batch。成功 `/undo` 会形成包含 `truncate_records`、目标 compaction 和 pop 后 change history 的 batch。普通 todo 更新和 checkpoint finalization 可以各自写单一状态操作。

这维持现有 compaction/notice 和 undo 状态的一致恢复，而不需要跨多行或跨文件协调。

### 创建使用原子落位，后续使用单行追加

首次 session 创建时先将 header 与首个操作写入临时 `.jsonl` 文件，再 rename 到正式路径，避免出现仅有 header 的空 session。后续操作用同步 append 写入单个 JSON 编码行；JSON 字符串会转义 record 内换行，因此每个操作保持一个物理行。

加载时允许忽略最后一条不完整或不合法的非空行，视为中断写入；真正恢复 session 时通过临时文件原子移除无效尾部或补齐缺失换行，再允许后续 seq 续写。任何 header 错误、中间损坏行或 seq 不连续都会使 session 无效，避免恢复为不可信状态。

### TranscriptContext 只维护当前引用和待写入状态

`TranscriptContext` 不再保留与 `records` 重复的完整 `currentSession.records` 副本，只保留当前 session 标识与 journal seq。它为三个状态分别维护 pending 标记；append 时一次提交 records 与当前 pending 状态，成功后清除对应标记。提供 records 批量追加接口，使相邻 tool call/result 和 provider-private records 不必产生多次 journal 写入。

`getAgentSession()` 继续为 agent 请求创建内存快照；该复制是 provider 隔离边界，不属于本次持久化热路径改造。

## Risks / Trade-offs

- [加载与 `/resume` 需要扫描完整 journal] → 使用共享 reducer 保证结果一致；`listSessions` 逐文件派生 metadata，不增加 sidecar 索引。
- [undo 后被截断 records 与旧状态仍占用磁盘] → 这是保留历史的明确代价；本变更不做日志压缩，后续可单独提案处理。
- [单行追加可能留下截断尾行] → 仅忽略最后无效行，并在恢复 session 时原子修复到有效前缀；以 seq 和中间行严格校验拒绝更深层损坏。
- [change history 本身可能很大] → 仅在 checkpoint 完成或 undo 改变 history 时写入，不再随每条 transcript/todo/compaction 记录重复写入；细粒度 checkpoint delta 留作后续优化。
- [旧 `.json` session 不可恢复] → 项目尚无用户使用，明确作为 breaking change；新 store 只枚举 `.jsonl`。
- [同步 append 仍可能阻塞短暂事件循环] → 写入量从完整 session 缩小为单个操作，保持项目当前同步 I/O 风格，避免在本变更中引入异步队列和退出 flush 生命周期。

## Migration Plan

1. 发布新实现时保留 `STORE_SCHEMA_VERSION = 1`，但 session 文件扩展名和内容改为 `.jsonl`。
2. `listSessions` 与 `loadSession` 只识别新的 `.jsonl` journal；既有 `.json` 文件不会被读取、修改或迁移。
3. 开发环境如需清理旧会话，可删除旧 `sessions/*.json` 或整个 `~/.echo/echo_tui/` 目录。
4. 若新 journal 的 header、顺序或中间内容无效，拒绝加载该 session；最后一行截断则按有效前缀恢复。

不提供旧格式回滚路径；代码库不保留旧完整快照写入实现。

## Open Questions

无阻塞问题。日志大小增长、session 列表扫描和 change history 的细粒度 delta 均明确留给后续独立变更。
