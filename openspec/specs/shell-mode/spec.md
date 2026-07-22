# shell-mode Specification

## Purpose
定义 `echo_tui` shell mode 的外部行为，包括模式切换、composer 视觉呈现、本地 bash 命令执行、shell transcript 展示与 provider context 投影，以及与 bash tool 共享命令执行 runner 的要求。
## Requirements
### Requirement: Shell mode switching
系统 SHALL 支持用户通过 Tab 在普通模式、plan mode 和 shell mode 之间循环切换，并在有 slash suggestion 可见时保留 Tab 补全 slash command 的既有行为。

#### Scenario: Cycle modes with Tab
- **WHEN** 用户在没有 command surface、approval surface、user question 或 slash suggestion 的空闲输入状态按下 Tab
- **THEN** 系统 SHALL 将模式按普通模式、plan mode、shell mode、普通模式的顺序切换

#### Scenario: Preserve slash completion
- **WHEN** slash suggestion 可见且用户按下 Tab
- **THEN** 系统 SHALL 补全当前选中的 slash command，而不是切换模式

### Requirement: Mode-specific composer appearance
系统 SHALL 根据当前模式显示不同的 composer 前缀和边框颜色：普通模式沿用青色，plan mode 使用紫色，shell mode 使用经典终端绿色。

#### Scenario: Render shell composer
- **WHEN** 当前模式为 shell mode
- **THEN** composer SHALL 使用 `$` 前缀和绿色边框渲染

#### Scenario: Render plan composer
- **WHEN** 当前模式为 plan mode
- **THEN** composer SHALL 使用 plan mode 对应前缀和紫色边框渲染

### Requirement: Execute shell input as bash
系统 SHALL 在 shell mode 下把用户提交的 composer 文本作为本地非交互 bash 命令执行，而不是发送给模型或触发工具审批。

#### Scenario: Submit shell command
- **WHEN** 当前模式为 shell mode 且用户输入 `pwd` 后按 Enter
- **THEN** 系统 SHALL 在当前 workspace cwd 中执行 bash 命令 `pwd`
- **AND** 系统 SHALL 不创建 agent turn
- **AND** 系统 SHALL 不打开 tool approval surface

#### Scenario: Ignore empty shell command
- **WHEN** 当前模式为 shell mode 且 composer 为空时用户按 Enter
- **THEN** 系统 SHALL 不执行 bash 命令，也不追加 transcript record

### Requirement: Display shell output as message transcript
系统 SHALL 使用新的 shell transcript role 记录一次完整 shell execution，并以 message 风格展示命令、合并终端输出和退出状态，而不是以 tool call / tool result 风格展示。模型可见 shell ctx 输出超过共享 runner 上限时，系统 SHALL 保存完整已采集终端输出，并 SHALL 在最终 shell transcript 中记录统一截断路径标记和输出尾部。shell-local SHALL 不应用该上下文 offloading 上限，并 SHALL 把完整合并输出保存在本地 transcript/session 中。

#### Scenario: Render successful shell output
- **WHEN** 用户在 shell mode 执行成功且有输出的命令
- **THEN** transcript SHALL 显示 `$ <command>` 和按 stdout/stderr 到达顺序合并的终端输出
- **AND** transcript SHALL 不显示 `tool_call` 或 `tool_result` 样式

#### Scenario: Render non-zero exit
- **WHEN** 用户在 shell mode 执行退出码非 0 的命令
- **THEN** transcript SHALL 显示终端输出和轻量退出状态，例如 `[exit 1]`

#### Scenario: Render truncated shell ctx output
- **WHEN** shell ctx 命令输出超过共享 runner 的模型可见上限
- **AND** offloading 文件写入成功
- **THEN** transcript SHALL 在命令信息之后显示 `[tool result truncated: <absolute-path>]`
- **THEN** transcript SHALL 在该标记之后显示已捕获终端输出的尾部
- **THEN** 后续 shell ctx provider 投影 SHALL 使用相同的标记和尾部预览

#### Scenario: Preserve complete shell-local output
- **WHEN** shell-local 命令输出超过共享 runner 的模型可见上限
- **THEN** transcript 和持久化 session SHALL 保存完整合并输出
- **AND** shell record SHALL NOT 包含 offloading marker
- **AND** 该 shell record SHALL NOT 进入 provider context

### Requirement: Shell transcript in model context
系统 SHALL 在发送 transcript 给大模型时，把 shell transcript 投影为 user message，并说明这是用户执行的 bash 命令及其终端输出。

#### Scenario: Project shell execution to provider input
- **WHEN** transcript 中存在 shell execution record 且用户随后发送普通对话消息
- **THEN** provider input SHALL 包含一条 user message，描述用户执行的 bash 命令、退出状态和终端输出

### Requirement: Shared bash runner
系统 SHALL 将 bash 命令执行、超时和输出截断逻辑抽取为共享 runner，供 bash tool handler 和 shell mode 共同使用。

#### Scenario: Bash tool preserves existing behavior
- **WHEN** 模型调用 `run_bash_command` tool
- **THEN** bash tool handler SHALL 使用共享 runner 执行命令
- **AND** tool result SHALL 保持现有面向工具的结构化文本语义

#### Scenario: Shell mode uses terminal output
- **WHEN** 用户在 shell mode 执行命令
- **THEN** shell mode SHALL 使用共享 runner 的合并终端输出进行 transcript 展示

### Requirement: Shell command live output preview
系统 SHALL 在 shell mode 命令运行期间，以 footer pending preview 形式即时展示命令产生的终端输出，而不是只显示 spinner 等待最终结果。

#### Scenario: Show output before command completes
- **WHEN** 用户在 shell mode 执行一个尚未结束但已经产生 stdout 或 stderr 的命令
- **THEN** 系统 SHALL 在命令完成前显示该命令的 live output preview
- **AND** status line SHALL 继续显示 working activity

#### Scenario: Keep transcript append-only during live output
- **WHEN** shell 命令仍在运行且产生多个输出 chunk
- **THEN** 系统 SHALL 只更新临时 pending preview
- **AND** 系统 SHALL NOT 为每个输出 chunk 追加 transcript record

#### Scenario: Commit final shell transcript after completion
- **WHEN** shell 命令完成
- **THEN** 系统 SHALL 清除 live output preview
- **AND** 系统 SHALL 追加一条完整 shell transcript record，包含最终捕获的合并终端输出和退出状态

### Requirement: Shell live output rendering
系统 SHALL 使用 shell 专用纯文本渲染展示 live output preview，避免把命令输出当作 assistant Markdown 流式响应处理。

#### Scenario: Render shell output without Markdown interpretation
- **WHEN** shell live output 包含 Markdown 标记、表格文本或代码 fence 字符
- **THEN** 系统 SHALL 按原始纯文本 shell 输出展示
- **AND** 系统 SHALL NOT 使用 assistant streaming 的 Markdown 渲染样式

#### Scenario: Bound long live output preview
- **WHEN** shell live output 行数超过 footer 可显示高度
- **THEN** 系统 SHALL 限制 preview 占用高度
- **AND** 系统 SHALL 显示最新输出尾部和隐藏内容摘要

### Requirement: Shell live output source
系统 SHALL 通过共享 bash runner 的可选输出事件接收 shell mode 运行中的 stdout/stderr 输出，并保持 bash tool 默认行为不变。

#### Scenario: Runner emits output events for shell mode
- **WHEN** shell mode 调用共享 bash runner 执行命令且命令产生 stdout 或 stderr
- **THEN** runner SHALL 向调用方发送输出事件，包含输出流类型和文本 chunk
- **AND** runner SHALL 继续返回最终 `BashCommandRunResult`

#### Scenario: Bash tool remains non-streaming
- **WHEN** 模型调用 `run_bash_command` tool
- **THEN** bash tool handler SHALL NOT 默认向 TUI 展示 live output preview
- **AND** bash tool result SHALL 保持完成后一次性返回的既有语义

### Requirement: Shell live output context policy
系统 SHALL 保持 shell ctx/local 策略只作用于最终 shell transcript 的 provider context 投影，不因 live output preview 改变模型上下文边界。

#### Scenario: Local live output stays local
- **WHEN** 当前为 shell local 子状态且命令运行中产生 live output
- **THEN** 系统 SHALL 在本地 footer preview 中显示输出
- **AND** 系统 SHALL NOT 将运行中的输出发送给模型
- **AND** 命令完成后的 shell transcript SHALL 继续标记为不进入模型上下文

#### Scenario: Included shell output enters context only after completion
- **WHEN** 当前为 shell ctx 子状态且命令运行中产生 live output
- **THEN** 系统 SHALL 在运行中仅本地显示 pending preview
- **AND** 系统 SHALL 仅在命令完成并追加最终 shell transcript 后，允许该最终记录进入后续 provider context

### Requirement: Shell command user interruption
系统 SHALL 允许用户通过 Escape 中断 shell mode 中正在运行的命令，且 shell mode 命令 SHALL NOT 依赖固定超时时间自动中断。

#### Scenario: Escape interrupts a running shell command
- **WHEN** 用户在 shell mode 命令运行期间按下 Escape
- **THEN** 系统 SHALL 请求中断正在运行的 shell 命令
- **AND** 若命令未响应正常终止信号，系统 SHALL 在短暂宽限后强制终止进程
- **AND** 系统 SHALL 在命令进程结束后追加一条最终 shell transcript record，记录已捕获输出和中断错误信息

#### Scenario: Agent bash tool keeps independent interruption behavior
- **WHEN** 模型调用 `run_bash_command` tool 执行命令
- **THEN** bash tool handler SHALL 继续接收 assistant turn 的取消信号
- **AND** bash tool SHALL 默认不依赖固定 timeout 自动中断
- **AND** bash tool MAY 在用户显式配置正整数 timeoutMs 时应用命令 timeout

### Requirement: Shell command Esc 优先于 assistant loop interrupt
系统 SHALL 保持 shell mode 本地命令的 Esc 中断语义独立于 assistant agent loop interrupt。当 shell mode 本地命令正在运行时，Esc SHALL 优先请求中断该 shell command；当没有正在运行的 shell command 且存在 active assistant turn 时，Esc 才 MAY 作为 assistant loop interrupt 处理。

#### Scenario: 运行中 shell command 消费 Esc
- **WHEN** shell mode 本地命令正在运行
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 请求中断正在运行的 shell 命令
- **THEN** 系统 SHALL NOT 因同一次 Esc 请求中断 assistant agent loop

#### Scenario: 无 shell command 时 Esc 可中断 assistant loop
- **WHEN** 当前没有运行中的 shell mode 本地命令
- **AND** assistant turn 仍然 active 且没有更高优先级 surface
- **AND** 用户按下 Esc
- **THEN** 系统 MAY 将该 Esc 作为 assistant agent loop interrupt 处理
