## MODIFIED Requirements

### Requirement: Agent 回调契约兼容
真实 LLM adapter SHALL 兼容 app agent contract：在请求开始时通知 thinking，在每个文本增量到达时通知文本增量，在 assistant segment、tool call、tool approval request 和 tool result 产生时通知 app 层处理对应状态，在成功完成时通知 complete，并返回最终 assistant 文本。agent contract 的输入 SHALL 是当前 `TranscriptRecord[]`，由具体 adapter 决定如何投影为 provider 请求。

#### Scenario: 请求开始触发 thinking
- **WHEN** adapter 开始处理一次 transcript 输入
- **THEN** adapter SHALL 在首个文本增量之前调用 `onThinking`

#### Scenario: 文本增量到达触发增量回调
- **WHEN** adapter 接收到新的文本增量
- **THEN** adapter SHALL 调用文本增量回调并传入 `delta` 与 `draft`
- **THEN** `draft` SHALL 是当前 assistant segment 从开始到当前增量为止的 draft

#### Scenario: 工具调用前提交 assistant segment
- **WHEN** adapter 在已经产生非空文本 draft 后收到 function call
- **THEN** adapter SHALL 在通知 tool call 前先通知 app 层提交当前 assistant segment
- **THEN** 后续文本增量 SHALL 从新的 assistant segment draft 开始累积

#### Scenario: 工具调用和结果触发回调
- **WHEN** adapter 解析出模型请求的 function call
- **THEN** adapter SHALL 调用 tool call 回调并传入 provider-neutral tool call
- **WHEN** 本地工具执行完成或工具执行被用户拒绝
- **THEN** adapter SHALL 调用 tool result 回调并传入 provider-neutral tool result

#### Scenario: apply_patch 工具调用触发授权回调
- **WHEN** agent loop runtime 准备执行 `apply_patch` tool call
- **THEN** runtime SHALL 在执行工具前调用 tool approval request 回调并传入 provider-neutral tool call
- **THEN** runtime SHALL 等待该回调返回授权决策后再继续处理该 tool call

#### Scenario: 成功完成触发 complete
- **WHEN** adapter 成功读到最终响应完成并得到最终 assistant 文本
- **THEN** adapter SHALL 调用 `onComplete(finalText)` 或等价完成回调
- **THEN** adapter SHALL resolve 为同一个 `finalText`

#### Scenario: 失败时不触发 complete
- **WHEN** adapter 因配置、网络、SDK stream、服务错误或工具循环上限失败
- **THEN** adapter SHALL reject 一个明确错误
- **THEN** adapter SHALL NOT 调用 complete 回调把失败伪装成成功回复

#### Scenario: agent 运行源码行为稳定
- **WHEN** `src/agent/openai-agent` 或 `src/agent/fake-agent` 处理 LLM 运行流程
- **THEN** 系统 SHALL 从 `~/.echo/config.json` 读取 LLM 运行配置，并保持必要字段、可选字段和默认不发送客户端输出上限的语义
- **THEN** adapter SHALL 在请求开始时调用 `onThinking`，在文本增量到达时调用增量回调，并在成功完成时调用 complete 回调
- **THEN** fake agent SHALL 支持 thinking、逐字 streaming 和 completion 回调，且测试通过 `createApp(options).runAgent` 注入 fake 或 stub agent 时，CLI 默认真实 adapter 行为 SHALL 不受影响
- **THEN** fake agent SHALL 从传入的 transcript records 中选择最新 user record 作为模拟响应文本来源

#### Scenario: agent 编译与测试路径保持兼容
- **WHEN** `src/agent` 中的运行源码模块参与 TypeScript 编译
- **THEN** agent 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`
- **THEN** 编译后的 agent 和 app 测试 SHALL 能够通过原有相对路径加载 `dist/src/agent` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

### Requirement: Agent loop runtime 编排真实工具循环
真实 LLM adapter SHALL 通过 provider-neutral agent loop runtime 编排 function tool call loop。该 runtime SHALL 保持现有 `RunAgent(records, callbacks)` app contract，接收一个底层 provider agent 作为依赖，并负责读取 LLM 配置、创建默认 tool registry、创建 tool executor、执行本地工具、维护 continuation `TranscriptRecord[]`，直到底层 provider agent 返回无 tool call 的最终 assistant 文本或发生错误。对于需要用户授权的工具调用，runtime SHALL 在执行工具前通过 app callback 获取授权决策；用户拒绝时 SHALL 不执行工具，并 SHALL 生成拒绝 tool result 参与 continuation。

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

#### Scenario: apply_patch 授权通过后执行工具
- **WHEN** agent loop runtime 准备执行 `apply_patch` tool call
- **AND** app callback 返回允许本次执行的授权决策
- **THEN** runtime SHALL 调用 tool executor 执行原始 tool call
- **THEN** runtime SHALL 将真实执行结果追加为 continuation 中的 tool result record

#### Scenario: apply_patch 被拒绝后跳过工具执行
- **WHEN** agent loop runtime 准备执行 `apply_patch` tool call
- **AND** app callback 返回拒绝执行的授权决策
- **THEN** runtime SHALL NOT 调用 tool executor 执行原始 tool call
- **THEN** runtime SHALL 生成拒绝 tool result
- **THEN** runtime SHALL 将拒绝 result 追加为 continuation 中的 tool result record

#### Scenario: OpenAI provider 边界保留协议转换
- **WHEN** 底层 OpenAI provider agent 发起一次 provider turn
- **THEN** OpenAI provider agent SHALL 在自身边界内把 `TranscriptRecord[]` 转换为 OpenAI Responses input
- **THEN** OpenAI provider agent SHALL 在自身边界内把 tool registry definitions 转换为 OpenAI function tools
- **THEN** OpenAI provider agent SHALL 返回 provider-neutral tool calls 给 agent loop runtime

