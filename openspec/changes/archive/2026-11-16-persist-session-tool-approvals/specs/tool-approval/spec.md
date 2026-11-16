## MODIFIED Requirements

### Requirement: 工具授权会话级允许选项
工具授权 choice surface SHALL 提供会话级允许选项。所有 allow 选项 SHALL 在选项列表中连续排列，并 SHALL 出现在 `Deny` 和 `Tell model what to do` 之前。`ToolApprovalContext` SHALL 持有当前会话内的授权缓存，并 SHALL 把会话级 allow 决策持久化到所属 session 的 sidecar。会话级允许选项 SHALL 只影响当前会话，SHALL NOT 持久化到用户配置，SHALL NOT 写入 transcript journal。

#### Scenario: 显示 allow 选项分组
- **WHEN** tool approval 请求处于活跃状态
- **THEN** choice surface SHALL 依次显示 `Allow once`、一个会话级 allow 选项、`Allow all tools for this session`
- **THEN** `Deny` SHALL 显示在所有 allow 选项之后
- **THEN** `Tell model what to do` SHALL 继续显示为支持内联文本输入的 option

#### Scenario: 非 bash 工具显示 tool 级授权
- **WHEN** `apply_patch` 或其他非 `run_bash_command` 的 tool approval 请求处于活跃状态
- **THEN** 会话级 allow 选项 SHALL 使用当前 tool name 表达 `Allow <toolName> for this session`
- **THEN** 用户选择该选项 SHALL 生成允许当前会话内同名工具的结构化授权决策

#### Scenario: bash 工具显示 command 级授权
- **WHEN** `run_bash_command` tool approval 请求处于活跃状态
- **THEN** 会话级 allow 选项 SHALL 显示为 `Allow this command for this session`
- **THEN** 用户选择该选项 SHALL 生成只允许当前 bash command 文本的结构化授权决策

#### Scenario: 允许所有工具的会话级授权
- **WHEN** tool approval 请求处于活跃状态
- **AND** 用户选择 `Allow all tools for this session`
- **THEN** 系统 SHALL 生成允许当前会话内所有后续需审批工具调用的结构化授权决策

#### Scenario: 命中会话授权时不打开 surface
- **WHEN** `ToolApprovalContext` 收到 tool approval 请求
- **AND** 该请求命中当前会话内已有授权缓存
- **THEN** `ToolApprovalContext` SHALL 立即返回允许执行的结构化授权决策
- **THEN** TUI SHALL NOT 打开 tool approval choice surface

#### Scenario: 会话级授权跨进程生效
- **WHEN** 用户在会话中选择会话级 allow 后重启 echo-tui 并恢复同一会话
- **THEN** 该授权 SHALL 继续对后续 `approval_required` 调用生效
- **THEN** 系统 SHALL NOT 重新打开 tool approval surface

### Requirement: 会话授权优先于自动审批
交互式工具审批 SHALL 在发起自动审批模型请求或打开人工 surface 前检查现有会话授权缓存。Auto 模型产生的 yes SHALL 只允许当前调用，不得写入该缓存；只有用户通过现有人工 surface 作出的会话级 allow 决策可以扩展后续调用权限，并 SHALL 持久化到所属 session 的 sidecar。

#### Scenario: Allow-all 缓存跳过 auto 请求
- **WHEN** 当前会话已启用 `Allow all tools for this session`
- **AND** 后续 tool call 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 allow-all 结构化决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Tool 缓存跳过 auto 请求
- **WHEN** 当前会话已允许某个非 bash tool name 在本会话执行
- **AND** 后续同名 tool call 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 tool 级允许决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Bash command 缓存跳过 auto 请求
- **WHEN** 当前会话已允许某个 bash command 文本在本会话执行
- **AND** 后续相同 command 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 command 级允许决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Auto yes 不形成会话授权
- **WHEN** 自动审批模型为一个 approval-required 调用精确返回 yes
- **THEN** 系统 SHALL 只为当前调用生成 `allow_once`
- **THEN** 后续同名工具或相同 bash command SHALL 在缓存仍未命中时重新进入 auto 判断
- **THEN** 系统 SHALL NOT 因该次 auto 允许写入 session sidecar
