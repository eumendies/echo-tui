## ADDED Requirements

### Requirement: agent loop 高危工具授权编排
agent loop runtime SHALL 在普通 tool executor 前执行 tool call 风险分类。对于需要授权的高危调用，runtime SHALL 请求 app 层授权并等待用户决策；用户允许时执行原始 tool call，用户拒绝时生成拒绝 tool result 并继续模型 continuation。

#### Scenario: 高危调用在 executor 前请求授权
- **WHEN** provider 返回被风险分类为需要授权的 tool call
- **THEN** agent loop runtime SHALL 在调用普通 tool executor 前调用 tool approval request callback
- **THEN** runtime SHALL 等待用户授权决策后再处理该 tool call

#### Scenario: 用户允许后执行原始工具调用
- **WHEN** 高危 tool call 授权请求返回允许本次执行
- **THEN** agent loop runtime SHALL 调用普通 tool executor 执行原始 tool call
- **THEN** runtime SHALL 将真实执行结果追加为 continuation 中的 tool result record

#### Scenario: 用户拒绝后不执行原始工具调用
- **WHEN** 高危 tool call 授权请求返回拒绝执行
- **THEN** agent loop runtime SHALL NOT 调用普通 tool executor 执行原始 tool call
- **THEN** runtime SHALL 生成拒绝 tool result
- **THEN** runtime SHALL 将拒绝结果追加为 continuation 中的 tool result record

#### Scenario: 安全调用不请求授权
- **WHEN** provider 返回被风险分类为可直接执行的 tool call
- **THEN** agent loop runtime SHALL NOT 调用 tool approval request callback
- **THEN** runtime SHALL 直接调用普通 tool executor 执行该 tool call
