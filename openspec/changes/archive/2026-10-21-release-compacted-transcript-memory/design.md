## Context

`TranscriptContext.records` 保存完整会话，`AppContext.getAgentSession()` 深拷贝该数组，Agent runtime 又创建 `recordRegion`。现有 compaction 更新 `activeStartIndex` 并追加 notice，但不移除这些数组中的旧记录。JSONL journal 已包含完整原文，因此无需为释放旧 transcript 建立新的存储系统。

现有索引、Undo 和审批使用完整 transcript 的记录位置；renderer 在 resize、主题或视图切换时读取 records。改动必须区分持久化历史和内存活跃区，不能直接删掉数组前缀后沿用所有下标。

## Goals / Non-Goals

**Goals:**

- compaction 成功后，应用及对应 Agent 运行状态不再长期持有边界之前的 transcript 原始对象、正文或附件。
- 仅保留当前摘要和后续 transcript，下一轮 session 快照仅复制该区间。
- 保持现有 journal、provider 投影、完整历史命令、连续 Undo 和独立 fork 的语义。
- 无压缩时维持现有行为；自动压缩与手动压缩采用同一裁剪规则。

**Non-Goals:**

- 不引入字节预算、分页数据库、新日志 schema、附件外置或新的历史查看命令。
- 不限制用户输入、模型响应、shell-local 输出或并发数量。
- 不改造 Undo 文件快照、输入历史、usage/debug 的独立内存增长。
- 不承诺整个进程内存严格有界，也不要求全量恢复及显式历史操作没有临时峰值。
- 不改变既有压缩阈值、摘要模板、工具配对保护和图片预算。

## Decisions

### 1. 用起点偏移描述内存记录区

内存状态为 `records + baseRecordIndex + compaction`。`records` 是当前完整有效历史的连续后缀，`baseRecordIndex` 为其第一条记录在完整历史中的位置。

保持以下不变量：

```text
完整有效记录数 = baseRecordIndex + records.length
全局位置 = baseRecordIndex + 内存下标
有 compaction：baseRecordIndex = compaction.activeStartIndex
无 compaction：baseRecordIndex = 0
```

`baseRecordIndex` 只存在运行时，不写进 journal；恢复时由当前 compaction 推导。`activeStartIndex`、`transcriptStartIndex`、审批关联位置和对外诊断计数保持完整历史坐标。journal seq 仍是操作序号，与记录位置无关。

示例：原历史有 1000 条，边界为 800，则驻留原第 800～999 条，起点为 800。追加一条 notice 后，总数是 1001，驻留数是 201；第二次压缩返回的局部边界须加上 800 才是持久化边界。

备选方案是重置 `activeStartIndex` 为零并重新编号全部 checkpoint；该方案会改变持久化坐标且影响旧会话，因此不采用。

### 2. 压缩采纳成功后同步释放所有旧引用

`runCompaction` 保持纯函数式，接收驻留区及其起点：只估算、摘要新进入压缩区的记录，并把局部边界转换为完整历史位置返回。调用方负责落盘和裁剪。

交互式主会话顺序为：产生非空摘要 → 将 compaction 和 notice 写入既有单个 journal batch → 更新应用压缩状态并裁剪 → runtime 同步更新状态、notice 和驻留区。持久化失败不得提前裁剪应用记录。无 journal 的 headless/临时会话按成功采纳结果裁剪自己的运行区。

不能只裁剪 `recordRegion`：本轮 `session.records`、回调或闭包持有的旧输入快照也须解除已压缩前缀的引用。优先把输入 records 转移至唯一运行记录区；确需保留独立快照时同步裁剪，不建立另一份旧历史缓存。生成摘要及发送请求时的临时 provider 数组在对应步骤结束后释放，不成为后续 continuation 的持有者。

`recordsOwnership: 'transfer'` 只转移记录数组，不把 session 元数据变成隐式输出；runtime 使用局部起点与摘要状态，通过采纳回调通知应用。应用的摘要入口直接把摘要与 notice 合并提交，不保留可单独推进摘要、却不裁剪记录的 setter 或待写摘要状态。

空摘要、无有效边界、异常和采纳前取消均不裁剪。已成功提交压缩后再被用户中断，不撤回已提交压缩；仍保持正常 partial assistant 持久化行为。压缩和裁剪后旧 usage 锚点失效，按现有规则重新校准。

### 3. 恢复可全量加载，但主状态只接收后缀

保留现有 journal replay。恢复结果中的完整数组只用于建立会话状态、必要摘要及历史操作；安装到主会话时按 `activeStartIndex` 截取活跃区并记录偏移。返回调用方的数据不得把完整 records 再长期挂到 AppContext、runtime 或 preview cache。

旧 schemaVersion 1 的日志直接适用，无需迁移。无 compaction 的会话恢复全量 records，保持现状。

应用恢复接口仅返回成功标志，调用方从已安装的 context 取得状态，不再深拷贝一份会话返回。fork 使用现有 store 的同步序列化建立独立 journal，无需在完整回读后再深拷贝整份 records。

### 4. 完整历史只在确实需要时读取

主会话日常追加、组装 Agent 输入、计数和 resize 不允许为补齐旧前缀而 replay journal。session 摘要更新改用总记录数及已保存的标题等轻量事实；截断导致标题失效时可按需 replay 重算，不能每条追加都加载全历史。

| 消费路径 | 处理方式 |
| --- | --- |
| `/fork` | 从 journal 的最终有效状态获取完整 records，与当前 compaction、todo、history 一起建立自包含新 journal；成功切换后继续只驻留活跃后缀 |
| `/copy` | 命令打开时按需加载完整有效 user/assistant 历史，仍复制原文；关闭面板后释放命令持有的记录 |
| `/reference`、`/resume` 预览 | 继续使用历史加载路径；预览缓存只存展示文本，不保留完整 replay session 或附件，压缩会话不因选中预览而重新装入主状态 |
| 子 Agent 回看 | 打开时只读取一次完整历史，只保留按 run 分组的过程记录；打开期间增量摄取主会话的新批次，计时、resize 和切换 run 不再读取 journal；退出时释放过程记录 |
| 审批与最近模式查询 | 使用完整逻辑位置；若所需事实已进入摘要，允许按需读取 journal，读取结果不成为常驻完整历史副本 |
| BTW | 打开时复制主会话摘要及驻留后缀，携带同一偏移；保持打开时快照隔离，旁路记录用自身坐标，不用主偏移当作旁路显示记录数 |

现有 session preview 的展示文本集合、Undo history 等不在本次全面预算化范围；但不能为了弥补裁剪额外引入永久完整 transcript 缓存。历史操作的临时峰值是明确接受的取舍。

### 5. Undo 恢复完整边界，再安装目标活跃区

checkpoint 的 `transcriptStartIndex` 取完整总记录数，不取驻留长度。若目标边界仍在当前驻留区且目标 compaction 与该区兼容，可直接截短后缀；若恢复较早 compaction 或无 compaction，需要从 journal 的最终有效历史取回目标状态所需记录。

普通截尾以缓存的首条用户完整位置判断标题是否仍有效；删除首条用户时重置标题，首条用户已经压缩时保留原标题。该位置实际参与标题维护，避免为了重算标题而读完整历史。

跨边界回退前先读取并准备所需历史，读取失败不得先修改文件。保留既有文件恢复成功后提交 transcript/compaction/history batch 的语义；不新增跨文件系统事务。安装目标状态后，再按目标 compaction 裁剪，绝不能把全局 Undo 边界钳到 `records.length`。

Undo 后新增记录、旧分支恢复和再次压缩都使用各自当前完整历史坐标。`/clear` 重置 records、起点和 compaction，但不删除旧 journal。

### 6. 破坏性重绘仅展示摘要提示与驻留区

压缩成功时不主动清屏，终端已经接收的旧消息留在 scrollback。需要破坏性重绘时，主会话只投影当前压缩历史提示及驻留记录，不读取旧原文。

提示说明较早历史已压缩、完整记录保存在会话文件；可以复用已存在的最新 compaction notice，避免同一提示重复，不把额外 UI 提示写入 transcript。无需在终端展开摘要全文，完整摘要继续保存在 compaction 并用于 provider 请求。

子 Agent/BTW 专用视图沿用自身记录源，退出后回到主会话活跃投影。renderer 的旧记录缓冲及 run 身份集合应按当前驻留区/活动调用清理或重建，防止渲染状态继续持有已释放原始对象。

coordinator 每帧统一同步主会话渲染缓存，包括主会话在后台的情形；renderer 不重复同步。投影 records 仅由 coordinator 按 owner 选择并传入，主投影状态只携带边界与摘要提示元数据，不再携带另一份 records 来源。主会话和其他视图仍使用独立增量状态。

备选方案是每次 resize 从磁盘恢复完整历史；这会反复制造峰值且增加复杂度，因此不采用。

## Risks / Trade-offs

- [位置错位] → 明确全局位置、页内下标和 journal seq，覆盖同一 run 连续压缩、notice、审批、Undo 后追加测试。
- [旧快照仍持有附件] → 审计 session 输入、runtime、callback、renderer、BTW 的记录所有权，不只断言主数组变短。
- [重绘后旧原文不再可见] → 显示压缩历史提示，完整 journal、copy 和历史回看仍可访问；这是本次明确的展示取舍。
- [全量恢复和显式历史操作仍有峰值] → 接受此限制，但确保临时结果在操作结束后释放，不重新进入主常驻记录区。
- [进程内存仍可能增长] → 验收只针对已压缩 transcript 驻留，不把 Undo 文件快照、未压缩的本地输出或终端 scrollback 当成本次已解决的问题。
- [压缩后的旧当前轮事实影响审批] → 必要查询按完整位置回读，不把已逐出记录误判为从未存在。

## Migration Plan

无需数据迁移或新增配置。代码变更作为一次迭代交付；现有日志和旧版本均继续按同一 schema 读取。回滚代码时旧版本仍能恢复完整 journal。

先通过纯函数及真实 controller/runtime 组合测试验证驻留范围、位置与 provider 投影，再用独立 `--expose-gc` 压测进程比较多次成功压缩后的 heap 趋势。不得给生产代码增加仅为测试存在的 GC 调用、参数或分支。

## Open Questions

无阻塞问题。实现中只需沿用现有渲染样式确定提示文案，不扩展为新的历史查看功能。
