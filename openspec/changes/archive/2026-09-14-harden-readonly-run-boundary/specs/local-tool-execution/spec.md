## MODIFIED Requirements

### Requirement: Readonly policy 只允许明确安全的临时操作
Readonly policy SHALL 允许明确列入只读集合的文件读取、glob/grep、网页读取/搜索和 skill 加载工具，并 SHALL 允许只修改当前 BTW 临时 todo state 的 todo 工具。`run_bash_command` SHALL 按生效沙箱分层执行：当该次运行的生效沙箱可用且档位为 `read-only` 时，任意命令 SHALL 直接进入既有 executor，效果由内核沙箱边界约束；否则 SHALL 仅在共享 readonly classifier 明确认可为 inspection command 时执行。`run_subagent` SHALL 仅在调用目标属于该次运行冻结的 readonly 执行策略子代理集合时放行。允许的调用 SHALL 继续使用既有 executor、abort、输出截断和 tool result 语义。

#### Scenario: 执行只读文件检查
- **WHEN** readonly run 收到 `read_files`、`glob` 或 `grep` 的有效 tool call
- **THEN** policy SHALL 允许调用进入普通 executor
- **THEN** result SHALL 保持对应工具既有成功、失败和中断语义

#### Scenario: 沙箱未生效时执行只读 bash inspection
- **WHEN** readonly run 的生效沙箱不是可用 `read-only` 档
- **AND** 收到共享 classifier 认可的只读 bash 命令，例如 `git status --short` 或 `git diff --stat`
- **THEN** policy SHALL 允许普通 bash executor 执行该命令
- **THEN** result SHALL 保持既有 stdout、stderr、exit code、timeout 和 truncation 语义

#### Scenario: 生效只读沙箱下任意 bash 进入执行
- **WHEN** readonly run 的生效沙箱可用且档位为 `read-only`
- **AND** 收到任意 `run_bash_command`，包括严格只读 allowlist 之外的命令
- **THEN** policy SHALL 允许调用直接进入普通 bash executor
- **THEN** 系统 SHALL NOT 请求人工审批或自动审批模型
- **THEN** 命令副作用 SHALL 由内核沙箱边界约束

#### Scenario: 只读运行仅委派只读子代理
- **WHEN** readonly run 收到 `run_subagent` tool call
- **THEN** 目标属于本轮 readonly 执行策略集合时 policy SHALL 放行
- **THEN** 目标为 general_purpose、未知名称或参数无法解析时 runtime SHALL 返回失败 tool result

#### Scenario: 更新临时 todo
- **WHEN** readonly BTW run 收到有效 todo tool call
- **THEN** runtime SHALL 允许更新该 run 的临时 todo state
- **THEN** 更新 SHALL NOT 写入主 todo state 或主 session journal

### Requirement: Readonly policy 拒绝写入、交互和未知工具
Readonly policy SHALL 拒绝 `apply_patch`、`edit_file`、生效沙箱未覆盖的非只读 bash、所有 MCP tools、`ask_user_questions` 和未列入允许集合的未知工具。拒绝 SHALL 返回保留原 call id 与 tool name 的 `ok: false` tool result，并 SHALL NOT 调用 executor、change recorder、tool approval callback 或 user-question callback。

#### Scenario: 写工具直接拒绝
- **WHEN** readonly run 收到 `apply_patch` 或 `edit_file` tool call
- **THEN** runtime SHALL 返回说明本次运行只允许只读工具的失败 result
- **THEN** runtime SHALL NOT 打开 approval surface、执行 handler 或修改文件

#### Scenario: 沙箱未生效时非只读 bash 直接拒绝
- **WHEN** readonly run 的生效沙箱不是可用 `read-only` 档
- **AND** 收到包含写入、副作用或不在 readonly allowlist 的 bash command
- **THEN** runtime SHALL 返回失败 tool result
- **THEN** runtime SHALL NOT 因会话级既有 allow decision 执行该 command

#### Scenario: MCP fail closed
- **WHEN** readonly run 收到任意 `mcp__` namespace tool call
- **THEN** runtime SHALL 返回 readonly policy 拒绝结果
- **THEN** runtime SHALL NOT查询 MCP approval、调用 MCP manager 或打开 approval surface

#### Scenario: User question 不等待输入
- **WHEN** readonly run 收到 `ask_user_questions` tool call
- **THEN** runtime SHALL 立即返回失败或取消 tool result
- **THEN** runtime SHALL NOT 调用 app user-question callback 或阻塞等待 stdin

#### Scenario: 未知工具 fail closed
- **WHEN** readonly run 收到不在显式允许集合内的工具
- **THEN** policy SHALL 拒绝该调用而不是回退到默认风险分类
- **THEN** runtime SHALL 保留 tool continuation 所需的 call id 和 tool name
