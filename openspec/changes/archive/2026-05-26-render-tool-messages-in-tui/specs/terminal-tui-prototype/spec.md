## ADDED Requirements

### Requirement: tool transcript message rendering
系统 SHALL 支持 `tool_call` 与 `tool_result` transcript record 的 TUI 可见投影。工具消息 SHALL 作为 transcript content records 参与当前 app snapshot 重绘、destructive resize recovery 和 session 恢复后的显示。工具消息的可见前缀和多行缩进 SHALL 与 assistant 消息保持一致。

#### Scenario: 显示 tool_call record
- **WHEN** transcript records 包含 `role: 'tool_call'` 的记录
- **THEN** transcript 渲染 SHALL 为该记录生成可见消息块
- **THEN** 该消息块 SHALL 使用与 assistant 消息一致的 `◆ ` 前缀和 continuation 缩进规则

#### Scenario: 显示 tool_result record
- **WHEN** transcript records 包含 `role: 'tool_result'` 的记录
- **THEN** transcript 渲染 SHALL 为该记录生成可见消息块
- **THEN** 该消息块 SHALL 使用与 assistant 消息一致的 `◆ ` 前缀和 continuation 缩进规则

#### Scenario: resize 后重新投影工具消息
- **WHEN** 当前 transcript records 包含 `tool_call` 或 `tool_result` 记录，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** 工具消息 SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL NOT 删除或隐藏这些工具消息

#### Scenario: 恢复 session 后显示工具消息
- **WHEN** 包含 `tool_call` 或 `tool_result` 记录的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复这些 transcript records
- **THEN** transcript 渲染 SHALL 为这些工具消息提供可见投影

#### Scenario: 工具消息不代表工具执行能力
- **WHEN** TUI 渲染 `tool_call` 或 `tool_result` 记录
- **THEN** 系统 SHALL NOT 因此要求已实现真实工具调用、工具执行或 tool result 回传模型
