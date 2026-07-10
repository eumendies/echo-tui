## ADDED Requirements

### Requirement: 内置 system prompt 注入
真实 LLM adapter SHALL 在每次默认真实 agent 调用中注入源码内置 system prompt。该 prompt SHALL 作为 provider 请求上下文中的 transient `system` transcript record 出现，用于约束 agent 身份、回答风格和工具使用行为；该 prompt SHALL NOT 由用户配置、模型 profile、环境变量或 slash 命令覆盖或关闭。

#### Scenario: 默认真实请求携带内置 system prompt
- **WHEN** 用户提交普通消息并触发默认真实 agent
- **THEN** agent loop runtime SHALL 在传给底层 provider agent 的 records 开头注入一条 `system` record
- **THEN** 该 system record 的 text SHALL 来自源码内置 prompt
- **THEN** OpenAI provider request input SHALL 包含该 system message

#### Scenario: 用户配置不能覆盖 system prompt
- **WHEN** `~/.echo/config.json` 或模型 profile 中包含 `systemPrompt`、`prompt` 或类似字段
- **THEN** 默认真实 agent SHALL NOT 使用这些字段覆盖内置 system prompt
- **THEN** 默认真实 agent SHALL 继续使用源码内置 prompt

#### Scenario: system prompt 不进入本地 transcript ledger
- **WHEN** agent loop runtime 注入内置 system prompt
- **THEN** runtime SHALL NOT 通过 app callbacks 追加该 system record
- **THEN** runtime SHALL NOT 修改调用方传入的 `TranscriptRecord[]`
- **THEN** transcript persistence SHALL NOT 保存该内置 system prompt record

#### Scenario: tool continuation 保留 system prompt
- **WHEN** 模型产生 tool call 且 agent loop runtime 需要发起 continuation provider turn
- **THEN** continuation records SHALL 仍以同一条内置 system record 开头
- **THEN** runtime SHALL 在该 system record 后继续追加 assistant segment、tool_call 和 tool_result records

#### Scenario: OpenAI adapter 不拥有 prompt 来源策略
- **WHEN** OpenAI provider agent 构造 Responses request
- **THEN** OpenAI provider agent SHALL 只转换传入 records 中已有的 `system` record
- **THEN** OpenAI provider agent SHALL NOT 自行读取配置或生成额外 system prompt
