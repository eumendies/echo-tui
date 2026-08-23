## 1. 建立运行时观察边界

- [x] 1.1 定义带中文字段注释的单一扁平、具名、强类型 Observation、AppScope、AssistantTurnScope、AgentRunScope 与各事件 input，覆盖 app、assistant turn、approval、provider、tool、question、compaction 和 close 全部已有事实
- [x] 1.2 实现 disabled/composite Observation 与逐消费者同步异常隔离，确保旁路失败不影响其它消费者和产品主流程
- [x] 1.3 为显式 scope input、语义方法转发、消费者隔离和 disabled 行为添加单元测试

## 2. 实现 debug 与 hook 投影

- [x] 2.1 在 `src/observation/observation-projector.ts` 实现集中 debug projector，将全部已有 app/turn/Agent 事件的 hash、文本摘要、provider 配置脱敏和 JSONL payload 映射移出控制流
- [x] 2.2 在同一文件实现 lifecycle hook projector，复用现有稳定 payload mapper 和 dispatcher，覆盖 assistant turn、approval、tool、compaction 与用户问题事件且不改变公开 hook 语义
- [x] 2.3 添加 projector 测试，验证既有 debug/hook 事件名和主要字段、敏感信息保护、显式 scope、runtimeKind 兼容、子 Agent 关联身份及消费者相互隔离
- [x] 2.4 添加 debug 禁用路径测试，验证 provider records、system prompt、tool definitions 和大文本不会执行 debug 专属 hash 或摘要投影

## 3. 迁移主 Agent loop

- [x] 3.1 在单次主/BTW run state 装配完成后构造并复用 AgentRunScope，用同一 Observation 的语义方法替换 provider request、usage、tool start/end 和 compaction 的 debug/hook payload 构造
- [x] 3.2 将 tool risk、approval 和 usage store failure 改为发布最小领域事实，删除主 loop 对 DebugContext、hash、summary 与 provider 配置脱敏 helper 的直接依赖
- [x] 3.3 更新主 loop 测试，确认 debug 事件顺序和主要字段兼容，且 provider records、transcript commit、审批、工具执行与 continuation 行为不变

## 4. 迁移子 Agent loop

- [x] 4.1 在 `runSubagentLoop` 内结合 provider 元数据和 `SubagentLoopInput.metadata` 单次构造子运行 state 与 AgentRunScope，并复用主 loop 的 provider、tool 与 compaction 观察语义
- [x] 4.2 删除子 loop 中重复的 debug/hook payload 构造和 DebugContext/helper 依赖，同时保持子 Agent tool policy、人工审批、用户问题和 transcript 时序不变
- [x] 4.3 添加子 Agent 观测测试，验证 run id、agent name、parent tool call id 在 provider、tool 和 compaction debug 事件中稳定关联，并能区分多个子运行

## 5. 组合入口与回归验证

- [x] 5.1 在 TUI 和 one-shot 组合入口创建同一种真实 Observation，并调整主/子 runtime 工厂装配；usage store 继续作为显式产品持久化端口
- [x] 5.2 清理不再使用的 loop debug helper、重复投影函数和位置参数，确认 Agent runtime 生产入口只保留真实运行边界且未引入测试专用依赖集合
- [x] 5.3 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复所有回归并记录交互式 TUI 验证项由用户执行

## 6. 扩展单一 Observation 的事件覆盖

- [x] 6.1 将全部已有事实收敛到 `src/observation/observation.ts` 中唯一的扁平 Observation；不引入其它 observer 类型、启动方法或 `agentRuns` 集合
- [x] 6.2 在同一 Observation 增加 app 事件，覆盖 `app_start`、`app_exit`、`user_submit`、`transcript_render_batch`、`resize_recovery`、`user_config_watch_error` 的最小领域事实
- [x] 6.3 在同一 Observation 增加 assistant turn 事件，覆盖回合 start/end/cancel/error、交互式人工审批与自动审批 reviewer 事实
- [x] 6.4 让 app 外 one-shot 直接使用同一 Observation，只调用真实 turn/Agent 事件，并通过 AssistantTurnScope.runtimeKind 控制兼容投影而不合成 TUI app/UI 事件
- [x] 6.5 扩展 disabled/composite Observation，逐消费者隔离全部事件 projector failure，并支持按事件保持既有 debug/hook 派发顺序

## 7. 扩展集中 projector

- [x] 7.1 在 `observation-projector.ts` 实现 app debug 投影，逐事件保持六类现有进程/UI debug 事件的名称、完整字段、可选字段、脱敏与发布顺序
- [x] 7.2 在同一文件扩展 turn debug/hook 投影，保持 assistant turn 生命周期、人工审批与自动审批事件的名称、完整字段及原事实顺序
- [x] 7.3 确保 debug disabled 时全部事件均不执行 user/final/tool 文本摘要、provider records 稳定 hash、system/tool/approval hash 或 provider 配置脱敏
- [x] 7.4 添加 projector 与 composite 测试，覆盖显式 AppScope/AssistantTurnScope/AgentRunScope、runtimeKind 兼容、完整事件兼容、不同消费者顺序及任一消费者失败不阻断其它消费者

## 8. 迁移应用、回合与组合入口

- [x] 8.1 在 `src/app/main.ts` 直接使用同一 Observation，并在原控制流边界迁移六类进程/UI 事件；删除 main 对这些事件的直接 debug payload、summary 与 roles 投影
- [x] 8.2 迁移 assistant turn runner、主动中断路径、工具审批 resolver/reviewer 直接调用同一 Observation 并传递 AssistantTurnScope，删除其 DebugContext、hash、summary 与直接 hook payload 依赖
- [x] 8.3 在主/BTW/子 Agent 单次 state 构造时建立并复用 AgentRunScope，保持现有 provider、transcript、tool、approval、question、compaction、usage 与主子关联语义
- [x] 8.4 调整 one-shot 直接使用同一 Observation 和 `runtimeKind: 'headless'` 的 AssistantTurnScope，保持现有 headless lifecycle 字段和顺序，并验证不产生 TUI app/UI 事件
- [x] 8.5 清理组合入口中跨层 debug/hooks 直传与旧 observation adapter，usage store 继续作为显式产品持久化端口
- [x] 8.6 删除 disabled debug 资源 observation 死代码和控制流中的单元素 composite 包装，仅在 debug/hook 组合根隔离消费者
- [x] 8.7 从 AgentRunScope 移除完整 provider 配置，provider request 事件仅携带显式白名单的非敏感配置事实

## 9. 完整回归验证

- [x] 9.1 更新 app runtime、assistant turn、审批、主/子 Agent 与 headless 测试，逐项断言现有事件名称、完整字段、可选字段和发布顺序
- [x] 9.2 添加 failure isolation 回归，覆盖 app exit/渲染/resize、turn lifecycle/审批与 Agent projector 抛错时原始控制流和其它消费者不受影响
- [x] 9.3 添加 debug disabled 回归，使用可观测 seam 证明集中 projector 跳过 summary/hash/脱敏，同时 hook、UI、turn 与 Agent 行为保持不变
- [x] 9.4 重新运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`，交互式 TUI 验证仍由用户执行
