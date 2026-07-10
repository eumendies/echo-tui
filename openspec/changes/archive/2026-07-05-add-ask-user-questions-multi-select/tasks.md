## 1. Tool 协议与类型

- [x] 1.1 扩展 `AskUserQuestion` 类型，支持可选 `multiSelect?: boolean`，并扩展答案类型以表达单选 `selectedOption` 与多选 `selectedOptions`。
- [x] 1.2 更新 `ask_user_questions` tool definition 描述和 JSON schema，暴露 question 级 `multiSelect` boolean 字段且默认单选。
- [x] 1.3 更新 `parseAskUserQuestionsArgs()`，接受 boolean `multiSelect`、保留缺省单选行为，并拒绝非 boolean 值。
- [x] 1.4 更新成功 result builder，使单选答案继续输出 `selected`，多选答案输出 `multiSelect: true` 和 `selectedOptions`。

## 2. Choice Surface 状态语义

- [x] 2.1 将 `ChoiceCommandSurface.selectedIndex` 重命名为 `focusedIndex`，并仅在 choice surface 链路中适配调用方和测试。
- [x] 2.2 新增 choice option 级 `checked?: boolean` 与 surface 级 `selectionMode?: 'single' | 'multiple'`，用于表达多选 checked 状态。
- [x] 2.3 更新 `ToolApprovalContext` 对 choice surface 的投影，使用 `focusedIndex` 保持现有单选授权行为不变。
- [x] 2.4 更新 choice renderer，使焦点控制 `▌`、active background、cursor 和窗口化，marker 在单选中跟随焦点、在多选中跟随 `checked`。

## 3. User Question 多选交互

- [x] 3.1 更新 `UserQuestionContext` 状态，将当前行命名为 `focusedOptionIndex`，并为当前多选题维护 `checkedOptionIndexes`。
- [x] 3.2 更新 surface 投影：单选题保持现有交互；多选题设置 `selectionMode: 'multiple'`，为普通选项投影 checked 状态，并让非空 `Other` 文本表现为已选。
- [x] 3.3 更新输入处理：多选题中 Up/Down 移动焦点，Space 切换普通选项，焦点在 `Other` 时 Space 作为文本输入处理，Enter 在至少一个答案存在时确认。
- [x] 3.4 更新逐题确认逻辑：多选答案按原始 option 顺序收集，非空 `Other` 追加自定义答案，进入下一题时重置焦点、checked 状态和 `Other` composer。
- [x] 3.5 保持 Esc 取消语义不变：关闭当前 user question surface 并返回 cancelled tool result，不因同一次 Esc 中断 assistant turn。

## 4. 测试与验证

- [x] 4.1 更新 tool schema/parser/result 单元测试，覆盖 `multiSelect` 暴露、默认单选、无效类型拒绝、单选兼容结果和多选结果格式。
- [x] 4.2 增加 `UserQuestionContext` 多选交互测试，覆盖 Space toggle、空答案不能提交、Other 非空自动纳入、逐题切换和 Esc 行为。
- [x] 4.3 更新 footer choice 渲染测试，覆盖 `focusedIndex`、多选 checked marker、焦点与 checked 分离，以及 inline input 输入区不被 active background 覆盖。
- [x] 4.4 运行 `npm run typecheck`。
- [x] 4.5 运行 `npm test`。
- [x] 4.6 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
