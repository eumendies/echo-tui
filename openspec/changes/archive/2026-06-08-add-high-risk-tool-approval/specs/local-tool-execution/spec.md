## ADDED Requirements

### Requirement: bash 工具执行前高危拦截
系统 SHALL 在执行 `run_bash_command` 的普通 handler 前支持上层风险分类拦截。bash handler SHALL 继续只负责非交互命令执行和结果归一化，不直接读取 TUI 输入或持有授权状态。

#### Scenario: 高危 bash 在 handler 前被拦截
- **WHEN** agent loop runtime 收到被分类为需要授权的 `run_bash_command` tool call
- **THEN** 系统 SHALL 在调用 bash handler 前请求用户授权
- **THEN** 用户拒绝时 bash handler SHALL NOT 被调用

#### Scenario: 安全 bash 继续普通执行
- **WHEN** agent loop runtime 收到被分类为可直接执行的 `run_bash_command` tool call
- **THEN** 系统 SHALL 通过普通 tool executor 调用 bash handler
- **THEN** bash handler SHALL 保持现有 stdout、stderr、exit code、timeout 和截断结果语义

#### Scenario: 风险分类不改变 bash handler 契约
- **WHEN** bash handler 被普通 tool executor 调用
- **THEN** handler SHALL 继续接收已解析的 JSON object 参数和原始 tool call
- **THEN** handler SHALL NOT 依赖 app callback、choice surface 或用户授权上下文
