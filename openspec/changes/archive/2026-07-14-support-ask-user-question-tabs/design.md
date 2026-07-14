## Context

`UserQuestionContext` 当前仅保存当前题的焦点、选择状态和 `Other` composer；用户按 Enter 后立即将答案追加到数组并重置 UI 状态进入下一题。这使已回答的问题不可回看或修改，也没有整体提交前的核对界面。

输入层已经把左右方向键映射为 `MOVE_LEFT` / `MOVE_RIGHT`。通用 choice card 已支持焦点、多选 checked 状态、内联输入与高度受限窗口化；但其单选 marker 目前直接从焦点推导，无法同时表达“已选答案”和“当前浏览焦点”。项目必须继续使用 ANSI footer 重绘和 raw-mode 输入，不引入第三方 TUI 库或 alternate screen。

## Goals / Non-Goals

**Goals:**

- 为包含两道及以上问题的请求提供可往返的问题 tab 和最终提交 tab。
- 为每道题持久保存答案草稿、option 焦点和 `Other` 输入内容；最终结果按原始问题顺序构造且 JSON 协议不变。
- 在提交前显示每道题的实时答案摘要与未完成状态，并阻止不完整答案提交。
- 在单选 UI 中清晰地区分选中状态与键盘焦点。
- 使 `Other` 焦点下的左右键继续编辑文本，而不是切换 tab。

**Non-Goals:**

- 不改变单问题请求的既有直接确认体验。
- 不支持鼠标点击、任意 tab 跳转快捷键或跨请求草稿恢复。
- 不改动模型 tool schema、tool result JSON 字段、取消结果或 transcript 持久化格式。

## Decisions

### 以 per-question draft 替代顺序 answers accumulator

活跃请求保存 `currentTabIndex` 和与问题数量等长的 `drafts`。每个 draft 包含 `focusedOptionIndex`、单选的显式 `selectedOptionIndex`、多选的 `checkedOptionIndexes` 与独立 `otherComposer`。提交时才从全部 drafts 构造 `AskUserQuestionsAnswer[]`。

这避免切换 tab 时重新初始化题目状态，也让提交页、完成校验和最终结果共享同一个事实来源。相比保留旧 `answers[]` 并在回退时做替换，per-question draft 不会出现答案数组与可编辑状态不同步的问题。

### 多题请求追加只读提交 tab

对两题及以上的请求，tab 序列为所有问题加一个末尾“提交” tab。问题 tab 仍使用 choice card 显示问题和选项；提交 tab 使用相同 card 显示按问题顺序排列的答案摘要、缺失题目和一个提交操作。单题请求不显示 tab 或提交页，以保持原有 Enter 直接完成的行为。

提交 tab 不维护第二份答案数据：它从 drafts 投影摘要，并在 Enter 时校验所有题目。存在缺失答案时保留 surface、显示校验反馈且不 resolve；全部有效时才创建成功 tool result。

### 左右键按 Other 焦点划分职责

多题请求中，当前焦点不在 `Other` 时，`MOVE_LEFT` / `MOVE_RIGHT` 在问题和提交 tab 间循环切换；焦点位于 `Other` 时，方向键交给 `applyComposerEditEvent`，仅移动文本光标。用户可先用 Up/Down 离开 `Other` 再切换 tab。

该方案选择保留编辑语义（方案 B），而非全局抢占左右键。它不需要变更底层 key parser，也保持普通 choice inline input 的既有契约。

### 扩展通用 choice surface，而不新增专用 surface kind

在 `ChoiceCommandSurface` 增加可选 tab 元数据和单选 option 的显式 selected 状态。仅有 tab 元数据的调用方渲染 tab 条；其他 choice 使用现有布局。渲染时焦点条始终由 `focusedIndex` 决定，单选 marker 在显式 selected 存在时由 selected 决定，未提供时维持既有“焦点即选中”兼容行为。

替代方案是新增 `user_questions` surface 和专属 renderer。该方案会复制 choice card 的输入、窗口化、光标及主题逻辑，且无法复用已有测试与布局约束，故不采用。

## Risks / Trade-offs

- [tab 条和提交摘要增加高度占用] → 复用 choice card 的高度预算和窗口化；空间不足时优先保留当前题选项、提交操作与摘要的完成/缺失状态。
- [单选 selected 与 focus 分离影响工具授权] → 新字段均为可选；没有 selected 字段的既有调用方保持旧 marker 行为。
- [用户在 Other 中不容易发现如何切 tab] → 按焦点动态显示输入提示，明确 Other 上左右键用于移动光标、需 Up/Down 离开输入项。
- [草稿校验与结果构造语义分叉] → 由同一组纯 helper 判断题目是否完成、投影摘要并创建答案，测试单选、多选和 Other 的边界情况。

## Migration Plan

该变更不涉及存储或外部协议迁移。发布时以代码与测试一并交付；若需回滚，可恢复 `UserQuestionContext` 的逐题状态模型和原 choice surface 投影。现有 transcript 中的 tool result 可继续按原格式渲染。

## Open Questions

无。tab 文案、状态标记和提交摘要均可在实现时遵循现有中文 choice surface UI 语言确定。
