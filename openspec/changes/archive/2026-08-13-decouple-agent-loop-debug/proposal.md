## Why

`src/app/main.ts`、assistant turn runner、工具审批协调器以及主/子 Agent loop 原本直接依赖或传递 `DebugContext`，并在控制流中构造文本摘要、hash、脱敏配置、debug JSONL payload 和 lifecycle hook payload。这让旁路诊断协议侵入 app、回合与 Agent 状态机，也会在 debug 关闭时留下不必要的投影开销。

最终实现需要以一个简单、统一的观察边界覆盖现有运行事实，同时不引入与实际控制流不匹配的 observer 层级或 run 容器。

## What Changes

- 在 `src/observation/observation.ts` 定义唯一的扁平、具名、强类型 `Observation`，覆盖现有 app、assistant turn、approval、provider、tool、question、compaction 与 `close` 事件。
- 不引入分层 observer、启动方法或 `agentRuns` 集合；调用点直接调用同一个 `Observation` 上的具名事件方法。
- `AppScope`、`AssistantTurnScope` 与 `AgentRunScope` 作为对应事件 input 的 `scope` 字段直接传递，不通过父 observer 派生或隐式捕获。
- Agent 在单次运行 state 构造时创建 `AgentRunScope`，此后 provider、usage、tool、approval、question 与 compaction 事件复用同一 scope。
- TUI 与 headless 直接使用同一 `Observation`。Headless 只调用真实发生的 turn/Agent 事件，不伪造 app/UI 事件；`AssistantTurnScope.runtimeKind` 仅供集中 projector 保持既有 TUI/headless 兼容投影。
- 在 `src/observation/observation-projector.ts` 集中完成 debug 与 lifecycle hook 投影，包括摘要、hash、非敏感 provider 事实映射、JSONL 字段映射和稳定 hook mapper 调用。
- debug 未启用时不安装诊断 projector，disabled observation 不执行投影；调用点只传递已有领域对象或最小事实。
- 仅在组合根使用 composite observation 逐消费者隔离故障，并按事件保留既有正序或逆序派发要求；控制流层直接复用同一 Observation，不增加单元素 composite 包装。
- 保持现有事件集合、名称、字段、可选字段、发布边界与相对顺序；保持 provider、transcript、审批、工具执行、compaction、usage 持久化和 lifecycle hook 对外语义不变。

## Capabilities

### New Capabilities
- `agent-runtime-observation`: 定义单一扁平 Observation、显式 scope 输入、按需投影、主子运行身份和旁路故障隔离。

### Modified Capabilities
- `developer-debug-logging`: 将全部既有 runtime debug/hook payload 映射集中到 observation projector，要求禁用路径跳过诊断投影，并保持事件兼容与旁路语义。

## Impact

- 主要影响 app、assistant turn、审批、主/子 Agent loop、one-shot 组合入口、`src/observation/`、`src/debug/` 与 lifecycle hooks 的依赖装配。
- lifecycle hooks 保留现有公开事件、payload、排队和失败隔离契约；usage store 仍是显式产品持久化端口。
- TUI 和 `--once` 共享同一 Observation 类型及 projector；headless 通过 `runtimeKind` 保持既有投影，不模拟 TUI 生命周期。
- 不改变用户 CLI、provider adapter、tool handler、transcript 协议或持久化格式。
- 测试覆盖事件字段与顺序兼容、scope 复用、headless 投影、禁用路径零昂贵投影和 composite 消费者故障隔离。
