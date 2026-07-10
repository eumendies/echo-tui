## ADDED Requirements

### Requirement: 高危工具会话级授权
高危工具授权 SHALL 支持当前 CLI 进程会话内复用用户授权。非 bash 工具的会话级授权 SHALL 按 tool name 匹配；`run_bash_command` 的会话级授权 SHALL 按当前 bash command 文本匹配，SHALL NOT 因一次选择而允许整个 bash 工具。

#### Scenario: 会话内允许同名非 bash 高危工具
- **WHEN** 高危非 bash tool call 授权请求处于活跃状态
- **AND** 用户选择 `Allow <toolName> for this session`
- **THEN** 系统 SHALL 执行当前 tool call
- **THEN** 当前 CLI 进程会话内后续同名且仍需审批的 tool call SHALL 不再显示授权 choice surface
- **THEN** 当前 CLI 进程会话内后续不同 tool name 的高危 tool call SHALL 仍按风险分类结果请求授权

#### Scenario: 会话内允许同一 bash command
- **WHEN** 高危 `run_bash_command` 授权请求处于活跃状态
- **AND** 用户选择 `Allow this command for this session`
- **THEN** 系统 SHALL 执行当前 bash tool call
- **THEN** 当前 CLI 进程会话内后续 command 文本完全相同且仍需审批的 `run_bash_command` SHALL 不再显示授权 choice surface
- **THEN** 当前 CLI 进程会话内后续 command 文本不同的高危 `run_bash_command` SHALL 仍按风险分类结果请求授权

#### Scenario: bash command 授权不扩张到整个 bash 工具
- **WHEN** 用户已经允许某个 bash command 在当前会话内执行
- **AND** agent loop runtime 收到另一个不同 command 文本的高危 `run_bash_command` tool call
- **THEN** 系统 SHALL NOT 因已有 bash command 授权而隐藏该 tool call 的授权 choice surface

#### Scenario: 会话内允许所有高危工具
- **WHEN** 高危 tool call 授权请求处于活跃状态
- **AND** 用户选择 `Allow all tools for this session`
- **THEN** 系统 SHALL 执行当前 tool call
- **THEN** 当前 CLI 进程会话内后续所有需要授权的高危 tool call SHALL 不再显示授权 choice surface

#### Scenario: 会话级授权不持久化
- **WHEN** 用户选择任一会话级 allow 选项
- **THEN** 系统 SHALL NOT 把该授权写入 transcript record
- **THEN** 系统 SHALL NOT 把该授权写入 persisted session 或用户配置
- **THEN** 新的 CLI 进程 SHALL 不继承该授权
