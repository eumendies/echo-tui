## Why

当前 `ask_user_questions` 以逐题确认并自动前进的方式收集答案。用户在多题请求中无法在问题之间来回查看或修改已选答案，也无法在提交前整体核对，容易导致误选后只能取消并重新开始。

## What Changes

- 多题 `ask_user_questions` 交互改为带问题 tab 和最终提交 tab 的草稿式流程。
- 支持使用左右方向键在非 `Other` 输入项焦点时切换问题 tab 与提交 tab；焦点位于 `Other` 时保留左右键的文本光标编辑语义。
- 为每道问题独立保存单选、多选、焦点和 `Other` 文本草稿，允许回到已回答的问题查看和修改。
- 在提交 tab 展示每道问题的当前答案或未完成状态；仅当所有问题均有效回答后才允许提交。
- 单选 choice surface 的已选状态与键盘焦点分离，避免切换焦点时丢失已选答案的可见标记。
- 保持 `ask_user_questions` 参数 schema、取消语义和成功 tool result JSON 格式不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ask-user-questions-tool`: 多题问题的导航、草稿保存、提交校验与答案预览行为。
- `interactive-choice-surface`: choice card 对 tab 导航和单选已选状态独立于焦点的可视表达。

## Impact

- 影响 `src/app/state/user-question-context.ts` 的交互状态和按键处理。
- 影响 `src/types/command.ts` 与 `src/render/footer/choice-surface.ts` 的 choice surface 投影及渲染。
- 影响 `test/app/app-context.test.js`、`test/render/footer.test.js` 等覆盖用户问题状态和 choice card 的测试。
- 不新增依赖、不修改 provider tool definition 或 tool result 协议。
