## 1. Renderer 数据解析

- [x] 1.1 新增 `ask_user_questions` tool message renderer 模块，解析 `tool_call.argumentsText` 中的 `questions`、`question`、`multiSelect` 和 option label。
- [x] 1.2 解析 `tool_result.text` 中的成功回答 JSON，支持单选 `selected`、多选 `selectedOptions`、answer `index` 和可选 `customText`。
- [x] 1.3 解析 `tool_result.text` 中的取消 JSON，识别 `cancelled: true` 和可选非空 `reason`。
- [x] 1.4 对 JSON 解析失败、字段类型不匹配、answer index 越界或 question/result 不一致的情况返回 `null`，供通用 fallback 接管。

## 2. 可见投影实现

- [x] 2.1 实现成功回答回执行，显示工具调用摘要、每题题目、`单选`/`多选` 标识和已选答案。
- [x] 2.2 实现 `Other` 自定义文本展示，把 `customText` 合并为 `Other：<text>` 或等价答案行，避免显示 JSON 字段名。
- [x] 2.3 实现取消回执行，显示已取消状态和可用取消原因，避免显示原始取消 JSON 字段名。
- [x] 2.4 复用现有工具消息 wrapping、theme 和显示层截断策略，确保窄终端和长答案不会破坏 transcript 布局。

## 3. 渲染路径接入

- [x] 3.1 在 `renderToolPairBlock` 中建立 pair-aware 与 split-render 两条分支，并为相邻 `ask_user_questions` tool pair 接入专用 pair-aware renderer。
- [x] 3.2 在 pair-aware renderer 返回 `null` 时进入 split-render 路径，保持非相邻单条 `tool_call` / `tool_result`、未知工具和无效历史记录的现有 fallback 行为不变。
- [x] 3.3 保持 tool call prefix 成功/失败状态着色、block 间空行和当前 theme 使用语义不变。

## 4. 测试与验证

- [x] 4.1 添加 renderer 测试覆盖单选成功、多选成功、多题结果和不显示原始 JSON 字段名。
- [x] 4.2 添加 renderer 测试覆盖 `Other` 自定义文本、取消结果和取消原因展示。
- [x] 4.3 添加 fallback 测试覆盖无法解析 arguments、无法解析 result、answer index 越界和无效 answer shape。
- [x] 4.4 添加布局测试覆盖窄宽度换行、显示层截断和成功/失败 prefix 状态样式保持。
- [x] 4.5 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
