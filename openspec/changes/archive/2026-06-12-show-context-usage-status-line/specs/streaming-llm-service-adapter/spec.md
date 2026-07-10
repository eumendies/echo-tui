## ADDED Requirements

### Requirement: 真实 context usage 上报
agent loop runtime SHALL 在 provider 返回真实 input token usage 后，通过 app callback 上报最近一次 provider request 的 context usage。该 usage SHALL 来自 provider 的真实 usage 字段，并 SHALL 携带当前运行模型的 context window。缺失真实 usage 时系统 SHALL NOT 伪造 usage 上报。

#### Scenario: provider 返回 input usage 后上报
- **WHEN** provider turn 返回 `usageInputTokens`
- **THEN** agent loop runtime SHALL 调用 context usage callback
- **THEN** callback payload SHALL 包含 provider 返回的 used token 数
- **THEN** callback payload SHALL 包含当前 run state 的 context window

#### Scenario: provider 未返回 usage 时不伪造
- **WHEN** provider turn 没有返回 `usageInputTokens`
- **THEN** agent loop runtime SHALL NOT 调用 context usage callback
- **THEN** agent loop runtime SHALL NOT 用本地 token 估算替代真实 usage 上报

#### Scenario: continuation turn 更新最近 usage
- **WHEN** 同一 assistant response 触发多次 provider turn continuation
- **AND** 后续 provider turn 返回新的 `usageInputTokens`
- **THEN** agent loop runtime SHALL 为每次真实 usage 调用 context usage callback
- **THEN** app 层 SHALL 能以最后一次 callback 作为 status line 的最近 usage

#### Scenario: usage 上报不改变 compaction 语义
- **WHEN** agent loop runtime 上报 context usage
- **THEN** runtime SHALL 继续使用同一 `usageInputTokens` 更新 context compaction usage anchor
- **THEN** usage 上报 SHALL NOT 改变 compaction boundary、summary 或 provider continuation records
