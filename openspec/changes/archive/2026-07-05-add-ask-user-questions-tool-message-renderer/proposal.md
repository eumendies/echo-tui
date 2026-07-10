## Why

`ask_user_questions` 的 tool result 当前在 transcript 中以原始 JSON 展示，用户需要理解 `answers`、`selectedOptions`、`customText` 等字段才能看懂刚刚提交的回答。现在该工具已经支持单选、多选和 `Other` 自定义文本，继续展示 JSON 会降低会话历史的可读性，也与 bash、todo、apply_patch 等专用 tool message renderer 的体验不一致。

## What Changes

- 为 `ask_user_questions` 增加专用 pair-aware tool message renderer，把 tool call 与 tool result 合并渲染为可读的回答回执。
- 成功结果显示每题题目、单选/多选模式，以及用户选择的答案；自定义文本以 `Other：...` 或等价形式展示。
- 取消结果显示简洁的已取消状态和原因。
- 在 tool pair 渲染入口区分 pair-aware 分支和可分开渲染分支；无效参数、解析失败或历史记录缺少必要 metadata 时保留现有通用工具消息 fallback，不中断 transcript 渲染。
- 不改变 provider-facing tool result JSON、不改变 `ask_user_questions` 交互流程、不引入新的工具能力。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ask-user-questions-tool`: 增加 `ask_user_questions` tool call/result 在 transcript 中的专用可读渲染要求，避免成功回答和取消结果直接显示原始 JSON。

## Impact

- 影响渲染层：`src/render/tool-message-renderer.ts` 与新增或调整的 `src/render/tool-message-renderers/*` 模块。
- 影响测试：新增 renderer 单元测试，覆盖单选、多选、Other、自定义文本、取消、解析失败 fallback 和宽度换行/截断。
- 不影响工具执行协议、tool result JSON、agent/provider 输入、session 持久化 schema 或 footer user-question 交互。
