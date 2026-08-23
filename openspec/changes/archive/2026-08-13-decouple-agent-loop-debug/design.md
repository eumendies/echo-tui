## Context

迁移前，app、assistant turn、工具审批以及主/子 Agent loop 在真实控制流中直接构造 debug/hook payload。进程/UI 事件包括 `app_start`、`app_exit`、`user_submit`、`transcript_render_batch`、`resize_recovery`、`user_config_watch_error`；其余既有事实覆盖 assistant turn、审批、provider、usage、tool、用户问题和 compaction。

这些事实属于同一条运行调用链，但不需要用 observer 对象层级表达。最终架构以 `src/observation/observation.ts` 中一个扁平、具名、强类型的 `Observation` 作为唯一旁路边界，调用点通过事件 input 显式提供对应 scope 和领域事实。`src/observation/observation-projector.ts` 是 debug 与 lifecycle hooks 的集中投影位置。

现有约束包括：

- observation、projector、debug sink 与 hook dispatcher 都是不可拦截旁路；失败不能改变 app、UI、回合或 Agent 状态机。
- debug JSONL 和 lifecycle hook 的既有事件集合、名称、字段、可选字段、脱敏规则及发布顺序必须保持不变。
- provider records、transcript commit、abort、审批、工具执行、用户问题、渲染、终端清理和进程退出顺序属于产品控制流，observation 不拥有控制权。
- lifecycle hooks 的公开 payload、异步排队、reload 和失败隔离契约不能改变。
- usage store 是用户可见产品持久化端口，不并入旁路 observation。
- `--once` 不经过 TUI app 生命周期，只能发布其真实发生的 turn/Agent 事实。

## Goals / Non-Goals

**Goals:**

- 用一个扁平 `Observation` 覆盖 app、assistant turn、approval、provider、tool、question、compaction 与资源关闭的全部已有事件。
- 让调用点只提交已有领域对象或最小事实，不再直接构造 debug/hook payload或执行诊断专属摘要、hash、脱敏。
- 通过对应事件 input 上的 `AppScope`、`AssistantTurnScope`、`AgentRunScope` 保留稳定身份，不建立 observer 父子关系。
- Agent 单次构造运行 state 和 `AgentRunScope`，所有运行级事件复用该 scope。
- 让 TUI 与 headless 使用同一 Observation；headless 只发布真实事件，并通过 `runtimeKind` 保持兼容投影。
- debug disabled 时跳过昂贵投影；composite 中每个消费者独立隔离失败。
- 保留当前 debug/hook 事件、字段、事实边界和相对顺序，以及主、BTW、子 Agent 的已有身份语义。

**Non-Goals:**

- 不建立允许任意字符串事件的全局 EventBus。
- 不建立分层 observer、生命周期启动 API 或 Agent run 注册集合。
- 不让 observation 决定进程退出、UI redraw、tool approval、用户问题回答、abort、continuation 或 usage 持久化。
- 不把 app、turn 或 Agent 状态机封装进黑盒 coordinator。
- 不为 headless 模拟 renderer、terminal、config watcher 或 TUI app/UI 事件。
- 不新增、删除或整理既有 debug/hook 事件，也不借迁移调整字段和顺序。

## Decisions

### 1. 仅保留一个扁平、具名、强类型 Observation

`src/observation/observation.ts` 暴露一个 `Observation` 类型。其方法按事实命名，覆盖现有 app、assistant turn、人工与自动审批、provider request/usage、runtime approval、tool、user question、compaction 和 `close`：

```text
Observation
  appStarted / appExiting / configurationWatchFailed
  resizeRecovered / transcriptBatchRendered / userSubmitted
  assistantTurnStarted / assistantTurnCompleted
  assistantTurnCancelled / assistantTurnFailed
  manualApprovalRequested / manualApprovalCompleted
  toolApprovalReviewed / toolApprovalUsageStoreFailed
  providerRequestBuilt / providerUsage / providerUsageStoreFailed
  toolRiskAssessed / toolApprovalRequested / toolApprovalResolved
  toolStarted / toolCompleted
  userQuestionRequested / userQuestionCompleted
  compactionCompleted
  close
```

这些方法接收强类型 input，不接受任意 `{kind, payload}`。应用、回合、审批和 Agent 调用点都持有同一个 Observation 引用并直接调用事件方法。架构中没有其它 observer 接口、启动 observation 生命周期的方法，也没有 `agentRuns` 容器。

### 2. Scope 是事件 input，不是 observer 层级

`AppScope`、`AssistantTurnScope`、`AgentRunScope` 是普通强类型数据。需要稳定上下文的对应事件把 scope 放在 input 的 `scope` 字段中直接传递；没有父 observer 派生、子 observer 捕获或隐式层级约束。

- `AppScope` 保存 TUI 启动事实所需的稳定 cwd、Node.js version 与 pid。
- `AssistantTurnScope` 保存回合固定的 interaction mode，以及区分 `tui`/`headless` 的 `runtimeKind`。
- `AgentRunScope` 只保存 conversation kind、interaction mode，并在子 Agent 运行时携带 run id、agent name、parent tool call id 等 metadata。

动态事实仍在事件发生时传入，避免错误冻结 terminal size、record count、错误或文本。Provider request 事件另行携带显式白名单挑选的 agent type、model、base URL、context window 和 reasoning 事实；scope 与事件 input 均不接收完整 LLM 配置、原始密钥、OAuth credential 或 headers。

### 3. Agent state 单次构造并复用 AgentRunScope

主、BTW 与子 Agent 在单次运行 state 装配时构造 `AgentRunScope`。Provider、usage、runtime approval、tool、user question 与 compaction 路径均从同一 state 读取并复用它，不逐事件重建，也不维护 run observer。

子 Agent scope 在 `runSubagentLoop` 已获得 `SubagentLoopInput.metadata` 后创建，确保子运行身份完整。主、BTW 与子 Agent 使用同一 Observation 方法及 projector；差异只由 scope 和领域 input 表达。

### 4. App 与 assistant turn 直接发布现有事实

`main.ts` 在原控制流边界直接调用同一个 Observation：

- initial render 前发布 app started；
- 终端清理前发布 app exiting；
- composer submission 路由到 assistant turn 时发布 user submitted；
- 主 transcript 普通 records 批量渲染前发布 transcript batch rendered；
- destructive repaint 前发布 resize recovered；
- config watcher callback 或同步启动异常时发布 configuration watch failed。

Assistant turn runner 在 user record 提交后的既有位置发布 started，并在原完成、取消、失败边界发布终态。主动中断路径复用当前 `AssistantTurnScope` 发布 cancelled。人工审批 resolver 直接发布请求和完成事实；自动 reviewer 发布有界结果及 usage store failure 事实。它们不持有 debug sink，也不计算 debug 专属摘要或 arguments hash。

### 5. Headless 使用相同 Observation 和 runtimeKind 投影

`src/cli/one-shot.ts` 与 TUI 使用同一 Observation，不创建单独的 headless observation 类型或运行根。One-shot 构造 `runtimeKind: 'headless'` 的 `AssistantTurnScope`，只调用实际发生的 assistant turn 与 Agent 事件，不调用 app started/exiting、user submitted、render、resize 或 config watch 事件。

`runtimeKind` 只在 projector 中控制兼容映射。例如既有 headless lifecycle hooks 仍发布，而迁移前不存在的 TUI assistant-turn debug JSONL 不会被合成。Signal abort、异常映射、资源关闭和 stdout 输出仍由 one-shot runner 控制。

### 6. observation-projector.ts 集中 debug 与 hooks

`src/observation/observation-projector.ts` 是生产组合与兼容投影中心：

```text
typed Observation event
  ├─▶ enabled debug observation ─▶ DebugContext.emit
  └─▶ hook observation ──────────▶ LifecycleHookDispatcher
```

Debug observation 负责文本摘要、稳定 hash、非敏感 provider 事实映射、错误 shape 和既有 JSONL 字段映射。Hook observation 只读取公开 hook payload 需要的字段，并继续使用稳定 lifecycle mapper/dispatcher。控制流模块不知道 JSONL 或 hook payload 结构。

### 7. Disabled 路径跳过投影

组合入口只在 `DebugContext.enabled` 时安装完整 debug observation；disabled debug context 不拥有待关闭资源。完全没有消费者时返回 `disabledObservation`。因此事件调用可以传递已有对象引用，但不会执行：

- user/display/final/tool/compaction 文本摘要；
- provider records 稳定序列化和 input hash；
- system prompt、tool schema、approval arguments hash；
- 非敏感 provider 事实的 JSONL payload 映射。

Hook observation 不间接触发 debug 专属工作。Disabled observation 的所有事件均为常数成本 no-op。

### 8. Composite 逐消费者隔离并保持事件顺序

`createCompositeObservation` 把多个完整 Observation 组合为同一接口。每次事件逐消费者调用并捕获同步异常；一个 projector 或 sink 失败不阻止其它消费者，也不回写 transcript 或改变产品控制流。

Composite 只在创建 debug/hook 消费者的组合根出现。App、assistant turn、审批、主 Agent 与子 Agent 控制流直接传递该 Observation，不用 `createCompositeObservation([observation])` 重复包装。

故障隔离不意味着统一重排。大多数事件按组合顺序投影；迁移前要求 hook/debug 反向顺序的 assistant turn 终态和 approval resolved 等事件按逆序投影。每个 observation 事件仍留在原事实完成点，不合并原本位于不同控制流位置的事件。`close` 同样逐消费者隔离。

### 9. 兼容投影保持已有事件与安全语义

Debug/hook projector 必须生成迁移前完全一致的事件名称、字段、可选字段和相对顺序。Provider records、调用 provider、usage 持久化、tool call/result commit、callback、用户问题、compaction notice 与 continuation 的控制流顺序不变。

子 Agent debug 事件继续包含稳定的 run id、agent name 与 parent tool call id，但不泄露完整委派文本。Provider 配置安全规则不得低于当前实现。Scope 是内部投影输入，不自动进入公开 hook payload。

## Risks / Trade-offs

- **[风险] 单一接口膨胀为 telemetry facade** → 方法只覆盖已有、稳定事实，不加入 token/redraw tick 等任意内部事件。
- **[风险] Scope 被误解为生命周期容器** → scope 只是事件 input 数据；设计和类型不提供派生或启动 API。
- **[风险] 重复构造 Agent scope 导致身份漂移** → 在 Agent state 构造时创建一次，运行级事件始终复用。
- **[风险] Composite 派发导致事件顺序变化** → 按事件固定既有正序/逆序，并用兼容测试覆盖。
- **[风险] Headless 复用导致伪造 TUI 事件** → one-shot 只调用真实事件，projector 使用 `runtimeKind` 控制兼容投影。
- **[风险] 故障隔离掩盖 projector 缺陷** → 单测直接断言 projector 完整字段，并单独验证 composite failure isolation。
- **[取舍] 调用点仍有具名 observation 调用** → 这些调用准确标记事实边界，比拥有控制权的 coordinator 或嵌套 observer 更直接。

## Migration Plan

1. 定义扁平 Observation、三类 scope、各事件 input、disabled observation 与 composite failure isolation。
2. 在 `observation-projector.ts` 集中实现 debug/hook observation，固定完整字段、脱敏、runtimeKind 兼容和逐事件顺序。
3. 迁移 app、assistant turn、人工审批与自动 reviewer，使其直接调用同一 Observation。
4. 在 Agent 单次 state 构造时建立并复用 `AgentRunScope`，迁移主、BTW 与子 Agent 的 provider、usage、approval、tool、question、compaction 事实。
5. 让 one-shot 复用同一 Observation，只发布真实 turn/Agent 事件，并以 `runtimeKind: 'headless'` 保持投影兼容。
6. 删除控制流中的 debug/hook payload 构造与跨层 sink 直传；usage store 保持显式端口。
7. 验证全部既有事件名称、字段、可选字段与顺序，验证 disabled 路径不投影，验证任一 composite 消费者失败不改变其它消费者或原流程。
