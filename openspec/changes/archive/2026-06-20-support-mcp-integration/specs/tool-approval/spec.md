## MODIFIED Requirements

### Requirement: apply_patch 执行前授权
系统 SHALL 在执行本地 `apply_patch` 工具前请求用户授权。授权发生在 tool executor 调用具体 handler 之前；用户允许时 SHALL 执行本次工具调用，用户拒绝或提交反馈文本时 SHALL NOT 执行工具，并 SHALL 生成可回传模型的 tool result。授权请求的可见 UI SHALL 使用通用 choice surface 呈现，而不是普通 select command surface。MCP tools SHALL 根据 server 审批策略复用同一授权流程：默认执行前授权，显式信任的 server 可跳过授权。

#### Scenario: apply_patch 执行前请求授权
- **WHEN** agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 系统 SHALL 在调用 tool executor 执行该 tool call 前请求用户授权
- **THEN** 系统 SHALL 在用户作出授权决策前暂停该 tool call 的执行
- **THEN** TUI SHALL 使用通用 choice surface 显示该授权请求

#### Scenario: MCP tool 默认执行前请求授权
- **WHEN** agent loop runtime 收到未显式信任 server 的 MCP tool call
- **THEN** 系统 SHALL 在调用 tool executor 执行该 MCP tool call 前请求用户授权
- **THEN** 系统 SHALL 在用户作出授权决策前暂停该 MCP tool call 的执行
- **THEN** TUI SHALL 使用通用 choice surface 显示该授权请求

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
- **THEN** 系统 SHALL NOT 为该 MCP tool call 请求用户选择

#### Scenario: 不需要风险分类授权的工具不触发授权
- **WHEN** agent loop runtime 收到不需要风险分类授权的 tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 因 apply_patch 或 MCP 授权能力而请求用户选择

#### Scenario: apply_patch 授权选项保持简洁
- **WHEN** `apply_patch` 授权请求显示 choice surface
- **THEN** 选项列表 SHALL 包含 `Allow once`、`Deny` 和 `Tell model what to do`
- **THEN** 系统 SHALL NOT 为 `Allow once` 或 `Deny` 生成冗长的 option description

### Requirement: 工具授权 permission gate 展示
工具授权 UI SHALL 使用通用 choice card 呈现 permission gate。该 surface SHALL 突出授权标题、command 或 tool preview 区块、action 选项区和操作提示，并 SHALL 使用项目现有终端渲染能力完成，不引入全屏 UI、alternate screen 或第三方 TUI 库。MCP tool 授权 SHALL 展示 MCP server 名、原始 tool 名和参数摘要，避免只显示内部 namespace。

#### Scenario: 高危 bash 授权显示 permission gate
- **WHEN** 高危 bash tool call 需要用户授权
- **THEN** 授权 surface SHALL 显示 `PERMISSION` 或等价明确授权标题
- **THEN** 授权 surface SHALL 显示 code-like command 区块
- **THEN** 授权 surface SHALL 显示 action 选项区
- **THEN** 授权 surface SHALL 显示确认、移动和取消相关操作提示

#### Scenario: MCP 授权显示 server 和 tool preview
- **WHEN** MCP tool call 需要用户授权
- **THEN** 授权 surface SHALL 显示 `PERMISSION` 或等价明确授权标题
- **THEN** 授权 surface SHALL 显示 MCP server 名称和原始 MCP tool 名称
- **THEN** 授权 surface SHALL 显示参数摘要或可读 preview
- **THEN** 授权 surface SHALL 显示 action 选项区和操作提示

#### Scenario: command preview 使用突出代码区块
- **WHEN** 授权请求包含 command 文本
- **THEN** 授权 surface SHALL 将 command 文本放在独立视觉区块中
- **THEN** command 文本 SHALL 比普通说明文本更醒目
- **THEN** command 文本 SHALL 保持纯文本宽度可计算，不得因 ANSI 样式破坏布局

#### Scenario: action 选项保留现有授权语义
- **WHEN** tool approval 请求处于活跃状态
- **THEN** action 选项 SHALL 继续包含 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`
- **THEN** 所有 allow 选项 SHALL 继续出现在 `Deny` 和 `Tell model what to do` 之前
- **THEN** 用户选择任一选项后 SHALL 继续生成现有结构化授权决策

#### Scenario: 高危 bash 授权不显示系统 reason
- **WHEN** 高危 bash tool call 需要用户授权
- **THEN** 授权 surface SHALL NOT 显示系统风险分类生成的 reason 文案
- **THEN** 授权 surface SHALL 让用户基于 command preview 自行判断是否允许执行
