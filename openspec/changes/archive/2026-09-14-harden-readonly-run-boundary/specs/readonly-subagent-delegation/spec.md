## MODIFIED Requirements

### Requirement: 子 Agent Bash 使用严格只读或共享审批策略
子 Agent 的 `run_bash_command` SHALL 使用不继承父级 interaction mode 的固定 fail-closed 分类。命中现有严格只读 Bash allowlist 的命令 SHALL 直接执行；interactive环境下任何无法证明为严格只读的命令 SHALL 在执行前进入与主 Agent相同的审批流程。主 Agent和子 Agent SHALL 共享 allow-all、tool和精确 Bash command会话授权缓存，SHALL NOT按 Agent来源分区；缓存未命中时 SHALL沿用当前 manual或auto设置。人工 surface SHALL 标明请求来自 `explorer`并提供现有完整审批语义。用户允许后系统 MAY执行该 Bash命令；无法追踪其副作用时 SHALL沿用现有 change history失效语义。headless环境下此类子 Agent命令 SHALL直接拒绝。父 run 声明 readonly 工具策略时，只读子运行 SHALL 继承同一只读边界：生效沙箱可用且档位为 `read-only` 时任意命令 SHALL 直接执行且 SHALL NOT 进入人工审批；否则仅严格只读 allowlist 内的命令执行，其余命令 SHALL 直接 fail-closed 拒绝且 SHALL NOT 打开 approval surface。

#### Scenario: 严格只读 Bash 直接执行
- **WHEN** 子 Agent 调用 `run_bash_command`，且 command 命中严格只读 allowlist
- **THEN** 系统 SHALL 直接执行该命令
- **THEN** 系统 SHALL NOT 请求自动审批模型或显示人工 permission surface

#### Scenario: 未知或可能写入的 Bash 请求人工审批
- **WHEN** 父 run 未声明 readonly 工具策略，且 interactive环境中的子 Agent 调用 `run_bash_command`，command 未命中严格只读 allowlist
- **THEN** 系统 SHALL 先查询与主 Agent共用的会话授权缓存，再按当前 manual或auto设置解析审批
- **THEN** 需要人工确认时 surface SHALL标明 `explorer`来源并显示 command preview和现有完整选项

#### Scenario: 子 Agent审批写入共享会话授权
- **WHEN** 子 Agent Bash permission surface活跃且用户选择精确 command会话授权或 allow-all会话授权
- **THEN** 系统 SHALL把决定写入与主 Agent共用的 `ToolApprovalContext`缓存
- **THEN** 后续匹配的主 Agent或子 Agent调用 SHALL复用该授权而不再次打开 surface
- **THEN** 真实 Bash结果 SHALL返回发起当前调用的 Agent

#### Scenario: 用户拒绝或反馈
- **WHEN** 子 Agent Bash permission surface 活跃且用户拒绝、按 Esc 或提交反馈
- **THEN** 系统 SHALL NOT 执行该 command
- **THEN** 子 Agent SHALL 收到保留原 call id 的失败 tool result
- **THEN** 提交反馈时失败结果 SHALL 包含用户反馈文本

#### Scenario: 父级 mode 不改变固定审批规则
- **WHEN** interactive父 turn 处于任一 interaction mode且子 Agent请求未命中严格只读 allowlist的 Bash command
- **THEN** 系统 SHALL使用相同的共享审批和会话缓存流程
- **THEN** 子 runtime SHALL NOT 接收或判断父级 interaction mode

#### Scenario: Headless 模式无法人工升级
- **WHEN** headless 父 run 中的子 Agent 请求未命中严格只读 allowlist 的 Bash command
- **THEN** 系统 SHALL 返回需要交互式人工审批的失败 tool result
- **THEN** 系统 SHALL NOT 等待 stdin，也 SHALL NOT 因父 run 使用 full-access 而静默放行该子 Agent command

#### Scenario: 只读父 run 下生效沙箱的 Bash 直接执行
- **WHEN** 父 run 声明 readonly 工具策略且生效沙箱为可用 `read-only` 档
- **AND** readonly 子 Agent 调用 `run_bash_command`
- **THEN** 命令 SHALL 在沙箱边界内直接执行
- **THEN** 系统 SHALL NOT 打开 approval surface 或请求自动审批模型

#### Scenario: 只读父 run 下未命中 allowlist 的 Bash fail-closed
- **WHEN** 父 run 声明 readonly 工具策略且生效沙箱不是可用 `read-only` 档
- **AND** readonly 子 Agent 调用未命中严格只读 allowlist 的 `run_bash_command`
- **THEN** 系统 SHALL 返回保留原 call id 的失败 tool result
- **THEN** 系统 SHALL NOT 打开 approval surface 或请求自动审批模型

### Requirement: Explorer 保持现有严格只读策略
新增Worker SHALL NOT改变Explorer的工具allowlist、固定Bash分类(默认父 run 下的人工升级、只读父 run 下的 fail-closed 和生效只读沙箱下的直接执行)、headless fail-closed或不接收父interaction mode的行为。Explorer定义 SHALL继续只包含读取搜索、Bash、只读Web和Skill工具，并 SHALL继续禁用Todo、提问、MCP、文件编辑和再次委派。

#### Scenario: Worker 不放宽 Explorer
- **WHEN** Worker已注册且主Agent选择`explorer`
- **THEN** Explorer provider-visible和executable registry SHALL与新增Worker前的严格只读集合一致
- **THEN** Explorer非只读Bash在默认父 run 下的interactive/headless行为 SHALL保持不变
