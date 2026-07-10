## ADDED Requirements

### Requirement: ask_user_questions transcript 回答回执
系统 SHALL 为相邻且 `toolCallId` 匹配的 `ask_user_questions` `tool_call` / `tool_result` transcript pair 提供专用可读投影。该投影 SHALL 使用 `tool_call.argumentsText` 中的问题定义和 `tool_result.text` 中的回答或取消结果生成回答回执。已识别的成功和取消结果 SHALL 避免直接显示原始 JSON 字段；无法安全解析或缺少必要数据的记录 SHALL 使用通用工具消息 fallback。该投影 SHALL 只影响 TUI 可见渲染，不得改变 transcript record、tool result JSON、provider continuation 输入或 session 持久化内容。

#### Scenario: 显示单选回答回执
- **WHEN** transcript records 包含相邻且 `toolCallId` 匹配的 `ask_user_questions` tool call 和 `ok: true` tool result
- **AND** tool call arguments 包含一个未声明 `multiSelect: true` 的 question
- **AND** tool result 文本包含该 question 的 `selected` 答案
- **THEN** transcript 渲染 SHALL 显示可读的 `ask_user_questions` 工具调用摘要
- **THEN** tool result 投影 SHALL 显示 question 文本、`单选` 或等价题型标识以及被选 option label
- **THEN** tool result 投影 SHALL NOT 直接显示 `answers`、`index`、`selected` 等原始 JSON 字段名

#### Scenario: 显示多选回答回执
- **WHEN** transcript records 包含相邻且 `toolCallId` 匹配的 `ask_user_questions` tool call 和 `ok: true` tool result
- **AND** tool call arguments 包含一个声明 `multiSelect: true` 的 question
- **AND** tool result 文本包含该 question 的 `multiSelect: true` 和 `selectedOptions` 数组
- **THEN** tool result 投影 SHALL 显示 question 文本、`多选` 或等价题型标识
- **THEN** tool result 投影 SHALL 按 tool result 中的答案顺序显示所有被选 option label
- **THEN** tool result 投影 SHALL NOT 直接显示 `selectedOptions`、`multiSelect` 等原始 JSON 字段名

#### Scenario: 显示 Other 自定义文本回答
- **WHEN** `ask_user_questions` 成功 tool result 的某个 answer 包含 `customText`
- **THEN** tool result 投影 SHALL 在对应答案行显示用户输入的自定义文本
- **THEN** 自定义文本 SHALL 与对应 option label 合并为可读答案，例如 `Other：<text>` 或等价形式
- **THEN** tool result 投影 SHALL NOT 直接显示 `customText` 原始 JSON 字段名

#### Scenario: 显示取消回执
- **WHEN** transcript records 包含相邻且 `toolCallId` 匹配的 `ask_user_questions` tool call 和 `ok: false` tool result
- **AND** tool result 文本是包含 `cancelled: true` 的取消 JSON
- **THEN** transcript 渲染 SHALL 显示可读的 `ask_user_questions` 工具调用摘要
- **THEN** tool result 投影 SHALL 显示已取消状态
- **THEN** 如果取消 JSON 包含非空 `reason`，tool result 投影 SHALL 显示该取消原因
- **THEN** tool result 投影 SHALL NOT 直接显示 `cancelled` 或 `reason` 原始 JSON 字段名

#### Scenario: 无法解析时使用通用 fallback
- **WHEN** `ask_user_questions` tool pair 缺少可解析的 question arguments、answer result、取消 result 或 answer index 无法映射到 question
- **THEN** transcript 渲染 SHALL 使用通用工具消息 fallback 显示该 pair 或对应 record
- **THEN** transcript 渲染 SHALL NOT 抛出异常、中断 app snapshot 渲染或隐藏原始工具记录

#### Scenario: 回答回执按当前宽度重新投影
- **WHEN** 当前 transcript records 包含可解析的 `ask_user_questions` tool pair
- **AND** terminal columns 变化触发 app snapshot 重绘
- **THEN** 回答回执 SHALL 按新的 terminal width 重新计算换行和缩进
- **THEN** 回答回执 SHALL 继续遵守工具结果显示层截断策略
- **THEN** 重绘 SHALL NOT 改写 `tool_call` 或 `tool_result` transcript record 的事实内容
