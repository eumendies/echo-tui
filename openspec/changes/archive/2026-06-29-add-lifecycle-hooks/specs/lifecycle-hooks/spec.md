## ADDED Requirements

### Requirement: 用户级 lifecycle hooks 配置
系统 SHALL 支持从用户级配置读取可选 lifecycle hooks 配置。配置 SHALL 允许用户按事件名配置一个或多个本地 hook 命令。未配置 hooks、hooks 配置缺失或单个 hook entry 无效时，系统 SHALL 保持现有 assistant、tool、compaction 和 TUI 行为不变。

#### Scenario: 未配置 hooks 时行为不变
- **WHEN** 用户级配置中不存在 `hooks` 节点
- **THEN** 系统 SHALL 不创建可执行 hook job
- **THEN** 普通 assistant turn、tool execution、compaction、transcript persistence 和 TUI rendering SHALL 保持既有行为

#### Scenario: 读取有效 hook 配置
- **WHEN** 用户级配置中为 `assistant_turn_end` 配置了一个有效本地命令
- **THEN** 系统 SHALL 在 `assistant_turn_end` 事件发生时 enqueue 对应 hook job
- **THEN** 系统 SHALL 使用当前工作目录作为 hook job 的工作目录

#### Scenario: 忽略无效 hook entry
- **WHEN** 用户级配置中的某个 hook entry 缺少可执行命令、事件名未知或字段类型无效
- **THEN** 系统 SHALL 忽略该 hook entry
- **THEN** 系统 SHALL NOT 因该无效 hook entry 阻止 CLI 启动或 assistant turn 执行
- **THEN** 系统 SHALL NOT 为该配置错误追加 transcript record

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
