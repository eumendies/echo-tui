## MODIFIED Requirements

### Requirement: plan mode readonly bash execution policy
系统 SHALL 在 plan mode 中对 provider tool call 应用只读执行策略。Provider-visible tool registry SHALL 与 normal mode 保持一致以稳定 tools schema；但 provider tool call 在进入 executor 前 SHALL 经过 mode-aware classifier。不符合 plan mode 只读策略的命令或写入型工具 SHALL 被拒绝且不得执行。

#### Scenario: Plan mode registry keeps default tool schema
- **WHEN** 系统为 plan mode 创建 provider-visible tool registry
- **THEN** registry SHALL 包含 normal mode 默认内置工具 definitions
- **AND** registry SHALL 包含 `run_bash_command`
- **AND** registry SHALL 包含 `apply_patch`
- **AND** registry SHALL 与 normal mode 在同一 MCP 状态下暴露相同的 provider-visible tool definition 集合

#### Scenario: Execute allowed readonly git command
- **WHEN** plan mode 下 `run_bash_command` 收到只读 git inspection 命令，例如 `git status --short` 或 `git diff --stat`
- **THEN** classifier SHALL 将该 tool call 判定为 safe
- **AND** executor SHALL 使用普通 bash handler 和共享 bash runner 执行该命令
- **AND** result SHALL 保留 stdout、stderr、exit code、timeout、duration 和 truncated 等既有 bash result 语义

#### Scenario: Reject command outside readonly allowlist
- **WHEN** plan mode 下 `run_bash_command` 收到不在只读 allowlist 内的命令，例如 `npm test`、`git reset --hard HEAD` 或 `python script.py`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令
- **AND** runtime SHALL 返回 `ok: false` 的 tool result
- **AND** result 文本 SHALL 说明当前处于 plan mode，bash 只允许 readonly inspection 命令，并提示需要退出 plan mode 才能执行该命令

#### Scenario: Reject shell metacharacters that can cause side effects
- **WHEN** plan mode 下 `run_bash_command` 收到包含 shell 管道、重定向、多命令连接、命令替换或多行语法的命令
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject git options that write output or mutate repository state
- **WHEN** plan mode 下 `run_bash_command` 收到表面为只读 git 子命令但包含写入型参数或 mutation 子命令，例如 `git diff --output patch.txt`、`git fetch`、`git pull`、`git checkout branch`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject write tools in plan mode
- **WHEN** plan mode 下 provider 返回 `apply_patch` 或等价写入型本地 tool call
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 打开用户授权 surface
- **AND** runtime SHALL NOT 调用 executor 执行该 tool call
- **AND** runtime SHALL 返回 `ok: false` 的 tool result，说明需要退出 plan mode 才能修改文件或系统状态

#### Scenario: Normal mode bash remains unchanged
- **WHEN** 系统为 normal mode 创建默认 tool registry
- **THEN** `run_bash_command` SHALL 保持既有完整 bash tool 行为
- **AND** 高风险 bash 命令 SHALL 继续按既有 approval 策略处理
- **AND** `apply_patch` SHALL 继续按既有 approval 策略处理
