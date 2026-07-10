## 1. 渲染边界与工具分发

- [x] 1.1 调整 `renderRecordBlock()` 的 tool 分支，使 `tool_call` / `tool_result` 进入 tool-aware renderer，而不是直接复用 assistant block。
- [x] 1.2 实现按 `toolName` 分发的最小工具消息渲染边界，并为未知工具或缺少 metadata 的旧记录保留通用 fallback。
- [x] 1.3 为工具消息补充宽度感知 wrapping，确保 resize 后能按当前 terminal width 重新投影。

## 2. Bash 工具专属展示

- [x] 2.1 实现 bash tool call 展示：`run_bash_command` 的 `tool_call` 显示为 `Bash('command')`，不显示原始 JSON arguments。
- [x] 2.2 实现 bash tool result 展示：使用灰色弱化样式、`⎿` 前缀和 continuation 缩进。
- [x] 2.3 从 bash tool result 中派生用户友好的可见输出，隐藏 `exit_code`、`duration_ms`、`timed_out`、`truncated` 等执行摘要行。
- [x] 2.4 覆盖 stdout、stderr、无输出、timeout 和旧 session fallback 的显示行为。
- [x] 2.5 增加 display-only 截断，长 tool result 显示截断提示但不改写 transcript record 内容。

## 3. 数据边界与兼容性

- [x] 3.1 如需新增 display-only 字段，扩展 `ToolExecutionResult` / transcript record 类型，并确保 OpenAI converter 继续使用完整 `text` 作为 `function_call_output`。
- [x] 3.2 确保 app turn lifecycle 仍持久化完整 tool metadata，`/resume` 后旧会话和新会话都能渲染。
- [x] 3.3 确保 bash tool handler 不输出 ANSI 样式，颜色和截断只发生在 render 层。

## 4. 测试与文档

- [x] 4.1 更新 render 单元测试，覆盖 bash call、bash result、灰色前缀、wrapping、截断和 fallback。
- [x] 4.2 更新 app flow 测试，确认 tool records 仍追加、持久化并传入 agent，不因展示变化改变 provider input。
- [x] 4.3 更新 README 中 tool call 展示说明。
- [x] 4.4 运行验证：`npm run build`、`npm run typecheck`、`npm test`、`find bin src test -name '*.js' -exec node --check {} \;`、`node --check dist/bin/echo-tui.js`、`npx -y @fission-ai/openspec@latest validate improve-tool-call-message-rendering --strict`。
