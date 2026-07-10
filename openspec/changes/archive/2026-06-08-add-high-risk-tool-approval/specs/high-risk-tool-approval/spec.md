## ADDED Requirements

### Requirement: 高危工具调用风险分类
系统 SHALL 在执行普通本地 tool executor 前对 tool call 进行风险分类。风险分类 SHALL 基于工具名和工具参数，输出是否可直接执行或是否需要用户授权。风险分类 SHALL 不执行工具本身。

#### Scenario: apply_patch 始终需要授权
- **WHEN** agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 风险分类 SHALL 返回需要用户授权
- **THEN** 系统 SHALL 在调用普通 tool executor 前等待用户授权决策

#### Scenario: 普通安全 bash 命令不触发授权
- **WHEN** agent loop runtime 收到 `run_bash_command` tool call，且 command 是 `pwd`、`ls`、`git status`、`git diff`、`git log`、`rg` 或等价只读/验证命令
- **THEN** 风险分类 SHALL 返回可直接执行
- **THEN** 系统 SHALL NOT 因高危工具拦截显示授权 choice surface

#### Scenario: 高危 bash 命令需要授权
- **WHEN** agent loop runtime 收到 `run_bash_command` tool call，且 command 包含常见删除、写入、编辑、安装、权限修改、破坏性 git 操作或远程脚本执行模式
- **THEN** 风险分类 SHALL 返回需要用户授权
- **THEN** 风险分类结果 SHALL 包含可展示给用户的风险原因
- **THEN** 系统 SHALL 在调用普通 tool executor 前等待用户授权决策

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
