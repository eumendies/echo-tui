## Context

prompts 是 MCP 三个原语里唯一"面向用户"的：`prompts/list` 给模板目录（name/description/arguments），`prompts/get` 返回一组带 role 的 messages（text/image/embedded resource/resource_link）。规范建议客户端以用户交互方式呈现，因此上游普遍把它映射成斜杠命令（Claude Code `/<server>:<prompt>`、Gemini CLI 命令注册与 `help` 子命令、opencode 命令注册表 + 懒解析、Crush 目录与取消息）；Codex CLI 与 Roo 至今不支持。

echo-tui 侧两条通道已就绪：`src/app/main.ts` 把 `commandHost.skills.listEnabledSkillDescriptors()` 与内置描述符合并成建议清单；`SkillInvocationCommandHandler` 命中后返回 `{kind: 'submit_user_message', text, displayText, metadata}` 完成注入。命令名正则 `/^\/([^/\s]+)(?:\s+([\s\S]*))?$/u` 只排除 `/` 与空白，因此冒号命名空间可用。

实现取舍受两个既有约束影响：一是 transcript 为 append-only 且持久化到 journal，record 基类只有 `text`/`createdAt`，`metadata` 目前只挂在 user record 上；二是注入通道是单条用户消息（`AssistantTurnSubmission.userText`）。

## Goals / Non-Goals

**Goals:**

- 让用户能用 `/<server>:<prompt>` 调用 server 提供的提示模板，参数按规范 `arguments` 顺序传递，结果注入当前对话。
- 复用既有机制：manager 缓存模式（与 resources 同构）、描述符合并、`submit_user_message` 注入、user record metadata。
- 明确 prompts 在 plan、只读运行、headless、子 Agent 与 active turn 下的边界。

**Non-Goals:**

- 不保真逐条注入 messages（见 D4）。
- 不给模型暴露"调用 prompts"的工具；prompts 不是模型能力。
- 不做 `/mcp` 面板计数、不做 prompts 的 elicitation/采样、不做图片 attachment 化。

## Decisions

### D1: 入口是斜杠命令，不是给模型的工具

prompts 按规范是用户控制的交互入口。映射成斜杠命令与上游一致，且复用 echo-tui 现有的命令匹配、建议清单、注入与 transcript 展示链路；若做成工具，模型会自主"调用模板"，语义与规范定位相反。

### D2: 命名 `/<server>:<prompt>`，handler 排在内置命令之后、skill fallback 之前

- 冒号作为 server 命名空间，天然避免与内置命令、技能（`/skill-name`）重名；跨 server 同名 prompt 各自带前缀，不互相覆盖。
- 顺序要求：内置命令优先（用户预期），但必须**早于** `SkillInvocationCommandHandler`——后者以 `/^\/([^/\s]+)/` 通配匹配任意斜杠文本，晚于它则 prompt 命令永远不会被命中。
- 描述符与技能描述符一起合并进建议清单，`/` 补全按前缀匹配自动生效；active assistant turn 期间与技能一样不出现在清单（沿用既有 `allowDuringAssistantTurn` 过滤）。

### D3: 参数用位置参数 + `key=value`，缺必填走交互收集

- 位置参数按 `arguments` 声明顺序映射，`key=value` 允许按名覆盖；这两种写法覆盖了上游的两种主流约定（Claude Code 空白切分、Gemini `--name=value`）。
- 缺少必填参数时打开现有 `choice` surface（复用 `ask_user_questions` 的交互形态）逐项收集，而不是抛用法错误——命令面板交互是 TUI 的既有优势。
- 无参数 prompt 提交后直接注入（Gemini 的 autoExecute 行为），避免多按一次回车。

### D4: messages 全量按序拼接成单条用户消息，加 role 标签

采用上游 Gemini CLI / opencode 的做法：把 messages 的文本**按序拼成一条 user message**，每条前加 `[user]` / `[assistant]` 标签；非文本内容块转占位符（图片给 mime 与字节数，embedded resource 给 uri 并提示 `read_mcp_resource`，resource_link 给 uri）。

- 理由：echo-tui 的注入通道是单条用户消息，此法不需要改动 transcript record 模型就能保留全部信息与角色来源。
- 备选（被否）：保 role 逐条注入，需要让 server 代笔的 assistant record 具备可持久化来源标记并新增 record 字段/role，牵动渲染层与 journal 兼容；用户明确选择前者。
- 备选（被否）：只取 `role === 'user'` 的文本（Crush 做法），会静默丢弃 server 明确提供的内容。

### D5: 目录发现与 resources 同构：capability 门控 + 有界缓存 + 失效标记

未声明 `prompts` capability 的 server 不发起调用；`-32601` 或其它失败只降级为空目录并写脱敏诊断，不影响工具与资源能力。目录按分页与条目/描述长度上限缓存；`notifications/prompts/list_changed` 只标记失效，下次 run 或启动重新拉取，不重连进程——与 resources 的既有纪律一致，也避免 server 用通知抖动拖住主循环。

### D6: 溯源 metadata 复用 user record 既有字段

注入的 user record 带 `metadata.mcpPrompt: {server, name, argumentsText}`，与 `agentWorkflow` / `skillInvocation` / `conversationReference` 同一层级；transcript 展示用户实际输入的 `/<server>:<prompt> args`（`displayText`），模型看到的是拼接后的正文。这样既满足"模型可见 = 用户提交内容"的既有语义，也让 `/resume` 重放能区分来源。

### D7: 边界与普通用户消息一致

命令由用户显式发起，因此：不进入工具审批；plan 模式与只读运行（BTW/`/review`）下就是一条普通用户消息，是否触发工具仍按当时边界判定；headless `--once` 不注册该命令（无可交互入口）；子 Agent 不暴露 prompts。

## Risks / Trade-offs

- [server 可控文本进入上下文] → 注入内容显式标注 role 与来源命令；不伪造成模型输出；信任模型与"用户主动加载 skill/资源"同档，不额外提升权限。
- [提示注入或超长内容] → 拼接结果按与 MCP 结果一致的 20,000 bytes 上限截断并追加 marker；命令本身由用户显式触发。
- [命令名冲突] → 冒号命名空间 + 内置命令优先 + 排位于 skill fallback 之前；同名 prompt 跨 server 各自带前缀。
- [通知抖动或目录膨胀] → list_changed 只标记失效；目录条目数与描述长度有界。
- [错误提示不友好] → 未命中 server/prompt 时返回 `info` surface 列出可用 server 与 prompt 名，避免静默失败。

## Migration Plan

无配置迁移与数据迁移。回滚只需移除命令 handler 注册、描述符来源与 manager 的 prompt 目录缓存。

## Open Questions

- `/mcp` 面板是否展示每 server 的 prompt 数量（与 resources 计数一起留待后续迭代）。
- 图片内容块是否映射为 tool result attachment（当前只给占位符）。
- 是否支持新版规范的 prompts elicitation（`InputRequiredResult`）以在取用前向用户收集答案。
