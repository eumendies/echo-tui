## MODIFIED Requirements

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
