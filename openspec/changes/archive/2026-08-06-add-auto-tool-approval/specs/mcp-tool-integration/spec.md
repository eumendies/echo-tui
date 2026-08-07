## MODIFIED Requirements

### Requirement: MCP tool 审批策略
系统 SHALL 对 MCP tools 应用 server 级风险分类策略。配置为 `approval: "never"` 的 server 的 MCP tool call SHALL 被分类为 safe 并跳过全部审批；其他 MCP tool call 默认 SHALL 被分类为 approval-required。交互式 manual 工具审批模式 SHALL 在调用 MCP server 前请求用户授权；auto 工具审批模式 SHALL 在会话授权缓存未命中时先请求配置的审批模型，模型精确返回 yes 时允许本次调用，返回 no 或失败时回退现有用户授权。用户拒绝时，系统 SHALL 不调用 MCP server，并 SHALL 返回可回传模型的拒绝 tool result。

#### Scenario: MCP tool 默认进入当前审批模式
- **WHEN** MCP server 没有配置 `approval` 或配置为 `approval: "always"`
- **AND** provider 调用该 server 的 MCP tool
- **THEN** 系统 SHALL 在调用 MCP server 前把该 tool call 分类为 approval-required
- **THEN** manual 工具审批模式 SHALL 请求用户授权，auto 工具审批模式 SHALL 在缓存未命中时先请求审批模型

#### Scenario: Auto yes 允许本次 MCP 调用
- **WHEN** auto 工具审批模式下一个 approval-required MCP tool 的审批模型精确返回 yes
- **THEN** 系统 SHALL 只允许当前 MCP tool call
- **THEN** 系统 SHALL 代理执行该调用并把真实 MCP result 回传主模型
- **THEN** 系统 SHALL NOT 因该 yes 建立 MCP tool 会话级授权

#### Scenario: Auto no 回退 MCP 人工审批
- **WHEN** auto 工具审批模式下一个 approval-required MCP tool 的审批模型返回 no、非法文本或请求失败
- **THEN** 系统 SHALL 显示现有 MCP permission surface，包括 server、原始 tool 名和参数 preview
- **THEN** 用户作出允许决策前系统 SHALL NOT 调用 MCP server

#### Scenario: 受信任 MCP server 跳过全部审批
- **WHEN** MCP server 配置为 `approval: "never"`
- **AND** provider 调用该 server 的 MCP tool
- **THEN** 系统 SHALL 将该 MCP tool call 判定为 safe
- **THEN** 系统 SHALL 不请求自动审批模型或打开工具授权 surface，直接代理执行 MCP tool

#### Scenario: 用户拒绝 MCP tool 调用
- **WHEN** MCP tool 人工授权请求处于活跃状态且用户选择拒绝或按 Esc
- **THEN** 系统 SHALL NOT 调用 MCP server
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 result SHALL 保留原始 MCP provider-visible tool name 和 call id

#### Scenario: Plan mode 仍优先拒绝 MCP tool
- **WHEN** 当前 interaction mode 为 plan 且 provider 调用 MCP tool
- **THEN** 系统 SHALL 在工具审批模式处理前将该调用分类为 rejected
- **THEN** 系统 SHALL NOT 请求自动审批模型、打开人工 surface 或调用 MCP server
