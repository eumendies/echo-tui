## MODIFIED Requirements

### Requirement: ask_user_questions 第一版单选交互
系统 SHALL 使用 choice surface 收集 `ask_user_questions` 的单选答案，并支持模型提供的预设选项和 `Other` 自定义文本答案。单题请求 SHALL 保持按 Enter 直接完成的交互；包含两道或以上问题的请求 SHALL 提供各问题 tab 和末尾提交 tab，以便用户在提交前查看或修改每道题的草稿。`ask_user_questions` surface 活跃时，Esc SHALL 只取消当前问题请求并生成 cancelled tool result，不得同一次按键直接中断整个 assistant turn；surface 关闭后，若 assistant turn 仍 active，用户再次按 Esc 才 SHALL 中断 agent loop。

#### Scenario: 显示第一题
- **WHEN** agent loop 收到有效的 `ask_user_questions` tool call
- **THEN** TUI SHALL 暂停当前 tool continuation
- **THEN** TUI SHALL 使用 choice surface 显示第一道问题
- **THEN** choice surface SHALL 显示该问题的选项和 `Other` 输入选项

#### Scenario: 单题请求直接完成
- **WHEN** `ask_user_questions` 仅包含一道单选问题
- **AND** 用户在有效答案上按 Enter
- **THEN** 系统 SHALL 生成 `ok: true` 的 tool result
- **THEN** 该 tool result 文本 SHALL 是包含该答案的 JSON 字符串

#### Scenario: 多题请求显示问题与提交 tab
- **WHEN** `ask_user_questions` 包含两道或以上问题
- **THEN** choice surface SHALL 显示每道问题对应的 tab 和一个末尾提交 tab
- **THEN** 初始激活的 tab SHALL 是第一道问题
- **THEN** 每个问题 tab SHALL 显示该问题当前保存的草稿状态

#### Scenario: 在非 Other 焦点切换 tab
- **WHEN** 多题 `ask_user_questions` 请求正在等待用户回答
- **AND** 当前焦点不位于 `Other` 输入项
- **AND** 用户按下 Left 或 Right
- **THEN** TUI SHALL 切换到相邻的问题 tab 或提交 tab
- **THEN** 系统 SHALL 保留所有问题已保存的选择、焦点和 `Other` 输入文本

#### Scenario: 在 Other 焦点保留左右编辑
- **WHEN** 多题 `ask_user_questions` 请求正在等待用户回答
- **AND** 当前焦点位于 `Other` 输入项
- **AND** 用户按下 Left 或 Right
- **THEN** 系统 SHALL 将按键用于移动 `Other` 输入文本的光标
- **THEN** TUI SHALL NOT 因该按键切换 tab

#### Scenario: 修改已回答问题
- **WHEN** 用户已为某道问题保存有效草稿
- **AND** 用户切换到另一道问题后再返回原问题 tab
- **THEN** TUI SHALL 显示该问题先前的答案和 `Other` 输入文本
- **THEN** 用户 SHALL 能修改该问题的选择或自定义文本

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

### Requirement: ask_user_questions 多题提交校验与预览
对于包含两道或以上问题的 `ask_user_questions` 请求，系统 SHALL 在提交 tab 按原始问题顺序展示每道题的当前答案摘要或未完成状态。系统 SHALL 仅在所有问题均具有有效答案时生成成功 tool result；提交结果 SHALL 按原始问题索引顺序构造，不受用户切换 tab 或修改答案的顺序影响。

#### Scenario: 提交 tab 预览答案
- **WHEN** 用户切换到多题请求的提交 tab
- **THEN** TUI SHALL 显示每道问题的文本或可识别摘要
- **THEN** TUI SHALL 显示单选答案、多选已勾选答案和非空 `Other` 自定义文本
- **THEN** TUI SHALL 显示尚未具有有效答案的问题为未完成

#### Scenario: 未完成时不能提交
- **WHEN** 用户位于提交 tab
- **AND** 至少一道问题没有有效答案
- **AND** 用户按 Enter
- **THEN** 系统 SHALL NOT 生成成功 tool result 或结束当前请求
- **THEN** TUI SHALL 保持提交 tab 可见
- **THEN** TUI SHALL 显示缺失答案的校验反馈

#### Scenario: 全部完成后提交
- **WHEN** 用户位于提交 tab
- **AND** 每道问题均具有有效答案
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 生成 `ok: true` 的 tool result
- **THEN** tool result 的 `answers` SHALL 按问题的 0-based 索引升序排列
- **THEN** 系统 SHALL 结束当前用户问题请求

#### Scenario: 单选 Other 空文本视为未完成
- **WHEN** 单选问题的当前选择为 `Other`
- **AND** 该题 `Other` 输入文本为空或仅包含空白
- **THEN** 系统 SHALL 将该问题视为未完成
- **THEN** 系统 SHALL NOT 允许其作为成功提交答案

#### Scenario: 多选题的有效答案
- **WHEN** 多选问题至少有一个普通 option 被 checked
- **OR** 多选问题的 `Other` 输入文本非空
- **THEN** 系统 SHALL 将该问题视为已完成

## ADDED Requirements

### Requirement: 多题单选状态独立于焦点
多题 `ask_user_questions` 的单选问题 SHALL 将当前已选答案与当前键盘焦点分别保存。用户移动 option 焦点或切换 tab SHALL NOT 改变已选答案，除非用户显式确认新的单选 option 或选择有效的 `Other` 文本。

#### Scenario: 移动焦点不替换单选答案
- **WHEN** 用户已在单选问题中选择一个普通 option
- **AND** 用户使用 Up 或 Down 将键盘焦点移动到其他 option
- **THEN** 原 option SHALL 继续显示为已选答案
- **THEN** 新焦点 SHALL 仅表达当前可操作 option

#### Scenario: 切换 tab 不替换单选答案
- **WHEN** 用户已在单选问题中选择有效答案
- **AND** 用户切换到另一 tab 后返回该问题
- **THEN** 原答案 SHALL 保持已选
- **THEN** 该问题的键盘焦点 SHALL 恢复为离开前的焦点位置
