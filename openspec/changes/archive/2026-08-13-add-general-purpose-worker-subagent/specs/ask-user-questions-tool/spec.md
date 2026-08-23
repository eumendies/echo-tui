## ADDED Requirements

### Requirement: Worker 可通过共享 surface 询问必要问题
Worker SHALL能调用`ask_user_questions`并复用主Agent相同的参数校验、choice surface、输入优先级和tool result格式。系统 SHALL在打开surface前验证请求属于当前父turn和Worker run，并 SHALL在surface标题中标明Worker来源。Explorer SHALL继续不获得该工具。

#### Scenario: Worker 获得用户答案
- **WHEN** interactive Worker调用合法`ask_user_questions`且run identity仍有效
- **THEN** TUI SHALL暂停Worker tool continuation并显示带Worker身份的问题surface
- **THEN** 用户提交的结果 SHALL以原内部call id返回Worker并作为内部tool call/result持久化

#### Scenario: Esc 只取消 Worker 当前问题
- **WHEN** Worker问题surface活跃且用户按Esc
- **THEN** 当前按键 SHALL生成cancelled tool result并关闭问题surface
- **THEN** 父assistant turn SHALL保持运行，除非用户在surface关闭后再次请求中断

#### Scenario: Headless Worker 不等待问题输入
- **WHEN** headless Worker调用`ask_user_questions`
- **THEN** 系统 SHALL立即返回cancelled tool result
- **THEN** 系统 SHALL NOT读取或等待stdin
