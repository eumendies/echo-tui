## ADDED Requirements

### Requirement: reasoning summary 不参与上下文压缩输入
系统 SHALL 将 `reasoning_summary` 视为本地可见、非 provider-facing 的 transcript role。上下文长度估算、压缩摘要输入和压缩后的 provider request 投影 SHALL 忽略 `reasoning_summary` records。

#### Scenario: token 估算跳过 reasoning summary
- **WHEN** 当前活跃 transcript records 包含 `reasoning_summary` record
- **THEN** 上下文长度估算 SHALL 不把该 record 的文本计入 provider input token 预估
- **THEN** 估算 SHALL 继续计入后续可发送的 user、assistant、tool_call 和 tool_result records

#### Scenario: 压缩摘要输入跳过 reasoning summary
- **WHEN** 系统生成结构化压缩摘要，且被压缩区间包含 `reasoning_summary` record
- **THEN** 摘要请求输入 SHALL 不包含该 reasoning summary 原文
- **THEN** 摘要请求 SHALL 继续包含被压缩区间内可发送 records 的必要内容

#### Scenario: 压缩后 provider input 不包含 reasoning summary
- **WHEN** session 存在压缩状态且活跃区间包含 `reasoning_summary` record
- **THEN** provider input SHALL 不包含该 reasoning summary record
- **THEN** provider input SHALL 继续包含压缩摘要消息和活跃区间内其他可发送 records

#### Scenario: reasoning summary 不影响压缩边界保护
- **WHEN** 压缩边界附近存在 `reasoning_summary` record
- **THEN** 系统 SHALL 继续保护 tool_call/tool_result 配对不被切断
- **THEN** 系统 SHALL NOT 因 reasoning summary record 破坏已有边界吸附规则
