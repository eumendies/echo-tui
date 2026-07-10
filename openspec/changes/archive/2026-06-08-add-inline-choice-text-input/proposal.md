## Why

当前 tool approval 和 `ask_user_questions` 都只能在 choice surface 中选择预设项，用户无法在同一个交互面板里补充自由文本。下一步需要让用户在拒绝/改写高危工具调用、或回答模型问题时直接输入“告诉模型怎么做”的文本，且避免把系统生成的风险原因误当成用户反馈回传给模型。

## What Changes

- 为通用 choice surface 增加可选的内联文本输入选项：当选中该选项时显示灰色 placeholder 和光标，用户输入后 placeholder 消失。
- tool approval 增加第三个选项 `Tell model what to do`，提交非空文本后生成 `provide_feedback` 决策，并只把用户输入文本回传给模型。
- `ask_user_questions` 自动追加 `Other` 选项，提交非空文本后在成功答案 JSON 中包含 `customText`。
- 内联文本输入复用现有 composer 编辑语义，支持插入、删除、左右移动、Home/End 等基础编辑键。
- Esc、Deny 和普通预设选项继续保持原语义，不回传系统风险分类原因。

## Capabilities

### New Capabilities

- `inline-choice-text-input`: 定义 choice surface 内联文本输入选项的展示、编辑和提交行为。

### Modified Capabilities

- `interactive-choice-surface`: 增加 choice surface 对内联文本输入 option 的渲染与光标要求。
- `tool-approval`: 增加授权面板中的 `Tell model what to do` 文本反馈选项和决策语义。
- `ask-user-questions-tool`: 增加 `Other` 自定义文本答案及成功结果格式。

## Impact

- 影响 `src/types/command.ts` 中 choice surface 类型定义。
- 影响 `src/render/footer.ts` 中 choice surface 渲染、宽度计算和光标定位。
- 影响 `src/app/tool-approval-context.ts` 与 `src/app/user-question-context.ts` 的输入事件处理和结果构造。
- 影响 `src/tools/ask-user-questions-tool-handler.ts` 的答案类型与成功结果格式。
- 需要更新相关 renderer、context、agent runtime/tool result 测试。
