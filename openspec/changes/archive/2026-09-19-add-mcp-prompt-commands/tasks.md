## 1. MCP client 与 manager 的 prompts 能力

- [x] 1.1 `src/mcp/client.ts`：`supportsPrompts()` capability 判定、`listPrompts(limit)`（分页有界）、`getPrompt(name, args)`（messages 与内容块的窄投影）
- [x] 1.2 `src/mcp/manager.ts`：bootstrap/reload 按 capability 拉取并缓存 prompt 目录（条目与描述有界），失败降级为空目录并记录脱敏诊断
- [x] 1.3 `src/mcp/manager.ts`：暴露 `listPrompts()`、`getPrompt(serverName, promptName, args)` 与命令描述符数据；未知 server/prompt 返回明确错误
- [x] 1.4 `notifications/prompts/list_changed`：只标记目录失效并在下一次读取前重新拉取，不重连进程、不中断进行中的 run

## 2. 命令注册与 host 端口

- [x] 2.1 新增 `src/commands/mcp-prompt-command-handler.ts`：匹配 `/<server>:<prompt>`、名称归一（空白与 `/` 转 `-`）、未命中时打开列出可用名称的 `info` surface
- [x] 2.2 在默认 handlers 中注册该 handler，位置在内置命令之后、`SkillInvocationCommandHandler` 之前
- [x] 2.3 把 prompt 命令描述符合并进 `src/app/main.ts` 的 slash suggestion 来源；未启用 MCP 时为空清单
- [x] 2.4 扩展 MCP command port：读取 prompt 目录、按名取回 messages、提供描述符；handler 不直接持有 `McpManager`

## 3. 参数解析与注入

- [x] 3.1 参数解析：位置参数按 `arguments` 顺序映射，支持 `key=value` 覆盖
- [x] 3.2 缺少必填参数时打开 `choice` surface 逐项收集；取消时保持 composer 可用且不注入
- [x] 3.3 无参数 prompt 提交后直接注入，不要求二次确认
- [x] 3.4 messages 拼接：按序拼接为单条用户消息，文本前加 `[user]` / `[assistant]` 标签；非文本块转占位符（图片 mime + 字节数、embedded resource uri + `read_mcp_resource` 提示）
- [x] 3.5 拼接结果超过 20,000 UTF-8 bytes 时截断并追加 marker
- [x] 3.6 提交结果：`displayText` 为用户输入的 `/<server>:<prompt>` 文本，user record 携带 `metadata.mcpPrompt: {server, name, argumentsText}`
- [x] 3.7 边界确认：不进入工具审批；plan 与只读运行走同一用户消息路径；headless 不注册；子 Agent 不暴露 prompts

## 4. 测试

- [x] 4.1 `test/mcp/manager.test.js`：capability 门控、method not found 降级、目录上限、list_changed 失效重拉、`getPrompt` 代理与未知 server 错误
- [x] 4.2 新增 `test/commands/mcp-prompt-command-handler.test.js`：命名与优先级、位置与键值参数、缺参收集、取消、未命中 info surface
- [x] 4.3 注入形态测试：多 role 拼接带标签、非文本占位符、超长截断、displayText 与 `metadata.mcpPrompt`
- [x] 4.4 `test/app/command-host.test.js`：prompt 描述符与取消息均通过 host 端口，未启用 MCP 时为空
- [x] 4.5 runtime 端到端：命令注入后 provider 只看到一条 user message，且 `/resume` 重放保持展示与元数据

## 5. 文档

- [x] 5.1 `README.md`：说明 `/<server>:<prompt>` 用法、参数形态与注入形态
- [x] 5.2 `docs/tui-architecture.md`：MCP manager 行、命令注册行与建议清单来源同步
- [x] 5.3 不向 `echo-tui-setup` skill 增加运行时行为说明（prompts 无配置面）

## 6. 校验

- [x] 6.1 `npm run typecheck`
- [x] 6.2 `npm test`
- [x] 6.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 6.4 `openspec validate add-mcp-prompt-commands --type change`
