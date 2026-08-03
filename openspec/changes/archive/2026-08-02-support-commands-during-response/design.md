## Context

当前 TUI 已允许 active assistant turn 期间继续编辑 composer，并通过 `PendingMessageContext` 排队一条原始文本；`@` file picker 也能在响应期间打开并使用统一 footer command surface 渲染。另一方面，`SlashSuggestionContext` 在 `responding` 时整体禁用 suggestions，`submitComposer()` 又在解析 command 前先把输入放入 pending 单槽，因此本地命令既不可发现，也不能在当前 turn 结束前启动。

现有 footer renderer 以 `previousHeight` 和 `previousCursorRow` 跟踪唯一 transient 区域，每次重绘先逐行清除上一帧，再绘制 pending、surface 或 composer。该机制可以承载响应与 surface 并存，但命令路由必须限制哪些 handler 可与 active turn 并行，并保护 command session 的单实例所有权。

## Goals / Non-Goals

**Goals:**

- 让明确声明安全的本地 slash command 在 active assistant turn 期间可被 suggestion 发现并立即执行。
- 允许这些命令打开和交互 command surface，同时不取消、暂停或污染当前 assistant turn。
- 保持普通文本和其他 slash 输入的 pending message 语义。
- 防止 queued command 或其他启动入口覆盖已有 command session。
- 保持 footer 局部重绘、高度预算、transcript append 和 surface 输入优先级稳定。

**Non-Goals:**

- 本变更不实现 `/btw`，只提供其后续所需的响应期命令基础能力。
- 不允许同时存在多个 command session，也不引入 surface 栈。
- 不改变 provider、agent loop、transcript journal 或 pending message 持久化格式。
- 不在本变更中新增 command surface 专属的后台 activity/status 行。
- 不把 shell、手动 compact、MCP bootstrap 等其他 busy 状态等同于 active assistant turn。

## Decisions

### 1. Handler 使用默认关闭的布尔能力声明

在 command handler 和由其派生的 slash descriptor 上增加 `allowDuringAssistantTurn` 能力，缺省值视为 `false`。响应期 suggestion 与提交路由都读取同一声明，前者负责发现性，后者再次执行强制校验，避免用户直接粘贴完整命令绕过限制。

首批允许 `/help`、`/status`、`/context`、`/usage` 和 `/copy`。这些命令只读取稳定快照或操作剪贴板，不切换 transcript/session、不启动新的 agent turn，也不修改当前 provider loop 使用的配置。`/copy` 成功后仍沿用既有行为追加一条本地 `local_notice`；该记录不会进入当前 provider request，但会作为本地操作事实持久化。`/diff`、模型和模式配置、session 管理、context 修改、MCP/skill/memory 管理、agent workflows 与 direct skill invocation 暂不开放。

选择布尔字段而不是通用 busy-state 权限矩阵，是因为当前需求只有 active assistant turn 这一条清晰边界；默认关闭可以保护未来新增命令而不引入未使用的抽象。

### 2. “响应期”由可中断的 active assistant turn 判定

响应期命令只在 `TurnContext.canInterruptAssistantTurn()` 为真时采用并行路由和过滤后的 suggestions。不能仅使用宽泛的 `responding`，因为它还覆盖手动压缩、shell command 等具有不同不变量的 response lock。

空闲状态继续展示全部命令和 enabled skills。active command session、tool approval、user question 或 file picker 接管输入时，不再展示 slash suggestions。

### 3. 提交层先尝试响应期命令，再使用 pending 单槽

`submitComposer()` 在 active assistant turn 分支中先解析当前文本：

1. 命中且 handler 允许响应期启动时，立即通过 command runtime 启动；输入按既有规则记录一次 history 并清空 composer。
2. 未命中允许的响应期命令时，继续按现有规则尝试写入 pending 单槽。
3. 空闲提交仍走统一 `submitDraft()` 路由，保持 command、skill、file mention 和普通消息行为不变。

command runtime 必须在启动点再次检查调用上下文和 handler 声明。Suggestion 过滤不是安全边界。

### 4. Command session 保持单实例且禁止静默替换

`CommandRuntime.startFromText()` 在已有 active command session 时不得调用另一个 handler 的 `start()`，也不得覆盖当前 session。普通 composer 本来会被 active surface 接管；此约束主要保护 pending 自动处理和未来其他程序化入口。

当主回答结束且存在 pending 输入时：

- 普通非 slash 文本仍可在 command surface 打开时自动开始下一轮对话。
- 若 pending 文本可匹配 slash handler，则在 active command session 关闭前不 claim、不执行，避免新 surface 或命令副作用覆盖当前 session。
- command session 关闭后，app 再次尝试 dispatch pending 输入。

该策略会保守地延后 direct skill invocation 和最终返回 `not_matched` 的 slash fallback，但不会丢失文本，也避免为了预判 handler 返回值而提前执行 handler 副作用。

### 5. 复用现有 surface 优先级和 footer 临时区域

响应期 command 继续使用现有 `CommandRuntime` session 和 `CommandSurface` union，不新增并行 renderer。输入优先级保持：user question、tool approval、file picker、command session、普通 composer。若当前 agent 在 command surface 打开期间请求 approval/question，高优先级 surface 可暂时覆盖 command surface；请求结束后原 command surface 重新出现。

Streaming token 只更新 `TurnContext` pending draft。Footer 重绘仍先清除上一帧完整 transient 区域，并把 command surface 和剩余空间内的 pending preview 限制在 `rows - 2`。高 surface 可以暂时隐藏 pending 正文，但不得清除其状态；关闭 surface 后应显示最新 draft。期间产生的 reasoning、tool 或 final transcript record 继续通过“清 footer、append transcript、重绘 surface”路径输出。

## Risks / Trade-offs

- [允许列表错误地包含有副作用命令] → `allowDuringAssistantTurn` 默认关闭，首批仅显式标记已审计的只读命令，并为每个开放命令增加注册测试。
- [Command surface 隐藏 streaming preview，用户误以为响应停止] → 保持 agent 状态和 spinner timer 运行，关闭 surface 后恢复最新 preview；独立后台 activity 行留给后续视觉优化。
- [高 surface 把稳定 transcript 推入 scrollback] → 继续遵守现有正常屏 footer 高度预算和局部清理策略，不尝试从 scrollback 拉回历史，也不引入 alternate screen。
- [Queued slash command 被 active session 阻塞后不再发送] → 在关闭 command session 的事件路径重新触发 pending dispatch，并覆盖同步、异步 handler 收尾测试。
- [异步 status 查询等迟到回调覆盖其他 surface] → 保持现有 handler/session/request identity 校验，同时由 runtime 禁止启动时静默替换 session。
- [输入 data event 与 turn 收尾并发] → 继续依赖 pending claim 和 active turn identity，新增 command 启动与 turn complete 交错的 controller 测试。
