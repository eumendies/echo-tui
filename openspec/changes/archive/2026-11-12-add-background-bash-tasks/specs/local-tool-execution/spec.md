## MODIFIED Requirements

### Requirement: bash command tool
系统 SHALL 提供第一版本地 bash 工具 `run_bash_command`。该工具 SHALL 接受必填 command 和可选 background 布尔参数，background 省略或为 false 时保持前台等待行为，为 true 时按后台任务协议启动。该工具 SHALL 只执行非交互命令，SHALL 在当前工作区中运行，SHALL 捕获 stdout、stderr、exit code、耗时、可选 timeout 和截断状态，并 SHALL 把模型继续工作所需的信息格式化为紧凑 tool result 文本；后台调用 SHALL 返回启动状态和可由 read_files 查询的日志与状态文件路径，内部任务身份只留在结构化 result 字段，最终执行状态 SHALL 写入任务文件，不再追加第二个 tool result；前台完整执行状态及后台启动任务引用 SHALL 继续保留在对应结构化 result 字段中。前台输出超过模型可见上限时，共享 runner SHALL 把完整已采集终端输出转存到当前项目分区的用户级文件，并 SHALL 让 tool result 保留输出尾部。

#### Scenario: 执行成功的 bash 命令
- **WHEN** `run_bash_command` 收到 `{ "command": "pwd" }` 形式的有效参数
- **THEN** bash handler SHALL 使用非交互 shell 在当前工作区执行该命令
- **THEN** result SHALL 标记 `ok: true`
- **THEN** 如果 stdout 或 stderr 非空，result 文本 SHALL 包含对应输出
- **THEN** 如果 stdout 和 stderr 均为空，result 文本 SHALL 明确说明命令成功且无输出
- **THEN** result 文本 SHALL NOT 常态包含 command、duration、`timed_out: false` 或 `truncated: false`

#### Scenario: 非零退出码作为工具失败结果
- **WHEN** 前台 bash 命令以非零 exit code 结束
- **THEN** bash handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result SHALL 包含该 command、exit code、stdout 和 stderr
- **THEN** 系统 SHALL NOT 仅因非零 exit code 追加本地 `error` transcript record

#### Scenario: 显式 timeout 命令超时
- **WHEN** 前台 bash tool 配置了正整数 timeout
- **AND** bash 命令运行超过该 timeout
- **THEN** bash handler SHALL 终止该命令
- **THEN** result SHALL 标记 `timedOut: true` 且 `ok: false`
- **THEN** result 文本 SHALL 包含该 command 并明确说明 timeout

#### Scenario: 输出超过上限
- **WHEN** 前台 bash 命令 stdout 和 stderr 输出超过配置的 max output bytes
- **THEN** bash handler SHALL 截断回传文本
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 包含该 command 并明确说明输出已截断

#### Scenario: 不支持交互输入
- **WHEN** bash 命令尝试读取 stdin 或需要 TTY 交互
- **THEN** bash handler SHALL 不提供交互式 stdin 或 TTY
- **THEN** 前台命令 SHALL 通过退出、失败、用户中断或显式 timeout 结束；后台命令 SHALL 由后台任务协议管理停止与结束

#### Scenario: 后台参数省略时兼容前台结果
- **WHEN** run_bash_command 的 background 参数省略或为 false
- **THEN** 工具 SHALL 等待命令完成并保持原 stdout、stderr、退出码、超时和截断语义

#### Scenario: 后台启动返回文件引用
- **WHEN** run_bash_command 的 background 为 true 且当前上下文允许后台执行
- **THEN** 工具 SHALL 按后台任务协议返回 state、output_path、status_path 和 read_files 指引
- **AND** 结果文本 SHALL 使用固定字段块（state、output_path、status_path）加一行 read_files 查询指引，SHALL NOT 含 stdout:/stderr: 分段标记、命令输出正文或内部任务 ID
- **AND** 启动成功 SHALL NOT 被解释为命令最终执行成功
- **AND** 结果文本 SHALL 继续遵循 Bash 工具的最终字节预算
- **AND** 启动结果文本 SHALL NOT 包含 stdout/stderr 正文，正文 SHALL 通过返回的 output_path 读取

#### Scenario: 参数类型错误
- **WHEN** background 存在且不是布尔值
- **THEN** 工具 SHALL 返回匹配原调用身份的失败结果而不启动进程


### Requirement: bash tool availability and execution limits
系统 SHALL 把当前已开发的 `run_bash_command` 暴露给模型。系统 SHALL 默认不为 bash tool 设置自动 timeout，前台命令与后台启动交接前的命令 SHALL 依赖 turn-level 中断信号响应用户 Esc，已交接后台任务 SHALL 使用会话级任务管理器的独立停止控制；系统 SHALL 继续支持 max output bytes 限制，并 MAY 在用户显式配置正整数 timeoutMs 时启用命令 timeout。

#### Scenario: 默认暴露 bash tool
- **WHEN** 创建默认 tool registry
- **THEN** tool registry SHALL 包含 `run_bash_command`
- **THEN** OpenAI 请求 SHALL 可以发送该工具 schema

#### Scenario: 默认 bash tool 不自动超时
- **WHEN** bash tool 执行命令且未配置正整数 timeoutMs
- **THEN** executor 或 handler SHALL NOT 启动固定时长的 timeout timer
- **THEN** turn-level 取消信号触发时 handler SHALL 尽力终止前台或尚未完成后台交接的命令，但 SHALL NOT 停止已经注册的后台任务

#### Scenario: 应用显式 timeout 和输出上限
- **WHEN** bash tool 执行命令
- **THEN** executor 或 handler SHALL 使用配置的 max output bytes 限制模型可见结果；后台日志 SHALL 另受后台任务协议的磁盘容量限制
- **THEN** 正整数 timeoutMs 配置 SHALL 作为显式 timeout 使用
- **THEN** 无效、缺失或 null timeoutMs SHALL 被归一化为无自动 timeout
- **THEN** 无效、缺失或越界 max output bytes 配置 SHALL 被归一化为安全默认值

#### Scenario: 后台硬超时不转义为等待窗口
- **WHEN** 后台任务启动且配置了正整数 timeoutMs
- **THEN** timeout SHALL 从该进程启动时计算，并在到期时终止任务
- **AND** 状态文件 SHALL 明确记录 timeout，不改为自动转后台或无限继续运行


### Requirement: 工具调用并发分类
判断工具调用能否与相邻只读调用重叠执行；未知或无法证明只读的调用一律独占。`read_files`、`glob`、`grep`、`web_fetch`、`web_search`、`use_skill`、`list_mcp_resources`、`read_mcp_resource` SHALL 分类为 `parallel_read`。`run_bash_command` 的 background 为 true 时 SHALL 分类为 exclusive，仅在启动交接完成后释放该调用的调度屏障；省略或为 false 时 SHALL 按严格只读 Bash 策略判定：命中只读 allowlist 为 `parallel_read`，否则 `exclusive`。`run_subagent` SHALL 在调用参数可解析为目标 readonly executionPolicy subagent 时分类为 `parallel_read`；参数 JSON 解析失败、agent 名称未知或目标为 general_purpose 时 SHALL 分类为 `exclusive`。其余工具一律 `exclusive`。分类器 SHALL 通过注入的只读 subagent 名称谓词获取策略，不携带目录依赖。

#### Scenario: 观察工具保持并行分类
- **WHEN** 分类器收到 `grep`、`read_files`、`glob`、`web_fetch`、`web_search` 或 `use_skill` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`

#### Scenario: 资源读取参与并行分类
- **WHEN** 分类器收到 `list_mcp_resources` 或 `read_mcp_resource` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`
- **THEN** 连续的资源读取与其它只读调用 SHALL 允许在同一并行段执行

#### Scenario: 只读 Bash 与风险 Bash 分类不变
- **WHEN** 分类器收到 background 省略或为 false 的、只读 allowlist 内外的 `run_bash_command` 调用
- **THEN** 前者 SHALL 为 `parallel_read`，后者 SHALL 为 `exclusive`

#### Scenario: 只读子 Agent 委派并行分类
- **WHEN** 分类器收到 `agent` 参数指向 readonly executionPolicy subagent 的 `run_subagent` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`

#### Scenario: 未知或解析失败的委派保持独占
- **WHEN** `run_subagent` 参数不是合法 JSON object、`agent` 名称不在目录中，或目标为 general_purpose
- **THEN** 分类结果 SHALL 为 `exclusive`

#### Scenario: 无委派目录的运行保持独占
- **WHEN** 当前运行没有注入 subagent 委派目录
- **THEN** 所有 `run_subagent` 调用 SHALL 分类为 `exclusive`

#### Scenario: 后台启动形成短期独占屏障
- **WHEN** 分类器收到 background 为 true 的 run_bash_command 调用，包括只读命令
- **THEN** 分类结果 SHALL 为 exclusive
- **AND** 启动结果返回后 scheduler SHALL 允许后续工具继续执行，不等待后台进程终止

