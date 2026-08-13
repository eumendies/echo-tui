## ADDED Requirements

### Requirement: Runtime debug 事件由单一 Observation 集中投影生成
系统 SHALL 由 `src/observation/observation-projector.ts` 将同一个扁平 Observation 的 app、assistant turn、approval、provider、tool、question 与 compaction 事实投影为 debug 事件。Projector SHALL 保持既有事件名称、字段、发布顺序、文本摘要和敏感信息保护语义，并 SHALL NOT 要求 app、runner、审批组件或 Agent loop 了解 JSONL payload 结构。

#### Scenario: 保持 app debug 事件兼容
- **WHEN** TUI 应用启动、退出、接收用户提交、批量渲染 transcript、执行 resize recovery 或遇到用户配置监听错误
- **THEN** 日志 SHALL 继续在既有事实边界包含 `app_start`、`app_exit`、`user_submit`、`transcript_render_batch`、`resize_recovery` 与 `user_config_watch_error`
- **THEN** 每类事件的既有字段、可选字段与相对发布顺序 SHALL 保持不变

#### Scenario: 保持主 Agent debug 事件兼容
- **WHEN** debug 模式下主 Agent 完成 provider request、tool call 和 provider continuation
- **THEN** 日志 SHALL 继续包含对应的 `provider_request_built`、`provider_usage`、`tool_call_start` 和 `tool_call_end` 事件
- **THEN** 既有 record roles、输入 hash、tool schema hash、tool identity、result status 和文本摘要字段 SHALL 保持可用

#### Scenario: debug 投影不改变 provider 或 transcript
- **WHEN** projector 从 provider records、tool call 或 tool result 生成 debug payload
- **THEN** projector SHALL NOT 修改接收到的领域对象
- **THEN** provider-visible records、tool result 和 transcript 提交顺序 SHALL 保持既有行为

### Requirement: Scope 由事件 input 显式提供
需要稳定关联身份的 debug 事件 SHALL 从事件 input 的 `AppScope`、`AssistantTurnScope` 或 `AgentRunScope` 读取字段。Projector SHALL NOT 依赖分层 observer、运行启动方法或 Agent run 集合查找上下文；Agent 运行级事件 SHALL 使用单次 state 中复用的 AgentRunScope。

AgentRunScope SHALL NOT 携带完整 provider 配置、API key、OAuth credential 或 headers。Provider request debug 映射 SHALL 只读取事件中显式挑选的非敏感 provider 事实。

#### Scenario: Agent 事件复用 scope
- **WHEN** 同一次 Agent 运行发布 provider、tool 与 compaction 事实
- **THEN** debug projector SHALL 从每个事件 input 携带的同一个 AgentRunScope 生成公共字段
- **THEN** 投影结果中的 conversation kind、interaction mode 和子运行身份 SHALL 保持一致

### Requirement: 子 Agent debug 事件具有关联身份
系统 SHALL 为子 Agent 产生的 provider、tool 和 compaction debug 事件记录稳定关联身份。关联字段 SHALL 至少包含子 Agent run id、agent name 和触发该运行的 parent tool call id，且 SHALL NOT 包含完整委派任务文本。

#### Scenario: 关联子 Agent 工具事件
- **WHEN** 子 Agent 在一次委派中执行 tool call
- **THEN** `tool_call_start` 与 `tool_call_end` debug 事件 SHALL 包含相同的子 Agent run id、agent name 和 parent tool call id
- **THEN** 开发者 SHALL 能把该工具事件关联到所属子运行和父 tool call

#### Scenario: 并列子运行保持可区分
- **WHEN** 同一个父 Agent 运行先后或并行启动多个子 Agent 运行
- **THEN** 每个子运行的 debug 事件 SHALL 使用各自稳定的 run id
- **THEN** 系统 SHALL NOT 仅依靠事件顺序推断子运行身份

### Requirement: debug 禁用路径避免专属热路径开销
系统 SHALL 在 debug 未启用时不安装完整 debug projector，并 SHALL 跳过 app、assistant turn 与 Agent 事件的 debug 专属 payload 投影。无 debug 模式 SHALL NOT 为日志目的摘要 user/final text，遍历完整 provider records 或 tool definitions 计算稳定 hash，计算 approval arguments hash，脱敏 provider config，或摘要完整 tool arguments、tool result 与 compaction summary。

#### Scenario: 普通 TUI 启动与提交不计算 debug 摘要
- **WHEN** 用户在未启用 debug 的情况下启动 TUI 并提交输入
- **THEN** app started 与 user submitted 事实 SHALL NOT 触发 debug payload 映射或 user/display text 摘要
- **THEN** 应用启动、输入提交、渲染与 lifecycle hooks SHALL 保持既有行为

#### Scenario: 普通启动不计算 debug hash
- **WHEN** 用户在未启用 debug 的情况下运行一个包含多轮 tool continuation 的 Agent turn
- **THEN** 每轮 provider request SHALL NOT 为 debug 日志计算 provider input、system prompt 或 tool schema hash
- **THEN** Agent turn、context usage、tool execution 和 lifecycle hooks SHALL 保持既有行为

#### Scenario: disabled observation 不执行投影
- **WHEN** debug 与 hooks 均无有效消费者
- **THEN** 组合结果 SHALL 使用 disabled observation 处理事件
- **THEN** disabled observation SHALL NOT 调用摘要、hash、脱敏或 payload mapper

### Requirement: Assistant turn debug 事件由 runtimeKind 兼容投影
系统 SHALL 由集中 debug projector 处理 assistant turn start、end、cancelled、error 以及自动审批诊断事实。Assistant turn runner、审批 resolver 和 reviewer SHALL NOT 直接持有 debug sink 或执行 debug 专属文本摘要与 arguments hash。Projector SHALL 使用 AssistantTurnScope.runtimeKind 保持 TUI 与 headless 的既有事件差异。

#### Scenario: 保持 TUI assistant turn 生命周期日志兼容
- **WHEN** TUI assistant turn 启动并完成、取消或失败
- **THEN** debug 日志 SHALL 保持既有 `assistant_turn_start` 及对应终态事件名称、全部字段、可选字段和发布顺序
- **THEN** lifecycle hook 事件名称、payload 字段与事实时序 SHALL 保持既有行为

#### Scenario: headless 不新增 TUI turn debug
- **WHEN** projector 收到 `runtimeKind: 'headless'` 的 assistant turn 事实
- **THEN** debug 日志 SHALL 保持迁移前 headless 事件集合
- **THEN** projector SHALL NOT 合成迁移前不存在的 TUI assistant-turn debug JSONL

#### Scenario: debug 关闭时跳过 turn 文本摘要
- **WHEN** debug 未启用但 lifecycle hooks 已启用
- **THEN** hook projector SHALL 派发既有 lifecycle hooks
- **THEN** 系统 SHALL NOT 为 debug 日志摘要 user text、final assistant text 或 tool arguments

### Requirement: Headless 使用同一 Observation 且不伪造 TUI 事件
App 外 headless CLI SHALL 直接使用与 TUI 相同的 Observation，并只发布实际发生的 turn 与 Agent 事实。Projector SHALL 通过 `runtimeKind` 保持既有 headless debug/hook 事件集合、字段和顺序，SHALL NOT 为 headless 运行合成 TUI app 进程/UI 事件。

#### Scenario: one-shot 运行不伪造 TUI 事件
- **WHEN** `--once` 启动并完成或失败
- **THEN** 它 SHALL 通过同一 Observation 发布真实 turn 与 Agent 事实
- **THEN** debug 日志 SHALL NOT 因复用 Observation 而新增 `app_start`、`app_exit`、`user_submit`、`transcript_render_batch`、`resize_recovery` 或 `user_config_watch_error`

### Requirement: Debug projector failure 保持旁路隔离
任一 debug projector 的摘要、hash、脱敏、payload 映射或 sink 写入失败 SHALL 在 composite observation 中按消费者隔离，SHALL NOT 阻止同一事实的其它消费者，也 SHALL NOT 改变 app、assistant turn 或 Agent run 的结果。Composite SHALL 对每个事件保持迁移前要求的消费者相对顺序。

#### Scenario: UI 事件投影失败
- **WHEN** `resize_recovery` 或 `transcript_render_batch` 的 debug 投影抛出异常
- **THEN** TUI SHALL 继续执行原始 destructive recovery 或 transcript 渲染
- **THEN** 该失败 SHALL NOT 产生用户可见 transcript error

#### Scenario: 一个消费者失败不阻断另一个消费者
- **WHEN** 同一事实需要 debug 和 hook 投影且其中一个消费者抛出异常
- **THEN** composite SHALL 继续调用另一个消费者
- **THEN** composite SHALL 保持该事件既有的 debug/hook 相对顺序
