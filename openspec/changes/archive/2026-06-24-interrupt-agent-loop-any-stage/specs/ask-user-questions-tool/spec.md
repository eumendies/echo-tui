## MODIFIED Requirements

### Requirement: ask_user_questions 第一版单选交互
系统 SHALL 逐题显示 `ask_user_questions` 的问题，每题 SHALL 使用单选 choice surface 收集一个答案。系统 SHALL 支持选择模型提供的预设选项，也 SHALL 支持通过 `Other` 选项输入自定义文本答案。`ask_user_questions` surface 活跃时，Esc SHALL 只取消当前问题请求并生成 cancelled tool result，不得同一次按键直接中断整个 assistant turn；surface 关闭后，若 assistant turn 仍 active，用户再次按 Esc 才 SHALL 中断 agent loop。

#### Scenario: 显示第一题
- **WHEN** agent loop 收到有效的 `ask_user_questions` tool call
- **THEN** TUI SHALL 暂停当前 tool continuation
- **THEN** TUI SHALL 使用 choice surface 显示第一道问题
- **THEN** choice surface SHALL 显示该问题的选项和 `Other` 输入选项

#### Scenario: 确认当前题并进入下一题
- **WHEN** 用户在某道问题上按 Enter 确认当前答案
- **AND** 该问题不是最后一道问题
- **THEN** 系统 SHALL 记录当前题的答案
- **THEN** TUI SHALL 显示下一道问题

#### Scenario: 确认最后一题并完成工具
- **WHEN** 用户在最后一道问题上按 Enter 确认当前答案
- **THEN** 系统 SHALL 记录当前题的答案
- **THEN** 系统 SHALL 生成 `ok: true` 的 tool result
- **THEN** 该 tool result 文本 SHALL 是包含所有答案的 JSON 字符串

#### Scenario: 用户取消提问
- **WHEN** `ask_user_questions` 请求处于活跃状态且用户按下 Esc
- **THEN** 系统 SHALL 关闭当前 choice surface
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 tool result 文本 SHALL 是包含 `cancelled: true` 和取消原因的 JSON 字符串
- **THEN** 系统 SHALL NOT 因用户取消而追加本地 error transcript record
- **THEN** 系统 SHALL NOT 因同一次 Esc 直接中断整个 assistant turn

#### Scenario: 取消 surface 后再次 Esc 中断 loop
- **WHEN** `ask_user_questions` 请求已因 Esc 取消并关闭 surface
- **AND** cancelled tool result 返回后 assistant turn 仍然 active
- **AND** 用户再次按下 Esc
- **THEN** 系统 SHALL 请求中断当前 agent loop
