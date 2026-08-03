## MODIFIED Requirements

### Requirement: plan mode readonly bash execution policy
系统 SHALL 在 plan mode 中对 provider tool call 应用只读执行策略。Provider-visible tool registry SHALL 与 normal mode 保持一致以稳定 tools schema；但 provider tool call 在进入 executor 前 SHALL 经过 mode-aware classifier。不符合 plan mode 只读策略的命令或写入型工具 SHALL 被拒绝且不得执行。

只读命令判定 SHALL 覆盖四类命令：`pwd`；已知只读文件检查命令（`ls`、`cat`、`head`、`tail`、`wc`、`grep`、`rg`、`echo`、`printf` 与排除全部写选项后的 `find`）；只读 git 检查子命令（含按参数形态白名单的 `branch/tag/stash/config/remote`）；以及上述命令通过 `|`、`&&`、`;`、`||`、换行组成的纯只读组合命令。组合命令 SHALL 逐段独立判定，任一段不满足只读条件即整体拒绝。写类元字符（重定向、输入重定向、命令替换、反引号、`xargs`）SHALL 继续导致整条命令被拒绝。

#### Scenario: Plan mode registry keeps default tool schema
- **WHEN** 系统为 plan mode 创建 provider-visible tool registry
- **THEN** registry SHALL 包含 normal mode 默认内置工具 definitions
- **AND** registry SHALL 包含 `run_bash_command`
- **AND** registry SHALL 包含 `apply_patch`
- **AND** registry SHALL 与 normal mode 在同一 MCP 状态下暴露相同的 provider-visible tool definition 集合

#### Scenario: Execute allowed readonly git command
- **WHEN** plan mode 下 `run_bash_command` 收到只读 git inspection 命令，例如 `git status --short`、`git diff --stat`、`git branch -a`、`git grep todo` 或 `git config --get user.name`
- **THEN** classifier SHALL 将该 tool call 判定为 safe
- **AND** executor SHALL 使用普通 bash handler 和共享 bash runner 执行该命令
- **AND** result SHALL 保留 stdout、stderr、exit code、可选 timeout、duration 和 truncated 等既有 bash result 语义

#### Scenario: Execute allowed readonly file inspection command
- **WHEN** plan mode 下 `run_bash_command` 收到只读文件检查命令，例如 `ls -la`、`cat package.json`、`head -20 src/app/main.ts`、`rg "hello" src` 或 `find . -name "*.ts"`
- **THEN** classifier SHALL 将该 tool call 判定为 safe
- **AND** executor SHALL 使用普通 bash handler 和共享 bash runner 执行该命令

#### Scenario: Execute readonly composed command
- **WHEN** plan mode 下 `run_bash_command` 收到由只读命令通过 `|`、`&&`、`;`、`||` 或换行组成的组合命令，例如 `git log --oneline | head -20`、`cat package.json | grep version` 或 `ls && git status`
- **THEN** classifier SHALL 将每个命令段分别按只读规则判定
- **AND** 所有段均满足只读条件时 classifier SHALL 将该 tool call 判定为 safe
- **AND** executor SHALL 使用普通 bash handler 和共享 bash runner 执行该组合命令

#### Scenario: Reject command outside readonly allowlist
- **WHEN** plan mode 下 `run_bash_command` 收到不在只读 allowlist 内的命令，例如 `npm test`、`git reset --hard HEAD`、`python script.py` 或 `node app.js`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令
- **AND** runtime SHALL 返回 `ok: false` 的 tool result
- **AND** result 文本 SHALL 说明当前处于 plan mode，bash 只允许 readonly inspection 命令，并提示需要退出 plan mode 才能执行该命令

#### Scenario: Reject shell metacharacters that can cause side effects
- **WHEN** plan mode 下 `run_bash_command` 收到包含写类 shell 元字符的命令，例如 `git status > out.txt`、`echo hi >> log.txt`、`cat "$(ls)"`、反引号命令替换或 `git ls-files -z | xargs -0 rm`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject git write-form subcommand or options
- **WHEN** plan mode 下 `run_bash_command` 收到表面为只读 git 子命令但包含写入型参数或 mutation 子命令，例如 `git diff --output patch.txt`、`git fetch`、`git pull`、`git checkout branch`、`git branch feature`、`git tag v1`、`git stash push` 或 `git config user.email x`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject find commands with write options
- **WHEN** plan mode 下 `run_bash_command` 收到含写选项的 `find` 命令，例如 `find . -exec touch {} \;`、`find . -delete`、`find . -fprint out.txt` 或 `find . -fprintf out.txt '%p\n'`
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
