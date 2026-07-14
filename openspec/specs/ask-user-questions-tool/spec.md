# ask-user-questions-tool Specification

## Purpose
定义 `ask_user_questions` 交互式工具的参数、用户选择流程、取消语义和 tool result 格式。
## Requirements
### Requirement: ask_user_questions 工具定义
系统 SHALL 暴露名为 `ask_user_questions` 的 function tool，用于在模型无法安全或正确继续前向用户询问一个或多个选择题。该工具 SHALL 只在答案必要且无法从已有上下文或代码库推断时使用。每道 question 默认 SHALL 为单选；当 question 声明 `multiSelect: true` 时，该题 SHALL 允许用户选择多个答案。

#### Scenario: 默认暴露 ask_user_questions 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `ask_user_questions` 的 tool definition
- **THEN** 该 definition SHALL 声明工具用于向用户询问必要的澄清问题或偏好选择
- **THEN** 该 definition SHALL 要求参数为 JSON object

#### Scenario: 工具参数包含问题数组
- **WHEN** 模型调用 `ask_user_questions`
- **THEN** 参数 SHALL 包含 `questions` 数组
- **THEN** 每个 question SHALL 包含 `question` 文本
- **THEN** 每个 question SHALL 包含非空 `options` 数组
- **THEN** 每个 option SHALL 包含 `label`，并 MAY 包含 `description`
- **THEN** 每个 question MAY 包含 boolean `multiSelect`
- **THEN** 缺省 `multiSelect` 的 question SHALL 按单选题处理

#### Scenario: 工具参数拒绝无效多选标记
- **WHEN** 模型调用 `ask_user_questions`
- **AND** 任一 question 的 `multiSelect` 既不是 boolean 也不是缺省值
- **THEN** 系统 SHALL 返回 `ok: false` 的 tool result
- **THEN** 失败结果 SHALL 包含可回传模型的简洁错误说明

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

### Requirement: ask_user_questions 结果格式
`ask_user_questions` 的成功结果 SHALL 使用结构化 JSON 文本返回给模型。每个答案 SHALL 使用问题索引标识对应回答；单选答案 SHALL 使用被选 option 的 `selected` label， 多选答案 SHALL 使用 `selectedOptions` label 数组并显式包含 `multiSelect: true`。当用户提交自定义文本答案时，答案 SHALL 额外包含 `customText`，使模型可以继续当前任务。成功结果 SHALL NOT 重复回传完整 question 文本或 option description。

#### Scenario: 单选成功结果包含答案数组
- **WHEN** 用户完成所有问题
- **AND** 某个 answer 对应单选 question
- **THEN** tool result 文本 SHALL 包含 `answers` 数组
- **THEN** 该 answer SHALL 包含对应问题的 0-based `index`
- **THEN** 该 answer SHALL 包含被选选项的 `selected`
- **THEN** `selected` SHALL 等于被选 option 的 label
- **THEN** 该 answer SHALL NOT 常态包含完整 `question` 文本或 option `description`

#### Scenario: 多选成功结果包含答案数组
- **WHEN** 用户完成所有问题
- **AND** 某个 answer 对应 `multiSelect: true` 的 question
- **THEN** 该 answer SHALL 包含对应问题的 0-based `index`
- **THEN** 该 answer SHALL 包含 `multiSelect: true`
- **THEN** 该 answer SHALL 包含 `selectedOptions` 数组
- **THEN** `selectedOptions` SHALL 按用户问题 option 的原始顺序列出所有已选 option label
- **THEN** 该 answer SHALL NOT 包含单值 `selected`
- **THEN** 该 answer SHALL NOT 常态包含完整 `question` 文本或 option `description`

#### Scenario: 成功结果包含自定义文本
- **WHEN** 用户通过 `Other` 提交某道问题的自定义文本答案
- **THEN** 对应 answer SHALL 包含 `customText`
- **THEN** `customText` SHALL 等于用户输入文本
- **THEN** 单选 answer 的 `selected` SHALL 表示用户选择了自定义输入选项
- **THEN** 多选 answer 的 `selectedOptions` SHALL 包含自定义输入选项的 label

#### Scenario: 参数无效时返回失败结果
- **WHEN** `ask_user_questions` 参数不是合法 JSON object、`questions` 为空、question 缺少 options、option label 为空或 `multiSelect` 类型无效
- **THEN** 系统 SHALL 返回 `ok: false` 的 tool result
- **THEN** 失败结果 SHALL 包含可回传模型的简洁错误说明

### Requirement: ask_user_questions 自定义文本答案
`ask_user_questions` SHALL 为每道单选问题提供 `Other` 自定义文本选项。用户通过该选项提交非空文本时，成功结果 SHALL 在对应 answer 中包含 `customText`。

#### Scenario: 显示 Other 选项
- **WHEN** `ask_user_questions` 请求正在等待用户回答某一道题
- **THEN** choice surface SHALL 显示模型提供的选项
- **THEN** choice surface SHALL 额外显示支持内联文本输入的 `Other` 选项

#### Scenario: 提交自定义文本答案
- **WHEN** 用户选中 `Other`
- **AND** 用户输入非空文本并按 Enter
- **THEN** 系统 SHALL 记录当前题的答案
- **THEN** 该答案 SHALL 包含 `customText`，值等于用户输入文本

#### Scenario: 自定义文本答案使用索引关联题目
- **WHEN** 用户通过 `Other` 完成某道问题
- **THEN** 成功结果中的 answer SHALL 使用该问题的 0-based `index` 关联题目
- **THEN** 成功结果中的 answer SHALL 包含 `selected` 表示 `Other`
- **THEN** 成功结果中的 answer SHALL 包含 `customText`
- **THEN** 成功结果中的 answer SHALL NOT 重复完整 question 文本

### Requirement: ask_user_questions 多选交互
系统 SHALL 对声明 `multiSelect: true` 的问题显示可多选的用户问题 choice surface。用户问题 choice surface SHALL 在答案 section 标题中显式标明当前题是单选或多选。多选题 SHALL 使用键盘焦点表示当前操作行，使用 checked 状态表示已选答案；用户 SHALL 能通过 Space 切换普通选项，通过 Enter 确认当前题的所有已选答案，通过 Esc 取消整个 `ask_user_questions` 请求。

#### Scenario: 显示多选题
- **WHEN** agent loop 收到有效的 `ask_user_questions` tool call
- **AND** 当前 question 声明 `multiSelect: true`
- **THEN** TUI SHALL 暂停当前 tool continuation
- **THEN** TUI SHALL 使用 choice surface 显示该问题
- **THEN** choice surface SHALL 显示该问题的所有选项和 `Other` 输入选项
- **THEN** choice surface SHALL 使用 `答案（多选）` 或等价标题标明当前题允许多选
- **THEN** choice surface SHALL 表达当前键盘焦点和每个选项的 checked 状态

#### Scenario: 显示单选题型标识
- **WHEN** agent loop 收到有效的 `ask_user_questions` tool call
- **AND** 当前 question 未声明 `multiSelect: true`
- **THEN** TUI SHALL 使用 choice surface 显示该问题
- **THEN** choice surface SHALL 使用 `答案（单选）` 或等价标题标明当前题为单选

#### Scenario: 切换普通多选选项
- **WHEN** 多选 question 正在等待用户回答
- **AND** 当前键盘焦点位于模型提供的普通 option
- **AND** 用户按下 Space
- **THEN** 系统 SHALL 切换该 option 的 checked 状态
- **THEN** TUI SHALL 保持在当前 question 并重绘 choice surface

#### Scenario: 确认多选题并进入下一题
- **WHEN** 用户在某道多选 question 上按 Enter 确认当前答案
- **AND** 至少一个普通 option 被 checked 或 `Other` 输入文本非空
- **AND** 该 question 不是最后一道问题
- **THEN** 系统 SHALL 记录当前题的所有已选答案
- **THEN** TUI SHALL 显示下一道问题

#### Scenario: 确认最后一道多选题并进入提交 tab
- **WHEN** 用户在最后一道多选 question 上按 Enter 确认当前答案
- **AND** 至少一个普通 option 被 checked 或 `Other` 输入文本非空
- **AND** `ask_user_questions` 包含两道或以上问题
- **THEN** 系统 SHALL 保存当前题的所有已选答案草稿
- **THEN** TUI SHALL 显示提交 tab
- **THEN** 系统 SHALL NOT 在用户确认提交 tab 前生成成功 tool result

#### Scenario: 单道多选题直接完成
- **WHEN** `ask_user_questions` 仅包含一道多选 question
- **AND** 至少一个普通 option 被 checked 或 `Other` 输入文本非空
- **AND** 用户按 Enter 确认当前答案
- **THEN** 系统 SHALL 生成 `ok: true` 的 tool result
- **THEN** 该 tool result 文本 SHALL 是包含该答案的 JSON 字符串

#### Scenario: 空多选答案不能提交
- **WHEN** 多选 question 正在等待用户回答
- **AND** 没有普通 option 被 checked
- **AND** `Other` 输入文本为空
- **AND** 用户按 Enter
- **THEN** 系统 SHALL NOT 完成当前 question
- **THEN** TUI SHALL 保持当前 choice surface 可继续选择或输入

#### Scenario: 多选 Other 文本自动纳入答案
- **WHEN** 多选 question 正在等待用户回答
- **AND** 用户在 `Other` 输入项中输入非空文本
- **AND** 用户按 Enter 确认当前题
- **THEN** 系统 SHALL 将 `Other` 作为当前题的一个已选答案
- **THEN** 对应 answer SHALL 包含 `customText`
- **THEN** `customText` SHALL 等于用户输入文本

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

