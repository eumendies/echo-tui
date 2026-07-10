## MODIFIED Requirements

### Requirement: ask_user_questions 结果格式
`ask_user_questions` 的成功结果 SHALL 使用结构化 JSON 文本返回给模型。每个答案 SHALL 使用问题索引和用户选择标签标识对应回答；当用户选择自定义文本答案时，答案 SHALL 额外包含 `customText`，使模型可以继续当前任务。成功结果 SHALL NOT 重复回传完整 question 文本或 option description。

#### Scenario: 成功结果包含答案数组
- **WHEN** 用户完成所有问题
- **THEN** tool result 文本 SHALL 包含 `answers` 数组
- **THEN** 每个 answer SHALL 包含对应问题的 0-based `index`
- **THEN** 每个 answer SHALL 包含被选选项的 `selected`
- **THEN** `selected` SHALL 等于被选 option 的 label
- **THEN** 每个 answer SHALL NOT 常态包含完整 `question` 文本或 option `description`

#### Scenario: 成功结果包含自定义文本
- **WHEN** 用户通过 `Other` 提交某道问题的自定义文本答案
- **THEN** 对应 answer SHALL 包含 `customText`
- **THEN** `customText` SHALL 等于用户输入文本
- **THEN** 对应 answer 的 `selected` SHALL 表示用户选择了自定义输入选项

#### Scenario: 参数无效时返回失败结果
- **WHEN** `ask_user_questions` 参数不是合法 JSON object、`questions` 为空、question 缺少 options 或 option label 为空
- **THEN** 系统 SHALL 返回 `ok: false` 的 tool result
- **THEN** 失败结果 SHALL 包含可回传模型的简洁错误说明

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

#### Scenario: 自定义文本答案使用索引关联题目
- **WHEN** 用户通过 `Other` 完成某道问题
- **THEN** 成功结果中的 answer SHALL 使用该问题的 0-based `index` 关联题目
- **THEN** 成功结果中的 answer SHALL 包含 `selected` 表示 `Other`
- **THEN** 成功结果中的 answer SHALL 包含 `customText`
- **THEN** 成功结果中的 answer SHALL NOT 重复完整 question 文本
