## ADDED Requirements

### Requirement: Plan mode readonly bash tool
系统 SHALL 在 plan mode 的只读 tool registry 中暴露受限版 `run_bash_command`，用于执行明确只读的 workspace inspection 命令。该工具 SHALL 保持与普通 bash tool 相同的参数和结果结构，但 SHALL 在执行前拒绝不符合 plan mode 只读策略的命令。

#### Scenario: Plan mode registry exposes readonly bash
- **WHEN** 系统为 plan mode 创建只读 tool registry
- **THEN** registry SHALL 包含名为 `run_bash_command` 的 tool definition
- **AND** 该 definition SHALL 描述其只允许 readonly inspection 命令
- **AND** registry SHALL NOT 包含 `apply_patch` 或其他写入型工具

#### Scenario: Execute allowed readonly git command
- **WHEN** plan mode 下 `run_bash_command` 收到只读 git inspection 命令，例如 `git status --short` 或 `git diff --stat`
- **THEN** handler SHALL 使用共享 bash runner 执行该命令
- **AND** result SHALL 保留 stdout、stderr、exit code、timeout、duration 和 truncated 等既有 bash result 语义

#### Scenario: Reject command outside readonly allowlist
- **WHEN** plan mode 下 `run_bash_command` 收到不在只读 allowlist 内的命令，例如 `npm test`、`git reset --hard HEAD` 或 `python script.py`
- **THEN** handler SHALL NOT 执行该命令
- **AND** handler SHALL 返回 `ok: false` 的 tool result
- **AND** result 文本 SHALL 说明当前处于 plan mode，bash 只允许 readonly inspection 命令，并提示需要退出 plan mode 才能执行该命令

#### Scenario: Reject shell metacharacters that can cause side effects
- **WHEN** plan mode 下 `run_bash_command` 收到包含 shell 管道、重定向、多命令连接、命令替换或多行语法的命令
- **THEN** handler SHALL NOT 执行该命令
- **AND** handler SHALL 返回 `ok: false` 的 tool result

#### Scenario: Reject git options that write output or mutate repository state
- **WHEN** plan mode 下 `run_bash_command` 收到表面为只读 git 子命令但包含写入型参数或 mutation 子命令，例如 `git diff --output patch.txt`、`git fetch`、`git pull`、`git checkout branch`
- **THEN** handler SHALL NOT 执行该命令
- **AND** handler SHALL 返回 `ok: false` 的 tool result

#### Scenario: Normal mode bash remains unchanged
- **WHEN** 系统为 normal mode 创建默认 tool registry
- **THEN** `run_bash_command` SHALL 保持既有完整 bash tool 行为
- **AND** 高风险 bash 命令 SHALL 继续按既有 approval 策略处理
