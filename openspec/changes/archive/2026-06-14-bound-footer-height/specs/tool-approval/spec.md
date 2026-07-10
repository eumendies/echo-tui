## ADDED Requirements

### Requirement: 工具授权详情高度受限
工具授权 choice surface SHALL 遵守 footer 全局高度预算。高危 bash command preview 或风险说明很长时，授权 UI SHALL 裁剪或摘要化长内容，并 SHALL 显示 `truncated`、省略号或等价提示，同时保留用户作出安全决策所需的标题、至少一个风险原因、全部授权选项和拒绝路径。当高度足以容纳所有授权 option 行时，preview SHALL 让位给全部授权选项。

#### Scenario: 长 bash command 审批不进入 scrollback
- **WHEN** 高危 `run_bash_command` 授权请求包含很长的 command preview
- **AND** terminal rows 已知
- **THEN** 授权 choice surface SHALL 在 footer 高度预算内渲染
- **THEN** footer layout 的总行数 SHALL 不超过 `rows - 2`
- **THEN** 后续 footer redraw SHALL 能清理旧授权 surface 的全部可见内容

#### Scenario: 长审批详情仍保留安全决策信息
- **WHEN** 高危 bash 授权详情因高度预算被裁剪
- **THEN** 授权 choice surface SHALL 继续显示授权标题
- **THEN** 授权 choice surface SHALL 显示详情被裁剪的可见提示
- **THEN** 授权 choice surface SHALL 显示至少一个风险原因或等价风险提示
- **THEN** 授权 choice surface SHALL 在高度足够时显示全部允许、拒绝和反馈相关选项
- **THEN** 用户 SHALL 仍能通过 `Deny` 或 Esc 拒绝该工具调用

#### Scenario: apply_patch 简洁授权仍受高度约束
- **WHEN** `apply_patch` 授权请求没有额外风险详情
- **THEN** 授权 choice surface SHALL 继续显示简洁授权选项
- **THEN** 授权 choice surface SHALL 仍遵守 footer 全局高度预算
