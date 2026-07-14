## 1. 用户问题草稿与导航状态

- [x] 1.1 将 `UserQuestionContext` 的多题请求状态重构为按问题保存焦点、单选已选项、多选勾选项和 `Other` composer 的 drafts。
- [x] 1.2 为多题请求实现问题 tab 与提交 tab 的左右切换，并保持每道题草稿不丢失。
- [x] 1.3 在非 `Other` 焦点时将左右键用于 tab 切换，在 `Other` 焦点时继续复用 composer 左右光标编辑。
- [x] 1.4 保持单题请求的 Enter 直接完成、Esc 取消和既有 tool result JSON 行为。

## 2. 提交校验与结果投影

- [x] 2.1 实现单选、多选与 `Other` 文本的统一有效答案校验及答案构造 helper。
- [x] 2.2 实现提交 tab 的答案摘要、未完成状态和 Enter 校验反馈。
- [x] 2.3 仅在所有问题有效回答后按原始问题索引顺序生成成功 tool result。

## 3. Choice surface 视觉扩展

- [x] 3.1 扩展 `ChoiceCommandSurface` 类型，支持可选 tab 元数据、当前 tab 和单选显式 selected 状态。
- [x] 3.2 在 choice card 中渲染 tab 导航条及完成、未完成、提交状态，并确保高度受限时保留当前 tab 上下文。
- [x] 3.3 分离单选 marker 的 selected 状态与焦点样式，并保持未使用新字段的既有 choice 调用方行为不变。
- [x] 3.4 根据普通 option 或 `Other` 焦点更新用户问题的操作提示。

## 4. 测试与验证

- [x] 4.1 更新 `UserQuestionContext` 测试，覆盖多题往返 tab、草稿保留、单选焦点与选中分离、Other 左右编辑和 Esc 取消。
- [x] 4.2 添加提交 tab 测试，覆盖答案预览、不完整校验、单选 Other 空文本、多选答案和原始索引顺序结果。
- [x] 4.3 更新 footer choice surface 测试，覆盖 tab 条、selected/focused 独立呈现及受限高度布局。
- [x] 4.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
