## MODIFIED Requirements

### Requirement: Plan tool restrictions remain runtime-enforced
系统 SHALL 继续根据当前 agent session 的 interaction mode 对工具调用执行风险分类。把 Plan Mode prompt 移入 user message SHALL NOT 放宽 plan mode 的执行边界:写入型工具与受限 MCP 工具 SHALL 继续被拒绝;`run_bash_command` SHALL 由生效只读沙箱或严格只读 allowlist 约束,SHALL NOT 绕过该约束生效。

#### Scenario: Reject write tool after plan transition
- **WHEN** 当前 agent session 为 plan mode
- **AND** 模型调用 `apply_patch` 或其他被 plan mode 禁止的写工具
- **THEN** runtime SHALL 拒绝该工具调用
- **AND** runtime SHALL NOT 因 mode prompt 已进入 transcript 而请求普通写入审批或执行变更

#### Scenario: Allow normal tool policy after returning to normal
- **WHEN** 当前 agent session 已切回 normal mode
- **AND** 模型调用正常模式下可用的写工具
- **THEN** runtime SHALL 按正常风险分类和审批规则处理该工具调用
- **AND** runtime SHALL NOT 沿用上一轮 plan mode 的工具拒绝策略
