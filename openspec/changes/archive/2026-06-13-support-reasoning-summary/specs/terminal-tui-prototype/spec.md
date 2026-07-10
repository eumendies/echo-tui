## ADDED Requirements

### Requirement: reasoning summary transcript role
系统 SHALL 支持 `reasoning_summary` transcript role 表示模型返回的 reasoning summary。该 record SHALL 作为可见、可持久化的 append-only transcript content record 参与 session 恢复和当前 app snapshot 重绘，但 SHALL NOT 被视为 assistant final answer、用户消息、本地错误或工具结果。

#### Scenario: 追加 reasoning summary record
- **WHEN** agent loop 收到非空 reasoning summary 并通知 app 层追加记录
- **THEN** 应用 SHALL 追加一条 `role: 'reasoning_summary'` 的 transcript record
- **THEN** 该 record 文本 SHALL 保存 reasoning summary 原文
- **THEN** 应用 SHALL NOT 把该文本合并进 assistant record

#### Scenario: 工具循环中 summary 位于工具记录之前
- **WHEN** 同一 provider turn 同时产生 reasoning summary 和 tool call
- **THEN** 可见 transcript SHALL 先追加 `reasoning_summary` record
- **THEN** 工具执行完成后 SHALL 再追加对应 `tool_call` 与 `tool_result` records

#### Scenario: 最终回复中 summary 位于 assistant 之前
- **WHEN** 同一 provider turn 产生 reasoning summary 且随后完成最终 assistant 回复
- **THEN** 可见 transcript SHALL 先追加 `reasoning_summary` record
- **THEN** 随后追加最终 `assistant` record

#### Scenario: summary record 被持久化和恢复
- **WHEN** 包含 `reasoning_summary` record 的 session 被保存并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该 record
- **THEN** transcript 渲染 SHALL 为该 record 提供可见投影

### Requirement: reasoning summary 可见渲染
系统 SHALL 为 `reasoning_summary` transcript record 提供区别于 user、assistant、error 和 tool result 的低强调可见投影。该投影 SHALL 根据当前 terminal width 重新计算，且 SHALL NOT 改变 transcript record 的原始文本。

#### Scenario: 渲染 reasoning summary
- **WHEN** transcript records 包含 `reasoning_summary` record
- **THEN** renderer SHALL 生成低强调的 reasoning summary 消息块
- **THEN** 该消息块 SHALL 使用区别于 assistant final answer 的前缀或样式
- **THEN** 渲染 SHALL NOT 把该 record 当作 Markdown assistant final message 处理

#### Scenario: resize 后重新投影 reasoning summary
- **WHEN** 当前 transcript records 包含 `reasoning_summary` record，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** reasoning summary SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL NOT 删除、隐藏或改写该 summary record

#### Scenario: reasoning summary 显示不改变 footer pending
- **WHEN** app 追加 `reasoning_summary` record
- **THEN** 该 record SHALL 通过 transcript append 路径显示在历史区域
- **THEN** 系统 SHALL NOT 要求新增 footer pending 状态来展示已完成的 summary
