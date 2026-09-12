## 1. 并行执行层

- [x] 1.1 `src/types/agent.ts` 的 `SubagentDescriptor` 增加 `executionPolicy`，`src/agent/subagent/runtime.ts` 的 `listDescriptors()` 透出冻结定义的执行策略
- [x] 1.2 `src/tools/tool-concurrency-classifier.ts` 增加可选只读 subagent 名称谓词：`run_subagent` 参数可解析且命中谓词 → `parallel_read`，解析失败/未知名称/general 目标 → `exclusive`；补充分类器单测
- [x] 1.3 `src/agent/loop-runtime/agent-loop-runtime.ts` 从 `subagentPort.listDefinitions()` 构造谓词并传入两处分组调用点；补充 loop 集成测试：两个 readonly 委派并发启动、exclusive 调用屏障、父级取消传播到全部子运行
- [x] 1.4 `src/types/tool.ts` 的 `ToolExecutionOptions` 增加可选 `subagentGroupSize`，主循环在含 ≥2 个 `run_subagent` 的并行段下行分组规模；`src/types/transcript.ts` 的 start event 增加可选 `parallelSize`，`src/agent/subagent/runtime.ts` 写入 start record；补充单委派无标记与并行标记的单测

## 2. 多运行状态层

- [x] 2.1 `src/app/state/subagent-run-context.ts` 改为按 runId 的 `Map` 注册表（含 parallel 标记与 `lastActivityAt`）：交错稳定记录全部接受并落盘、未知 runId 批次仍整体拒绝、终态删除条目；更新 `subagent-run-context` 单测
- [x] 2.2 `markParentCancelled` 改为 Set 记录全部取消运行、`isCurrentRun`/`hasTimedActivity`/`updateActivity` 按 Map 语义更新；补充并行取消与迟到 callback 单测

## 3. 审批 FIFO 排队

- [x] 3.1 `src/app/state/tool-approval-context.ts` 增加待处理队列：存在活跃请求时入队等待，决议后按 FIFO 提升；补充排队、提升、单请求行为不变单测
- [x] 3.2 增加 abort 清算入口：父 turn 中断时活跃与排队请求统一以 interrupted 决议收尾；补充单测

## 4. 主窗口渲染分叉

- [x] 4.1 `src/types/render.ts` 的 `PendingState` 增加 `subagents` 形态，`SubagentRunContext.getPending()` 按并行标记返回 singular/plural；补充状态投影单测
- [x] 4.2 `src/render/blocks.ts` 与 `src/render/footer.ts` 实现 plural 紧凑块：共享标题 + 按 start 顺序每 run 一行 + `… +N more` 折叠 + 会话窗口快捷键提示；补充渲染单测
- [x] 4.3 `src/render/app-renderer.ts` 按 start record `parallelSize` 过滤主投影的子 Agent 记录，并对并行 run 反转外层 pair 的报告折叠（展开正文）；补充 live 追加、快照重绘与重放一致的渲染单测
- [x] 4.4 新建 `src/render/tool-message-renderers/run-subagent.ts`：run_subagent 外层 pair 展开形态（Agent 身份标题 + 任务摘要 + 报告正文前缀，不铺原始 JSON），解析失败回退通用投影，compact 一行终态迁入该模块；补充渲染单测

## 5. Ctrl+O 会话窗口

- [x] 5.1 `src/input/event-types.ts` 增加 `OPEN_SUBAGENT_VIEW`，`src/input/key-parser.ts` 映射 `Ctrl+O`（`\x0f`）
- [x] 5.2 新建 `src/app/subagent-view-controller.ts`（仿 BTW controller）：open/close/switchRun/handleEvent/createRenderState/hasTimedActivity，按 runId 过滤 transcript records 并接入实时 draft；补充状态机与迟到隔离单测
- [x] 5.3 实现窗口 body 渲染：委派任务、内部 tool pair、reasoning、assistant 段复用现有块渲染器 + draft 尾部，标题展示 agent 名/任务/phase/elapsed 与切换序号
- [x] 5.4 `src/app/main.ts` 接线：visibleOwner 三态、输入优先级（modal > view > btw > 主，Esc 关 view 不中断 turn）、resize destructive recovery、activity timer、与 `/btw` 互斥；补充输入路由优先级单测

## 6. 收尾

- [x] 6.1 同步 `docs/tui-architecture.md` 的子 Agent 委派、审批与渲染描述
- [x] 6.2 全量验证：`npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 6.3 手动验收：同轮 3 个 explorer 并行的紧凑块与 Ctrl+O 切换、单 explorer rail 回归、并行审批 FIFO 与浮层、Esc 返回不中断、resize 恢复、/resume 重放后窗口回看
