## Why

MCP 三个原语里 tools 与 resources 已经接入，prompts 还没有。prompts 与前两者定位不同：它是 server 定义、**面向用户**的提示模板（`prompts/list` 给目录，`prompts/get` 返回一组带 role 的 messages），规范建议客户端以用户交互的方式呈现。主流客户端普遍把它映射成斜杠命令：Claude Code 用 `/<server>:<prompt>` 并在结果里直接注入对话，Gemini CLI 把 prompt 注册成命令（含 `help` 子命令与参数提示），opencode 注册进命令注册表并懒解析 `getPrompt`，Crush 提供目录与按名取消息；Codex CLI 至今不支持。

echo-tui 侧已有两条几乎现成的通道：`main.ts` 把技能描述符合并进 slash 建议清单，`SkillInvocationCommandHandler` 通过 `submit_user_message` 把命令结果注入对话。补上 prompts 只差"发现 + 命名 + 参数 + 拼接"四件事。

## What Changes

- MCP client 与 manager 增加 prompts 能力：按 server 声明的 `prompts` capability 门控的目录发现（分页有界、描述截断、失败降级为空目录并记录脱敏诊断）与缓存；暴露 `listPrompts()` 与 `getPrompt(server, name, args)`；`notifications/prompts/list_changed` 只标记失效，下次 run 或启动重新拉取，不重连进程。
- 新增 `/<server>:<prompt>` 斜杠命令：描述符与技能描述符一起合并进 suggestion 清单，命令 handler 排列在 direct skill invocation fallback **之前**（内置命令仍优先），`/` 补全自动列出。
- 参数传递：按 `arguments` 顺序的位置参数，支持 `key=value` 覆盖；缺少必填参数时用现有 `choice` surface 交互收集；无参数 prompt 提交后直接注入，不要求二次确认。
- 注入形态：`prompts/get` 返回的 messages **按序拼接成单条 user message**，每条前加 role 标签（`[user]` / `[assistant]`）；非文本内容块使用占位符（图片给出 mime 与字节数、embedded resource 给出 uri 并提示可用 `read_mcp_resource` 读取），不静默丢弃。
- transcript 与溯源：transcript 展示用户实际输入的 `/<server>:<prompt> args`，注入的 user record 携带 `metadata.mcpPrompt: {server, name, argumentsText}`，可与普通用户消息区分。
- 边界：命令由用户主动发起，不进入审批；plan、只读运行（BTW/`/review`）与 headless 下与普通用户消息一致；子 Agent 不暴露 prompts；active assistant turn 期间与技能一样不出现在建议清单。
- 非目标：不引入"server 代笔的 assistant record"（不保 role 逐条注入、不改 transcript record 模型）、不做 `/mcp` 面板计数、不做 prompts 的 elicitation/采样。

## Capabilities

### New Capabilities

- `mcp-prompt-commands`: prompts 目录发现与失效策略、`/<server>:<prompt>` 命令的命名与优先级、参数解析与缺失收集、messages 拼接注入与溯源 metadata、以及 plan/只读运行/headless/子 Agent 边界。

### Modified Capabilities

- `command-host-runtime`: `CommandHost` 的 MCP 受控能力从"启停与重载"扩展为同时暴露 prompt 目录读取、按名调用与命令描述符，handler 不直接接触 `McpManager`。

## Impact

- 代码：`src/mcp/client.ts`（prompt 目录/取用与 capability 门控）、`src/mcp/manager.ts`（目录缓存、失效、诊断）、新增 `src/commands/mcp-prompt-command-handler.ts`、`src/app/command/mcp-command-port.ts`（或同级端口）扩展、`src/app/main.ts`（handler 注册顺序与描述符合并）、`src/types/mcp.ts` 与 `src/types/command.ts`（prompt 引用、命令描述符与调用结果）。
- 配置：无新增用户配置字段。
- 测试：`test/mcp/manager.test.js`、新增 `test/commands/mcp-prompt-command-handler.test.js`、`test/tools/` 无关、`test/app/command-host.test.js`、`test/agent/agent-loop-runtime.test.js`（注入后的用户消息形态）。
- 文档：`README.md`、`docs/tui-architecture.md`；`echo-tui-setup` skill 保持配置面职责，不新增运行时行为描述（无对应配置字段）。
