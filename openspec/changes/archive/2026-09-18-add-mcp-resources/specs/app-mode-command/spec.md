## MODIFIED Requirements

### Requirement: Plan tool restrictions remain runtime-enforced
系统 SHALL 继续根据当前 agent session 的 interaction mode 对工具调用执行风险分类。把 Plan Mode prompt 移入 user message SHALL NOT 放宽 plan mode 的执行边界:写入型工具与 `mcp__` 命名空间的 MCP tools SHALL 继续被拒绝;只读观察工具（包括 MCP 资源读取工具 `list_mcp_resources` 与 `read_mcp_resource`）SHALL 继续按只读语义直接放行;`run_bash_command` SHALL 由生效只读沙箱或严格只读 allowlist 约束,SHALL NOT 绕过该约束生效。

#### Scenario: Reject write tool after plan transition
- **WHEN** 当前 agent session 为 plan mode
- **AND** 模型调用 `apply_patch` 或其他被 plan mode 禁止的写工具
- **THEN** runtime SHALL 拒绝该工具调用
- **AND** runtime SHALL NOT 因 mode prompt 已进入 transcript 而请求普通写入审批或执行变更

#### Scenario: Allow readonly resource reads in plan mode
- **WHEN** 当前 agent session 为 plan mode
- **AND** 模型调用 `list_mcp_resources` 或 `read_mcp_resource`
- **THEN** runtime SHALL 执行该调用
- **AND** runtime SHALL NOT 因该调用来自 MCP 集成而按受限 MCP 工具拒绝

#### Scenario: Allow normal tool policy after returning to normal
- **WHEN** 当前 agent session 已切回 normal mode
- **AND** 模型调用正常模式下可用的写工具
- **THEN** runtime SHALL 按正常风险分类和审批规则处理该工具调用
- **AND** runtime SHALL NOT 沿用上一轮 plan mode 的工具拒绝策略

