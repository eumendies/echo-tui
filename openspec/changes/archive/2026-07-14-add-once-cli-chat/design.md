## Context

当前 `src/cli/main.ts` 只处理无参数 TUI 启动、help、version 和未知命令；`src/app/main.ts::run` 会创建终端控制器、进入 raw mode、注册 stdin/resize 监听并启动 TUI。真正的 provider-neutral agent loop 已由 `createAgentLoopRuntime` 提供，但普通 assistant turn 还通过 `AppContext`、footer renderer、工具授权 surface 和用户问题 surface 编排。

单轮 CLI 需要复用 provider 配置、agent loop、MCP、hooks 和 usage 记录，同时不能依赖 TTY 或任何需要用户继续输入的 UI 状态。`--full-access` 还需要在明确的单轮运行上下文中绕过 approval-required 工具的等待，而不能改变普通 TUI 的安全策略。

## Goals / Non-Goals

**Goals:**

- 增加 `echo-tui --once <prompt...>` 的非交互单轮执行路径。
- 保持无参数 `echo-tui` 的 TUI 行为、help/version 行为和现有 provider adapter 不变。
- 复用 `createAgentLoopRuntime`，让单轮模式继续获得当前配置、工具 registry、MCP continuation、hooks 和 usage store 能力。
- 在默认单轮模式下对 approval 和用户提问提供立即返回的失败结果，不让 agent 永久等待。
- 通过显式 `--full-access` 允许单轮模式执行 approval-required 工具，并把授权策略限定在本次 headless turn。
- 可靠传播成功/失败退出码，并在 finally 中清理 MCP、debug 和其他运行资源。

**Non-Goals:**

- 第一版不进入 raw mode、不启动 TUI renderer、不支持单轮过程中的交互式审批或用户追问。
- 第一版不把单轮请求追加到可恢复的 transcript session，也不提供 `--resume` 或多轮 CLI 会话。
- 第一版不要求流式 stdout 输出；先输出最终 assistant 文本，后续可单独设计流式终端协议。
- 不改变 provider adapter 的请求协议，不新增第三方 CLI/TUI 依赖。

## Decisions

### 1. 在 CLI 层增加独立的 headless runner

`runCli` 解析 `--once` 后调用新的 headless runner，而不是调用 `createApp().start()` 或伪造 TTY。

headless runner 负责创建并清理当前单轮需要的 `McpManager`、hooks、debug context、usage store 和 `createAgentLoopRuntime`，向 agent loop 传入一条 user record，等待最终文本并写入 stdout。

备选方案是复用 `runAssistantTurn`，但该函数依赖 `AppContext` 的 response lock、transcript persistence、spinner、renderer、`ToolApprovalContext` 和 `UserQuestionContext`，会把 TUI 生命周期错误地带入 CLI；因此不采用。

### 2. 让 CLI 入口统一支持异步退出

单轮请求是异步操作，CLI 入口 SHALL 等待 runner 完成后再返回退出码。`bin/echo-tui.ts` 需要等待 `runCli` 的 Promise；help、version、unknown command 仍保持不启动 TUI 的同步语义，只是通过统一的异步返回协议结束。

备选方案是在 `runCli` 内部 fire-and-forget 并通过全局 `process.exitCode` 处理错误，这会让测试和调用方无法可靠等待完成，也容易提前报告成功，因此不采用。

### 3. 用 per-run execution mode 传入 headless 策略

在 agent session/run state 上增加区分式 execution mode：`interactive` 或携带 approval policy 的 `headless`。风险分类器仍负责识别 approval-required、rejected 和 safe；agent loop 在识别出 approval-required 后：

- 默认单轮模式返回明确的拒绝 tool result，不调用需要 UI 的 approval callback。
- `full-access` 单轮模式生成允许当前调用的内部决策并直接进入 executor。

该策略不修改 `classifyToolCallRisk` 的普通规则，也不修改 TUI `ToolApprovalContext` 的会话授权缓存。plan mode 的拒绝规则仍优先于允许策略；单轮 runner 固定使用 normal interaction mode。

### 4. 保留工具 registry，明确非交互工具边界

单轮模式继续使用默认内置 registry 和已成功 bootstrap 的 MCP registry。安全的只读工具可以直接执行；`ask_user_questions` 因没有输入通道直接返回取消/失败结果。`--full-access` 只绕过 approval，不会创建未配置的 MCP server，也不能替用户回答问题。

单轮模式不创建 `ChangeHistoryContext`，因此 full-access 产生的文件或系统变更不会通过 `/undo` 记录；这属于显式 full-access 的已知取舍，帮助文本和文档需要明确提示。

### 5. 采用最终文本输出和明确退出码

成功时只向 stdout 写最终 assistant 文本和换行；不输出 ANSI、spinner 或工具面板。配置、provider、网络、工具 continuation 或清理阶段的不可恢复错误写入已脱敏的 stderr，并返回非零退出码。单轮模式不持久化 transcript，但 provider usage 仍通过现有 usage store 记录。

## Risks / Trade-offs

- **[Risk] `--full-access` 可能执行破坏性 bash、patch、memory 或 MCP 操作。** → 仅允许与 `--once` 一起使用，在 help 和 README 中显示明确警告；普通 TUI 不受影响。
- **[Risk] 单轮模式遇到 `ask_user_questions` 无法继续对话。** → 返回结构化取消结果，让模型自行收尾或失败，不等待永不满足的 Promise。
- **[Risk] full-access 变更没有 TUI 的 undo checkpoint。** → 文档明确说明单轮模式不提供回滚；后续如需回滚再设计独立 headless change recorder。
- **[Risk] MCP bootstrap 或关闭过程异常导致资源泄漏。** → runner 使用 `try/finally` 关闭 MCP 和 debug context，并复用 manager 的降级诊断语义。
- **[Risk] 将 `runCli` 改为异步会影响现有测试和 bin 调用协议。** → 保留 help/version/unknown 的结果与输出契约，只调整等待方式，并补充所有 action 的 CLI 测试。

## Migration Plan

1. 增加 CLI action、headless runner、tool policy 字段和对应单元测试。
2. 更新 help、README 和架构文档，明确 `--once` 与 `--full-access` 的行为和风险。
3. 运行 typecheck、完整测试和 JavaScript 语法检查。
4. 该变更为新增 CLI 能力，无配置文件迁移；回滚时移除新 action 和 headless runner 即可，不影响已有 TUI 配置与 session 文件。

## Open Questions

- 是否在后续版本支持从 stdin 读取 prompt，当前只支持命令行参数。
- 是否需要单独增加 `--stream`，把 provider 增量转换为 stdout 流式协议。
- 是否需要为 full-access 单轮模式增加显式超时或独立的 headless change history。
