## ADDED Requirements

### Requirement: Runtime 使用单一扁平类型化观察边界
系统 SHALL 在 `src/observation/observation.ts` 中定义一个扁平、具名、强类型的 `Observation`，覆盖全部已有 app、assistant turn、approval、provider、tool、question、compaction 与 `close` 事实。App、runner、审批组件与 Agent loop SHALL 直接调用同一个 Observation 上的对应方法并传递已有领域对象或最小运行事实，SHALL NOT 构造 debug JSONL 或 lifecycle hook 专属 payload。

#### Scenario: app 发布应用事实
- **WHEN** TUI 应用启动、退出、接收用户提交、批量渲染 transcript、执行 resize recovery 或遇到用户配置监听错误
- **THEN** `main.ts` SHALL 直接调用同一 Observation 上对应的具名事件方法
- **THEN** `main.ts` SHALL NOT 构造 debug 专属 payload、文本摘要或 record role 投影

#### Scenario: runner 发布 assistant turn 事实
- **WHEN** assistant turn 启动、完成、取消或失败
- **THEN** runner SHALL 直接调用同一 Observation 上对应的回合事件方法
- **THEN** runner SHALL NOT 构造 debug 或 lifecycle hook 专属 payload

#### Scenario: loop 发布工具与用户问题事实
- **WHEN** Agent loop 开始或完成 tool call，或者请求并完成用户问题
- **THEN** loop SHALL 通过同一 Observation 发布对应事实
- **THEN** loop SHALL 传递已有 ToolCall、ToolExecutionResult 或问题请求，而不是消费者专属 payload

#### Scenario: loop 发布 provider 请求事实
- **WHEN** Agent loop 完成本轮 provider records 构造
- **THEN** loop SHALL 通过同一 Observation 发布 provider request built 事实
- **THEN** record role、输入 hash、system prompt hash、tool schema hash 和脱敏配置 SHALL 由集中投影层生成

### Requirement: Observation 不建立运行层级 API
系统 SHALL NOT 为 app、assistant turn 或 Agent run 定义分层 observer、启动方法或 `agentRuns` 集合。`AppScope`、`AssistantTurnScope` 与 `AgentRunScope` SHALL 作为对应事件 input 的字段直接传递，SHALL NOT 通过父子 observer 派生或隐式捕获。

#### Scenario: TUI 传递 app 与 turn scope
- **WHEN** TUI 发布 app started 或 assistant turn 生命周期事实
- **THEN** 调用点 SHALL 在事件 input 中直接提供对应的 AppScope 或 AssistantTurnScope
- **THEN** 调用点 SHALL NOT 为发布事实而创建额外 observer 或启动 observation 生命周期

#### Scenario: Agent 传递运行 scope
- **WHEN** 主、BTW 或子 Agent 发布 provider、usage、approval、tool、question 或 compaction 事实
- **THEN** 每个事件 input SHALL 直接携带该次运行的 AgentRunScope
- **THEN** Observation SHALL NOT 查询或维护 Agent run 注册集合
- **THEN** AgentRunScope SHALL NOT 携带完整 provider 配置、API key、OAuth credential 或 headers

### Requirement: Agent 单次 state 构造并复用运行 scope
系统 SHALL 在每次 Agent 运行 state 构造时创建一个 `AgentRunScope`，并在该次运行的全部运行级 Observation 事件中复用它。Scope SHALL 区分主运行、BTW 运行与子 Agent 运行；子 Agent scope SHALL 包含稳定的 run id、agent name 和 parent tool call id。

#### Scenario: 主运行复用公共 scope
- **WHEN** 主 Agent 或 BTW Agent 在同一次运行中发布 provider、tool 与 compaction 事实
- **THEN** 这些事件 SHALL 复用 state 中同一个 AgentRunScope
- **THEN** loop SHALL NOT 为每个事实重复构造 conversation kind 或 interaction mode

#### Scenario: 子 Agent scope 在身份完整后构造
- **WHEN** `runSubagentLoop` 已获得 SubagentLoopInput metadata
- **THEN** 系统 SHALL 构造一次包含子运行身份的 AgentRunScope 并存入该次运行 state
- **THEN** provider、tool 与 compaction 投影 SHALL 能关联相同的 run id、agent name 和 parent tool call id

#### Scenario: Provider 诊断事实使用白名单输入
- **WHEN** 主或子 Agent 发布 provider request 事实
- **THEN** 事件 SHALL 只携带显式挑选的 agent type、model、base URL、context window 与 reasoning 配置
- **THEN** 事件和 scope SHALL NOT 接收完整 LLM 配置、API key、OAuth credential 或 headers

### Requirement: Headless 直接复用同一 Observation
App 外 headless CLI SHALL 使用与 TUI 相同的 Observation。Headless SHALL 只调用实际发生的 assistant turn 与 Agent 事件，SHALL NOT 伪造 app 启停、用户提交、render、resize 或 config watcher 事实；AssistantTurnScope 的 `runtimeKind` SHALL 供 projector 控制既有 TUI/headless 兼容映射。

#### Scenario: one-shot 发布真实事实
- **WHEN** `--once` 启动并完成、取消或失败
- **THEN** 它 SHALL 使用 `runtimeKind: 'headless'` 的 AssistantTurnScope 调用同一 Observation
- **THEN** 它 SHALL NOT 因复用 Observation 而调用 TUI app/UI 事件

#### Scenario: runtimeKind 控制兼容投影
- **WHEN** projector 收到 headless assistant turn 事实
- **THEN** projector SHALL 保持迁移前 headless debug/hook 事件集合与字段
- **THEN** projector SHALL NOT 合成迁移前仅属于 TUI 的 assistant-turn debug 事件

### Requirement: 观察投影集中且按需执行
系统 SHALL 在 `src/observation/observation-projector.ts` 中集中生成 debug 与 lifecycle hook 投影。未启用对应消费者时，系统 SHALL NOT 执行仅供该消费者使用的昂贵工作，包括 user/final text 摘要、完整 provider records 稳定序列化、provider input hash、system prompt hash、tool schema hash、approval arguments hash、provider 配置脱敏和大文本摘要。

#### Scenario: debug 关闭时跳过 app 与 turn 摘要
- **WHEN** debug 未启用但 app 或 lifecycle hooks 仍在运行
- **THEN** Observation SHALL NOT 为 `user_submit` 或 assistant turn 事件计算 debug 专属文本摘要
- **THEN** 用户提交、hook 派发与 assistant turn 结果 SHALL 保持不变

#### Scenario: debug 关闭时跳过 provider 诊断投影
- **WHEN** debug 未启用且没有其它消费者请求 provider 诊断摘要
- **THEN** Agent runtime SHALL NOT 为 Observation 计算 provider input、system prompt 或 tool schema hash
- **THEN** provider 请求内容和执行结果 SHALL 与启用 debug 时保持一致

#### Scenario: debug 开启时生成兼容投影
- **WHEN** debug 已启用并收到 provider request built 事实
- **THEN** debug projector SHALL 从事件 input 生成既有 provider request 摘要字段
- **THEN** projector SHALL NOT 修改传给 provider 的 records 或 tool definitions

### Requirement: Composite 故障不改变运行结果
Observation SHALL 是不可拦截的旁路能力。Composite observation SHALL 对每次事件逐消费者隔离同步异常、写入失败或 payload 投影失败，SHALL NOT 改变 app 启停与退出清理、UI 渲染、用户提交、provider continuation、transcript 提交、tool approval、tool execution、用户问题、compaction 或 Agent 返回结果。

Composite observation SHALL 只在多个 projector 的组合边界创建。App、assistant turn、审批和 Agent runtime SHALL 直接复用注入的 Observation，SHALL NOT 用单元素 composite 重复包装。

#### Scenario: app projector 抛出异常
- **WHEN** debug projector 在处理 transcript batch rendered 或 app exiting 事实时抛出异常
- **THEN** TUI SHALL 继续完成原始渲染或退出清理
- **THEN** 其它 Observation 消费者 SHALL 仍可接收同一事实

#### Scenario: tool projector 抛出异常
- **WHEN** debug projector 在处理 tool completed 事实时抛出异常
- **THEN** Agent loop SHALL 继续提交原始 tool result 并执行后续 continuation
- **THEN** 系统 SHALL NOT 因该异常追加 transcript error record

#### Scenario: disabled observation 跳过投影
- **WHEN** Observation 没有启用的 debug 或 hook 消费者
- **THEN** disabled observation SHALL 对全部事件执行常数成本 no-op
- **THEN** 系统 SHALL NOT 分配或计算消费者专属 payload

### Requirement: 主子 loop 共享观察语义
主 Agent 与子 Agent loop SHALL 对共同的 provider、tool、question 和 compaction 生命周期使用同一组 Observation 方法及投影规则。运行身份或执行策略差异 SHALL 通过 AgentRunScope 或领域 input 表达，SHALL NOT 通过复制消费者 payload 构造逻辑表达。

Hook projector SHALL 将 AgentRunScope 的 `conversationKind` 投影到运行级 lifecycle payload；子 Agent payload SHALL 额外投影 `agentName`，但 SHALL NOT 投影内部 `runId` 或 `parentToolCallId`。

#### Scenario: 主子运行记录同类工具事件
- **WHEN** 主 Agent 与子 Agent 分别完成一次 tool call
- **THEN** 两者 SHALL 调用相同的 tool started 和 tool completed 方法
- **THEN** debug projector SHALL 生成一致的公共字段，并通过 scope 区分事件来源

### Requirement: 工具审批通过同一 Observation 发布
交互式人工审批、自动审批 reviewer 与 Agent runtime 审批 SHALL 通过同一个 Observation 的对应具名方法发布。Resolver、reviewer 与 loop SHALL NOT 直接依赖 debug writer 或计算 debug 专属 arguments hash。

#### Scenario: 人工审批 lifecycle 事件
- **WHEN** assistant turn 打开人工审批 surface 并得到用户决策
- **THEN** resolver SHALL 使用 AssistantTurnScope 发布审批请求与审批结果事实
- **THEN** hook projector SHALL 保持既有 request/response payload 和时序

#### Scenario: 自动审批诊断
- **WHEN**自动审批 reviewer 成功、失败、超时或因动作投影超限回退人工
- **THEN** reviewer SHALL 发布有界审批结果事实
- **THEN** debug projector SHALL 负责 arguments hash 和既有脱敏 JSONL payload

#### Scenario: Agent runtime 审批
- **WHEN** Agent loop 发布风险评估、审批请求或审批结果
- **THEN** 对应事件 SHALL 直接携带复用的 AgentRunScope
- **THEN** debug 与 hook projector SHALL 保持既有事件字段及相对顺序

### Requirement: 观测迁移保持事实边界与发布顺序
系统 SHALL 将全部 Observation 调用放置在迁移前对应 debug/hook 调用的事实边界，并 SHALL 保持既有事件集合、字段与发布顺序。Composite SHALL 支持按事件选择既有消费者正序或逆序，SHALL NOT 假定全部事件使用一个固定派发顺序。Observation SHALL NOT 接管控制流、UI 状态、transcript commit、审批决策、abort 或资源清理。

#### Scenario: app 事件保持原有事实顺序
- **WHEN** app 启动、渲染、resize、配置监听失败或退出
- **THEN** 对应 Observation 调用 SHALL 位于原 debug 事件所处的控制流边界
- **THEN** projector failure SHALL NOT提前、延后或跳过原始 UI 与资源操作

#### Scenario: turn 与 Agent 事件保持原有顺序
- **WHEN** 同一 assistant turn 发布 lifecycle、approval、provider、tool、question 与 compaction 事实
- **THEN** debug 与 lifecycle hook projector SHALL 分别维持迁移前各自的事件字段和相对顺序
- **THEN** composite SHALL 对要求反向消费者顺序的终态或审批事件使用其既有顺序
