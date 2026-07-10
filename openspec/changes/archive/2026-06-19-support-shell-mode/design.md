## Context

当前应用的输入路径以普通对话为中心：用户提交 composer 文本后进入 agent turn，模型可通过 `run_bash_command` tool 执行命令。这个路径适合模型自主调用工具，但不适合用户直接把输入当成本地 shell 命令运行。

已有 bash tool handler 已具备非交互执行、stdout/stderr 捕获、超时、输出截断和工具结果格式化能力，但它的输出面向模型工具调用，包含 `command`、`exit_code`、`stdout`、`stderr` 等辅助信息。shell mode 需要复用底层执行能力，同时以更接近终端的 message 样式展示纯执行结果。

## Goals / Non-Goals

**Goals:**

- 支持通过 Tab 在普通模式、plan mode、shell mode 之间循环切换。
- shell mode 下 Enter 将 composer 文本作为本地 bash 命令执行，不触发 agent turn。
- shell mode 的 composer 使用 `$` 前缀和绿色边框；plan mode 使用紫色边框；普通模式沿用青色边框。
- shell 执行结果使用新的 transcript role，以 message 形式展示命令和合并后的终端输出。
- shell transcript 在 provider context 中投影为 user message，表明这是用户执行的 bash 命令及输出。
- 抽取 bash 执行 runner，让 bash tool handler 和 shell mode 共用执行、timeout、truncation 逻辑。

**Non-Goals:**

- 不实现 PTY、交互式 shell、stdin 转发或长驻 shell session。
- 不让 shell mode 中的 `cd` 持久改变后续命令工作目录。
- 不改变现有 `run_bash_command` tool schema、审批策略或工具结果格式。
- 不新增外部依赖或替换现有 raw mode / ANSI TUI 架构。

## Decisions

### Decision: shell mode 使用独立 transcript role，而不是 tool_call/tool_result

shell mode 是用户直接执行命令，不是 assistant 发起工具调用。新增 shell transcript role 可以让界面按 message 样式展示 `$ command` 和终端输出，也避免 provider converter 把用户行为误表示为 assistant tool history。

备选方案是复用 `tool_call` / `tool_result`，但这会继承工具化 UI，并让 provider context 中出现语义不准确的 assistant tool call，因此不采用。

### Decision: shell record 表示一次完整 shell execution

一次 shell record 包含 command、合并终端输出、exitCode、timedOut、truncated、durationMs 等字段。相比拆成 `shell_command` 和 `shell_result` 两条记录，单条记录不会被 context compaction 或 resume preview 切断，渲染和 provider 投影也更直接。

### Decision: bash runner 同时保留 merged output 与 stdout/stderr

共享 runner 在 stdout/stderr data event 到达时记录合并输出，用于 shell mode 模拟终端显示；同时保留独立 stdout/stderr，供现有 bash tool handler 继续格式化结构化工具结果。

这不能保证字符级完全等同 PTY，但比执行结束后简单拼接 stdout/stderr 更接近真实终端输出，并且不引入 PTY 复杂度。

### Decision: shell transcript 投影为 provider user message

发送给模型时，shell record 转成 user message，内容包含“用户执行了 bash 命令”、命令文本、退出状态和终端输出。这样用户随后询问“刚才为什么失败”时，模型可以基于 shell 输出回答，同时不会误以为该命令是 assistant 自己调用的工具。

### Decision: Tab 切换模式，但保留 slash suggestion 补全优先级

当 slash suggestion 可见时，Tab 继续用于补全 slash command；否则 Tab 在 normal、plan、shell 之间循环切换。这样既满足快速切换模式，也不破坏既有 slash command 输入体验。

## Risks / Trade-offs

- [Risk] shell 输出进入 provider context 后可能占用较多上下文。→ 复用 runner 输出截断，并在 provider 投影中保留 truncated 标记；后续可进一步增加 shell context 投影上限。
- [Risk] stdout/stderr 合并顺序基于 Node pipe data event，不是 PTY 级精确顺序。→ MVP 接受该近似，避免引入 PTY 和交互式终端复杂度。
- [Risk] 用户可能期望 `cd` 持久生效。→ MVP 明确每条命令在当前 workspace cwd 中独立执行；后续如有需求再设计 shell cwd。
- [Risk] Tab 切换模式与补全存在心智冲突。→ 明确 slash suggestion 可见时 Tab 补全，否则 Tab 切模式，并在测试中覆盖。
