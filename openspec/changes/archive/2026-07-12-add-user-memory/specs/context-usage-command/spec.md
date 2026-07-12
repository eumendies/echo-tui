## MODIFIED Requirements

### Requirement: `/context` command 展示详细 context usage
系统 SHALL 提供 `/context` slash command，用于展示最近一次真实 provider request 的 context usage 详情。详情 SHALL 包含 used tokens、context window、窗口占用百分比，以及按 System prompt、Memory、Skills、Tools、Messages、Reasoning 分类的 token breakdown。

#### Scenario: 显示最近 provider usage 详情
- **WHEN** app 已收到最近一次真实 provider context usage
- **AND** 用户提交 `/context`
- **THEN** 系统 SHALL 打开 context usage 详情 surface
- **AND** surface SHALL 显示 used tokens 和 context window
- **AND** surface SHALL 显示窗口占用百分比
- **AND** surface SHALL 显示 System prompt、Memory、Skills、Tools、Messages、Reasoning 的分类占用

#### Scenario: 无 provider usage 时提示不可用
- **WHEN** app 尚未收到真实 provider context usage
- **AND** 用户提交 `/context`
- **THEN** 系统 SHALL 显示暂无 context usage 的提示
- **AND** 系统 SHALL NOT 使用本地实时估算冒充 provider usage
- **AND** 系统 SHALL NOT 追加 transcript record

#### Scenario: context command 不触发 agent 请求
- **WHEN** 用户提交 `/context`
- **THEN** command runtime SHALL 将该输入视为本地命令消费
- **AND** app SHALL NOT 将 `/context` 作为 user message 提交给 agent
- **AND** app SHALL NOT 因该命令启动 provider request

### Requirement: context usage 分类计算
系统 SHALL 基于最近一次 provider request 快照估算 context usage 分类占用，并 SHALL 将分类 token 校准到 provider 返回的真实 `usageInputTokens` 总量。分类 token 总和 SHALL 等于该次 usage 的 used tokens。

#### Scenario: 分类总和等于 provider used tokens
- **WHEN** provider 返回 `usageInputTokens`
- **AND** 系统生成 context usage breakdown
- **THEN** 所有分类 segment 的 tokens 总和 SHALL 等于 `usageInputTokens`
- **AND** context usage 的 used tokens SHALL 等于 `usageInputTokens`

#### Scenario: system prompt、memory 和 skill catalog 分别计入对应分类
- **WHEN** agent loop 为 provider request 注入内置 system prompt 和用户 memory
- **THEN** 系统 SHALL 将 memory 以外的内置 system prompt 估算 tokens 归入 System prompt 分类
- **AND** 系统 SHALL 将用户 memory 的估算 tokens 归入 Memory 分类
- **AND** 系统 SHALL 将 skill catalog 的估算 tokens 归入 Skills 分类

#### Scenario: 工具定义和工具历史计入 Tools
- **WHEN** provider request 包含可用工具定义
- **THEN** 系统 SHALL 将工具定义估算 tokens 归入 Tools 分类
- **AND** provider-visible `tool_call` 与 `tool_result` 历史 SHALL 归入 Tools 分类

#### Scenario: 用户、assistant 消息和 shell 上下文计入 Messages
- **WHEN** provider request 包含 user records、压缩摘要注入消息或进入上下文的 shell records
- **OR** provider request 包含 assistant text records
- **THEN** 系统 SHALL 将这些内容归入 Messages 分类
- **AND** `includeInContext: false` 的 shell records SHALL NOT 计入 Messages 分类
- **AND** tool call records SHALL NOT 归入 Messages 分类

#### Scenario: provider reasoning carry-over 计入 Reasoning
- **WHEN** provider request 包含 provider-visible reasoning carry-over records
- **THEN** 系统 SHALL 将这些 records 归入 Reasoning 分类
- **AND** 本地 `reasoning_summary` records SHALL NOT 计入 Reasoning 分类
