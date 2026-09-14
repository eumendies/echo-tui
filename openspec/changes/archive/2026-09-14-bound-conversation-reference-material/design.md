## Context

当前 `/reference` 链路：确认选择时 `loadSessionReadOnly` 全量重放 journal，`createPendingConversationReference` 用全部最终 records 渲染成一整段 `materialText` 存入 pending；提交时若素材超过引用预算（`max(2000, min(12000, floor(contextWindow * 0.10)))`），把整段素材作为一条 user 消息发起单次无工具总结请求。

由此产生两个结构性问题：

- 素材源忽略源会话的 compaction 状态。`CompactionState`（`summaryText` + `activeStartIndex`）表达的活跃投影才是源会话模型真正看到的上下文，而引用素材却取压缩边界之前的全部原始 records，且现成的 `summaryText` 反而不进素材。引用成本为 O(全量历史)。
- 总结请求输入无上限。素材超过总结模型窗口时请求必然失败，且错误被脱敏成笼统的「引用准备失败」。

关键事实约束：自动压缩阈值为 0.8 × 窗口、保留最近 20 条（`COMPACTION_THRESHOLD_RATIO` / `COMPACTION_RECENT_KEEP_COUNT`），因此压缩过的会话其活跃投影天然有界；`AgentTurnOptions` 只有 `abortSignal` 与 `isCompaction`，provider 层没有输出上限参数（Anthropic 有固定 `max_tokens` 兜底，OpenAI 系没有）；`test/agent/conversation-reference.test.js` 现有两处断言把「不拼接 compaction summary」锁为契约，需要随本变更反转。

## Goals / Non-Goals

**Goals:**

- 引用素材源对齐源会话活跃投影：`compaction.summaryText` 区块 + `activeStartIndex` 之后的 records。
- 总结请求输入具备相对当前生效模型的硬上限 `min(64000, floor(contextWindow * 0.5))` tokens，超限走头尾保留截断降级，仍保持单次请求。
- 截断发生时向模型明确省略范围，并强化 `source_file` 分页回读提示。
- full/summary 判定与截断判定都只在发送时按当前生效模型重算；选择时结果仅用于卡片展示。

**Non-Goals:**

- 不新增总结输出上限（模型输出为固定小节结构化总结，长度实际可控；Anthropic 路径另有固定 `max_tokens` 兜底）。
- 不实现分块 map-reduce 总结（N+1 请求，成本与失败面不匹配引用摘要定位）。
- 不实现引用总结缓存、不改 journal 格式、不改提交时固化的不可变性语义。
- 不处理列表预过滤、标签转义、主线程阻塞等已记录的其他问题（后续变更）。

## Decisions

### 1. 素材源 = 源会话活跃投影

`createPendingConversationReference` 不再渲染 `session.records` 全量，改为：存在 `session.compaction` 时先渲染 `[compacted_summary]` 区块（内容为 `compaction.summaryText`），再渲染 `records.slice(activeStartIndex)`；无 compaction 时保持全部最终 records。

替代方案：直接把源 `compaction.summaryText` 当作最终引用总结（不重总结活跃部分）——会丢失最近约 20 条活跃细节；维持全量（现状）——成本无界。选择 slice + summary 区块，因为素材体积从 O(全量历史) 降到 O(活跃上下文)，压缩过的会话通常直接落入引用预算，full 投影零请求即可用。

该决策同时反转 `conversation-reference.test.js` 的两处既有断言：summaryText 必须进素材，`activeStartIndex` 之前的 records 必须不进。

### 2. pending 素材改为结构化记录段

`PendingConversationReference.materialText`（单字符串）调整为记录段数组，每段对应一条已渲染的中立记录块（或 compacted_summary / 省略标注等伪段）。

原因：头尾截断必须按记录粒度取舍；发送时需按当前模型重算预算与上限，可组合的段是前提。该状态为进程内 transient，不落盘，无迁移成本。

### 3. 总结输入上限与三级判定

发送时计算 `summaryInputLimit = min(64000, floor(contextWindow * 0.5))` tokens（用现有 `estimateTextTokens` 估算），判定顺序：

1. 素材 ≤ 引用预算 → full 投影，0 请求（不变）；
2. 素材 ≤ 总结输入上限 → 单次总结（现有路径，新增上限保护）；
3. 素材 > 总结输入上限 → 头尾保留截断后单次总结。

0.5 比例为指令与输出留余量；64k 上限防止超大窗口模型为一次引用付出离谱成本；不设固定下限——下限会在 window < 16k 时把输入占比抬过 50% 甚至抬到窗口本身之上，使「截断后输入不超过窗口」的保证失效；小窗口模型退化为薄总结（省略标注 + source_file 回读兜底）优于必然失败的总结请求。

截断顺序：compacted_summary 区块整体优先保留（若其本身超过输入上限，则对 summaryText 自身截断并标注）；随后从头部保留最早若干条、从尾部保留最近若干条，逐段累加直至接近输入上限（预留指令与输出余量）；中段以 `[已省略 N 条记录]` 伪段替代。尾部权重高于头部：最近对话对后续请求相关性最高。

替代方案：素材超限时直接报错要求用户先压缩源会话——摩擦大，且大窗口模型上产生的活跃上下文在小窗口模型下无法靠用户自查解决，故采用自动降级。

### 4. 截断场景的回读提示

现有 summary 模式 `detailHint` 已提示 read_files 分页读取 `source_file`；发生头尾截断时追加明确说明「总结未覆盖中段 N 条记录，可分页读取 source_file 回查」，保证被省略细节有确定的恢复路径。full 投影不发生截断，不加提示。

### 5. 输出侧不做上限校验

总结是指令约束下的固定小节结构化输出，实际长度可控；Anthropic adapter 固定 `max_tokens` 已构成兜底；OpenAI 系依赖模型自身输出限制。留待实际出现失控输出时再以后置校验方式加固。

## Risks / Trade-offs

- [Risk] 头尾截断丢失中段细节 → Mitigation: compacted_summary 区块优先保留（早期结论已覆盖）；provider-facing 文本明确省略范围并提示 read_files 分页回读 `source_file`；`source_file` 的 append-only 语义说明已存在。
- [Risk] 极端单条记录（24k 字符上限内）仍可能占满小模型的输入上限 → Mitigation: 逐段累加截断保证总量不超限，接受单段信息密度损失。
- [Trade-off] 保真度换可预测性：始终单请求、成本可预估，放弃 map-reduce 的中段保真。
- [Trade-off] 压缩感知使引用内容依赖源会话 compaction 质量；源会话摘要本身失真时引用随之失真（与源会话自身上下文一致，可接受）。
- [Risk] pending 类型调整触碰 command-port 与 submission controller 的类型适配 → 仅类型与传参适配，不改变提交生命周期行为。

## Migration Plan

- 纯运行时行为变更：不迁移 journal、不改持久化 schema、pending 引用状态不落盘。
- 回滚：还原 `conversation-reference.ts`、`types/transcript.ts` 与测试即可，无数据残留。

## Open Questions

无。总结输出上限、分块 map-reduce、引用总结缓存留待后续独立变更。
