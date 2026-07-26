## ADDED Requirements

### Requirement: lifecycle hooks 观察工具授权交互
系统 SHALL 为需要用户授权的 tool approval request 和 response 派发 lifecycle hook 事件。该事件 SHALL 覆盖交互式 TUI 中等待用户选择的授权请求，也 SHALL 覆盖 headless 模式下的默认拒绝或 full-access 自动允许结果。Tool approval hook SHALL 只作为旁路观察者，不得改变授权决策或工具执行结果。

#### Scenario: 派发 tool approval request hook
- **WHEN** agent loop runtime 收到需要 tool approval 的 tool call
- **THEN** 系统 SHALL 在等待用户选择或生成 headless 决策前派发 `tool_approval_request` 事件
- **THEN** payload SHALL 包含 interaction mode、tool call id、tool name 和 arguments text
- **THEN** payload SHALL 在存在 preview 时包含 preview title 和 preview 文本

#### Scenario: 派发 tool approval response hook
- **WHEN** tool approval 请求产生结构化授权决策
- **THEN** 系统 SHALL 派发 `tool_approval_response` 事件
- **THEN** payload SHALL 包含 interaction mode、tool call id、tool name 和 decision
- **THEN** 当用户提交反馈文本时，payload SHALL 包含该 feedback 文本
- **THEN** 当用户选择 command 级会话授权时，payload SHALL 包含被允许的 command 文本

#### Scenario: 命中会话授权缓存时不派发交互 hook
- **WHEN** tool call 命中 allow-all、tool 级或 command 级会话授权缓存
- **THEN** 系统 SHALL 直接使用缓存的授权决策
- **THEN** 系统 SHALL NOT 打开 tool approval surface
- **THEN** 系统 SHALL NOT 派发 `tool_approval_request` 或 `tool_approval_response` 事件

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
