## MODIFIED Requirements

### Requirement: local tool registry and execution boundary
系统 SHALL 提供 provider-neutral 的本地工具执行边界。该边界 SHALL 支持工具定义、工具 handler、工具 registry 和工具 executor，并 SHALL 让 agent adapter 可以按工具名称执行已注册工具而不依赖具体工具实现细节。该边界 SHALL 支持合并内置工具 registry 与启动期成功初始化的 MCP tool registry；主运行 SHALL 按当前主 Agent 工具选择筛选内置与 MCP 工具，并让 provider definitions、executor 与特殊执行入口使用同一最终注册集合。未注册、禁用或初始化失败的工具 SHALL 继续返回失败结果而不是中断 app。

#### Scenario: 注册工具定义和 handler
- **WHEN** 系统创建本地 tool registry
- **THEN** registry SHALL 能按工具名称保存 tool definition 和对应 handler
- **THEN** registry SHALL 能向 agent adapter 暴露可发送给 provider 的工具定义列表

#### Scenario: 合并 MCP tool registry
- **WHEN** MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** normal mode 默认 tool registry SHALL 包含当前主 Agent 工具选择允许的内置工具和这些 MCP tools
- **THEN** registry SHALL 能按 MCP namespace tool name 找到对应 MCP handler

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

#### Scenario: 禁用工具在执行前拒绝
- **WHEN** 主运行收到未包含在最终 registry 中的工具调用，包括 Todo、提问、委派等特殊工具
- **THEN** 系统 SHALL 在特殊处理、审批或 executor 之前返回匹配原调用身份的失败结果
- **THEN** 系统 SHALL NOT 产生该工具的执行副作用

### Requirement: plan mode readonly bash execution policy
系统 SHALL 在 plan mode 中对 provider tool call 应用只读执行策略。Provider-visible tool registry SHALL 在相同主 Agent 工具配置和可用目录下与 normal mode 保持一致以稳定 tools schema；但 provider tool call 在进入 executor 前 SHALL 经过 mode-aware classifier。plan 运行 SHALL 在配置档位非 `off` 时自动派生运行级 `read-only` 沙箱收紧。`run_bash_command` SHALL 分层执行：当生效沙箱可用且档位为 `read-only` 时,任意命令 SHALL 判定为 safe 并直接进入既有 executor,SHALL NOT 打开用户授权 surface,工作区写入、网络访问与状态变更由内核沙箱边界拒绝;当生效沙箱不可用时,命令 SHALL 仅在命中严格只读 allowlist 时执行,未命中命令 SHALL 被拒绝且不得执行。写入型工具与 MCP tools SHALL 无论沙箱是否生效都被拒绝且不得执行。

沙箱不可用时的只读命令判定 SHALL 覆盖四类命令：`pwd`；已知只读文件检查命令（`ls`、`cat`、`head`、`tail`、`wc`、`grep`、`rg`、`echo`、`printf` 与排除全部写选项后的 `find`）；只读 git 检查子命令（含按参数形态白名单的 `branch/tag/stash/config/remote`）；以及上述命令通过 `|`、`&&`、`;`、`||`、换行组成的纯只读组合命令。组合命令 SHALL 逐段独立判定，任一段不满足只读条件即整体拒绝。写类元字符（重定向、输入重定向、命令替换、反引号、`xargs`）SHALL 继续导致整条命令被拒绝。

#### Scenario: Plan mode registry keeps default tool schema
- **WHEN** 系统为 plan mode 创建 provider-visible tool registry
- **THEN** registry SHALL 包含同配置 normal mode 所选的内置工具 definitions
- **AND** registry SHALL 包含 `run_bash_command`
- **AND** registry SHALL 在 `apply_patch` 未被禁用时包含该工具，在其被禁用时不包含该工具
- **AND** registry SHALL 与 normal mode 在同一主工具配置和 MCP 状态下暴露相同的 provider-visible tool definition 集合

#### Scenario: 生效只读沙箱下任意 bash 进入执行
- **WHEN** plan 运行的生效沙箱可用且档位为 `read-only`
- **AND** `run_bash_command` 收到严格只读 allowlist 之外的命令，例如 `jq . package.json`、`node -e "..."` 或 `awk '{print $1}'`
- **THEN** classifier SHALL 将该 tool call 判定为 safe
- **AND** executor SHALL 使用普通 bash handler 和共享 bash runner 执行该命令
- **AND** runtime SHALL NOT 打开用户授权 surface
- **AND** 命令的写入、网络与其他越界效果 SHALL 由内核沙箱边界拒绝

#### Scenario: 生效只读沙箱下网络访问被拒绝
- **WHEN** plan 运行的生效沙箱可用且档位为 `read-only`
- **AND** `run_bash_command` 收到需要网络访问的只读命令，例如 `git ls-remote origin`
- **THEN** 命令 SHALL 在沙箱边界内执行
- **AND** 网络访问 SHALL 被内核沙箱边界拒绝，命令 SHALL 以失败结果返回

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
- **WHEN** plan 运行的生效沙箱不是可用 `read-only` 档
- **AND** `run_bash_command` 收到不在只读 allowlist 内的命令，例如 `npm test`、`git reset --hard HEAD`、`python script.py` 或 `node app.js`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令
- **AND** runtime SHALL 返回 `ok: false` 的 tool result
- **AND** result 文本 SHALL 说明当前处于 plan mode，bash 只允许 readonly inspection 命令，并提示需要退出 plan mode 才能执行该命令

#### Scenario: Reject shell metacharacters that can cause side effects
- **WHEN** plan 运行的生效沙箱不是可用 `read-only` 档
- **AND** `run_bash_command` 收到包含写类 shell 元字符的命令，例如 `git status > out.txt`、`echo hi >> log.txt`、`cat "$(ls)"`、反引号命令替换或 `git ls-files -z | xargs -0 rm`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject git write-form subcommand or options
- **WHEN** plan 运行的生效沙箱不是可用 `read-only` 档
- **AND** `run_bash_command` 收到表面为只读 git 子命令但包含写入型参数或 mutation 子命令，例如 `git diff --output patch.txt`、`git fetch`、`git pull`、`git checkout branch`、`git branch feature`、`git tag v1`、`git stash push` 或 `git config user.email x`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject find commands with write options
- **WHEN** plan 运行的生效沙箱不是可用 `read-only` 档
- **AND** `run_bash_command` 收到含写选项的 `find` 命令，例如 `find . -exec touch {} \;`、`find . -delete`、`find . -fprint out.txt` 或 `find . -fprintf out.txt '%p\n'`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject write tools in plan mode
- **WHEN** plan 运行下 provider 返回 `apply_patch` 或等价写入型本地 tool call
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 打开用户授权 surface
- **AND** runtime SHALL NOT 调用 executor 执行该 tool call
- **AND** runtime SHALL 返回 `ok: false` 的 tool result，说明需要退出 plan mode 才能修改文件或系统状态

#### Scenario: Normal mode bash remains unchanged
- **WHEN** 系统为 normal mode 创建默认 tool registry
- **THEN** `run_bash_command` SHALL 保持既有完整 bash tool 行为
- **AND** 高风险 bash 命令 SHALL 继续按既有 approval 策略处理
- **AND** 已启用的 `apply_patch` 和 `edit_file` SHALL 继续按既有 approval 策略处理

### Requirement: 可配置的 provider-visible 文件编辑工具
公共工具工厂 SHALL 始终构造 `apply_patch` 与 `edit_file`，再由主 Agent 的 `disabledTools` 或子 Agent 的 `allowedToolNames` 分别筛选，不再提供内部 `fileEditMode` 或 `includeBothFileEditTools` 兼容分支。主 Agent SHALL 按归一化的独立工具选择注册编辑工具，允许同时注册两个、只注册一个或均不注册；缺少 `disabledTools` 时 SHALL 默认 `[]`，两个编辑工具及其他可用工具默认开启。主／子运行 SHALL NOT 读取 `tools.fileEdit.mode`。子运行 SHALL 继续遵守自身白名单，不继承主 Agent 禁用名单；Worker definition SHALL 仅保留 `apply_patch`，不得暴露或执行 `edit_file`，Explorer SHALL 仍无编辑工具，自定义 Agent SHALL 继续自身白名单。每次运行的 provider definitions 与 executable registry SHALL 同源并固定至该运行结束。

#### Scenario: 缺失名单默认同时使用两个编辑工具
- **WHEN** 主 Agent 的 `disabledTools` 缺失
- **THEN** 默认主 registry SHALL 同时包含 `apply_patch` 和 `edit_file` 的 definition 及 handler，并包含其他可用工具

#### Scenario: 旧编辑模式不影响任何运行
- **WHEN** 旧 `tools.fileEdit.mode` 为 `edit_file`、`apply_patch` 或非法值
- **THEN** 公共工厂 SHALL 仍构造两个编辑 handler，主运行 SHALL 只按新名单及可用性筛选，子运行 SHALL 只按自身白名单及可用性筛选
- **THEN** 系统 SHALL NOT 读取旧模式、自动迁移写盘或主动清理旧字段

#### Scenario: 同时开启两个编辑工具
- **WHEN** 有效的新主 Agent 工具选择未禁用任何编辑工具
- **THEN** registry SHALL 同时包含 `apply_patch` 和 `edit_file` 的 definition 及 handler
- **THEN** 旧 mode SHALL NOT 使其中一个工具消失

#### Scenario: 同时关闭两个编辑工具
- **WHEN** 主 Agent 新工具选择同时禁用 `apply_patch` 和 `edit_file`
- **THEN** registry SHALL 不包含任一编辑工具
- **THEN** 系统 SHALL 继续保留 Bash，且不得自动补回编辑工具

#### Scenario: 子运行独立按白名单筛选编辑工具
- **WHEN** 主 Agent 同时禁用两个编辑工具，并委派 Worker、Explorer 或自定义 Agent
- **THEN** Worker SHALL 注册 `apply_patch` 而不注册 `edit_file`，Explorer SHALL 不注册任一编辑工具
- **THEN** 自定义 Agent SHALL 仅注册自身白名单允许的编辑工具，主禁用名单 SHALL NOT 收窄或扩大子运行集合

#### Scenario: 当前 run 固定工具集合
- **WHEN** assistant run 已经准备完成后用户配置发生变化
- **THEN** 当前 run SHALL 继续使用启动时的 tool definitions 和 executor registry
- **THEN** 下一次主运行 SHALL 使用最新归一化的工具选择
