## Context

change history 今天以"每次重写整份数组"的形态落盘。写入链路（`src/app/state/app-context.ts`、`transcript-context.ts`、`change-history-context.ts`）是：

```
assistant-turn-runner.ts:59   beginChangeCheckpoint()     每轮开始，建 recording checkpoint
assistant-turn-runner.ts:374  finalizeChangeCheckpoint()  每轮 finally
app-context.ts:720            finalizeChangeCheckpoint()  中断路径

AppContext.finalizeChangeCheckpoint()
  └─ ChangeHistoryContext.finalizeCheckpoint()      // history.push(cp) 或 history = [invalid]
  └─ syncChangeHistory(true)
       └─ TranscriptContext.setChangeHistory(getHistory())   // 深拷贝整份 ×2
       └─ TranscriptContext.persistCurrentSession()
            └─ createPendingOperation() → createSetChangeHistoryOperation(整份数组)
```

`ChangeHistoryContext` 的栈只有 3 个真实改动点（实测确认，见决策 3）：`finalizeCheckpoint()`（recording → push）、`finalizeCheckpoint()`（invalid → 重置为单元素栈）、`markLastUsed()`（undo 后弹出）。`invalidate()` 在 `current` 存在时清空栈、由随后的 finalize 产生重置；在 `current` 为空时是**完全空操作**。

`setChangeHistory` 全仓库只有一个调用点（`app-context.ts:621`），`restoreToBoundary` 也只有一个调用点（`AppContext.executeUndo`），改造面很小。

本机实测（146 个真实会话，870.8 MiB journal）：

| 指标 | 观测值 |
| --- | --- |
| `set_change_history` 总体积 | 167.8 MiB（19.3%），其中 154.5 MiB 来自单个会话 |
| 该会话写入次数 / 恢复后栈深 | 291 / 287 |
| 该会话累计序列化的 checkpoint 个数 | 41910（**146× 冗余**） |
| 该会话最后一次写入体积 | 2.16 MiB（也是整份 journal 的最大单行） |
| 语料若改为只写增量 | 167.8 MiB → 2.60 MiB（**64×**）；该会话 154.5 → 2.16 MiB（**71×**） |
| 死数据占比 > 90% 的会话比例 | 27%（> 50× 的占 17%） |

峰值侧：解析一个 158.5 MiB journal 时 heap 峰值 122.3 MiB、RSS 高水位 230.5 MiB，最大贡献就是 2.16 MiB 的 `set_change_history` 行。合成实验显示峰值几乎由**最大单行**决定 —— 同为 ~145 MiB 的文件，切成 72 行 × 2.1 MiB 时 heap 峰值 +109 MiB，切成 20000 行 × 7.6 KiB 时只有 +8 MiB。因此把 change history 的最大行从 2.16 MiB 降到约 20 KB 是本变更的主要收益来源。

约束：

- journal 文件位置、`schemaVersion` 与操作集合的既有语义不变；新版本必须能读全部历史 journal。
- `/undo`、`/diff`、`/fork`、`/resume` 的用户可见语义不变。
- `append_records` 仍是语料最大项（80.6%），本变更不碰它。

## Goals / Non-Goals

**Goals:**

- change history 以增量操作持久化：单次写入字节由本次新增或移除的 checkpoint 决定，不随栈中已有 checkpoint 数量增长。
- 消除**新写入**的 change history 大行，使后续恢复峰值不再由 change history 行主导。
- 未产生新 checkpoint 的轮次不再写 change history 操作。
- 恢复语义逐字段等价：新旧形态、混合形态的 journal 恢复出相同的栈。

**Non-Goals:**

- **不缩小既有 journal**：本变更只改变写入形态。已经写在磁盘上的整份数组仍然存在，恢复这些文件时仍要解析它们的大行。要缩小既有文件需要迁移、重写或压缩，不在本变更范围内。
- 不承诺单个 checkpoint 一定小：checkpoint 内联 `compactionBefore` 摘要与文件 before snapshot，含大文件快照时仍可能产生大行（实测该语料文件快照合计只有 0.12 MiB，但快照体积本身无上界）。
- `/fork` 仍然一次性写入完整栈（新 session 必须自包含），因此 fork 产生的首行仍与栈规模同阶。
- 不做 `compactionBefore` 摘要的内容去重（实测该会话 166 个带摘要的 checkpoint 只有 3 份不同摘要，可在本变更之上再降约 36×，但收益远小于本变更）。
- 不做 change history 栈深上限，不做 journal 压缩、分块或 squash。
- 不改变 change checkpoint 的结构与字段。
- 不承诺恢复峰值与 `append_records` 体积无关（fork 初始快照等单次大操作仍是独立话题）。

## Decisions

### 1. 新增两个增量操作，而不是改变 `set_change_history` 的语义

新增：

```ts
type PushChangeCheckpointJournalOperation = {op: 'push_change_checkpoint'; checkpoint: ChangeCheckpoint};
type PopChangeCheckpointJournalOperation = {op: 'pop_change_checkpoint'};
```

`set_change_history` 保持"整份替换"语义不变。这样旧 journal 不需要迁移，混合 journal（老版本写过的前缀 + 新版本写的后缀）天然可恢复，replay 只需按顺序应用三种操作。若改成"给 `set_change_history` 加一个增量标志"，同一 op 会承载两种语义，且旧版本会把增量数组当成完整栈接受 —— 那是静默的状态错误，比读不出来更糟。

### 2. `set_change_history` 保留给两种自包含场合

- **失效边界重置**：栈被重置为单个 invalid checkpoint。栈本身只有 1 个元素，整份写入体积可忽略。
- **`/fork` 初始快照**：新 session 必须"在不读取源 journal 的情况下 replay 出等价状态"，因此整份写入是必需的语义要求，不是性能问题。

### 3. 由 `ChangeHistoryContext` 自己记录增量，调用方只做搬运

当前调用方是"取整份栈"（`getHistory()`），无法表达"这一轮到底发生了什么"。改为 context 内部维护待写增量：

```ts
type ChangeHistoryDelta =
  | {kind: 'push'; checkpoint: ChangeCheckpoint}
  | {kind: 'pop'}
  | {kind: 'reset'; history: ChangeCheckpoint[]};

// ChangeHistoryContext
finalizeCheckpoint(): ChangeHistoryDelta | null;   // 返回本次栈改动的增量；没有改动时返回 null
```

真实改动点与对应 delta（实测确认，`invalidate()` 只有一条真实路径）：

| 改动点 | 行为 | delta |
| --- | --- | --- |
| `finalizeCheckpoint()`，recording | `history.push(cp)` | `{kind:'push', checkpoint}` |
| `finalizeCheckpoint()`，invalid | `history = [cp]` | `{kind:'reset', history:[cp]}` |
| `invalidate()`，`current` 存在 | `history = []`（不写 delta，等 finalize 产生 `reset`） | 由随后的 finalize 决定 |
| `invalidate()`，`current` 为空 | **空操作**（守卫要求 `status === 'recording'`，而 `current` 为空时栈顶必然是 ready/invalid） | 无 |
| `markLastUsed()`（undo） | `history.pop()` | 无；undo 路径单独写入 `pop`（见决策 4） |

实测证据：`current` 为空、栈为 `[b1/ready, b2/ready]` 时调用 `invalidate()`，栈保持不变；栈为 `[c2/invalid]` 或空栈时同样不变。因此代码中 `invalidate()` 末尾的 `this.history = [checkpoint]` 分支不可达 —— 本变更保持该分支原样，不为了"覆盖两条路径"放宽守卫或改动已完成 checkpoint 的行为。

由 context 自己产出而不是让调用方比较前后快照，是因为"比较整份栈"本身就是 O(栈规模) 的工作，而 delta 与栈改动同源时不会漏记。

实现时把增量做成 `finalizeCheckpoint()` 的返回值，而不是 context 内部的 `pendingDelta` 字段加 `takePendingDelta()`：返回值同样满足"与栈改动同源"，还消除了"增量已记录但未被消费"这一失败模式（字段版一旦漏调用消费入口就会静默覆盖上一轮增量）。代价只是调用方必须接住返回值，而它只有一个调用点。

`TranscriptContext` 侧把 `pendingChangeHistory: ChangeCheckpoint[]` 换成 `pendingChangeHistoryDelta`，`stageChangeHistoryDelta(delta)` 同时做两件事：把 delta 应用到自己的镜像栈（保持"主会话持有权威栈"不变），并记下待写增量。两侧应用同一份 delta，因此不会分叉。

**写入失败与重试的不变量**：`persistOperation` 只在写入成功后才 `clearPendingState()`，失败时待写增量保留、由下一次成功提交携带写出。据此定下三条规则：

1. delta 只在 `stageChangeHistoryDelta` 时**应用一次**到镜像栈；重试路径只重写 journal 操作，不再应用 delta（否则镜像栈会被推两次）。
2. 待写增量是一个**列表**而不是单个字段：连续两次写入失败时两个增量都要保留，否则后者会静默覆盖前者，journal 与内存栈分叉。
3. 写出待写增量的地方必须按应用顺序写全，并且**先写增量、后写弹出**。`restoreToBoundary` 直接拼自己的 batch（不走 `createPendingOperation`），因此必须显式补齐待写增量。

第 3 条是审查阶段发现的真实缺陷：写入失败后立即 `/undo`，`restoreToBoundary` 既没补齐待写增量、又在成功后清空了它。若 journal 里的栈还是空的（第一轮写入就失败），会写出没有对应 checkpoint 的 pop 让重放判定 session 不可恢复；栈非空时会弹掉前一个 checkpoint，与内存栈分叉。

`setChangeHistory(整份)` 随之删除：`loadSession` 直接安装 replay 结果、`forkSession` 只读镜像栈、`restoreToBoundary` 改为接收回退意图，都不需要它。

### 4. `/undo` 用 `pop` 表达回退，仍在同一个 batch 内

`AppContext.executeUndo` 不再构造"回退后的整份数组"，而是把回退意图交给 `restoreToBoundary`：

```
今天：batch[truncate_records, set_compaction, set_change_history(整份数组)]
之后：batch[truncate_records, set_compaction, pop_change_checkpoint]
```

原子性不变 —— records 截断、compaction 回退、栈弹出仍在同一行内，replay 不会观察到只完成一部分的状态。这条路径的收益是体积（该会话单次 2 MiB → 约 50 B），不是次数（实测该会话只发生 4 次 undo）。

`restoreToBoundary` 只有 undo 一个生产调用点，且 undo 的语义永远是"弹出栈顶一个 checkpoint"，因此不引入"整份替换"参数：它只表达弹出意图。

实现时补了两条约束。其一，**栈为空时不写 `pop_change_checkpoint`**：它是公开 API 在 change history 为空时被调用（既有测试就把 `restoreToBoundary` 当截断原语用）产生的真实缺陷 —— 内存上空弹出是空操作，但写进 journal 会让重放判定该 session 不可恢复。其二，batch 内**先按顺序补齐待写增量、再写弹出**（见决策 3 第 3 条）。两者共同保留同一个不变量：journal 里不会出现无对应 checkpoint 的弹出，且重放结果始终等于内存栈。

### 5. `pop_change_checkpoint` 只做空栈检查，不带 `expectedId`

replay 时 `pop` 遇到空栈返回失败，使该 session 判定为不可恢复，而不是静默忽略或错位。不加"期望弹出的 checkpoint id"校验：文件损坏已由 `seq` 连续性校验兜底，再加一层 id 比对属于没有具体故障场景支撑的复杂度。若后续发现"错位弹出但 seq 正常"的真实场景，再单独引入。

### 6. 版本边界：保持 `schemaVersion: 1`（已决策）

`loadSession` 走 `safelyReadJournal(..., repairTail: true)`：未知操作出现在**最后一行**时会被当作"可修复尾部"，`repairJournal` 用临时文件 + rename **重写 journal**；而 `listSessionSummaries` 在 index 条目指纹有效时直接返回摘要、**不 replay journal**。实测（用当前实现构造含新格式操作的 journal）：

| 场景 | 旧版能否加载 | 是否改写文件 | 后果 |
| --- | --- | --- | --- |
| 末尾**恰好 1 行**无法识别的条目 | 能 | **是** | **该行被物理删除**，静默丢失一个 checkpoint |
| 末尾 ≥2 行无法识别的条目 | 不能 | 否 | 会话不可恢复，文件不动 |
| 无法识别的条目之后还有正常行 | 不能 | 否 | 同上 |
| index 指纹有效时的列表 | — | — | **旧版 `/resume` 会列出该会话**，选中后加载失败 |

注意触发条件是"末尾恰好 1 行**无法识别**的条目"，而不是"新格式操作"本身：`append_records`、`set_todo_state` 等操作名与结构不变，旧版本认识它们；本变更下旧版本无法识别的只有新增的两个 change history 操作。

**决策：保持 `schemaVersion: 1`。** 前提是**旧版本不会读取新格式会话**（维护者确认：不使用发布版打开开发构建写过的会话）。在该前提下，上表第一行的行为只会在"主动降级后又打开新会话"时出现，属于本变更明确接受的代价。

曾评估的替代方案是"新写入使用 `schemaVersion: 2`，读取同时接受 1 与 2"，它能把触发条件压缩到退化场景。实测对照：

| 场景 | 保持 v1（本变更采用） | 新写入 v2（未采用） |
| --- | --- | --- |
| 全新会话 | — | 不能加载，**文件不动** |
| 会话里新版本做过 1 次改文件的轮次 | 能加载，**改写文件删掉该行** | 不能加载，文件不动 |
| 会话里新版本做过 ≥2 次改文件的轮次 | 不能加载，文件不动 | 不能加载，文件不动 |
| v1 旧会话被新版本追加 ≥2 行 | 不能加载，文件不动 | 不能加载，文件不动 |
| v1 旧会话被新版本**只追加 1 行** | 能加载，**改写文件删掉该行** | 能加载，**改写文件删掉该行** |

不采用的理由：它要求同步调整「单文件 JSONL transcript journal」中"首行 schemaVersion 1"的措辞与 `compacted-transcript-residency` 的表述，而在上述前提下收益无法兑现。**若前提发生变化（例如同时分发多个版本，或让开发构建与发布版共用同一存储根目录），应重新评估该方案** —— 那时"会话里只发生过 1 次带文件变更的轮次"会成为实际暴露面，实测占真实会话的 21%。

两个方案都不解决 index 短路的列表行为：旧版本可能列出一个随后打不开的会话。这是**可见**失败而非静默损坏，本变更接受该行为，不引入 index schemaVersion 提升（那会导致旧版本在降级时对每个项目全量重建索引）。

### 7. 用"写入量线性度"固定收益，而不是只测一次

收益来自"写入量随轮次线性而非二次增长"，这可以直接断言：让 N 轮真实写入链路（`AppContext` → `TranscriptContext` → store，而不是手工拼操作）产生 journal，断言 `bytes(N=100) / bytes(N=10)` 接近线性比例（约 10）而不是二次比例（约 100）。这比一次性峰值测量更适合长期看护，一次性测量只作为验证记录补充。

## Risks / Trade-offs

- **旧版本读取新格式会话**：见决策 6 的实测表与已决策的版本边界。本变更不提供安全回滚保证 —— 旧版本遇到末尾恰好 1 行无法识别的条目时会改写文件并删除该行（实测占真实会话 21% 的形态）。该代价由"旧版本不会读取新格式会话"这一前提兜住，而该前提依赖使用习惯、并非机制保证：`createTranscriptStore()` 目前没有 rootDir 覆盖入口（无环境变量、无 CLI 参数），从仓库 `npm start` 运行的新构建与全局安装的发布版共用 `~/.echo/echo_tui`。给开发构建单独的存储根目录是与本变更正交的缓解手段，本次不引入。
- **index 短路的列表**：旧版本可能列出一个随后打不开的会话。可见失败，不影响文件。
- **混合 journal 的恢复顺序**：老前缀用 `set_change_history`、新后缀用 `push`/`pop`，replay 必须严格按文件顺序应用。测试用"同一组轮次分别以两种形态生成"的等价性断言固定。
- **delta 漏记**：栈的改动点集中在 `ChangeHistoryContext` 一个文件内；测试覆盖 invalid 边界（唯一真实路径）、重复 finalize 与 undo。
- **重试导致重复应用**：若把 delta 应用放在重试路径上，镜像栈会被推两次。缓解：应用只发生在 `stageChangeHistoryDelta`，并有"写入失败后重试不丢失、不重复"的验收测试。
- **重复 finalize 的行为变化**：今天重复调用 `finalizeChangeCheckpoint()`（`current` 已为 null）仍会重写一份整份栈；变更后无 delta 即不写入。这是收敛，但需要测试固定"未产生 checkpoint 的轮次不追加 change history 操作"。
- **收益上限**：本变更后该会话 history 从 154.5 MiB 降到 2.16 MiB，但 `append_records`（3.8 MiB）会成为该会话 journal 的主体，最大单行改由 fork 初始快照或长记录决定。既有文件不会因此变小。

## Migration Plan

无需数据迁移。旧 journal 按既有语义 replay；新写入自动使用增量操作。回滚代价见决策 6 与 Risks。本变更不引入配置项开关 —— 增量形态是唯一写入路径，避免"两种形态并存"带来的长期维护面。

## Open Questions

- `compactionBefore` 摘要去重（实测 36×）是否值得作为下一个变更：在增量形态落地后，change history 已不再是 journal 主体，优先级下降，需要重新测量后再判断。
- 栈深是否需要产品层面的上限（`/undo` 可回退深度的显式语义），与本次改动正交。
- `invalidate()` 末尾的不可达分支是否值得单独清理（行为不变），与本变更正交。
