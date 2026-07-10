## 1. Tool 类型与本地执行层

- [x] 1.1 新增 provider-neutral tool 类型定义，覆盖 tool definition、tool call、tool result、handler、registry 和 executor contract。
- [x] 1.2 实现 tool registry，支持注册工具、按名称查找 handler、暴露启用工具定义列表。
- [x] 1.3 实现 tool executor，负责解析 JSON arguments、处理未知工具、归一化 handler 结果和失败结果。
- [x] 1.4 实现 `run_bash_command` bash handler，使用非交互 shell 在当前工作区运行命令。
- [x] 1.5 为 bash handler 增加 timeout、max output bytes、stdout/stderr/exit code/duration/timedOut/truncated 结果格式化。

## 2. 配置与默认启用策略

- [x] 2.1 扩展用户配置读取，支持 timeout、max output bytes，并对无效值使用安全默认。
- [x] 2.2 在 app/agent 组合根中创建默认 tool registry；默认注册已开发的 bash tool。
- [x] 2.3 更新文档示例，说明 bash tool 非交互执行且不提供沙箱保证。

## 3. Transcript 与 OpenAI input 映射

- [x] 3.1 扩展 tool transcript record 结构，保存 tool call id、tool name、arguments、ok、exitCode、timedOut、truncated、duration 等 metadata。
- [x] 3.2 扩展 OpenAI transcript converter，使 `tool_call` record 映射为 `function_call` item，`tool_result` record 映射为 `function_call_output` item。
- [x] 3.3 保持 `error` 和未知 role 过滤行为，并覆盖恢复 session 后 tool records 可重建 provider input。
- [x] 3.4 新增 OpenAI tool schema converter/helper，把本地 tool definitions 转为 Responses API function tools。

## 4. OpenAI tool call loop

- [x] 4.1 扩展 agent callback contract，支持 assistant segment、tool call 和 tool result 事件，同时保持现有文本 streaming 行为。
- [x] 4.2 扩展 OpenAI request 构造：registry 非空时发送 tools，registry 为空时不发送 tools。
- [x] 4.3 解析 OpenAI function call stream 事件，使用完成后的 arguments 执行工具，避免使用 partial arguments。
- [x] 4.4 实现 tool call loop：追加 tool call 事件、执行工具、追加 tool result 事件、携带 `function_call_output` 继续请求模型。
- [x] 4.5 使用模型停止请求工具作为 function call loop 的正常退出条件。
- [x] 4.6 确保非零 exit code、timeout、截断等业务失败作为 tool result 回传模型，而不是直接变成本地 error。

## 5. App turn lifecycle 集成

- [x] 5.1 扩展 TurnContext/AppContext，支持在 response lock 内追加 tool_call/tool_result records 并清理 pending draft。
- [x] 5.2 在 `main.ts` agent callbacks 中处理 assistant segment、tool call、tool result 和最终 completion 的 transcript append 与持久化。
- [x] 5.3 确保 tool call loop 期间保持 response lock，失败时追加 error record、清 pending 并释放 response lock。
- [x] 5.4 确保 `/resume` 后包含 tool metadata 的 records 能继续传入 agent 并参与 provider input 重建。

## 6. 测试与验证

- [x] 6.1 增加 tool registry/executor/bash handler 单元测试，覆盖成功、非零退出、timeout、输出截断、未知工具、无效 arguments。
- [x] 6.2 增加配置读取测试，覆盖默认限制值、显式限制值和无效限制值归一化。
- [x] 6.3 增加 OpenAI converter 测试，覆盖 tool_call/tool_result input item、tools schema 和 error 过滤。
- [x] 6.4 增加 OpenAI agent loop 测试，覆盖 function call、continuation request、多工具顺序和工具失败回传。
- [x] 6.5 增加 app flow 测试，覆盖 tool_call/tool_result append、response lock、持久化、失败释放和 `/resume` 后继续对话。
- [x] 6.6 运行必要验证：`npm run build`、`npm run typecheck`、`npm test`、`find bin src test -name '*.js' -exec node --check {} \;`、`node --check dist/bin/echo-tui.js`、`npx -y @fission-ai/openspec@latest validate add-bash-tool-call-loop --strict`。
