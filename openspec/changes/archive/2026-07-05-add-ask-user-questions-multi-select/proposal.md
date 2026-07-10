## Why

`ask_user_questions` 目前只能表达逐题单选，模型在需要用户同时确认多个偏好、范围或候选项时只能退化为多道单选题或让用户输入自由文本。为减少澄清轮次并提高结构化答案质量，需要为该交互式工具补充明确的多选语义。

## What Changes

- `ask_user_questions` 的每道 question 支持可选 `multiSelect` boolean 字段；默认仍为单选，保持现有调用兼容。
- 多选题在用户问题 choice card 中使用 Space 切换普通选项，Enter 确认当前题的所有已选项。
- choice surface 将“键盘焦点”和“选中状态”拆开表达：焦点行负责高亮与窗口化，多选 checked 状态负责 `●/○` marker。
- `Other` 内联输入继续作为自定义答案入口；多选题中非空 `Other` 文本自动纳入已选答案，且输入区域不被焦点背景覆盖。
- 成功 tool result 保持单选答案的既有 `selected` 格式；多选答案使用新的 `selectedOptions` 数组返回。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ask-user-questions-tool`: 扩展工具参数、逐题交互和成功结果格式，使单个问题可以声明并提交多选答案。
- `interactive-choice-surface`: 扩展通用 choice card 的状态语义，使调用方可以区分当前键盘焦点和多选 checked 状态。

## Impact

- 影响类型与工具协议：`src/types/tool.ts`、`src/tools/ask-user-questions-tool-handler.ts`。
- 影响用户问题状态机：`src/app/state/user-question-context.ts`。
- 影响 choice surface 类型与渲染：`src/types/command.ts`、`src/render/footer/choice-surface.ts`。
- 影响相关测试：tool schema/parser/result、user question 交互、footer choice 渲染。
- 不引入新依赖，不改变 terminal raw mode、ANSI 渲染和不使用 alternate screen 的约束。
