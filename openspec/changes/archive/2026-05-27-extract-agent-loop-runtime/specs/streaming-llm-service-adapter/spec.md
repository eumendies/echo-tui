## ADDED Requirements

### Requirement: Agent loop runtime 编排真实工具循环
真实 LLM adapter SHALL 通过 provider-neutral agent loop runtime 编排 function tool call loop。该 runtime SHALL 保持现有 `RunAgent(records, callbacks)` app contract，接收一个底层 provider agent 作为依赖，并负责读取 LLM 配置、创建默认 tool registry、创建 tool executor、执行本地工具、维护 continuation `TranscriptRecord[]`，直到底层 provider agent 返回无 tool call 的最终 assistant 文本或发生错误。

#### Scenario: 默认真实路径通过 loop runtime 调用 OpenAI agent
- **WHEN** CLI 默认真实 adapter 处理普通用户消息
- **THEN** 系统 SHALL 通过 agent loop runtime 调用底层 OpenAI provider agent
- **THEN** `main.ts` SHALL NOT 直接创建 tool registry 或 tool executor
- **THEN** app 层看到的 agent contract SHALL 仍是 `RunAgent(records, callbacks)`

#### Scenario: loop runtime 加载配置和工具运行时
- **WHEN** agent loop runtime 开始一次 `RunAgent` 调用
- **THEN** runtime SHALL 读取当前 LLM 配置
- **THEN** runtime SHALL 使用该配置创建默认 tool registry 和 tool executor
- **THEN** runtime SHALL 使用同一配置和 tool registry 初始化底层 provider agent
- **THEN** runtime SHALL NOT 在后续 `runTurn` 调用中把 provider 私有运行态作为参数传回底层 provider agent

#### Scenario: 底层 provider agent 不执行工具循环
- **WHEN** 底层 provider agent 完成一次流式模型 turn 并返回 tool calls
- **THEN** provider agent SHALL NOT 执行本地工具
- **THEN** provider agent SHALL NOT 追加 assistant、tool_call 或 tool_result transcript records
- **THEN** agent loop runtime SHALL 负责执行 tool calls 并发起后续 continuation turn

#### Scenario: continuation 使用 TranscriptRecord 主干
- **WHEN** agent loop runtime 需要在工具调用后继续请求模型
- **THEN** runtime SHALL 继续使用 `TranscriptRecord[]` 作为上下文主干
- **THEN** runtime SHALL 在工具调用前提交非空 assistant segment record
- **THEN** runtime SHALL 为每个工具调用追加 `tool_call` record，并为每个工具结果追加 `tool_result` record
- **THEN** runtime SHALL NOT 引入独立的 runtime message 或 provider-neutral message 中间模型

#### Scenario: OpenAI provider 边界保留协议转换
- **WHEN** 底层 OpenAI provider agent 发起一次 provider turn
- **THEN** OpenAI provider agent SHALL 在自身边界内把 `TranscriptRecord[]` 转换为 OpenAI Responses input
- **THEN** OpenAI provider agent SHALL 在自身边界内把 tool registry definitions 转换为 OpenAI function tools
- **THEN** OpenAI provider agent SHALL 返回 provider-neutral tool calls 给 agent loop runtime
