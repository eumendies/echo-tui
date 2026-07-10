## ADDED Requirements

### Requirement: ask_user_questions 自定义文本答案
`ask_user_questions` SHALL 为每道单选问题提供 `Other` 自定义文本选项。用户通过该选项提交非空文本时，成功结果 SHALL 在对应 answer 中包含 `customText`。

#### Scenario: 显示 Other 选项
- **WHEN** `ask_user_questions` 请求正在等待用户回答某一道题
- **THEN** choice surface SHALL 显示模型提供的选项
- **THEN** choice surface SHALL 额外显示支持内联文本输入的 `Other` 选项

#### Scenario: 提交自定义文本答案
- **WHEN** 用户选中 `Other`
- **AND** 用户输入非空文本并按 Enter
- **THEN** 系统 SHALL 记录当前题的答案
- **THEN** 该答案 SHALL 包含 `customText`，值等于用户输入文本

#### Scenario: 自定义文本答案保留题目信息
- **WHEN** 用户通过 `Other` 完成某道问题
- **THEN** 成功结果中的 answer SHALL 保留对应的 `question`
- **THEN** 成功结果中的 answer SHALL 包含 `selectedOption.label` 为 `Other`
- **THEN** 成功结果中的 answer SHALL 包含 `customText`

## MODIFIED Requirements

### Requirement: ask_user_questions 第一版单选交互
系统 SHALL 逐题显示 `ask_user_questions` 的问题，每题 SHALL 使用单选 choice surface 收集一个答案。系统 SHALL 支持选择模型提供的预设选项，也 SHALL 支持通过 `Other` 选项输入自定义文本答案。

#### Scenario: 显示第一题
- **WHEN** agent loop 收到有效的 `ask_user_questions` tool call
- **THEN** TUI SHALL 暂停当前 tool continuation
- **THEN** TUI SHALL 使用 choice surface 显示第一道问题
- **THEN** choice surface SHALL 显示该问题的选项和 `Other` 输入选项

#### Scenario: 确认当前题并进入下一题
- **WHEN** 用户在某道问题上按 Enter 确认当前答案
- **AND** 该问题不是最后一道问题
- **THEN** 系统 SHALL 记录当前题的答案
- **THEN** TUI SHALL 显示下一道问题

#### Scenario: 确认最后一题并完成工具
- **WHEN** 用户在最后一道问题上按 Enter 确认当前答案
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
`ask_user_questions` 的成功结果 SHALL 使用结构化 JSON 文本返回给模型。每个答案 SHALL 保留原 question 文本和用户选择的 option 信息；当用户选择自定义文本答案时，答案 SHALL 额外包含 `customText`，使模型可以继续当前任务。

#### Scenario: 成功结果包含答案数组
- **WHEN** 用户完成所有问题
- **THEN** tool result 文本 SHALL 包含 `answers` 数组
- **THEN** 每个 answer SHALL 包含对应的 `question`
- **THEN** 每个 answer SHALL 包含 `selectedOption`
- **THEN** `selectedOption` SHALL 至少包含被选 option 的 `label`

#### Scenario: 成功结果包含自定义文本
- **WHEN** 用户通过 `Other` 提交某道问题的自定义文本答案
- **THEN** 对应 answer SHALL 包含 `customText`
- **THEN** `customText` SHALL 等于用户输入文本

#### Scenario: 参数无效时返回失败结果
- **WHEN** `ask_user_questions` 参数不是合法 JSON object、`questions` 为空、question 缺少 options 或 option label 为空
- **THEN** 系统 SHALL 返回 `ok: false` 的 tool result
- **THEN** 失败结果 SHALL 包含可回传模型的简洁错误说明
