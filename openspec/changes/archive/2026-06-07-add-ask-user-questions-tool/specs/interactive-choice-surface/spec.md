## ADDED Requirements

### Requirement: choice surface 支持逐题用户问题
choice surface SHALL 能被 `ask_user_questions` 复用来逐题显示用户问题。问题文本 SHALL 作为 surface title 或 message 显示，选项 SHALL 使用现有 option label 和 description 呈现规则。

#### Scenario: 显示 ask_user_questions 当前题
- **WHEN** `ask_user_questions` 请求正在等待用户回答某一道题
- **THEN** choice surface SHALL 显示当前题的问题文本
- **THEN** choice surface SHALL 显示当前题的选项
- **THEN** 如果 option 包含 description，description SHALL 继续显示在 label 下一行并使用弱化样式

#### Scenario: 多题显示进度
- **WHEN** `ask_user_questions` 请求包含多道问题
- **THEN** choice surface SHALL 显示当前题序号和总题数，或以等价方式让用户知道当前正在回答哪一道题

#### Scenario: 用户问题输入提示
- **WHEN** choice surface 用于 `ask_user_questions`
- **THEN** 输入提示 SHALL 说明 Enter 确认、Up/Down 选择、Esc 取消
