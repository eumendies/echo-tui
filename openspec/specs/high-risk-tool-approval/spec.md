# high-risk-tool-approval Specification

## Purpose
定义本地高危工具调用的风险分类、高危 bash 命令模式识别，以及用户拒绝或允许高危调用后的工具结果语义。
## Requirements
### Requirement: 高危工具调用风险分类
系统 SHALL 在执行普通本地 tool executor 前对 tool call 进行风险分类。风险分类 SHALL 基于工具名和工具参数，输出是否可直接执行、是否需要审批或是否应拒绝。风险分类 SHALL 不执行工具本身，也 SHALL 不因工具审批模式为 auto 而把原有 approval-required 调用改判为 safe。Approval-required 调用 SHALL 在 executor 前进入当前工具审批模式的决策流程；manual 模式等待用户授权，auto 模式可由审批模型允许本次执行或回退用户授权。

#### Scenario: apply_patch 始终分类为需要审批
- **WHEN** agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 风险分类 SHALL 返回需要审批
- **THEN** 系统 SHALL 在调用普通 tool executor 前进入当前工具审批模式的决策流程

#### Scenario: 普通安全 bash 命令不触发审批
- **WHEN** agent loop runtime 收到 `run_bash_command` tool call，且 command 是 `pwd`、`ls`、`git status`、`git diff`、`git log`、`rg` 或等价只读/验证命令
- **THEN** 风险分类 SHALL 返回可直接执行
- **THEN** 系统 SHALL NOT 因高危工具拦截请求自动审批模型或显示授权 choice surface

#### Scenario: 高危 bash 命令需要审批
- **WHEN** agent loop runtime 收到 `run_bash_command` tool call，且 command 包含常见删除、写入、编辑、安装、权限修改、破坏性 git 操作或远程脚本执行模式
- **THEN** 风险分类 SHALL 返回需要审批
- **THEN** 风险分类结果 SHALL 包含现有可展示 preview
- **THEN** 系统 SHALL 在调用普通 tool executor 前进入当前工具审批模式的决策流程

### Requirement: bash 高危命令模式
系统 SHALL 对 `run_bash_command` 的 command 文本执行保守模式识别，覆盖常见会修改本地文件、依赖、权限、git 状态或执行远程脚本的命令。系统 SHALL NOT 声称该识别提供完整 shell sandbox。

#### Scenario: 删除和文件修改命令触发授权
- **WHEN** bash command 包含 `rm`、`rm -rf`、`rmdir`、`unlink`、`mv`、`cp`、`chmod`、`chown`、`truncate` 或等价文件/权限修改命令
- **THEN** 风险分类 SHALL 返回需要用户授权
- **THEN** 风险原因 SHALL 描述该命令可能删除、移动、覆盖或修改本地文件

#### Scenario: shell 写入重定向触发授权
- **WHEN** bash command 包含 `>`、`>>`、`2>`、`&>` 或 `>|` 等写入重定向
- **THEN** 风险分类 SHALL 返回需要用户授权
- **THEN** 风险原因 SHALL 描述该命令可能写入或覆盖文件

#### Scenario: 原地编辑和 find 删除触发授权
- **WHEN** bash command 包含 `sed -i`、`perl -i`、`perl -pi`、`find ... -delete` 或 `find ... -exec rm`
- **THEN** 风险分类 SHALL 返回需要用户授权
- **THEN** 风险原因 SHALL 描述该命令可能原地编辑或删除文件

#### Scenario: 包管理和破坏性 git 操作触发授权
- **WHEN** bash command 包含依赖安装/修改命令，或 `git reset`、`git clean`、`git checkout --`、`git restore`、`git rebase`、`git commit`、`git push` 等会改变仓库状态的命令
- **THEN** 风险分类 SHALL 返回需要用户授权
- **THEN** 风险原因 SHALL 描述该命令可能修改依赖、工作区或 git 历史/远端状态

#### Scenario: 远程脚本执行触发授权
- **WHEN** bash command 包含 `curl` 或 `wget` 输出通过 pipe 传给 `sh`、`bash` 或等价 shell 执行器
- **THEN** 风险分类 SHALL 返回需要用户授权
- **THEN** 风险原因 SHALL 描述该命令可能执行远程脚本

### Requirement: 高危调用拒绝结果
用户拒绝高危工具调用时，系统 SHALL NOT 执行该工具调用，并 SHALL 生成可回传模型的失败 tool result。该 result SHALL 保留原始 tool call id 和 tool name，保证 function tool continuation 完整。

#### Scenario: 用户拒绝高危 bash 调用
- **WHEN** 高危 `run_bash_command` 授权请求处于活跃状态
- **AND** 用户选择 `Deny` 或按下 Esc
- **THEN** 系统 SHALL NOT 调用普通 tool executor 执行该 bash command
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** tool result 文本 SHALL 表示用户拒绝执行
- **THEN** tool result 文本 SHALL NOT 包含系统风险分类原因

#### Scenario: 用户允许高危 bash 调用
- **WHEN** 高危 `run_bash_command` 授权请求处于活跃状态
- **AND** 用户选择 `Allow once`
- **THEN** 系统 SHALL 调用普通 tool executor 执行原始 bash tool call
- **THEN** 系统 SHALL 将真实执行结果作为对应 tool result 继续回传模型

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

### Requirement: edit_file 写入审批策略
系统 SHALL 将 `edit_file` 视为受控写入型本地工具。Normal mode 的 `edit_file` 调用 SHALL 在进入普通 executor 前完成审批决策，并 SHALL 支持按工具名复用当前进程会话级授权；manual 工具审批模式 SHALL 请求用户授权，auto 工具审批模式 SHALL 在会话缓存未命中时先请求审批模型并在 no 或失败时回退用户授权。Plan mode SHALL 在 auto 判断或打开授权 surface 前直接拒绝；headless mode SHALL 继续遵守 deny-by-default 与显式 full-access 策略。

#### Scenario: normal mode 始终需要审批决策
- **WHEN** normal mode 的 agent loop runtime 收到 `edit_file` tool call，且当前会话没有适用的 allow 决策
- **THEN** 风险分类 SHALL 返回需要审批
- **THEN** manual 工具审批模式 SHALL 打开人工 surface，auto 工具审批模式 SHALL 先请求审批模型
- **THEN** 授权预览 SHALL 至少包含 `edit_file` 工具名和目标路径摘要，并 SHALL NOT 展开无界 old/new 文本

#### Scenario: plan mode 拒绝 edit_file
- **WHEN** plan mode 的 runtime 收到 `edit_file` tool call
- **THEN** 风险分类 SHALL 返回 plan-mode rejected
- **THEN** runtime SHALL NOT 请求自动审批模型、打开授权 surface 或执行 handler
- **THEN** 失败结果 SHALL 提示退出 plan mode 后再修改文件

#### Scenario: 会话级授权按 edit_file 工具名复用
- **WHEN** 用户选择允许 `edit_file` 在当前会话执行
- **THEN** 当前调用 SHALL 执行
- **THEN** 当前 CLI 进程内后续仍需审批的 `edit_file` 调用 SHALL 不再请求自动审批模型或打开授权 surface
- **THEN** 该授权 SHALL NOT 自动允许 `apply_patch` 或其他不同名称工具

#### Scenario: headless 默认拒绝与 full-access 放行
- **WHEN** headless run 收到 `edit_file` tool call
- **THEN** deny approval policy SHALL 返回需要显式 `--full-access` 的失败结果且不得修改文件
- **THEN** full-access approval policy SHALL 允许调用进入普通 executor
- **THEN** 两种 headless policy SHALL NOT 请求自动审批模型

