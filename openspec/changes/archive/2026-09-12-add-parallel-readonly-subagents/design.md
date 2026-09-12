## Context

主循环已经具备连续只读工具的并行骨架：`agent-loop-runtime` 把同一 provider turn 中相邻的 `parallel_read` 调用交给 `executeConcurrentReadonlyCalls` 并发执行，结果按 provider 原始顺序成对提交（openspec/specs/local-tool-execution/spec.md 的并发分类与只读段调度要求）。`run_subagent` 目前被并发分类器归为 `exclusive`，委派永远串行。

子 Agent 基础设施已具备并发重入条件：`SubagentToolPort.run` 每次调用创建独立的 metadata、failure handoff accumulator 与子 runtime 实例，取消信号、审批 origin、延迟 callback 隔离均按 runId 边界设计；历史上的"每父 run 四次委派预算"已在代码中移除（de71c23），但 spec 仍保留该要求，存在漂移。

现存的单 slot 状态是本次主要改造对象：

- `SubagentRunContext` 只保存一个 `activeRun`；交错 runId 的稳定记录批次会被整体拒绝，导致 `onSubagentRecords` 丢弃 transcript 记录。
- `ToolApprovalContext.requestManual` 遇到新请求会以 "another approval request replaced it" 抢占式 deny 现有请求。
- 渲染分组只合并"相邻同 runId"的子 Agent 记录；并行交错输出会造成轨道碎片且 continuation 行无 run 标识。
- BTW 已建立"全屏接管"的既定模式：非 alternate screen，而是 `renderDestructive`（2J/3J 清屏清 scrollback 后整屏重绘）+ visibleOwner 路由（main/btw）+ 输入优先级链 + resize recovery。

用户已确认的产品决策：单 run 保留 rail 流式（方案乙）、并行 run 主窗口紧凑化且细节进入 Ctrl+O 会话窗口、审批 FIFO 排队、不设并发上限、入口快捷键 Ctrl+O。

## Goals / Non-Goals

**Goals:**

- 同一并行只读段内的多个 readonly `run_subagent` 并发执行，结果与取消语义与现有并行只读工具一致。
- live 投影、快照重绘与会话重放使用同一份确定性渲染事实，任何时刻 resize/replay 不出现分叉漂移。
- 多运行状态下稳定记录零丢失，审批请求不互相破坏，footer 活动按 run 隔离。
- 提供全屏会话窗口查看任意 run 的完整 loop 过程，包括实时 draft。

**Non-Goals:**

- 不引入真正的 alternate screen（ANSI 1049）；全屏窗口沿用 destructive repaint 模式。
- 不为并行 subagent 设并发上限或排队机制；provider 限流由各子 loop 既有 retry 退避吸收。
- 不提供向运行中 subagent 追加输入的能力；委派 task 在启动时固定。
- 不改变 worker（general_purpose）委派的独占执行语义，也不放开嵌套委派。
- 不处理与 `/btw` 并存时的互邀视图组合；两者简单互斥。

## Decisions

### Decision 1: 并行判定下沉到并发分类器 + 定义执行策略透出

`SubagentDescriptor` 增加 `executionPolicy` 字段，`SubagentToolPort.listDefinitions()` 从冻结定义直接透出；`classifyToolCallConcurrency(call, isParallelSubagent?)` 增加可选谓词参数：调用名为 `run_subagent` 且参数中的 `agent` 命中谓词时返回 `parallel_read`，参数 JSON 解析失败或名称未知返回 `exclusive`。

主循环在 `initializeRunState` 时从 `subagentPort.listDefinitions()` 过滤 `readonly_investigation` 构造谓词并传给两处分组调用点；无 port 的运行（BTW、子运行）谓词为空，`run_subagent` 保持独占。

替代方案：把策略硬编码进分类器、或在工具 description 里要求模型自律。前者无法覆盖自定义 readonly agent，后者不可靠；均放弃。fail-closed 未知名称与现有只读 bash 分类行为对称。

### Decision 2: parallelSize 作为持久化渲染事实

主循环在收集并行只读段时统计其中 `run_subagent` 调用数量，≥2 时通过 `ToolExecutionOptions.subagentGroupSize` 下行（executor → handler → `port.run` 已透传 options）；端口把 `parallelSize` 写入 start record 事件。

这是渲染分叉（方案乙）的关键：执行中"外层 tool pair 是否已提交"不可靠（pair_after_execute 在完成后才提交），按活跃 run 数判定会在 mid-group 完成时翻转。写入 transcript 的 start record 后，live 渲染、快照重绘、resize recovery、/resume 重放都读取同一事实。

替代方案：单 run 保留 rail、并行才紧凑的判定完全留在渲染层推导 —— 无法稳定实现；或统一紧凑（方案甲）—— 用户已选择保留单 run rail，放弃。

### Decision 3: SubagentRunContext 多运行注册表

`activeRun` 单对象改为 `Map<runId, ActiveSubagentRun>`，字段增加 `parallel`（来自 start record）与 `lastActivityAt`：

- `acceptRecords`：start 建立条目；tool_call/tool_result/reasoning/assistant 更新对应条目；终态删除条目；未知 runId 的批次仍整体拒绝（保留迟到隔离语义，`assistant-turn-runner` 的丢弃兜底不变）。
- `updateActivity`：按 runId 更新，未知 runId 拒绝。
- `getPending()`：存在 parallel run 时返回 `kind: 'subagents'` 的 plural 形态（按 start 顺序稳定排列），否则返回现有 `kind: 'subagent'` 单数形态（单 run 视觉零退化）。活跃 run 同源同段（并行段由 allSettled 屏障隔开），不会出现单/复混排。
- `markParentCancelled`：`cancelledRunId` 改为 Set，接收所有已取消运行的迟到 cancelled 终态。
- `isCurrentRun` / `hasTimedActivity`：Map 语义。

每个 run 的实时 draft（`SubagentActivity.draft`）继续仅驻留内存，供 plural 行与 Ctrl+O 会话窗口使用。

### Decision 4: 主窗口渲染分叉

- 无 parallelSize 标记的 run：完全保持现状——rail 流式渲染、singular footer 块、完成后外层 pair 因 terminal 存在而 compact（`compactSubagentResult`）。
- 带 parallelSize 标记的 run：`groupTranscriptBlocks` 在主投影中过滤其全部 subagent records；执行中状态由 plural 紧凑 pending 块承担（复用 `renderPendingToolCallsLines` 的"共享标题 + 每 run 一行 + `… +N more`"模式，行内容为 agent 名、任务摘要、phase、当前工具、elapsed）；完成后外层 `run_subagent` tool pair **展开**显示最终报告正文（对 parallel run 反转 `compactSubagentResult`），保证父 Agent 消费的结论在主窗口可见。

交错 continuation 行的 run 标识问题随并行 run 退出主 rail 而消失：主 rail 只承载单 run，无需新增行内标识。

### Decision 5: 人工审批 FIFO 排队

`ToolApprovalContext` 增加待处理队列：`request`/`requestManual` 在存在 `activeRequest` 时入队等待而非抢占 deny；`resolveActive` 后按 FIFO 提升下一个请求并打开 surface。会话级缓存命中、auto 审批 reviewer 并发路径不受影响；reviewer 拒绝后的 `requestManual` 回退进入同一队列。新增 abort 清算入口：父 turn abort 时活跃与排队请求统一以 interrupted deny 收尾，避免等待 Promise 悬挂。

排队中的 run 通过 `waiting_approval` 活动相位在紧凑块中可见；审批 surface 仍为单 slot。

### Decision 6: Ctrl+O subagent 会话窗口沿用 BTW 全屏接管模式

新增 `src/app/subagent-view-controller.ts`，镜像 `BtwConversationController` 的结构：

- **进入**：`Ctrl+O`（`\x0f`，当前空闲）映射为新输入事件 `OPEN_SUBAGENT_VIEW`。无 run 时 no-op。打开时定位到最新的 run（优先运行中）。
- **数据**：按 runId 过滤主 transcript records（records 已完整持久化），实时 draft 取自 `SubagentRunContext`；不新增数据通道。
- **渲染**：进入/退出/resize 走 `renderDestructive`；窗口 body 把 run records 投影为普通块（task、tool pair、reasoning、assistant，复用 blocks 渲染器，无 rail 前缀）+ draft 尾部；后续 records 批次增量渲染。
- **切换**：↑/↓ 在 transcript 内全部 run 间循环，标题显示序号（如 `2/5`）。
- **输入**：visibleOwner 扩为三态（main/btw/subagent_view）；view 激活时消费全部输入，Esc 关闭 view 且不得触达 `interruptActiveTurn`（插入位置在 btw 检查之后、Esc 中断语义之前）；审批/提问 modal 仍按现有高优先级浮在 view 之上；Ctrl+C/D 维持全局退出；与 `/btw` 互斥。
- **生命周期**：run 结束后 records 仍在 transcript，可随时重开回看；/resume 重放后同样可看；view 激活时父 turn 中断/完成不影响 view，用户手动 Esc 返回。

替代方案：真正的 alternate screen——违反 AGENTS.md 约束，放弃；在主窗口做内嵌滚动窗格——复杂度高且与追加式渲染模型冲突，放弃。

## Risks / Trade-offs

- [不设并发上限导致 provider 限流或成本放大] → 子 loop 保留既有 provider retry 退避；每父 run 委派次数实际受模型自律与任务形态约束；spec 明确不承诺上限。
- [parallelSize 依赖父 loop 正确传递 groupSize] → 分组与统计在同一函数内完成；测试覆盖 2 个并行委派、1 委派 + 观察工具混合、独占委派三种组合。
- [多运行记录交错持久化顺序 = 完成顺序] → 快照重绘按 parallelSize 过滤，不依赖物理顺序；单 run 顺序与现状一致。
- [审批排队改变交互预期] → 仅在多请求竞争时生效；单请求路径行为不变；排队请求以 footer 活动相位可见，不产生静默等待。
- [Ctrl+O 全屏重绘清 scrollback] → 与 BTW 行为一致，属于既定 destructive recovery 模式；进入前主窗口状态可从 transcript 完整恢复。
- [view 与 modal 表面叠加] → 复用现有优先级链（modal > view），审批在 view 之上出现时输入先归 modal，与 BTW 现状同构。

## Migration Plan

纯增量行为变更，无持久化格式破坏：`parallelSize` 为可选字段，历史 journal 缺省时按单 run 处理。实现按阶段推进：并行执行层 → 多运行状态层 → 审批排队 → 主窗口渲染分叉 → Ctrl+O 会话窗口，每阶段保持全量 typecheck/test 通过后进入下一阶段。回滚即还原对应提交，无需数据迁移。

## Open Questions

无。
