## ADDED Requirements

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
系统 SHALL 使用新的 shell transcript role 记录一次完整 shell execution，并以 message 风格展示命令、合并终端输出和退出状态，而不是以 tool call / tool result 风格展示。

#### Scenario: Render successful shell output
- **WHEN** 用户在 shell mode 执行成功且有输出的命令
- **THEN** transcript SHALL 显示 `$ <command>` 和按 stdout/stderr 到达顺序合并的终端输出
- **AND** transcript SHALL 不显示 `tool_call` 或 `tool_result` 样式

#### Scenario: Render non-zero exit
- **WHEN** 用户在 shell mode 执行退出码非 0 的命令
- **THEN** transcript SHALL 显示终端输出和轻量退出状态，例如 `[exit 1]`

#### Scenario: Render truncated shell output
- **WHEN** shell 命令输出超过捕获上限
- **THEN** transcript SHALL 显示已捕获的终端输出和 truncated 标记

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
