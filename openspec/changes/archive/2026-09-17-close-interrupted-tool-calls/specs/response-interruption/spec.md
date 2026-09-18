## MODIFIED Requirements

### Requirement: 中断后的 transcript 结果
系统 SHALL 将用户主动中断与模型失败区分开。若中断前已经产生 partial assistant draft，系统 SHALL 先将该 partial draft 追加为 assistant transcript record；已播报但未取得 tool result 的工具调用 SHALL 以相邻的 `tool_call` 与合成失败 `tool_result` 成对补齐，合成结果的 `ok` SHALL 为 false 且文本 SHALL 说明用户中断且未返回结果；无论是否存在 partial draft 或未完成工具调用，系统 SHALL 追加本地中断提示 record。中断收尾的 record 顺序 SHALL 为 partial reasoning（如有）→ partial assistant（如有）→ 补齐的工具 pairs → 本地中断提示。中断提示 SHALL 可见、可持久化、可恢复，但 SHALL NOT 被视为 assistant 回复或错误反馈。

#### Scenario: 中断时保留 partial assistant
- **WHEN** assistant response 已经产生非空 partial draft
- **AND** 用户按 Esc 中断当前回答
- **THEN** 系统 SHALL 追加一条 assistant transcript record 保存该 partial draft
- **THEN** 系统 SHALL 追加一条本地中断提示 record，说明模型回答已被中断
- **THEN** 系统 SHALL NOT 追加 `error` transcript record 表示本次用户主动中断

#### Scenario: 中断时没有 partial assistant
- **WHEN** assistant response 尚未产生文本增量
- **AND** 用户按 Esc 中断当前回答
- **THEN** 系统 SHALL NOT 追加空 assistant transcript record
- **THEN** 系统 SHALL 追加一条本地中断提示 record，说明模型回答已被中断
- **THEN** 系统 SHALL NOT 追加 `error` transcript record 表示本次用户主动中断

#### Scenario: 中断补齐未完成工具调用
- **WHEN** 当前 assistant turn 存在已播报但未取得 tool result 的工具调用
- **AND** 用户按 Esc 中断当前回答
- **THEN** 系统 SHALL 追加相邻的 `tool_call` 与合成失败 `tool_result` records
- **THEN** 系统 SHALL 在该补齐记录之后追加本地中断提示 record
- **THEN** 合成的 tool result SHALL 在后续 provider 转换中作为失败工具结果参与请求

#### Scenario: 恢复 session 后显示中断提示
- **WHEN** 包含本地中断提示 record 的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该本地中断提示 record
- **THEN** transcript 渲染 SHALL 为该 record 提供区别于 user、assistant 和 error 的克制可见投影
