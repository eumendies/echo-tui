## Context

echo-tui 已有全部所需接缝，本设计明确各接缝的复用方式：

- 命令系统：`CommandHandler`（match/start/handleEvent）+ `CommandHostApp` 受控端口 + `createDefaultSlashCommandHandlers` 注册清单，`/mode` 是中等复杂度命令的先例。
- 会话状态：`todoState` 通过 journal 的 `set_todo_state` 操作持久化，`transcriptContext` 持有，`/clear`、`/fork`、`/resume` 语义已定型；`shared.ts` 为 open todo 注入 transient suffix。
- 独立模型判断：自动工具审批（`automatic-tool-approval`）已验证「严格解析专用 profile → 无工具 provider agent → 组合超时 → 失败关闭 → usage 记账」模式。
- 回合生命周期：`runAssistantTurn` 拥有完整回合回调边界；`main.ts` 组合根负责接线；pending 单槽与 command session 已有明确占用语义。

## Goals / Non-Goals

**Goals:**

- `/goal` 提供常驻可度量目标：设置、替换、状态查看、暂停、恢复、清除。
- goal `active` 时每个成功完成的会话回合后由独立评估器判定；未达成自动推进下一回合，直到达成、暂停或达到边界。
- 全部状态经 session journal 持久化，resume/fork/clear 语义与既有会话状态一致。
- 自动循环始终有界、可中断、可审计：`maxTurns`、Esc 暂停、评估失败关闭、revision 隔离、逐轮 local notice。

**Non-Goals:**

- token 预算边界（Codex 的 `token_budget`）与 `--max-turns` 命令行旗标，留作后续演进。
- headless `--once` 路径接入 goal 循环。
- 目标内容的多主题/子目标建模；条件为单段文本。
- 评估器自行重跑测试或修改工作区；评估只消费 transcript 中已可见的证据。

## Decisions

### D1: 状态模型与会话级持久化

`GoalState` 作为 session 状态进 journal（新增 `set_goal_state` 操作），字段：`condition`、`status`（`active`/`paused`）、`revision`、`startedAt`、`turns`、`maxTurns`、`lastEvaluation`。对齐 `todoState` 先例获得 resume/fork/clear 的既有语义。

- 替代方案：独立 goal 存储文件——需要自建 resume/clear/分区语义，且与 session 生命周期脱节，弃用。
- 全局（跨 session）目标——不符合「session 级 standing objective」语义，弃用。
- resume 语义：恢复条件但置 `paused` 并重置运行时基线（`turns=0`、`startedAt` 刷新），必须 `/goal resume` 才继续，避免恢复会话即自动燃烧 token。

### D2: 独立评估器复用自动工具审批骨架

`src/app/goal/evaluator.ts` 复刻 `createToolApprovalReviewer` 结构：`AppSettings` 新增 `goal.evaluationModelProfileId`（严格解析，必须存在于当前 revision 的 profile 目录）；无工具 provider agent；输入为 system prompt + 有界投影；输出解析「verdict + 理由」；30s 组合超时（deadline + parent abort）；失败关闭为 `unavailable` 而非猜测。

- 替代方案：复用主会话模型评估——评估不独立、prompt 成本高、易受工作模型自我认知偏差影响，弃用。
- 复用 `toolApprovalModelProfileId`——两个用途耦合，用户无法单独为 goal 选择更便宜的快速模型，弃用。
- 未配置有效评估模型时 `/goal <condition>` 直接拒绝并指引 `/config`；不做静默回退。

### D3: 自动续跑循环的驱动点与隔离

`runAssistantTurn` 返回值扩展为 `'completed' | 'cancelled' | 'failed'`；`main.ts` 在 `startAssistantTurn` 完成后调用 `goalController.handleTurnFinished(outcome)`（fire-and-forget）。GoalController 内部单一 async 循环：评估 → `met` 完成 / `unavailable` 暂停 / `not_met` 且未达 `maxTurns` 则递增 `turns`、写 local notice、经注入的 `continueTurn()` 启动推进回合，等待其 outcome 后继续评估。

- 自动推进回合使用独立入口（main.ts 直接组装 `AssistantTurnSubmission` 调 `runAssistantTurn`，展示为 `[goal] 自动继续（第 N/M 轮）`、带 `metadata.goalContinuation`），不经过 `ComposerSubmissionController` 与 pending 单槽：单槽语义属于用户消息，goal 续跑写入会造成覆盖与竞争，弃用。
- 修改 agent loop runtime 直接内建 goal 循环——侵入核心循环且与 headless/subagent 语义纠缠，弃用。
- 让位规则：启动（评估或续跑）前检查 response lock、pending 单槽、command session；被占用即让位（goal 保持 `active`，等待下一个回合完成通知自然恢复）。用户消息永远优先。

### D4: revision 隔离与失败语义

每次设置/替换/恢复目标递增 `revision`。迟到的评估结果、超时回调、续跑回合 outcome 在 revision 不匹配或状态非 `active` 时一律丢弃。回合 `failed` 或 `cancelled`（Esc）→ 暂停并通知；评估超时/解析失败 → `unavailable` → 暂停并通知。此语义对齐项目既有 late-callback isolation 模式。

### D5: goal 上下文注入

`AgentSessionInput` 增加可选 `goalState`；`shared.ts` 在构造 provider records 时按 `todoState` 同款方式注入 transient suffix（目标、状态、已完成回合数、最近评估理由）。suffix 不写 transcript、不改 system prompt、不参与 compaction 边界。

### D6: 展示与命令面

- `/goal` 状态卡：info/select surface，展示条件、状态、回合进度、耗时、最近评估理由及 pause/resume/clear 操作提示。
- 每轮评估与生命周期变化写 local notice（可持久化的本地事实）。
- footer：`StatusLineState` 增加 goal 段（状态 + `N/M` 进度）；评估进行中复用现有 activity 动画语义。
- `/status`：快照新增 goal 摘要行。
- `/goal` 不声明 `allowDuringAssistantTurn`：状态修改命令按响应期规范保持期间不可立即启动；推进回合的主动停止由 Esc 承担。

## Risks / Trade-offs

- [评估误判导致提前完成或无效推进] → 严格 yes/no + 理由协议、证据限定在 transcript 可见内容；理由写入 local notice 可审计；用户可随时 `/goal clear` 或 `/goal pause` 纠正。
- [自动循环连续消耗模型请求] → `maxTurns` 默认 20、评估失败关闭、Esc 暂停、resume 后强制 paused 基线；每次推进前均检查用户输入通道。
- [command session 占用时续跑静默等待，用户不再输入则暂停于中间态] → 已知限制：footer 徽标持续显示 active，用户任意下一次输入或 `/goal resume` 即恢复推进；后续可加 command session 关闭唤醒接点。
- [journal 新操作破坏旧 session 兼容] → 纯增量：旧 journal 无 `set_goal_state` 时按空目标处理，加载不失败（对齐 todo 先例）。
- [评估 prompt 投影过大] → 证据投影设条数与字符双上限，仅覆盖目标激活后的记录区间。

## Migration Plan

无既有数据迁移；纯增量变更。新版本读取旧 journal 兼容（缺失 `set_goal_state` 时使用无目标状态，加载不失败）；但旧版本 echo-tui 读取含 `set_goal_state` 的新 journal 时会按「未知操作」将该 session 判为不可恢复，升级提示需写入发布说明。不需要回滚步骤。

## Open Questions

- `maxTurns` 是否需要 `--max-turns` 语法扩展与配置项，默认值 20 是否需要按模型窗口调整。
- 评估器是否应接收「上一轮评估理由」做进展对比，以识别原地踏步并提前暂停（当前版本仅携带最新一条）。
- 是否为 goal 生命周期发布 lifecycle hooks 事件（`goal_evaluated` 等），供外部自动化消费。
