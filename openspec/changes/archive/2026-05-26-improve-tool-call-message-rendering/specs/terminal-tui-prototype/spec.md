## MODIFIED Requirements

### Requirement: tool transcript message rendering
系统 SHALL 支持 `tool_call` 与 `tool_result` transcript record 的 TUI 可见投影。工具消息 SHALL 作为 transcript content records 参与当前 app snapshot 重绘、destructive resize recovery 和 session 恢复后的显示。系统 SHALL 根据 tool metadata 生成工具专属展示：tool call SHALL 使用 assistant 风格调用行，tool result SHALL 使用区别于 assistant 的弱化结果行。未知工具或缺少 metadata 的历史记录 SHALL 使用安全 fallback 渲染。

#### Scenario: 显示 bash tool_call record
- **WHEN** transcript records 包含 `role: 'tool_call'` 且 `toolName` 为 `run_bash_command` 的记录
- **THEN** transcript 渲染 SHALL 为该记录生成可见消息块
- **THEN** 该消息块 SHALL 使用 assistant 调用前缀并显示 `Bash('...')` 形式的命令调用
- **THEN** 该消息块 SHALL NOT 显示原始 JSON arguments

#### Scenario: 显示 bash tool_result record
- **WHEN** transcript records 包含 `role: 'tool_result'` 且 `toolName` 为 `run_bash_command` 的记录
- **THEN** transcript 渲染 SHALL 为该记录生成可见消息块
- **THEN** 该消息块 SHALL 使用灰色弱化样式和 `⎿` 前缀显示命令输出或简洁状态
- **THEN** 该消息块 SHALL NOT 显示 `exit_code`、`duration_ms`、`timed_out` 或 `truncated` 等执行摘要行

#### Scenario: bash tool_result 无输出
- **WHEN** bash tool result 没有可显示的 stdout 或 stderr 内容
- **THEN** transcript 渲染 SHALL 显示简洁的无输出状态
- **THEN** 渲染 SHALL NOT 产生空白工具结果块

#### Scenario: tool_result 显示层截断
- **WHEN** tool result 的可见投影超过显示层上限
- **THEN** transcript 渲染 SHALL 截断可见输出并显示截断提示
- **THEN** 截断 SHALL 只影响 TUI 展示，不改变 transcript record 的事实内容

#### Scenario: 完整消息块之间保留空行
- **WHEN** transcript records 中存在相邻的两个完整可见消息块，例如连续 assistant 记录或 tool result 后的 assistant 记录
- **THEN** transcript 渲染 SHALL 在两个完整消息块的投影之间保留一个空行
- **THEN** 同一工具调用组内的 tool call 与紧随其后的 tool result SHALL NOT 被额外空行分隔
- **THEN** 该空行 SHALL 只影响 TUI 展示，不改变 transcript record 的事实内容

#### Scenario: resize 后重新投影工具消息
- **WHEN** 当前 transcript records 包含 `tool_call` 或 `tool_result` 记录，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** 工具消息 SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL NOT 删除或隐藏这些工具消息

#### Scenario: 恢复 session 后显示工具消息
- **WHEN** 包含 `tool_call` 或 `tool_result` 记录的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复这些 transcript records
- **THEN** transcript 渲染 SHALL 为这些工具消息提供可见投影

#### Scenario: 未知工具使用通用 fallback
- **WHEN** TUI 渲染未知 `toolName` 或缺少 tool metadata 的 `tool_call` / `tool_result` 记录
- **THEN** 系统 SHALL 使用通用工具消息 fallback 渲染该记录
- **THEN** 系统 SHALL NOT 因未知工具展示方式中断 app snapshot 渲染

#### Scenario: 工具消息不代表工具执行能力
- **WHEN** TUI 渲染 `tool_call` 或 `tool_result` 记录
- **THEN** 系统 SHALL NOT 因此要求已实现新的真实工具调用、工具执行或 tool result 回传模型
