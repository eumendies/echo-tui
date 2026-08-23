# developer-debug-logging Specification

## Purpose
定义 `echo_tui` 开发者 debug 模式的启用方式、结构化日志、短提示、旁路隔离和敏感信息保护要求，帮助开发者调试 assistant turn、provider 请求、工具执行和压缩流程，同时保持普通用户启动体验不变。
## Requirements
### Requirement: 开发者 debug 模式启用
系统 SHALL 支持一个默认关闭的开发者 debug 模式。该模式 SHALL 只能通过开发者启动路径或显式 debug 环境变量启用，普通用户安装后的 `echo-tui` 启动 SHALL NOT 默认启用 debug。

#### Scenario: 默认启动不启用 debug
- **WHEN** 用户或开发者在没有设置 debug 环境变量的情况下启动 TUI
- **THEN** 系统 SHALL 不创建 debug 日志 writer
- **THEN** 系统 SHALL 不写入 debug 日志文件
- **THEN** 系统 SHALL 保持既有 transcript、provider request、tool execution 和渲染行为

#### Scenario: debug 环境变量启用 debug
- **WHEN** 进程启动时存在有效 debug 环境变量
- **THEN** 系统 SHALL 创建 debug 日志上下文
- **THEN** 系统 SHALL 为本次进程生成或解析 debug 日志路径
- **THEN** 后续关键流程事件 SHALL 写入该 debug 日志

#### Scenario: 用户 CLI 帮助不暴露 debug 参数
- **WHEN** 用户运行 `echo-tui --help`
- **THEN** 帮助内容 SHALL NOT 要求列出 debug 模式参数
- **THEN** 系统 SHALL 继续只展示普通用户需要的 CLI 用法

### Requirement: debug 日志旁路隔离
Debug 日志 SHALL 作为内部旁路观察数据写入文件。Debug 写入 SHALL NOT 修改 transcript、provider 输入、tool approval 决策、tool execution 决策、tool result、compaction 状态、session persistence 或 lifecycle hook 语义。

#### Scenario: debug 事件不进入 transcript
- **WHEN** debug 模式记录 assistant turn 或 tool call 事件
- **THEN** 系统 SHALL NOT 将 debug 事件追加为 user、assistant、system、tool_call、tool_result、local_notice 或 error transcript record
- **THEN** `/resume` 加载的 session SHALL NOT 包含 debug 事件记录

#### Scenario: debug 事件不进入 provider 请求
- **WHEN** 系统构造 provider request
- **THEN** debug 日志内容 SHALL NOT 被加入 provider-visible records
- **THEN** debug 模式 SHALL NOT 改变 system prompt、tool schema、transcript 活跃区间或 plan mode transient suffix

#### Scenario: debug 写入失败不阻断主流程
- **WHEN** debug 日志文件创建、打开或写入失败
- **THEN** 系统 SHALL 继续执行 TUI 主流程
- **THEN** 系统 SHALL NOT 因 debug 写入失败中断 assistant turn、tool execution 或 compaction

### Requirement: debug 结构化事件日志
系统 SHALL 在 debug 模式下写入结构化 JSONL 日志。每一行 SHALL 表示一个事件，并包含 timestamp、递增序号、事件名和事件相关元数据。系统 SHALL 避免在热路径上记录 token 级或 redraw 级高频事件。

#### Scenario: 写入启动事件
- **WHEN** debug 模式启动成功
- **THEN** debug 日志 SHALL 包含 app 启动事件
- **THEN** 事件 SHALL 包含 cwd、Node.js 版本、进程 id 和日志路径等运行时摘要

#### Scenario: 写入 assistant turn 生命周期事件
- **WHEN** 用户提交普通消息并触发 assistant turn
- **THEN** debug 日志 SHALL 记录 assistant turn start 事件
- **WHEN** assistant turn 完成、失败或被取消
- **THEN** debug 日志 SHALL 记录对应的完成、失败或取消事件

#### Scenario: 写入 provider request 摘要
- **WHEN** agent loop runtime 完成 provider-visible records 构造
- **THEN** debug 日志 SHALL 记录 provider request 摘要事件
- **THEN** 事件 SHALL 包含 interaction mode、record 数量、record role 序列、关键输入 hash、tool schema hash 和 compaction 边界摘要
- **THEN** 事件 SHALL NOT 默认包含完整 system prompt、完整用户消息或完整 tool result 文本

#### Scenario: 写入 tool 和 compaction 事件
- **WHEN** 系统准备处理 tool call
- **THEN** debug 日志 SHALL 记录 tool call start 摘要
- **WHEN** tool call 产生结果、拒绝结果或交互式工具结果
- **THEN** debug 日志 SHALL 记录 tool call end 摘要
- **WHEN** 系统完成自动 compaction
- **THEN** debug 日志 SHALL 记录 compaction end 摘要

### Requirement: debug 敏感信息保护
系统 SHALL 对 debug 日志 payload 做敏感信息保护。Debug 日志 SHALL NOT 记录 LLM provider API key、headers、完整 provider client 配置或未截断的大段用户/工具内容。

#### Scenario: provider 配置被脱敏
- **WHEN** debug 日志记录 provider 或模型配置摘要
- **THEN** 日志 SHALL NOT 包含 apiKey
- **THEN** 日志 SHALL NOT 包含 headers 明文
- **THEN** 日志 MAY 包含 provider 类型、model id 和 context window 等非密钥摘要

#### Scenario: 文本内容默认摘要化
- **WHEN** debug 日志记录用户消息、assistant 输出、tool arguments 或 tool result 相关事件
- **THEN** 日志 SHALL 默认记录长度、hash、角色和状态等摘要
- **THEN** 日志 SHALL NOT 默认记录完整文本内容

### Requirement: debug 短提示
系统 SHALL 在 debug 模式启用时显示一个短提示，告知开发者 debug 已启用及日志路径。该提示 SHALL NOT 要求新增 footer 布局、状态栏字段、渲染 block 类型或改变现有 transcript 渲染规则。

#### Scenario: debug 启用后显示短提示
- **WHEN** TUI 在 debug 模式下启动
- **THEN** 系统 SHALL 显示一个短提示说明 debug 已启用
- **THEN** 提示 SHALL 包含或指向 debug 日志路径

#### Scenario: 非 debug 模式不显示提示
- **WHEN** TUI 在非 debug 模式下启动
- **THEN** 系统 SHALL NOT 显示 debug 启用提示
- **THEN** 普通启动 banner、footer 和 transcript 展示 SHALL 保持既有行为

### Requirement: 自动审批脱敏性能观测
系统 SHALL 在 debug 模式下为每次进入自动审批路径的 approval-required 调用记录有界结构化摘要，用于观察审批输入规模、provider 时延、上下文形态、动作投影类型和回退原因。事件 SHALL NOT 包含用户消息、前序 exchange、澄清答案、pending action、tool arguments 或 reviewer 响应的原始文本，并 SHALL NOT 因 debug 写入失败改变审批决策或执行流程。

#### Scenario: 记录成功审批的规模与时延
- **WHEN** 自动 reviewer 返回可解析的 `yes` 或 `no`
- **THEN** debug 事件 SHALL 包含 tool name、model、结果、latency milliseconds、prompt character count、action character count 和 arguments hash
- **THEN** 事件 SHALL 包含是否使用前序 exchange、是否包含可信澄清答案以及动作投影为 exact 或 summarized 的枚举摘要

#### Scenario: 记录未调用 reviewer 的超限回退
- **WHEN** pending action 因无法安全有界投影而直接回退人工审批
- **THEN** debug 事件 SHALL 把结果或回退原因记录为 `manual_only` 或等价稳定枚举
- **THEN** 事件 SHALL NOT 包含导致超限的原始参数

#### Scenario: 区分 timeout 和 provider error
- **WHEN** 自动审批因独立 deadline 到期或 provider/config 错误回退人工
- **THEN** debug 事件 SHALL 使用不同的 `timeout` 和 `error` 稳定结果
- **THEN** error 事件 MAY 包含错误类型名称但 SHALL NOT 包含可能携带凭据或内容的完整错误消息

#### Scenario: Debug 关闭不增加持久化内容
- **WHEN** debug 模式未启用
- **THEN** 系统 SHALL NOT 写入自动审批观测事件
- **THEN** 审批 prompt、响应和性能元数据 SHALL NOT 进入 transcript 或 session journal

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
