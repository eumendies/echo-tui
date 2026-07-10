## ADDED Requirements

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

#### Scenario: Agent bash tool keeps timeout behavior
- **WHEN** 模型调用 `run_bash_command` tool 执行命令
- **THEN** bash tool handler SHALL 继续使用配置的 timeout
- **AND** bash tool SHALL NOT 因 shell mode 的 Escape 中断机制而关闭超时保护
