# lifecycle-hooks Specification

## Purpose
定义 `echo_tui` lifecycle hooks 能力的外部行为，包括用户级 hooks 配置、不可拦截的旁路观察者语义、assistant/tool/compaction 事件派发、结构化 payload 传递，以及 hook 执行隔离，方便用户在 TUI 生命周期事件上运行本地自动化而不影响主对话流程。
## Requirements
### Requirement: 用户级 lifecycle hooks 配置
系统 SHALL 支持从用户级配置读取可选 lifecycle hooks 配置。配置 SHALL 允许用户按事件名配置一个或多个本地 hook 命令。Hook entry SHALL 支持字符串 shorthand 和对象格式；对象格式 SHALL 支持 command、timeoutMs 和可选 enabled 字段。未配置 hooks、hooks 配置缺失、单个 hook entry 无效或 hook entry 被 disabled 时，系统 SHALL 保持现有 assistant、tool、compaction 和 TUI 行为不变。

#### Scenario: 未配置 hooks 时行为不变
- **WHEN** 用户级配置中不存在 `hooks` 节点
- **THEN** 系统 SHALL 不创建可执行 hook job
- **THEN** 普通 assistant turn、tool execution、compaction、transcript persistence 和 TUI rendering SHALL 保持既有行为

#### Scenario: 读取有效 hook 配置
- **WHEN** 用户级配置中为 `assistant_turn_end` 配置了一个有效本地命令
- **THEN** 系统 SHALL 在 `assistant_turn_end` 事件发生时 enqueue 对应 hook job
- **THEN** 系统 SHALL 使用当前工作目录作为 hook job 的工作目录

#### Scenario: 读取对象格式 hook 配置
- **WHEN** 用户级配置中某个 hook entry 使用对象格式并包含有效 command 与 timeoutMs
- **THEN** 系统 SHALL 将该 entry 作为可执行 hook entry 读取
- **THEN** 未设置 enabled 字段的对象 entry SHALL 被视为 enabled

#### Scenario: disabled hook entry 不执行
- **WHEN** 用户级配置中某个 hook entry 设置 `enabled` 为 `false`
- **THEN** 系统 SHALL 保留该配置用于管理视图读取
- **THEN** lifecycle hook dispatcher SHALL NOT 为该 disabled entry 创建可执行 hook job
- **THEN** 普通 assistant turn、tool execution、compaction、transcript persistence 和 TUI rendering SHALL 保持既有行为

#### Scenario: 忽略无效 hook entry
- **WHEN** 用户级配置中的某个 hook entry 缺少可执行命令、事件名未知或字段类型无效
- **THEN** 系统 SHALL 忽略该 hook entry
- **THEN** 系统 SHALL NOT 因该无效 hook entry 阻止 CLI 启动或 assistant turn 执行
- **THEN** 系统 SHALL NOT 为该配置错误追加 transcript record

### Requirement: lifecycle hooks 配置草稿和诊断
系统 SHALL 提供面向管理命令的 hooks 配置草稿读取能力。草稿读取 SHALL 保留可管理的 hook entries、enabled 状态、entry 顺序和配置诊断；该能力 SHALL NOT 改变 runtime hook 执行语义。

#### Scenario: 读取管理草稿
- **WHEN** 管理命令读取 hooks 配置草稿
- **THEN** 系统 SHALL 从用户级配置的 `hooks` 节点读取所有支持 event 的 hook entries
- **THEN** 系统 SHALL 保留每个有效 entry 的 command、timeoutMs、enabled 状态和原始顺序
- **THEN** 系统 SHALL 将字符串 shorthand 归一化为 enabled 草稿 entry

#### Scenario: 读取配置诊断
- **WHEN** 用户级 hooks 配置包含未知 event、无效 entry、空 command 或非法 timeoutMs
- **THEN** 管理草稿 SHALL 包含对应配置诊断摘要
- **THEN** runtime hooks SHALL 继续忽略无效配置
- **THEN** 系统 SHALL NOT 因读取诊断追加 transcript record

#### Scenario: 保存管理草稿
- **WHEN** 管理命令保存 hooks 配置草稿
- **THEN** 系统 SHALL 只替换用户级配置的 `hooks` 节点
- **THEN** 系统 SHALL 保留用户级配置中的 llm、mcp、theme 或其它 root 节点
- **THEN** 保存后的 disabled entries SHALL 使用对象格式保留 enabled 状态

### Requirement: lifecycle hook dispatcher 支持配置 reload
系统 SHALL 支持在当前 TUI 进程中更新 lifecycle hook dispatcher 的运行配置。配置 reload SHALL 影响后续 lifecycle event 的 hook job 入队，不得修改已经入队或正在运行的 hook job。

#### Scenario: reload 后使用新配置
- **WHEN** hooks 配置被保存并 reload 到 dispatcher
- **THEN** 后续 lifecycle hook event SHALL 使用 reload 后的 enabled hook entries
- **THEN** disabled entries SHALL NOT 在后续 lifecycle hook event 中入队执行

#### Scenario: reload 不影响已入队任务
- **WHEN** lifecycle hook dispatcher 已经存在排队或运行中的 hook job
- **AND** hooks 配置在该 job 完成前被 reload
- **THEN** 已入队或正在运行的 hook job MAY 继续使用入队时的 command、timeoutMs 和 payload
- **THEN** reload SHALL NOT 尝试终止或重写正在运行的 hook 子进程

#### Scenario: reload 失败不破坏现有配置
- **WHEN** hooks 配置保存或 reload 失败
- **THEN** lifecycle hook dispatcher SHALL 保持最后一次成功加载的运行配置
- **THEN** 系统 SHALL NOT 将 reload 失败追加为 transcript record

### Requirement: lifecycle hook synthetic test 执行入口
系统 SHALL 提供受控的 hook synthetic test 执行入口，用于验证单条 hook command 在 lifecycle hook 执行契约下是否可运行。Synthetic test SHALL 使用测试 payload，不得触发真实 lifecycle event 或改变 transcript、session、provider request、tool result、tool approval 或 compaction 状态。

#### Scenario: synthetic test 使用 hook 执行契约
- **WHEN** 系统执行某条 hook entry 的 synthetic test
- **THEN** 系统 SHALL 使用指定 cwd 作为测试进程工作目录
- **THEN** 系统 SHALL 设置 `ECHO_HOOK_EVENT` 和 `ECHO_HOOK_CWD` 环境变量
- **THEN** 系统 SHALL 将 synthetic payload JSON 写入测试进程 stdin
- **THEN** 系统 SHALL 对测试进程应用该 entry 的 timeoutMs

#### Scenario: synthetic payload 字段
- **WHEN** 系统为某个 lifecycle event 构造 synthetic payload
- **THEN** payload SHALL 包含 event、timestamp 和 cwd
- **THEN** assistant turn events 的 payload SHALL 包含 interaction mode 和测试 status
- **THEN** tool call events 的 payload SHALL 包含测试 tool call id、tool name，并按 event 类型包含 arguments text 或 ok 状态
- **THEN** compaction event 的 payload SHALL 包含测试 activeStartIndex 和 createdAt

#### Scenario: synthetic test 捕获 bounded 输出
- **WHEN** synthetic test 进程产生 stdout 或 stderr
- **THEN** 测试执行入口 MAY 捕获 bounded stdout 和 stderr 供调用方做短状态映射
- **THEN** 捕获输出 SHALL 被截断到实现定义的安全上限
- **THEN** 捕获输出 SHALL NOT 被追加到 transcript、session 或 provider request

#### Scenario: synthetic test 失败隔离
- **WHEN** synthetic test 进程启动失败、返回非零退出码或超时
- **THEN** 测试执行入口 SHALL 返回失败、exit code 或 timeout 结果
- **THEN** 系统 SHALL NOT 因测试失败中断当前 assistant turn、tool execution 或 compaction 流程
- **THEN** 系统 SHALL NOT 因测试失败追加 error transcript record

### Requirement: hooks 为不可拦截旁路观察者
Lifecycle hooks SHALL 只能观察事件并执行旁路本地命令。Hook 命令的执行结果 SHALL NOT 改变用户输入、assistant 输出、provider 请求、tool approval 决策、tool execution 决策、tool result、compaction 状态或 transcript 记录。

#### Scenario: hook 失败不阻断 assistant turn
- **WHEN** `assistant_turn_start` 事件对应的 hook 命令启动失败、返回非零退出码或超时
- **THEN** 系统 SHALL 继续执行原始 assistant turn
- **THEN** 系统 SHALL NOT 因该 hook 失败追加本地 error transcript record

#### Scenario: hook 不能拒绝工具执行
- **WHEN** `tool_call_start` 事件对应的 hook 命令返回非零退出码
- **THEN** 系统 SHALL NOT 将该退出码解释为工具拒绝决策
- **THEN** 原始 tool call SHALL 继续按照既有 risk classification、tool approval 和 executor 规则处理

#### Scenario: hook 输出不注入模型上下文
- **WHEN** hook 命令向 stdout 或 stderr 写入内容
- **THEN** 系统 SHALL NOT 把该输出追加为 user、assistant、tool_result、local_notice 或 error transcript record
- **THEN** 系统 SHALL NOT 把该输出作为 provider request 输入或 tool result 回传模型

### Requirement: lifecycle hook 事件
系统 SHALL 为 assistant turn、tool call 和 compaction 的关键事实事件派发 lifecycle hook 事件。事件派发 SHALL 发生在对应事实已经进入当前运行时状态之后，且 SHALL NOT 为 token 增量流派发 hook 事件。

#### Scenario: assistant turn 成功事件
- **WHEN** 用户提交普通消息并且 assistant turn 成功完成
- **THEN** 系统 SHALL 派发 `assistant_turn_start` 事件
- **THEN** 系统 SHALL 派发 `assistant_turn_end` 事件
- **THEN** `assistant_turn_end` 事件 payload SHALL 表示该 turn 成功完成

#### Scenario: assistant turn 失败事件
- **WHEN** 用户提交普通消息后 assistant turn 因非取消错误失败
- **THEN** 系统 SHALL 派发 `assistant_turn_start` 事件
- **THEN** 系统 SHALL 派发 `assistant_turn_error` 事件
- **THEN** 原有错误显示和 transcript 追加语义 SHALL 保持不变

#### Scenario: assistant turn 取消事件
- **WHEN** 用户中断当前 assistant turn
- **THEN** 系统 SHALL 派发 `assistant_turn_cancelled` 事件
- **THEN** 原有中断提示和 partial assistant persistence 语义 SHALL 保持不变

#### Scenario: tool call 事件
- **WHEN** agent loop runtime 收到并准备处理一个 provider-neutral tool call
- **THEN** 系统 SHALL 派发 `tool_call_start` 事件
- **WHEN** 该 tool call 产生 tool execution result、拒绝 result 或交互式工具 result
- **THEN** 系统 SHALL 派发 `tool_call_end` 事件

#### Scenario: compaction 事件
- **WHEN** agent loop runtime 完成一次自动 compaction 并得到新的 compaction state
- **THEN** 系统 SHALL 派发 `compaction_end` 事件
- **THEN** 原有 compaction notice transcript 追加和 session persistence 语义 SHALL 保持不变

#### Scenario: 不为 token 增量派发 hooks
- **WHEN** provider streaming 返回一个或多个 assistant token delta
- **THEN** 系统 SHALL NOT 为每个 token delta 创建 hook job
- **THEN** streaming preview SHALL 保持既有性能和 redraw 语义

### Requirement: hook payload
系统 SHALL 以结构化 JSON payload 向 hook 命令传递事件上下文。Payload SHALL 至少包含事件名、timestamp、cwd 和事件相关数据。系统 SHALL NOT 在 hook payload 中包含 LLM provider apiKey、headers 或 provider client 配置。

Agent 运行级 hook payload SHALL 使用 `conversationKind` 区分 `primary`、`btw` 与 `subagent`。子 Agent 事件 SHALL 额外包含稳定的 `agentName`，但 SHALL NOT 暴露内部 `runId` 或 `parentToolCallId`。

#### Scenario: 通过 stdin 传递 payload
- **WHEN** 系统启动一个 hook job
- **THEN** 系统 SHALL 将该事件的 JSON payload 写入 hook 进程 stdin
- **THEN** 系统 SHALL 提供 `ECHO_HOOK_EVENT` 环境变量表示事件名
- **THEN** 系统 SHALL 提供 `ECHO_HOOK_CWD` 环境变量表示当前工作目录

#### Scenario: assistant payload 包含 turn 状态
- **WHEN** 系统派发 assistant turn hook 事件
- **THEN** payload SHALL 包含 interaction mode 和 turn status
- **THEN** payload SHALL NOT 包含 LLM provider apiKey、baseURL headers 或 SDK client 配置

#### Scenario: tool payload 包含工具上下文
- **WHEN** 系统派发 `tool_call_start` 或 `tool_call_end` 事件
- **THEN** payload SHALL 包含 tool call id 和 tool name
- **THEN** `tool_call_start` payload SHALL 包含该 tool call 的 arguments text
- **THEN** `tool_call_end` payload SHALL 包含 tool result 的 ok 状态

#### Scenario: 区分主 Agent 与子 Agent 事件
- **WHEN** 系统为主 Agent、BTW Agent 或子 Agent 派发 tool、approval、question 或 compaction hook
- **THEN** payload SHALL 包含对应的 `conversationKind`
- **THEN** 子 Agent payload SHALL 包含 `agentName`
- **THEN** payload SHALL NOT 包含子运行 `runId` 或 `parentToolCallId`

#### Scenario: compaction payload 包含压缩状态摘要元数据
- **WHEN** 系统派发 `compaction_end` 事件
- **THEN** payload SHALL 包含新 compaction state 的 activeStartIndex 和 createdAt
- **THEN** payload SHALL NOT 因 payload 构造改变 compaction state 或 transcript records

### Requirement: hook 执行隔离和输出处理
系统 SHALL 以非交互方式执行 hook 命令，并为每个 hook job 应用 timeout。Hook job 的 stdout、stderr、退出码、超时和异常 SHALL 默认不显示在 TUI 中，不写入 transcript，不持久化到 session。

#### Scenario: hook 输出不显示到 TUI
- **WHEN** hook 命令产生 stdout 或 stderr 输出
- **THEN** 当前 TUI transcript 区域 SHALL NOT 显示该输出
- **THEN** footer、command surface、tool approval surface 和 user question surface SHALL NOT 被 hook 输出替换

#### Scenario: hook 超时被隔离
- **WHEN** hook 命令运行超过配置或默认 timeout
- **THEN** 系统 SHALL 终止该 hook job
- **THEN** 系统 SHALL NOT 中断当前 assistant turn、tool execution 或 compaction 流程

#### Scenario: hook 输出被忽略
- **WHEN** hook 命令 stdout 或 stderr 产生大量输出
- **THEN** 系统 SHALL 忽略该输出
- **THEN** 系统 SHALL NOT 因输出过大追加 transcript record 或阻断主流程

#### Scenario: 退出时不保证 drain hooks
- **WHEN** 用户退出 CLI 且仍有 hook jobs 排队或运行中
- **THEN** 系统 MAY 放弃等待这些 hook jobs 完成
- **THEN** 终端 cleanup 和进程退出 SHALL 保持既有行为

### Requirement: lifecycle hooks 观察工具授权交互
系统 SHALL 为需要用户授权的 tool approval request 和 response 派发 lifecycle hook 事件。该事件 SHALL 覆盖交互式 TUI 中等待用户选择的授权请求，也 SHALL 覆盖 headless 模式下的默认拒绝或 full-access 自动允许结果。Tool approval hook SHALL 只作为旁路观察者，不得改变授权决策或工具执行结果。

#### Scenario: 派发 tool approval request hook
- **WHEN** 交互式 TUI 为 tool call 打开人工审批 surface，或 headless runtime 需要生成审批决策
- **THEN** 系统 SHALL 在等待用户选择或生成 headless 决策前派发 `tool_approval_request` 事件
- **THEN** payload SHALL 包含 interaction mode、tool call id、tool name 和 arguments text
- **THEN** payload SHALL 在存在 preview 时包含 preview title 和 preview 文本

#### Scenario: 派发 tool approval response hook
- **WHEN** 人工审批 surface 产生结构化用户决策，或 headless runtime 产生审批决策
- **THEN** 系统 SHALL 派发 `tool_approval_response` 事件
- **THEN** payload SHALL 包含 interaction mode、tool call id、tool name 和 decision
- **THEN** 当用户提交反馈文本时，payload SHALL 包含该 feedback 文本
- **THEN** 当用户选择 command 级会话授权时，payload SHALL 包含被允许的 command 文本

#### Scenario: 命中会话授权缓存时不派发交互 hook
- **WHEN** tool call 命中 allow-all、tool 级或 command 级会话授权缓存
- **THEN** 系统 SHALL 直接使用缓存的授权决策
- **THEN** 系统 SHALL NOT 打开 tool approval surface
- **THEN** 系统 SHALL NOT 派发 `tool_approval_request` 或 `tool_approval_response` 事件

#### Scenario: Auto 审批直接允许时不派发交互 hook
- **WHEN** 交互式 auto 工具审批模型允许当前调用且系统未打开人工审批 surface
- **THEN** 系统 SHALL 直接生成当前调用的 `allow_once` 决策
- **THEN** 系统 SHALL NOT 派发 `tool_approval_request` 或 `tool_approval_response` 事件

#### Scenario: Auto 审批回退人工 surface 时派发交互 hook
- **WHEN** 交互式 auto 工具审批返回 no 或失败并回退人工审批 surface
- **THEN** 系统 SHALL 在真正打开该 surface 时派发 `tool_approval_request`
- **THEN** 系统 SHALL 在用户完成选择后派发 `tool_approval_response`

#### Scenario: tool approval hook 不改变授权结果
- **WHEN** `tool_approval_request` 或 `tool_approval_response` 对应的 hook 命令失败、超时或输出内容
- **THEN** 系统 SHALL 保持原始 tool approval 决策不变
- **THEN** 系统 SHALL NOT 因 hook 结果允许、拒绝或修改 tool call
- **THEN** 系统 SHALL NOT 将 hook 输出回传给模型

### Requirement: lifecycle hooks 观察用户问题交互
系统 SHALL 为 `ask_user_questions` request 和 response 派发 lifecycle hook 事件。User question response payload SHALL 包含用户答案文本或取消结果文本，使用户配置的本地 hook 可以审计或判断答案。User question hook SHALL 只作为旁路观察者，不得替用户回答或修改 tool result。

#### Scenario: 派发 user question request hook
- **WHEN** agent loop runtime 收到有效的 `ask_user_questions` tool call
- **THEN** 系统 SHALL 在等待用户回答或生成 headless cancelled result 前派发 `user_question_request` 事件
- **THEN** payload SHALL 包含 interaction mode、tool call id、tool name、arguments text 和 question count
- **THEN** payload SHALL 包含可供 hook 识别问题内容的 question text 或 questions text

#### Scenario: 派发 user question response hook
- **WHEN** `ask_user_questions` 请求产生成功答案、取消结果或失败结果
- **THEN** 系统 SHALL 派发 `user_question_response` 事件
- **THEN** payload SHALL 包含 interaction mode、tool call id、tool name 和 ok 状态
- **THEN** payload SHALL 包含该 tool result 的答案文本或结果文本
- **THEN** payload SHALL 在可解析答案数量时包含 answer count

#### Scenario: user question hook 不改变回答结果
- **WHEN** `user_question_request` 或 `user_question_response` 对应的 hook 命令失败、超时或输出内容
- **THEN** 系统 SHALL 保持原始 `ask_user_questions` tool result 不变
- **THEN** 系统 SHALL NOT 使用 hook 输出替代用户答案
- **THEN** 系统 SHALL NOT 将 hook 输出追加到 transcript 或 provider request

### Requirement: lifecycle interaction hook synthetic payload
系统 SHALL 为 tool approval 和 user question lifecycle events 构造稳定 synthetic payload，用于 `/hooks` synthetic test。Synthetic payload SHALL 包含 event、timestamp、cwd 和该事件所需的代表性测试字段，不得触发真实授权、真实用户问题或真实 tool execution。

#### Scenario: tool approval synthetic payload
- **WHEN** 系统为 `tool_approval_request` 或 `tool_approval_response` 构造 synthetic payload
- **THEN** payload SHALL 包含测试 tool call id、tool name、interaction mode 和 arguments text
- **THEN** request payload SHALL 包含测试 preview 字段
- **THEN** response payload SHALL 包含测试 decision 和 feedback text

#### Scenario: user question synthetic payload
- **WHEN** 系统为 `user_question_request` 或 `user_question_response` 构造 synthetic payload
- **THEN** payload SHALL 包含测试 tool call id、tool name、interaction mode 和 arguments text
- **THEN** request payload SHALL 包含测试 question count 和 question text
- **THEN** response payload SHALL 包含 ok 状态、answer count 和答案文本或结果文本

#### Scenario: interaction synthetic test 不触发真实交互
- **WHEN** 用户对 interaction hook event 执行 synthetic test
- **THEN** 系统 SHALL NOT 打开 tool approval surface
- **THEN** 系统 SHALL NOT 打开 user question surface
- **THEN** 系统 SHALL NOT 执行真实 tool call
- **THEN** 系统 SHALL NOT 派发额外 lifecycle hook event
