## MODIFIED Requirements

### Requirement: Worker 复用主 Agent 普通执行策略
Worker SHALL 继承父 Agent 当前 normal或plan交互语义，并通过与主 Agent相同的风险分类处理本地写入、Bash 和 MCP。plan 父运行的 bash 沙箱分层 SHALL 通过委派端口传递给 Worker:生效 `read-only` 沙箱可用时,Worker 的 `run_bash_command` SHALL 与主 Agent 一样由内核边界执行;沙箱不可用时,Worker SHALL 按主 Agent plan mode语义拒绝越界命令。所有 approval-required Worker调用 SHALL 使用与主 Agent共享的会话授权缓存、manual/auto resolver和change recorder，同时附加 Worker run origin用于surface身份和迟到回调隔离。

#### Scenario: Normal Worker 执行普通任务工具
- **WHEN** normal mode Worker 请求安全工具或需要审批的文件编辑、高风险 Bash、MCP调用
- **THEN** 系统 SHALL 使用主 Agent normal mode的风险分类结果
- **THEN** approval-required调用 SHALL 在共享会话缓存未命中时进入当前manual或auto审批流程
- **THEN** 人工surface SHALL显示Worker身份，批准后的变更 SHALL沿用父turn change recorder

#### Scenario: Plan Worker 不能绕过写入与 MCP 边界
- **WHEN** plan mode Worker 请求文件编辑或 MCP tool
- **THEN** 系统 SHALL 按主 Agent plan mode语义直接拒绝该调用
- **THEN** 系统 SHALL NOT 因调用来自Worker而进入写入审批或执行对应handler

#### Scenario: Plan Worker 的 bash 继承父运行沙箱边界
- **WHEN** plan mode Worker 请求严格只读 allowlist 之外的 Bash 命令
- **THEN** 父运行生效沙箱为可用 `read-only` 档时,系统 SHALL 在继承的沙箱边界内直接执行该命令且 SHALL NOT 打开 approval surface
- **THEN** 父运行沙箱未生效时,系统 SHALL 按主 Agent plan mode语义直接拒绝该调用

#### Scenario: Headless Worker 沿用父策略
- **WHEN** headless Worker产生approval-required工具调用
- **THEN** approval policy为`deny`时系统 SHALL返回失败tool result且不等待stdin
- **THEN** approval policy为`full-access`时系统 SHALL允许该调用一次并继续Worker continuation
