## Why

`/resume`、`/resume` 预览、`/fork`、跨边界 `/undo`、`/copy`、审批与子 Agent 回看都依赖"按需全量读取 journal"。当前 replay 把整份文件读成一个字符串、再 split 成行数组，并且**无条件**构造一份整文件量级的 `repairedJournalText` 副本（只在 tail 需要修复时才用），同时对每条记录做一次多余的深拷贝。

实测一个 158.5 MiB 的真实会话：replay 保留的结果只有 9.7 MiB，但进程 RSS 峰值 1056 MiB（去掉测量脚本自身持有的一份副本后，应用约 740 MiB），其中约 632 MiB 是两份整文件量级的中间字符串；`/resume` 列表每选中一个候选都要重来一次。

## What Changes

- journal replay 改为**按行读取**：不再构造整文件字符串与行数组，读取过程只保留当前行、结果状态与必要的序号信息。
- `repairedJournalText` 改为**惰性**：只在 tail 确实需要修复时构造，且该路径按需重读文件；正常读取路径不再产生这份副本。
- 去掉 replay 与恢复安装中的**多余深拷贝**：解析产物已是私有对象，不再对每条 record 与 change history 重复克隆，`loadSession` 安装活跃后缀时也不再克隆。
- 语义保持不变：replay 结果、`seq` 连续性校验、中间损坏判定、尾行容错与修复行为、失败返回 `null` 的语义、journal 文件格式与 schema 全部不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `transcript-journal-persistence`：「journal replay 与恢复容错」增加按行读取与内存特征要求：读取过程 SHALL NOT 构造整文件量级的中间副本，修复文本 SHALL 仅在需要修复时构造。
- `resume-session-browser-performance`：「选中会话预览按需加载」增加预览读取的内存特征要求：预览加载 SHALL NOT 因文件大小构造整文件量级副本。
- `compacted-transcript-residency`：「完整历史操作不退化为活跃区操作」与「恢复与回退后安装活跃记录」增加回读的内存特征要求：完整历史回读 SHALL NOT 复制整份解析结果，安装活跃后缀 SHALL NOT 重复深拷贝。

## Impact

- `src/persistence/transcript-journal.ts`：replay 核心拆分为"增量重放核心 + 行读取适配"，`repairedJournalText` 惰性化。
- `src/persistence/transcript-store.ts`：`safelyReadJournal` 走按行读取；`loadSession`、`loadSessionReadOnly`、`loadSessionPreview`、`listSessionSummaries` 的索引重建共享同一读取路径。
- `src/app/state/transcript-context.ts`：`loadSession` 安装活跃后缀时不再深拷贝。
- 不新增配置项、不新增依赖、不改 journal schema 与文件位置。
- 测试替身需要把"是否读取了 journal"的计数点从 `readFileSync` 迁移到新的读取原语，否则既有的"日常操作不 replay journal"断言会退化为空断言。
- 明确不做：不引入起始下标/字节偏移索引、不做 journal 压缩、不改 change history 持久化形态、不做"只读尾部"式按需回读。未压缩的长会话仍需在内存中装载全部 records，本变更只消除与结果无关的重复副本。
