## MODIFIED Requirements

### Requirement: apply_patch 执行前授权
在交互式 TUI 或默认单轮模式下，系统 SHALL 在执行本地 `apply_patch` 工具前完成授权决策。交互式 TUI 的 manual 审批模式 SHALL 请求用户授权；auto 审批模式 SHALL 在未命中会话授权缓存时先请求配置的审批模型，模型精确返回 yes 时可自动允许本次执行，返回 no 或失败时 SHALL 回退相同的用户授权 surface。授权发生在 tool executor 调用具体 handler 之前；用户允许时 SHALL 执行本次工具调用，用户拒绝或提交反馈文本时 SHALL NOT 执行工具，并 SHALL 生成可回传模型的 tool result。MCP tools SHALL 根据 server 审批策略复用同一授权流程：默认需要审批，显式信任的 server 可跳过授权。通过 `run_bash_command` 执行的 agent memory skill 脚本 SHALL NOT 获得 memory 专属审批分类，只按现有通用 bash 风险规则处理。`echo-tui --once --full-access` 是显式非交互例外：对当前单轮中被风险分类为 approval-required 的已注册工具 SHALL 自动允许，不得等待 UI 或请求自动审批模型。

#### Scenario: apply_patch 执行前完成授权
- **WHEN** 交互式 TUI 或默认单轮 agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 系统 SHALL 在调用 tool executor 执行该 tool call 前取得允许或拒绝决策
- **THEN** 交互式 manual 模式 SHALL 使用通用 choice surface 显示该授权请求
- **THEN** 交互式 auto 模式 SHALL 按 automatic-tool-approval 能力先判断是否可自动 `allow_once`
- **THEN** 默认单轮模式 SHALL 返回非交互失败结果而不是等待 surface 输入或请求自动审批模型

#### Scenario: Memory skill 脚本不触发专属授权
- **WHEN** normal mode 下 `run_bash_command` 执行未命中通用高风险规则的 `agent-memory` 脚本命令
- **THEN** classifier SHALL 按普通安全 bash 命令处理
- **THEN** 系统 SHALL NOT 因命令读取或修改 memory 而打开专属审批 surface或请求自动审批模型

#### Scenario: MCP tool 默认执行前完成审批
- **WHEN** 交互式 TUI 或默认单轮 agent loop runtime 收到未显式信任 server 的 MCP tool call
- **THEN** 交互式 TUI SHALL 在调用 MCP server 前按当前工具审批模式取得授权决策
- **THEN** 默认单轮模式 SHALL 生成失败 tool result 而不是等待用户选择或请求自动审批模型

#### Scenario: 用户允许本次执行
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户选择 `Allow once`
- **THEN** 系统 SHALL 执行该次 tool call
- **THEN** 系统 SHALL 将真实工具执行结果作为对应的 tool result 回传给模型

#### Scenario: 用户拒绝本次执行
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户选择 `Deny` 或按下 Esc
- **THEN** 系统 SHALL NOT 执行该次 tool call
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 tool result SHALL 保留原始 tool call id 和 tool name
- **THEN** 该 tool result 文本 SHALL 明确说明用户拒绝执行该工具

#### Scenario: 用户提供反馈文本
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户通过 `Tell model what to do` 提交非空文本
- **THEN** 系统 SHALL NOT 执行该次 tool call
- **THEN** 系统 SHALL 生成可回传模型的失败 tool result
- **THEN** 该 tool result 文本 SHALL 包含用户输入的反馈文本

#### Scenario: 受信任 MCP tool 不触发授权
- **WHEN** agent loop runtime 收到显式信任 server 的 MCP tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 为该 MCP tool call 请求自动审批模型或用户选择

#### Scenario: 不需要风险分类授权的工具不触发授权
- **WHEN** agent loop runtime 收到不需要风险分类授权的 tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 因工具审批能力请求自动审批模型或用户选择

#### Scenario: 非 bash 授权选项保持简洁
- **WHEN** `apply_patch` 的人工授权 choice surface 显示
- **THEN** 选项列表 SHALL 包含 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`
- **THEN** 系统 SHALL NOT 为 `Allow once` 或 `Deny` 生成冗长的 option description

#### Scenario: full-access 自动允许 approval-required 工具
- **WHEN** 用户使用 `echo-tui --once --full-access <prompt>` 且 agent 请求 approval-required 的已注册工具
- **THEN** 系统 SHALL NOT 打开 TUI approval surface、等待 stdin 或请求自动审批模型
- **THEN** 系统 SHALL 直接执行该工具并把真实结果回传给模型
- **THEN** 该自动允许策略 SHALL 只影响当前单轮运行

#### Scenario: full-access 不改变普通 TUI 授权
- **WHEN** 用户未使用 `echo-tui --once --full-access` 而在普通 TUI 中请求 approval-required 工具
- **THEN** 系统 SHALL 根据工具审批模式使用 manual surface，或先执行 auto 判断并在 no/失败时回退同一 surface
- **THEN** 系统 SHALL 继续使用现有结构化授权决策和会话授权缓存

## ADDED Requirements

### Requirement: 会话授权优先于自动审批
交互式工具审批 SHALL 在发起自动审批模型请求或打开人工 surface 前检查现有进程会话授权缓存。Auto 模型产生的 yes SHALL 只允许当前调用，不得写入该缓存；只有用户通过现有人工 surface 作出的会话级 allow 决策可以扩展后续调用权限。

#### Scenario: Allow-all 缓存跳过 auto 请求
- **WHEN** 当前进程已启用 `Allow all tools for this session`
- **AND** 后续 tool call 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 allow-all 结构化决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Tool 缓存跳过 auto 请求
- **WHEN** 当前进程已允许某个非 bash tool name 在本会话执行
- **AND** 后续同名 tool call 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 tool 级允许决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Bash command 缓存跳过 auto 请求
- **WHEN** 当前进程已允许某个 bash command 文本在本会话执行
- **AND** 后续相同 command 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 command 级允许决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Auto yes 不形成会话授权
- **WHEN** 自动审批模型为一个 approval-required 调用精确返回 yes
- **THEN** 系统 SHALL 只为当前调用生成 `allow_once`
- **THEN** 后续同名工具或相同 bash command SHALL 在缓存仍未命中时重新进入 auto 判断

### Requirement: Auto no 复用现有人工授权 surface
自动审批模型返回 no、返回非法文本或请求失败后，系统 SHALL 使用与 manual 模式相同的 `ToolApprovalContext`、permission choice surface 和结构化授权决策，不得创建降级版审批界面或删除现有操作。

#### Scenario: Auto no 显示现有操作
- **WHEN** 自动审批结果为 no 且人工授权 surface 打开
- **THEN** action 选项 SHALL 继续包含 `Allow once`、适用的会话级 tool/command allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`
- **THEN** 所有选项 SHALL 继续生成现有结构化 `ToolApprovalDecision`

#### Scenario: Auto no 保留 feedback 输入
- **WHEN** 自动审批结果为 no 且用户选中 `Tell model what to do`
- **THEN** 用户 SHALL 能按现有 inline composer 语义输入非空反馈
- **THEN** 系统 SHALL 继续生成 `provide_feedback` 决策并跳过原始工具执行

#### Scenario: Auto no 保留 Esc 拒绝
- **WHEN** 自动审批结果为 no 且 permission surface 处于活跃状态
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 按现有语义拒绝原始 tool call
- **THEN** 系统 SHALL 生成可回传主模型的失败 tool result
