## MODIFIED Requirements

### Requirement: agent loop 高危工具授权编排
agent loop runtime SHALL 在普通 tool executor 前执行 tool call 风险分类。对于需要授权的高危调用，runtime SHALL 请求 app 层授权并等待用户决策；app 层 callback MAY 因当前 CLI 进程会话内已有授权而立即返回允许执行的结构化决策，且不显示授权 UI。用户允许或 app 层命中会话授权时，runtime SHALL 执行原始 tool call；用户拒绝或提供反馈时，runtime SHALL 生成拒绝 tool result 并继续模型 continuation。

#### Scenario: 高危调用通过 approval callback 获取授权决策
- **WHEN** provider 返回被风险分类为需要授权的 tool call
- **THEN** agent loop runtime SHALL 在调用普通 tool executor 前调用 tool approval request callback
- **THEN** runtime SHALL 等待用户授权决策后再处理该 tool call

#### Scenario: 用户允许本次后执行原始工具调用
- **WHEN** 高危 tool call 授权请求返回允许本次执行
- **THEN** agent loop runtime SHALL 调用普通 tool executor 执行原始 tool call
- **THEN** runtime SHALL 将真实执行结果追加为 continuation 中的 tool result record
- **THEN** runtime SHALL NOT 因该决策在自身内部建立会话级授权缓存

#### Scenario: 用户允许非 bash 工具在当前会话内执行
- **WHEN** 高危非 bash tool call 授权请求返回允许同名工具在当前会话内执行
- **THEN** runtime SHALL 调用普通 tool executor 执行当前原始 tool call
- **THEN** runtime SHALL 将该决策视为允许执行
- **THEN** runtime SHALL NOT 在自身内部记录该 tool name 的会话级授权

#### Scenario: 用户允许 bash command 在当前会话内执行
- **WHEN** 高危 `run_bash_command` 授权请求返回允许同一 command 在当前会话内执行
- **THEN** runtime SHALL 调用普通 tool executor 执行当前原始 tool call
- **THEN** runtime SHALL 将该决策视为允许执行
- **THEN** runtime SHALL NOT 在自身内部记录该 bash command 文本的会话级授权

#### Scenario: 用户允许所有需审批工具在当前会话内执行
- **WHEN** 高危 tool call 授权请求返回允许所有工具在当前会话内执行
- **THEN** runtime SHALL 调用普通 tool executor 执行当前原始 tool call
- **THEN** runtime SHALL 将该决策视为允许执行
- **THEN** runtime SHALL NOT 在自身内部记录允许所有工具的会话级授权

#### Scenario: 用户拒绝后不执行原始工具调用
- **WHEN** 高危 tool call 授权请求返回拒绝执行
- **THEN** agent loop runtime SHALL NOT 调用普通 tool executor 执行原始 tool call
- **THEN** runtime SHALL 生成拒绝 tool result
- **THEN** runtime SHALL 将拒绝结果追加为 continuation 中的 tool result record

#### Scenario: 用户反馈后不执行原始工具调用
- **WHEN** 高危 tool call 授权请求返回用户反馈决策
- **THEN** agent loop runtime SHALL NOT 调用普通 tool executor 执行原始 tool call
- **THEN** runtime SHALL 生成包含用户反馈文本的拒绝 tool result
- **THEN** runtime SHALL 将拒绝结果追加为 continuation 中的 tool result record

#### Scenario: 安全调用不请求授权
- **WHEN** provider 返回被风险分类为可直接执行的 tool call
- **THEN** agent loop runtime SHALL NOT 调用 tool approval request callback
- **THEN** runtime SHALL 直接调用普通 tool executor 执行该 tool call

#### Scenario: 会话授权命中不改变 transcript continuation
- **WHEN** app 层 approval callback 因会话级授权命中而立即返回允许执行决策
- **AND** agent loop runtime 执行对应 tool call
- **THEN** runtime SHALL 继续追加原始 tool call record 和真实 tool result record
- **THEN** runtime SHALL NOT 追加表示授权缓存命中的额外 provider-facing transcript record
