## 1. 读取与重放解耦

- [x] 1.1 把 `replayTranscriptJournal` 的循环抽成增量重放核心：喂入一行 → 校验并应用 → 返回继续/失败/待定尾行；保持 seq 连续性校验、`session_start` 校验、中间损坏判定与 `truncate_records`/`set_*` 语义不变。
- [x] 1.2 尾行容错改为"待定失败"：解析或结构校验失败先记为待定；后续仍有非空行则判定中间损坏并停止读取；到达 EOF 仍待定则视为可修复尾行。
- [x] 1.3 核心 `finish()` 只返回 session、journal reference 与 `requiresRepair`，不再产出修复文本；`replayTranscriptJournal(text)` 保留签名与语义，改为基于核心的薄包装。
- [x] 1.4 新增同步分块读取器（`openSync`/`readSync` + `StringDecoder` + 64 KiB chunk），按 `\n` 切分逐行喂入核心，并报告 EOF 是否存在未换行的残行。
- [x] 1.5 `transcript-store` 的 `safelyReadJournal` 改走同步分块读取；`repairTail && requiresRepair` 时按需重建修复文本：复用既有规范化规则（`trim` + 丢弃空行 + `\n` 连接 + 结尾换行），计数按非空逻辑行而非物理行。
- [x] 1.6 新增异步行读取器（`createReadStream` + 行切分）供 `loadSessionPreview` 使用，与同步适配器共享同一核心；保持"异步接口 + 只读最终 replay"语义与失败降级不变，读取期间不占住事件循环。

## 2. 去掉重复深拷贝

- [x] 2.1 replay 核心不再对 `append_records` 的每条记录与状态对象做额外 `structuredClone`：解析产物由本次读取独占，直接进入状态。
- [x] 2.2 `TranscriptContext.loadSession` 安装活跃后缀时不再深拷贝，直接安装本次读取产生的记录切片；保持"主会话常驻只含活跃后缀"与既有返回值语义。
- [x] 2.3 清理 `TranscriptContext.loadReferenceSession` 的冗余 `structuredClone(loaded.session)`：调用方只把 session 投影成有界引用素材、不保留 session；清理后复核引用准备的投影结果不变。
- [x] 2.4 复核保留的拷贝（change history、todoState、compaction）仍满足隔离要求，不因本次改动被削弱。

## 3. 测试

- [x] 3.1 边界行为用**显式预期值**固定：结构无效/未知操作在末行 → 可修复；同类问题在中间行 → 不可恢复；无效尾行后只跟空行 → 仍可修复；seq 断裂与 `truncate_records` 越界即使在末行 → 不可恢复；空文件与无效 `session_start` → 不可恢复。逐项断言结果与 `requiresRepair`。
- [x] 3.2 补充互拍式等价性测试：对覆盖 batch、truncate、尾行损坏、缺少结尾换行、中间损坏的 journal，比较同步适配器、异步适配器与 `replayTranscriptJournal(text)` 三者结果深相等（作为补充证据，不作为唯一证据）。
- [x] 3.3 多字节边界测试：构造含 CJK 与 emoji 且跨越 chunk 边界的 journal（7 个偏移量），断言同步与异步读取结果均与文本重放一致。
- [x] 3.4 规范化与修复测试：夹空行、行首尾空白、CRLF 三种输入下断言恢复结果正确，且修复文本等于规范化后的有效前缀。
- [x] 3.5 结构断言：注入 `fsImpl` 观察读取原语，断言正常恢复只 `openSync` 一次、不以整文件为单位读取、非修复路径不携带修复文本、重放过程 `structuredClone` 调用为 0。
- [x] 3.6 峰值场景断言：覆盖"超长单行"（1.5 MB 单条记录）与"先大后小"（先追加 400 条再 `truncate_records(1)`）两种输入，确认结果正确且全程未整文件读取。
- [x] 3.7 测试替身计数点迁移：`test/app/compacted-transcript-residency.test.js` 的 `io.journalReads` 与 `test/persistence/transcript-store.test.js` 的两处 `countingFs` 从 `readFileSync` 迁移到 `openSync`，并各补一条反向断言证明计数非空。
- [x] 3.8 回归：`/resume`、`/fork`、`/copy`、跨边界 Undo、子 Agent 回看、审批回读相关的既有测试全部保持通过；`test/persistence/transcript-journal.test.js` 中依赖 `repairedJournalText` 字段的断言改为断言 `createRepairedJournalText` 的规范化结果。

## 4. 验证与文档

- [x] 4.1 按顺序执行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 4.2 一次性峰值测量：对一个 ≥150 MiB 的真实或合成 journal，比较变更前后 `loadSessionReadOnly` 与 `loadSessionPreview` 的 heapUsed/RSS 峰值与耗时，把观测值写入验证记录（不作为 CI 门禁，不新增长期脚本）。
- [x] 4.3 更新文档：`docs/tui-architecture.md` 的 journal/存储段落说明按行读取与惰性修复文本。
- [x] 4.4 手验：`/resume` 列表打开与连续移动、大 journal 预览、`/fork`、`/copy` 旧消息、跨压缩边界连续 `/undo`、Ctrl+O 子 Agent 回看，确认无卡顿与行为回归。

## 5. 验证记录

- 类型检查、完整测试与 JS 语法检查按顺序通过；完整测试共 2163 项，2134 通过、29 跳过、0 失败（本变更新增 6 项：边界表、三入口等价、多字节跨块、规范化修复文本、结构断言、超长单行/先大后小）。
- 峰值测量（同一份 158.5 MiB 真实 journal，`--expose-gc`，一次性执行）。应用侧对比必须让测量进程自身不持有文件副本，否则两侧都会被抬高约 316 MiB；下面是修正后的口径（脚本只读首行拿身份，基线代码取自 HEAD 的独立 worktree）：

  | 指标 | 旧实现（HEAD） | 本变更 |
  | --- | --- | --- |
  | `loadSessionReadOnly` 用时 | 714 ms | 466 ms |
  | 解析期间 heap 峰值 | 386.3 MiB | 122.3 MiB |
  | 进程 RSS 高水位（replay） | 833.5 MiB | 230.5 MiB |
  | 进程 RSS 高水位（含一次 preview） | 1029.0 MiB | 268.1 MiB |
  | preview 用时 | 678 ms | 492 ms |
  | replay 内 `structuredClone` | 1825 次 | 0 次 |
  | replay 结果保留量 | 9.5 MiB | 9.4 MiB（不变） |

  早先记录的 704 → 439 MiB / 1283 → 699 MiB 来自持有文件副本的测量脚本，两侧同样被抬高，仅相对改善仍成立；以本表为准。
- 恢复仍需全量解析整份 journal（"只读尾部"是 Non-Goal），因此峰值仍与文件大小线性相关；剩余峰值主要来自必须解析的 154.5 MiB change history 快照行（该会话 97.5% 的行是已被覆盖的死数据）。要再降一个量级需要变更 B（change history 持久化形态）或 C（journal 压缩 / squash），或为 append 携带起始下标以支持只读尾部。
- 实现期间发现并修掉两个自身缺陷：修复文本按物理行截取会把无效尾行写回（改按非空逻辑行计数，由既有 torn-write 测试捕获）；残行用字符串累积会让超长行退化为反复拼接（改为片段数组、成行时一次拼接，replay 与 preview 用时因此反超原实现）。
- 4.4 尚未完成：当前沙箱无 PTY（`os.openpty()` 与 `/dev/ptmx` 均返回 EPERM），`/resume` 列表移动、大 journal 预览、`/fork`、`/copy`、连续 `/undo`、Ctrl+O 回看等交互路径需要在允许 PTY 的环境手验。自动化测试与一次性测量不替代该手验。
- 二轮 review 收敛（三条均已复现并修复）：
  - 异步适配器改用 `for await...of` + 统一 `try/catch`。原实现把重放放在 `data` 事件回调里，回调中抛出的同步异常不会进入外层 Promise 的 `catch`：20 万条记录的单次 `append_records` 在 `push(...records)` 触发 `RangeError` 后直接终结进程（旧实现把重放包在 `try` 里，因此不会）。
  - 单次 `append_records` 改为逐条 `push`。实测展开参数的阈值在 12 万～13 万条之间，而 `/fork` 的初始快照可能一次写入整段历史。
  - 行切分器的 `push` 返回"继续/停止"，同步读取循环与异步迭代在收到停止信号后立即结束读取（此前只停止解析、仍读到 EOF）：首行无效的 2 MiB 输入从读满 2.00 MiB 降到 0.0625 MiB，修复路径同样收齐前缀即停。
  - 新增 3 条回归测试：单次大操作不失败、结果确定后停止读取（按实际读取字节断言）、多字节跨块自校验。
  - 多字节跨块测试此前没有真正切分字符（padding 未计入序列化前缀，偏移落在 chunk 内 179–185 附近，逐块 `toString()` 也能通过）；已改为按完整序列化前缀反推 padding，并断言多字节字符的字节偏移恰好等于 chunk 边界 ±3。
- 观测（与本变更无关）：`test/tools/tool-execution.test.js` 的 `glob applies the default output budget without retaining a partial path` 在完整套件下偶发失败（本分支 1/6～2/10，基线 HEAD 1/8，单文件单独运行 5/5 通过），是既有的负载敏感测试，待单独跟进。
