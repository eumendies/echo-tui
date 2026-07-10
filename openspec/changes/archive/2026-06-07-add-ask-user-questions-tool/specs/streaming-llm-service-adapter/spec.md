## ADDED Requirements

### Requirement: interactive tool continuation
agent loop runtime SHALL 支持 interactive tool continuation。对于 `ask_user_questions`，agent loop SHALL 在收到 tool call 后暂停普通工具执行流程，等待 app 层用户交互返回 tool result，再将该 result 追加到 continuation records 并继续后续模型请求。

#### Scenario: ask_user_questions 通过 app callback 执行
- **WHEN** provider 返回名为 `ask_user_questions` 的 tool call
- **THEN** agent loop SHALL 通知 app 层打开用户问题交互
- **THEN** agent loop SHALL 等待 app 层返回 tool result
- **THEN** agent loop SHALL NOT 将该 tool call 交给普通 tool executor 执行

#### Scenario: 用户回答后继续 agent loop
- **WHEN** app 层为 `ask_user_questions` 返回 tool result
- **THEN** agent loop SHALL 将对应 tool result record 加入 continuation records
- **THEN** agent loop SHALL 使用包含该 tool result 的上下文继续请求模型

#### Scenario: 用户取消后继续回传取消结果
- **WHEN** app 层为 `ask_user_questions` 返回 `ok: false` 的取消 tool result
- **THEN** agent loop SHALL 将取消结果作为普通 tool result 追加到 continuation records
- **THEN** agent loop SHALL NOT 因用户取消而把当前 turn 标记为本地执行错误
