## MODIFIED Requirements

### Requirement: /review 从 plan mode 切换到 normal
当 `/review` 在 plan interaction mode 下启动时，workflow handler SHALL 在提交 agent turn 前将当前 mode 切换为 normal，使该 turn 按 normal interaction mode 的工具边界执行，并由运行级只读边界保证只读语义。该切换 SHALL NOT 放宽只读边界，也 SHALL NOT 使 `/review` 运行测试或构建。

#### Scenario: plan mode 启动 /review
- **WHEN** 当前 interaction mode 为 plan 且用户提交纯 `/review`
- **THEN** workflow handler SHALL 在提交 agent turn 前切换到 normal
- **THEN** `/review` SHALL 使用 normal mode 的工具边界并在运行级只读边界内执行
- **THEN** `/review` SHALL NOT 因 mode 切换而修改项目代码或运行测试、构建

## ADDED Requirements

### Requirement: /review 声明运行级只读边界
`/review` workflow definition SHALL 声明运行级 readonly 工具策略与 `read-only` 沙箱收紧，并 SHALL 通过普通提交流程透传到该 turn 的 agent session。handler SHALL 在启动时追加一条说明只读边界的本地 notice。该 turn 内写文件工具、MCP tools、`ask_user_questions` 和非 readonly 子代理委派 SHALL 在审批与执行前被拒绝；`run_bash_command` SHALL 在生效只读沙箱下直接执行，沙箱不可用或档位不是 `read-only` 时回退严格只读 allowlist。该边界 SHALL NOT 依赖 prompt 文本强制。

#### Scenario: /review 启动时声明并通知只读边界
- **WHEN** 用户提交纯 `/review`
- **THEN** workflow handler SHALL 为该 turn 声明 readonly 工具策略与只读沙箱收紧
- **THEN** transcript SHALL 追加一条本地 notice 说明本次运行启用只读边界
- **THEN** 该 notice SHALL NOT 改变 provider-visible tool definitions

#### Scenario: /review turn 拒绝写操作
- **WHEN** `/review` turn 收到 `apply_patch`、`edit_file`、MCP tool 或非 readonly 子代理委派
- **THEN** runtime SHALL 返回 fail-closed 失败 tool result
- **THEN** runtime SHALL NOT 打开 approval surface 或执行该调用

#### Scenario: /review 的 bash 边界
- **WHEN** `/review` turn 收到 `run_bash_command`
- **THEN** 生效沙箱为可用 `read-only` 档时命令 SHALL 在沙箱边界内直接执行且 SHALL NOT 进入审批
- **THEN** 沙箱不可用或档位不是 `read-only` 时仅严格只读 allowlist 内的命令 SHALL 执行
