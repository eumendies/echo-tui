## 1. 类型与渲染基础

- [x] 1.1 扩展 `ChoiceCommandSurface` option 类型，支持声明内联文本输入、placeholder、当前文本和 cursor 位置。
- [x] 1.2 更新 choice surface 宽度计算，使输入项 label、placeholder 和当前文本参与 box 宽度计算。
- [x] 1.3 更新 choice surface 渲染逻辑，在输入项中显示灰色 placeholder、用户文本和正确的 footer cursor 位置。
- [x] 1.4 为 choice surface 内联输入渲染、placeholder、编号、选中态和 cursor 行列增加 renderer 测试。

## 2. Tool approval 文本反馈

- [x] 2.1 在 `tool-approval-context` 中为活跃请求维护内联输入 composer state。
- [x] 2.2 将 tool approval 选项扩展为 `Allow once`、`Deny` 和 `Tell model what to do`。
- [x] 2.3 当选中反馈选项时，将文本编辑事件转发给现有 composer ops，并在 Up/Down 切换时保留输入文本。
- [x] 2.4 提交非空反馈文本时返回 `provide_feedback` 决策，并确保原始 tool call 不执行。
- [x] 2.5 更新 tool approval 和 agent runtime 测试，覆盖允许、拒绝、Esc、反馈文本以及不回传系统风险原因。

## 3. ask_user_questions 自定义答案

- [x] 3.1 扩展 `AskUserQuestionsAnswer`，支持 `customText` 字段。
- [x] 3.2 在每道用户问题的 choice surface 中追加支持内联输入的 `Other` 选项。
- [x] 3.3 在 `user-question-context` 中为当前题维护 Other 输入 composer state，并复用 composer ops 处理编辑事件。
- [x] 3.4 提交非空 Other 文本时记录 `selectedOption.label = "Other"` 和 `customText`，并继续下一题或完成请求。
- [x] 3.5 更新 ask_user_questions context 和 tool result 测试，覆盖预设选项、自定义文本、多题流程和取消流程。

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`。
- [x] 4.2 运行 `npm test`。
- [x] 4.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
