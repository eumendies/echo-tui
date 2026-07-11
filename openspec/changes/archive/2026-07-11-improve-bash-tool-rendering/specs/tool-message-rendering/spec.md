## ADDED Requirements

### Requirement: bash tool rail projection
系统 SHALL 为 `run_bash_command` 的 tool call 和相邻匹配的 tool result 提供专属 rail 投影。该投影 SHALL 在首行保留工具调用标记，并使用当前 render theme 的不同语义颜色将命令区与结果区表示为连续的左侧 rail；完成的成功调用标记 SHALL 使用 success 语义色，完成的失败调用标记、命令 rail 和标题 SHALL 使用 error 语义色，pending 调用标记 SHALL 使用 muted 语义色。系统 SHALL NOT 将有效 bash 命令显示为 `Bash('...')` 形式或将原始换行显示为字面量转义文本。

#### Scenario: 成功的 call/result 对使用双段 rail
- **WHEN** transcript 包含相邻且 call id 匹配的 `run_bash_command` tool call 与成功 tool result
- **THEN** renderer SHALL 以命令 rail 显示调用标记和命令内容
- **THEN** renderer SHALL 以与命令 rail 不同的结果 rail 显示执行结果，并以空 rail 行分隔两个区域
- **THEN** renderer SHALL 使用当前 render theme 的语义颜色，而不是固定 ANSI 调色板

#### Scenario: 调用标记反映执行状态
- **WHEN** bash call 与成功或失败的 result 成对渲染
- **THEN** 成功调用的 `◆` SHALL 使用 success 语义色
- **THEN** 失败调用的 `◆` SHALL 使用 error 语义色
- **THEN** 失败调用的命令 rail 和标题 SHALL 使用 error 语义色

#### Scenario: 无结果的 pending 调用使用 rail 预览
- **WHEN** footer pending preview 或单独 tool call 只包含有效的 `run_bash_command` 调用
- **THEN** renderer SHALL 使用与完成态一致的命令 rail 结构显示命令
- **THEN** renderer SHALL 显示运行中状态且 SHALL NOT 伪造执行结果

### Requirement: bash command structure and embedded script preview
系统 SHALL 从有效 bash call arguments 的原始 `command` 字符串投影命令结构。普通多行命令 SHALL 保留其逻辑行和缩进；视觉换行 SHALL NOT 伪造 shell 续行符。系统 SHALL 对边界可安全识别的 heredoc 和长 `-c`/`-e` 内嵌脚本分别显示 shell 头部与脚本正文，并对超出展示预算的脚本显示可计数省略行。

#### Scenario: heredoc 保留 shell 前置上下文
- **WHEN** bash 命令包含 heredoc marker 之前的多行 shell 前置命令和一个闭合 heredoc 正文
- **THEN** renderer SHALL 显示从命令起始到 marker 的完整 shell 头部
- **THEN** renderer SHALL 将 heredoc 正文作为逐逻辑行的脚本预览显示
- **THEN** 超出脚本展示预算的正文 SHALL 显示隐藏逻辑行数量

#### Scenario: 无法安全拆分的复杂命令
- **WHEN** bash 命令包含无法可靠识别边界的引用、转义或命令替换
- **THEN** renderer SHALL 不拆分或省略命令片段
- **THEN** renderer SHALL 将原始命令按显示宽度安全换行显示

#### Scenario: 长内嵌脚本受限显示
- **WHEN** 可识别的 heredoc 或 `-c`/`-e` 脚本超过脚本展示预算
- **THEN** renderer SHALL 显示预算内的脚本逻辑行
- **THEN** renderer SHALL 显示包含隐藏逻辑行数量的省略提示

### Requirement: bash execution status and result projection
系统 SHALL 在 bash 完成态的调用标题中显示紧凑执行状态，包括成功或失败、退出码，以及存在时的耗时、超时或截断事实。超时和截断事实 SHALL 只来自结构化 result 字段，不能从 stdout、stderr 或 result 文本中的同名字面量推断。结果区 SHALL NOT 显示 `output`、`stdout` 或 `stderr` 标题。系统 SHALL 以现有错误语义颜色强调 stderr，并以现有弱化样式显示无输出、超时和截断提示。stdout 与 stderr SHALL 共用同一个结果展示预算。

#### Scenario: 成功输出不显示冗余标题
- **WHEN** bash result 成功且仅包含 stdout
- **THEN** 标题 SHALL 显示成功状态、退出码和可用耗时
- **THEN** 结果 rail SHALL 直接显示 stdout，且 SHALL NOT 显示 `output` 标题

#### Scenario: stdout 与 stderr 同时存在
- **WHEN** bash result 同时包含非空 stdout 和 stderr
- **THEN** 结果 rail SHALL 直接连续显示两个通道的既有结果内容，且 SHALL NOT 插入 stdout 或 stderr 标题
- **THEN** stderr 内容 SHALL 使用错误语义颜色
- **THEN** stdout 与 stderr 的可见逻辑行总数 SHALL 受同一个结果展示预算限制

#### Scenario: 输出文本中的状态字面量不改变结构化状态
- **WHEN** bash stdout、stderr 或 result text 包含 `timed_out: true` 或 `truncated: true` 字面量，但 result 结构化字段未设置对应事实
- **THEN** 标题 SHALL NOT 显示超时或截断状态
- **THEN** 结果区 SHALL NOT 追加超时或截断提示

#### Scenario: 失败、超时或截断
- **WHEN** bash result 为非零退出、超时或输出截断
- **THEN** 标题 SHALL 显示对应状态和可用执行元数据
- **THEN** renderer SHALL 保留可见的 stderr、超时或截断提示，而不将其隐藏为通用输出标题

#### Scenario: heredoc 分隔符按 shell 规则闭合
- **WHEN** bash 命令包含 `<<EOF` heredoc
- **THEN** renderer SHALL 只将完全等于 `EOF` 的逻辑行视为闭合分隔符
- **THEN** 带前导空格的 `EOF` SHALL 作为正文保留
- **WHEN** bash 命令包含 `<<-EOF` heredoc
- **THEN** renderer SHALL 只在移除前导 tab 后完全等于 `EOF` 时闭合，且前导空格 SHALL NOT 被移除

### Requirement: bash renderer layout safety and record preservation
bash 专属 renderer SHALL 只改变终端可见投影，不得改变 transcript record、tool result、provider continuation 或持久化内容。命令、脚本和结果的每一可见行 SHALL 遵守 safe render width；无法解析有效 `command` arguments 的记录 SHALL 降级到通用 tool renderer。

#### Scenario: 窄终端中的 rail 投影
- **WHEN** terminal width 较窄，且 bash 命令、脚本行或结果行超过可用宽度
- **THEN** renderer SHALL 按 safe render width 换行或截断内容并按需省略非必要状态细节
- **THEN** renderer SHALL NOT 输出超过 safe render width 的可见行

#### Scenario: 原始工具事实保持不变
- **WHEN** bash call 或 result 被 rail renderer 投影
- **THEN** 原始 `argumentsText`、result text、退出码、耗时、超时和截断字段 SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result 而不是渲染后的 rail 文本

#### Scenario: 无效调用参数降级
- **WHEN** `run_bash_command` tool call 的 argumentsText 不是包含非空 `command` 字符串的有效 JSON object
- **THEN** renderer SHALL 降级到通用 tool call renderer
- **THEN** renderer SHALL NOT 抛出异常或中断 transcript 渲染
