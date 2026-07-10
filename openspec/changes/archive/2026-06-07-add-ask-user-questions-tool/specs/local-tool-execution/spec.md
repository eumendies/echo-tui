## ADDED Requirements

### Requirement: ask_user_questions 工具注册
系统 SHALL 在默认本地 tool registry 中注册 `ask_user_questions` 工具定义，使 provider request 可以携带该 function tool schema。该工具的用户交互执行 SHALL 由 agent loop/app callback 处理，而不是由普通 tool executor handler 直接访问 TUI 状态。

#### Scenario: 默认 registry 包含 ask_user_questions
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `ask_user_questions` 的 tool definition
- **THEN** OpenAI 请求 SHALL 可以发送该工具 schema

#### Scenario: ask_user_questions 不通过普通 executor 访问 UI
- **WHEN** agent loop 收到 `ask_user_questions` tool call
- **THEN** 系统 SHALL 通过 interactive tool callback 获取用户回答
- **THEN** 普通 tool executor SHALL NOT 直接读取 TUI 输入或持有用户问题 UI 状态
