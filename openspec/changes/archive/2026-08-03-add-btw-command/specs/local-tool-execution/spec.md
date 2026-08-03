## ADDED Requirements

### Requirement: Per-run readonly tool policy 保持 provider schema 稳定
系统 SHALL 支持独立于 interaction mode 和 headless approval policy 的 per-run readonly tool policy。该 policy SHALL 保持 normal run 在相同 MCP 状态下的 provider-visible tool definitions 不变，并 SHALL 在 tool call 进入普通风险审批、交互 callback 或 executor 前执行 fail-closed 分类。未显式指定 policy 的现有 run SHALL 保持默认工具行为。

#### Scenario: BTW readonly run 保持工具定义
- **WHEN** 系统以 readonly policy 启动 BTW agent run
- **THEN** provider-visible registry SHALL 与相同 MCP 状态下的 normal run 暴露相同 tool definitions
- **THEN** 系统 SHALL NOT 通过裁剪 tools schema 表达 readonly 约束

#### Scenario: 默认 run 行为不变
- **WHEN** agent session 未指定 readonly policy
- **THEN** 本地工具、MCP、approval、plan mode 和 headless policy SHALL 保持既有行为

### Requirement: Readonly policy 只允许明确安全的临时操作
Readonly policy SHALL 允许明确列入只读集合的文件读取、glob/grep、网页读取/搜索和 skill 加载工具，并 SHALL 允许只修改当前 BTW 临时 todo state 的 todo 工具。`run_bash_command` SHALL 仅在共享 readonly classifier 明确认可为 inspection command 时执行；允许的调用 SHALL 继续使用既有 executor、abort、输出截断和 tool result 语义。

#### Scenario: 执行只读文件检查
- **WHEN** readonly run 收到 `read_files`、`glob` 或 `grep` 的有效 tool call
- **THEN** policy SHALL 允许调用进入普通 executor
- **THEN** result SHALL 保持对应工具既有成功、失败和中断语义

#### Scenario: 执行只读 bash inspection
- **WHEN** readonly run 收到共享 classifier 认可的只读 bash 命令，例如 `git status --short` 或 `git diff --stat`
- **THEN** policy SHALL 允许普通 bash executor 执行该命令
- **THEN** result SHALL 保持既有 stdout、stderr、exit code、timeout 和 truncation 语义

#### Scenario: 更新临时 todo
- **WHEN** readonly BTW run 收到有效 todo tool call
- **THEN** runtime SHALL 允许更新该 run 的临时 todo state
- **THEN** 更新 SHALL NOT 写入主 todo state 或主 session journal

### Requirement: Readonly policy 拒绝写入、交互和未知工具
Readonly policy SHALL 拒绝 `apply_patch`、`edit_file`、非只读 bash、所有 MCP tools、`ask_user_questions` 和未列入允许集合的未知工具。拒绝 SHALL 返回保留原 call id 与 tool name 的 `ok: false` tool result，并 SHALL NOT 调用 executor、change recorder、tool approval callback 或 user-question callback。

#### Scenario: 写工具直接拒绝
- **WHEN** readonly run 收到 `apply_patch` 或 `edit_file` tool call
- **THEN** runtime SHALL 返回说明当前会话只允许只读工具的失败 result
- **THEN** runtime SHALL NOT 打开 approval surface、执行 handler 或修改文件

#### Scenario: 非只读 bash 直接拒绝
- **WHEN** readonly run 收到包含写入、副作用或不在 readonly allowlist 的 bash command
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
