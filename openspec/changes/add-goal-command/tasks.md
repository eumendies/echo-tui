## 1. 准备与状态基础

- [x] 1.1 准备实现分支（基于 dev 的 feature/goal-command），运行 `npm run typecheck` 与 `npm test` 确认基线
- [x] 1.2 新增 `src/types/goal.ts`：GoalState（condition/status/revision/startedAt/turns/maxTurns/lastEvaluation）与评估结果类型，字段中文注释
- [x] 1.3 `transcript-journal.ts` 新增 `set_goal_state` 操作（含 `null` 表示无目标）、工厂函数、replay 应用与结构校验
- [x] 1.4 `transcript-context.ts` 持有 goalState：session 装载克隆、清空、变更时经 journal 持久化
- [x] 1.5 `app-context.ts`：`getAgentSession` 携带 goalState；清空会话同步清空；装载 session 时按 resume 语义归一化（置 paused、turns=0、刷新激活时间、保留条件与最近评估）
- [x] 1.6 测试：journal `set_goal_state` 往返与无操作兼容、/clear 同步清空、resume 归一化语义

## 2. goal 命令面

- [x] 2.1 `src/types/command.ts` 扩展 `CommandHostApp.goal` 端口（读取快照、设置/替换、暂停、恢复、清除）；新增 `src/app/command/goal-command-port.ts` 并在 `command-host.ts` 装配
- [x] 2.2 新增 `src/commands/goal-command-handler.ts`：解析 `/goal` 语法（条件、裸命令、pause/resume/clear 与别名）、条件非空与 4000 字符校验、评估模型配置校验、状态卡 surface、用法提示
- [x] 2.3 在 `resolve-slash-command.ts` 注册 handler，命令描述进入 slash suggestions
- [x] 2.4 测试：命令解析矩阵（设置/替换/裸/pause/resume/clear/别名/超长/空参数）、忙闲设置行为、状态卡内容、无目标提示

## 3. goal 上下文注入

- [x] 3.1 `types/agent.ts` 为 `AgentSessionInput` 增加可选 `goalState` 字段（随 1.5 提前完成）
- [x] 3.2 `src/agent/loop-runtime/shared.ts` 按 todoState 同款方式注入 goal transient suffix（条件、状态、轮次进度、最近评估理由；paused 标明等待用户恢复）
- [x] 3.3 `agent-loop-runtime.ts` 透传 `session.goalState` 到 provider records 构造
- [x] 3.4 测试：active/paused/无目标三态注入、suffix 不写 transcript、system prompt 与 tools schema 保持稳定、模型无 goal 管理工具

## 4. 独立评估器

- [x] 4.1 新增 `src/app/goal/evaluation-projection.ts`：目标激活后 transcript 的有界证据投影（条数与字符双上限，含 assistant 文本、工具结果与本地通知）
- [x] 4.2 新增 `src/app/goal/evaluator.ts`：复刻 `createToolApprovalReviewer` 骨架——严格 profile 解析、无工具 provider agent、30 秒组合超时、失败关闭为 unavailable、verdict + 理由协议解析、usage 记账
- [x] 4.3 测试：投影有界性、判定协议解析（合法/非法）、超时与失败关闭、profile 解析失败、usage 记账与记账失败隔离

## 5. 自动续跑循环与接线

- [x] 5.1 `assistant-turn-runner.ts` 返回回合 outcome（`completed`/`cancelled`/`failed`），更新既有测试
- [x] 5.2 `src/app/goal/goal-controller.ts`：状态与生命周期操作（设置/替换/暂停/恢复/清除、revision 管理、turns/maxTurns、生命周期 local notice）
- [x] 5.3 `goal-controller.ts` 评估驱动循环：评估→达成完成/不可用暂停/未达成续跑；发起前让位检查（response lock、pending、command session）；迟到评估与回合 outcome 的 revision 隔离
- [x] 5.4 `main.ts` 接线：装配 GoalController、回合完成后通知、`continueTurn` 独立入口（`[goal] 自动继续 N/M` 展示文本 + goalContinuation metadata，不走 pending 单槽）、Esc 中断联动暂停
- [x] 5.5 测试：fake evaluator 驱动的边界矩阵（达成/未达成/不可用、maxTurns、让位、revision 隔离、Esc 暂停、迟到 outcome 丢弃）

## 6. 配置中心集成

- [x] 6.1 `app-settings-config.ts`：`goal.evaluationModelProfileId` 的读取、归一化、校验（引用须存在于 `llm.models`，未配置合法）与写入（随 2.2 的配置校验提前完成）
- [x] 6.2 `/config` 常规 Tab 新增 goal 评估模型行：始终可见、候选来自已配置 profiles、未配置状态、动态行索引与既有面板语义一致
- [x] 6.3 测试：设置往返、非法引用拒绝保存、未配置可保存且保留其他节点、配置变化对后续评估生效

## 7. 展示收尾

- [x] 7.1 footer：`StatusLineState` 增加 goal 段（active `N/M`、paused 标记、评估中指示、无 goal 隐藏），`render-context.ts` 接入投影，`footer/composer-surface.ts` 渲染
- [x] 7.2 `/status`：`CommandStatusSnapshot` 增加 goal 摘要（状态、条件摘要、N/M），status surface 渲染；无 goal 隐藏
- [x] 7.3 测试：footer 三态渲染、status 摘要展示与只读语义

## 8. 全量验证与文档

- [x] 8.1 运行 `npm run typecheck`
- [x] 8.2 运行 `npm test`
- [x] 8.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 8.4 手动走查（fake agent）：设置目标→评估→自动续跑→达成；Esc 暂停与 `/goal resume`；pending 让位；`/clear`、`/fork`、`/resume` 语义；footer 徽标；`/config` 评估模型；`/status` 摘要
  - 走查方式：非 TTY 管道驱动 `dist/bin/echo-tui.js`（沙箱不允许 pty），临时 HOME 配 fake provider + `goal.evaluationModelProfileId`；实测覆盖：设置通知、footer `goal 1/20`、`goal 1/20 评估中`、评估不可用暂停、`/status` 的 `Goal paused · 1/20` 摘要、`/goal resume`、Esc 中断暂停、`/goal clear`、正常退出（9/9 通过）
  - 未实测项（由单测覆盖）：`达成` 完成路径（fake agent 无法输出 yes/no 判定协议）、pending 让位、`/clear`/`/fork`/`/resume` 的 goal 继承语义、`/config` 评估模型面板、pty 真终端下的重绘表现
- [x] 8.5 更新 AGENTS.md 及 docs 中的 slash command 清单，补充 `/goal` 说明
