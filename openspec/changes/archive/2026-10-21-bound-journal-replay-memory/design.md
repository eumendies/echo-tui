## Context

journal 是单文件 JSONL，恢复时按行 replay 有效操作。当前实现（`src/persistence/transcript-journal.ts`、`transcript-store.ts`）有三个与结果无关的内存放大点：

1. `safelyReadJournal` 用 `readFileSync` 读成整文件字符串，`replayTranscriptJournal` 再 `split('\n')` 建行数组；
2. `replayTranscriptJournal` **无条件**构造 `repairedJournalText: lines.slice(0, sequence + 1).join('\n')`，但只有 `repairTail && requiresRepair` 时才使用；
3. replay 对每条 record 做 `structuredClone`，`TranscriptContext.loadSession` 又对活跃后缀做一次 `structuredClone`。

本机实测（158.5 MiB / 1527 行真实 journal，其中 97.6% 是 change history 死数据，records 只有 3.6 MiB）：

| 阶段 | heapUsed | RSS |
| --- | --- | --- |
| 进程 baseline | ~4 MiB | 40 MiB |
| `readFileSync` 返回 | 636 MiB | 815 MiB |
| replay 期间峰值 | 704 MiB | 966 MiB |
| replay 结果**保留** | — | — |
| 进程 RSS 高水位 | — | **1056 MiB**（再浏览一次预览到 1283 MiB） |

replay 只保留 9.7 MiB（records 5.4 + changeHistory 4.3），却要 ~1 GB 峰值；去掉测量脚本自身多持有的一份字符串后，应用峰值仍约 740 MiB。其中约 632 MiB 是两份整文件量级的字符串（原文 + 修复副本）。

约束：

- `loadSession`、`loadSessionReadOnly`、`listSessionSummaries` 的索引重建都是**同步 API**，被 `TranscriptContext.getCompleteRecords()`、`executeUndo`、命令 handler、子 Agent 视图等同步调用点依赖，不能为了流式而改成异步。
- journal 格式、schema 与文件位置不变；本变更不改 change history 的持久化形态（那是另一个变更）。

## Goals / Non-Goals

**Goals:**

- journal 读取与 replay 不再额外保留完整文件副本：正常路径的内存由**读取缓冲 + 最大单行解析开销 + 重放期间的有效状态**构成（重放期间的有效状态可以大于最终结果，例如先追加大量 records 再 truncate）。
- 消除两处与结果无关的深拷贝。
- 行为逐字节等价：replay 结果、`seq` 校验、中间损坏判定、尾行容错与修复、失败返回 `null` 的语义全部不变。
- 让"是否读取了 journal"在测试替身中仍然可观测（否则既有断言会变成空断言）。

**Non-Goals:**

- 不引入起始下标/字节偏移索引，不做"只读尾部"式按需回读（未压缩会话仍要装载全部 records）。
- 不做 journal 压缩、分块、squash 或 change history 持久化改造。
- 不改变 `/resume` 预览的记录条数与截断策略。
- 不承诺整个进程内存有界，不承诺 replay 峰值与 records 体积无关，也不承诺峰值与"最大单行"无关：一条 `set_change_history` 或 fork 初始快照行可以远大于 chunk 大小，解析它必然产生与行大小相当的开销。

## Decisions

### 1. 拆成"增量重放核心 + 行读取适配"

把现有 `replayTranscriptJournal(text)` 里的循环抽成增量核心：喂入一行 → 校验并应用 → 返回"继续/失败/待定尾行"；`finish()` 产出与今天同形的 `{session, reference, repairedJournalText, requiresRepair}`。

在此之上保留两个入口：

- `replayTranscriptJournal(text)`：`split('\n')` 后逐行喂入。签名与语义不变，测试与预览路径继续可用。
- `replayTranscriptJournalFile(filePath, fsImpl)`：同步分块读取后逐行喂入，供 store 的同步路径使用。

备选：直接给 `replayTranscriptJournal` 换签名接收文件路径。否决原因是测试与预览路径已经有文本形态的调用者，换签名会把"读取方式"和"重放语义"耦合在同一个入口里。

### 2. 一个增量核心 + 两个 I/O 适配器

核心只负责"喂一行 → 校验并应用 → 继续/失败/待定尾行"，不理解文件与 I/O。在此之上保留两个适配器：

- **同步分块读取器**（`openSync` + `readSync` 循环读固定大小 chunk + `node:string_decoder` 的 `StringDecoder` 处理跨 chunk 多字节字符）：供 `loadSession`、`loadSessionReadOnly` 与索引重建使用。这些入口是同步 API，被 `getCompleteRecords()`、`executeUndo`、命令 handler、子 Agent 视图依赖，整条链异步化的代价远大于收益。
- **异步行读取器**（`createReadStream` + 同一个行切分器）：供 `loadSessionPreview` 使用。预览是异步接口，且用户可在加载期间继续导航、Esc、看 spinner、接收后台响应；把它的读取改成同步会在整个大文件读取期间占住事件循环，这是明确的体验回退。行切分逻辑（跨 chunk 残行、多字节边界、结尾换行判定）在两个适配器间共用，避免两套切分实现产生语义漂移。

异步适配器用 `for await...of` 而不是 `data`/`end` 事件回调，并把整段循环与收尾放进同一个 `try/catch`：事件回调里抛出的同步异常不会进入外层 Promise 的 `catch`，会直接成为未捕获异常并终结进程（旧实现把重放包在 `try` 里，因此不会）。同样地，重放核心按记录逐条 `push` 而不是展开参数，避免单次操作承载整段历史（例如 `/fork` 的初始快照）时触发引擎的实参数量上限。

`replayTranscriptJournal(text)` 保留为第三个入口（文本 + `split` 喂核心），主要服务测试与已有调用点。

备选：统一用同步读取器覆盖预览。否决原因是"返回 Promise 不等于非阻塞"——同步循环读大文件期间导航与取消都会停住，而"读取命中 page cache 很快"不是稳定前提（冷缓存、网络盘、大文件都不同）。

### 3. 核心不再产出修复文本，由掌握 `repairTail` 的 store 按需生成

增量核心的 `finish()` 只返回 session、journal reference 与 `requiresRepair`。修复文本由 store 在 `repairTail && requiresRepair` 时按需重建——它本来就掌握文件路径与该次读取的 `sequence`。

重建必须复用现有规范化规则：逐行读取 → `trim()` → 丢弃空行 → 只取"`session_start` + 前 `sequence` 条非空逻辑行" → 以 `\n` 连接并补结尾换行。**计数单位是非空逻辑行，不是物理行**：journal 中可能夹有空行、行首尾空白或 CRLF，按物理行截取会写出与既有行为不同的字节。

收齐有效前缀后立即停止读取，不再等待下一条非空行。

备选一：核心继续返回该字段并惰性化（getter 或回调）。否决原因是它把"是否需要修复"的知识（`repairTail`）留在了没有该知识的层，只为维持旧返回形状。
备选二：边读边累积每行原文。否决原因是那正是要消除的整文件量级副本。修复本身已经要重写整份文件，多一次读取是可接受的取舍，且该路径罕见。

### 4. 尾行容错用"待定失败"表达

今天靠 `index === lines.length - 1` 判断"是否是最后一行"。流式下改成：某行解析或结构校验失败时先记为待定失败；若之后还有非空行到来，判定为中间损坏并返回 `null`；若到 EOF 仍待定，则视为可修复尾行。

行切分器的 `push` 返回"是否继续"，同步读取循环与异步迭代都在收到停止信号后立刻结束读取（含 descriptor 关闭与流销毁），因此"已判定不可恢复"与"已收齐所需前缀"两种情况都不会再扫完整个文件。

`requiresRepair` 的另一个来源"文件缺少结尾换行"由读取器直接给出（EOF 时是否仍有未换行的残行）。

### 5. 去掉两处多余深拷贝

`JSON.parse` 的产物是本次读取私有的新对象，replay 直接 push 到状态里即可，不再 `structuredClone`；`TranscriptContext.loadSession` 安装 `records.slice(base)` 时也不再克隆——replay 结果数组与其中的元素在 `loadSession` 返回后没有其他持有者。

同类冗余还有 `TranscriptContext.loadReferenceSession` 的 `structuredClone(loaded.session)`：调用方 `createPendingConversationReference` 只把 session 投影成有界的引用素材，不保留 session 本身，因此该拷贝同样是纯浪费（对 158 MiB 级 journal 等于多留一整份解析结果）。本变更一并清理，使实现不与规格中"不重复深拷贝回读结果"的要求冲突。

保留的拷贝（`cloneChangeHistory`、todoState、compaction）语义上仍需隔离，不在本次范围。

### 6. 读取原语的测试可观测性

测试替身目前用 `readFileSync` 计数 `.jsonl` 读取（`test/app/compacted-transcript-residency.test.js` 的 `io.journalReads`、`test/persistence/transcript-store.test.js` 的 `countingFs`）。读取原语改变后这些计数会永远为 0，使"日常操作不 replay journal"退化为空断言。

处理方式：把计数点迁移到新的读取入口（计数 `openSync` 或计数核心的调用次数），并补一条**反向断言**——注入一个会在 journal 读取时抛错的实现，证明断言确实会失败，而不是恒真。

### 7. 等价性用显式预期值固定，不靠两个入口互拍

文本入口与文件入口共享同一核心，核心改错时两者仍会深相等。因此边界行为必须用显式预期值断言，逐项固定当前语义（已用运行时探针核对）：

| 输入 | 当前行为 |
| --- | --- |
| 结构无效或未知操作在**最后一行** | 按可修复尾行忽略，`requiresRepair = true` |
| 结构无效或未知操作在**中间行** | 不可恢复 |
| 无效尾行之后只有空行 | 仍按可修复尾行处理（空行不参与判断） |
| 结构有效但语义失败（`seq` 断裂、`truncate_records` 越界）**即使在最后一行** | 不可恢复 |
| 夹空行、行首尾空白、CRLF | 可恢复；修复文本按规范化规则重写 |
| 缺少结尾换行但末行有效 | 可恢复且 `requiresRepair = true` |

互拍式比较只作为补充，不作为唯一证据。

## Risks / Trade-offs

- [行为不等价] → 对同一份 journal（覆盖 batch、truncate、尾行损坏、缺少结尾换行、中间损坏）比较三个入口的结果深相等，并断言失败场景同样返回 `null`。
- [边界语义漂移] → 决策 7 的边界表逐项用显式预期值固定；两个入口互拍只作为补充证据，不作为唯一证据。
- [UTF-8 跨块边界损坏] → 使用 `StringDecoder`，并加一条用多字节字符（含 CJK 与 emoji）跨 64 KiB 边界构造的测试。
- [修复路径重读文件] → 仅在 `repairTail && requiresRepair` 时发生；既有"最后一行写入中断""缺少结尾换行"两个场景的测试继续覆盖写回结果，并补夹空行、行首尾空白与 CRLF 的规范化断言。
- [峰值仍与最大单行和中间状态相关] → 一条超大 `set_change_history`/fork 快照行的解析开销与"先追加大量 records 再 truncate"的中间状态都不可消除；规格按"不额外保留完整文件副本"表述，而不是绝对阈值或"与文件大小无关"。
- [内存断言脆弱] → 不引入 heap/RSS 阈值断言；自动化测试只断言结构事实（不整文件读取、不构造修复文本、不重复深拷贝、等价性），峰值用一次性测量记录在任务的验证记录里。

## Migration Plan

无数据迁移：journal 格式、schema 与文件位置不变，新旧代码读写同一批文件。代码一次性交付；回滚只需回退本次提交（已写入的 journal 无需处理）。

## Open Questions

无阻塞问题。预览路径是否需要在后续变更中恢复为非阻塞异步读取，留待手验结论决定。
