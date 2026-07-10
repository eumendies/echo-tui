## ADDED Requirements

### Requirement: local tool registry and execution boundary
系统 SHALL 提供 provider-neutral 的本地工具执行边界。该边界 SHALL 支持工具定义、工具 handler、工具 registry 和工具 executor，并 SHALL 让 agent adapter 可以按工具名称执行已注册工具而不依赖具体工具实现细节。

#### Scenario: 注册工具定义和 handler
- **WHEN** 系统创建本地 tool registry
- **THEN** registry SHALL 能按工具名称保存 tool definition 和对应 handler
- **THEN** registry SHALL 能向 agent adapter 暴露可发送给 provider 的工具定义列表

#### Scenario: 按名称执行已注册工具
- **WHEN** tool executor 收到一个已注册工具名称和 JSON arguments 字符串
- **THEN** executor SHALL 找到对应 handler
- **THEN** executor SHALL 把解析后的参数交给 handler 执行
- **THEN** executor SHALL 返回结构化 tool execution result

#### Scenario: 未注册工具返回失败结果
- **WHEN** tool executor 收到未注册工具名称
- **THEN** executor SHALL 返回失败的 tool execution result
- **THEN** executor SHALL NOT 抛出未捕获异常中断 app

#### Scenario: arguments JSON 无效返回失败结果
- **WHEN** tool executor 收到无法解析为 JSON object 的 arguments 字符串
- **THEN** executor SHALL 返回失败的 tool execution result
- **THEN** 失败结果 SHALL 包含可回传模型的简洁错误说明

### Requirement: bash command tool
系统 SHALL 提供第一版本地 bash 工具 `run_bash_command`。该工具 SHALL 只执行非交互命令，SHALL 在当前工作区中运行，SHALL 捕获 stdout、stderr、exit code、耗时、timeout 和截断状态，并 SHALL 把这些信息格式化为可显示且可回传模型的 tool result 文本。

#### Scenario: 执行成功的 bash 命令
- **WHEN** `run_bash_command` 收到 `{ "command": "pwd" }` 形式的有效参数
- **THEN** bash handler SHALL 使用非交互 shell 在当前工作区执行该命令
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result SHALL 包含 exit code、duration、stdout 和 stderr 摘要

#### Scenario: 非零退出码作为工具失败结果
- **WHEN** bash 命令以非零 exit code 结束
- **THEN** bash handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result SHALL 包含该 exit code、stdout 和 stderr
- **THEN** 系统 SHALL NOT 仅因非零 exit code 追加本地 `error` transcript record

#### Scenario: 命令超时
- **WHEN** bash 命令运行超过配置的 timeout
- **THEN** bash handler SHALL 终止该命令
- **THEN** result SHALL 标记 `timedOut: true` 且 `ok: false`
- **THEN** result 文本 SHALL 明确说明 timeout

#### Scenario: 输出超过上限
- **WHEN** bash 命令 stdout 和 stderr 输出超过配置的 max output bytes
- **THEN** bash handler SHALL 截断回传文本
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 明确说明输出已截断

#### Scenario: 不支持交互输入
- **WHEN** bash 命令尝试读取 stdin 或需要 TTY 交互
- **THEN** bash handler SHALL 不提供交互式 stdin 或 TTY
- **THEN** 命令 SHALL 只能通过退出、失败或 timeout 结束

### Requirement: bash tool availability and execution limits
系统 SHALL 把当前已开发的 `run_bash_command` 暴露给模型。系统 SHALL 支持 timeout 和 max output bytes 限制，并 SHALL 对无效配置使用安全默认值。

#### Scenario: 默认暴露 bash tool
- **WHEN** 创建默认 tool registry
- **THEN** tool registry SHALL 包含 `run_bash_command`
- **THEN** OpenAI 请求 SHALL 可以发送该工具 schema

#### Scenario: 应用 timeout 和输出上限
- **WHEN** bash tool 执行命令
- **THEN** executor 或 handler SHALL 使用配置的 timeout 和 max output bytes
- **THEN** 无效、缺失或越界配置 SHALL 被归一化为安全默认值

