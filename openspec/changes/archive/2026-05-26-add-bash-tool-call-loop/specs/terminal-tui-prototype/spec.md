## ADDED Requirements

### Requirement: tool call transcript lifecycle
系统 SHALL 在真实 tool call 期间把工具调用和工具结果追加为 append-only transcript records。`tool_call` record SHALL 表示模型请求执行的工具，`tool_result` record SHALL 表示本地工具执行结果。工具 records SHALL 被持久化、参与 `/resume` 恢复，并 SHALL 在同一 response lock 内显示。

#### Scenario: 追加 tool_call record
- **WHEN** agent adapter 解析出模型请求执行本地工具
- **THEN** app SHALL 追加一条 `role: 'tool_call'` 的 transcript record
- **THEN** 该 record SHALL 包含可见文本、tool call id、tool name 和 arguments 信息
- **THEN** 该 record SHALL 立即通过现有 transcript append 渲染路径显示

#### Scenario: 追加 tool_result record
- **WHEN** 本地工具执行完成
- **THEN** app SHALL 追加一条 `role: 'tool_result'` 的 transcript record
- **THEN** 该 record SHALL 包含可见结果文本、tool call id、tool name、ok 状态和执行元信息
- **THEN** 该 record SHALL 立即通过现有 transcript append 渲染路径显示

#### Scenario: 工具调用期间保持 response lock
- **WHEN** agent 正在执行 tool call loop
- **THEN** app SHALL 保持 response lock，阻止用户提交第二个普通请求
- **THEN** tool_call 和 tool_result records SHALL 仍可追加到当前 transcript

#### Scenario: 工具 records 被持久化
- **WHEN** tool_call 或 tool_result record 被追加到当前 transcript
- **THEN** 系统 SHALL 在本轮可持久化时保存这些 records
- **THEN** session 恢复后 SHALL 保留这些 records 和其 tool metadata

#### Scenario: tool call 后继续 assistant 回复
- **WHEN** 工具结果已追加且模型基于结果生成最终回复
- **THEN** app SHALL 追加最终 assistant transcript record
- **THEN** 最终 assistant record SHALL NOT 覆盖或合并已追加的 tool_call / tool_result records

#### Scenario: tool loop 失败时释放 response lock
- **WHEN** tool call loop 因 provider 错误或系统性工具执行异常失败
- **THEN** app SHALL 追加本地 `error` transcript record
- **THEN** app SHALL 清空 pending preview 并释放 response lock
