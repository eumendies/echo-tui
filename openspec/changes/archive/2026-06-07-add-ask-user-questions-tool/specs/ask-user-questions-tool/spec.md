## ADDED Requirements

### Requirement: ask_user_questions 工具定义
系统 SHALL 暴露名为 `ask_user_questions` 的 function tool，用于在模型无法安全或正确继续前向用户询问一个或多个选择题。该工具 SHALL 只在答案必要且无法从已有上下文或代码库推断时使用。

#### Scenario: 默认暴露 ask_user_questions 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `ask_user_questions` 的 tool definition
- **THEN** 该 definition SHALL 声明工具用于向用户询问必要的澄清问题或偏好选择
- **THEN** 该 definition SHALL 要求参数为 JSON object

#### Scenario: 工具参数包含问题数组
- **WHEN** 模型调用 `ask_user_questions`
- **THEN** 参数 SHALL 包含 `questions` 数组
- **THEN** 每个 question SHALL 包含 `question` 文本
- **THEN** 每个 question SHALL 包含非空 `options` 数组
- **THEN** 每个 option SHALL 包含 `label`，并 MAY 包含 `description`

### Requirement: ask_user_questions 第一版单选交互
系统 SHALL 在第一版中逐题显示 `ask_user_questions` 的问题，每题 SHALL 使用单选 choice surface 收集一个选项。系统 SHALL NOT 在第一版中支持多选、Other 自定义输入或开放文本输入。

#### Scenario: 显示第一题
- **WHEN** agent loop 收到有效的 `ask_user_questions` tool call
- **THEN** TUI SHALL 暂停当前 tool continuation
- **THEN** TUI SHALL 使用 choice surface 显示第一道问题
- **THEN** choice surface SHALL 显示该问题的选项

#### Scenario: 确认当前题并进入下一题
- **WHEN** 用户在某道问题上按 Enter 确认当前选项
- **AND** 该问题不是最后一道问题
- **THEN** 系统 SHALL 记录当前题的答案
- **THEN** TUI SHALL 显示下一道问题

#### Scenario: 确认最后一题并完成工具
- **WHEN** 用户在最后一道问题上按 Enter 确认当前选项
- **THEN** 系统 SHALL 记录当前题的答案
- **THEN** 系统 SHALL 生成 `ok: true` 的 tool result
- **THEN** 该 tool result 文本 SHALL 是包含所有答案的 JSON 字符串

#### Scenario: 用户取消提问
- **WHEN** `ask_user_questions` 请求处于活跃状态且用户按下 Esc
- **THEN** 系统 SHALL 关闭当前 choice surface
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 tool result 文本 SHALL 是包含 `cancelled: true` 和取消原因的 JSON 字符串
- **THEN** 系统 SHALL NOT 因用户取消而追加本地 error transcript record

### Requirement: ask_user_questions 结果格式
`ask_user_questions` 的成功结果 SHALL 使用结构化 JSON 文本返回给模型。每个答案 SHALL 保留原 question 文本和用户选择的 option 信息，使模型可以继续当前任务。

#### Scenario: 成功结果包含答案数组
- **WHEN** 用户完成所有问题
- **THEN** tool result 文本 SHALL 包含 `answers` 数组
- **THEN** 每个 answer SHALL 包含对应的 `question`
- **THEN** 每个 answer SHALL 包含 `selectedOption`
- **THEN** `selectedOption` SHALL 至少包含被选 option 的 `label`

#### Scenario: 参数无效时返回失败结果
- **WHEN** `ask_user_questions` 参数不是合法 JSON object、`questions` 为空、question 缺少 options 或 option label 为空
- **THEN** 系统 SHALL 返回 `ok: false` 的 tool result
- **THEN** 失败结果 SHALL 包含可回传模型的简洁错误说明
