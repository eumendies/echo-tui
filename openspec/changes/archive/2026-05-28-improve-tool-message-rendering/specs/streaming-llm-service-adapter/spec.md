## ADDED Requirements

### Requirement: 工具调用可见消息延迟落盘
系统 SHALL 在 app 可见层把未完成的工具调用视为 footer pending 状态，而不是在 `tool_call` 回调到达时立即写入 transcript 区域。工具执行完成后，系统 SHALL 保持既有 transcript record 类型，按顺序追加对应的 `tool_call` record 和 `tool_result` record。

#### Scenario: tool call 先显示为 pending preview
- **WHEN** agent callback 收到 provider-neutral tool call
- **THEN** app SHALL 暂存该 tool call
- **THEN** app SHALL 更新 footer pending preview 以显示该工具调用
- **THEN** app SHALL NOT 立即追加可见 `tool_call` transcript record

#### Scenario: tool result 到达后追加既有 transcript records
- **WHEN** 本地工具执行完成且 agent callback 收到 tool result
- **THEN** app SHALL 使用暂存的 tool call 追加 `tool_call` transcript record
- **THEN** app SHALL 紧随其后追加 `tool_result` transcript record
- **THEN** 两条 record SHALL 保持既有 metadata 字段，供历史恢复和 provider input 转换继续使用

#### Scenario: runtime continuation 记录不受可见延迟影响
- **WHEN** agent loop runtime 执行工具调用并发起 continuation turn
- **THEN** runtime SHALL 继续在自身维护的 continuation records 中追加 `tool_call` 和 `tool_result`
- **THEN** app 可见层延迟 transcript append SHALL NOT 改变 provider continuation input 顺序

#### Scenario: result 缺少暂存 call 时安全降级
- **WHEN** app 收到 tool result 但没有可匹配的暂存 tool call
- **THEN** app SHALL 仍追加该 `tool_result` record 或等价可见失败反馈
- **THEN** app SHALL NOT 因缺少暂存 call 中断本轮响应或丢失 tool result
