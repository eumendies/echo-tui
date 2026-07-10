## ADDED Requirements

### Requirement: OpenAI transcript input 转换
真实 LLM adapter SHALL 在 OpenAI provider 边界内把本地 `TranscriptRecord[]` 转换为 OpenAI Responses API 的结构化 input。转换器 SHALL 只发送本次模型请求支持的 transcript role，并 SHALL NOT 把本地错误反馈发送给模型。

#### Scenario: 转换 user assistant system records
- **WHEN** transcript records 包含 `user`、`assistant` 或 `system` role
- **THEN** OpenAI 转换器 SHALL 将这些 records 转换为 OpenAI input message
- **THEN** 转换后的 message SHALL 保留原 role 语义并把 transcript `text` 映射为 OpenAI message `content`

#### Scenario: 过滤 error records
- **WHEN** transcript records 包含 `error` role
- **THEN** OpenAI 转换器 SHALL NOT 把该 record 放入 OpenAI input
- **THEN** 后续普通 user / assistant / system records SHALL 继续按顺序参与转换

#### Scenario: 跳过暂不支持的 role
- **WHEN** transcript records 包含本次 change 未支持的 role
- **THEN** OpenAI 转换器 SHALL NOT 把该 record 放入 OpenAI input
- **THEN** 转换器 SHALL NOT 因未知 role 中断本次请求构造

## MODIFIED Requirements

### Requirement: OpenAI SDK 流式请求
真实 LLM adapter SHALL 使用 OpenAI 官方 SDK 发起文本对话请求，并默认使用流式模式。请求输入 SHALL 从当前本地 transcript records 派生，包含可发送的多轮上下文，且 SHALL NOT 包含工具调用、多模态输入或后台任务调度相关定义。

#### Scenario: 构造流式文本请求
- **WHEN** 用户提交普通非 slash 消息并触发真实 adapter
- **THEN** adapter SHALL 通过 OpenAI 官方 SDK 发起流式文本响应请求
- **THEN** 请求参数 SHALL 包含配置中的模型名、从 transcript records 派生的 OpenAI input 和输出长度限制
- **THEN** OpenAI input SHALL 包含本轮刚提交的 user record

#### Scenario: 携带已提交多轮上下文
- **WHEN** 当前 transcript records 已包含此前完成的 user / assistant / system records，且用户提交新普通消息
- **THEN** adapter SHALL 在本次 OpenAI input 中按 transcript 顺序包含这些可发送 records
- **THEN** adapter SHALL NOT 只发送当前用户文本

#### Scenario: 不发送工具调用定义
- **WHEN** adapter 构造文本响应请求
- **THEN** 请求参数 SHALL NOT 包含 tools、function calling、多模态输入或后台任务调度相关字段

#### Scenario: 敏感配置不进入持久化内容
- **WHEN** adapter 使用配置创建 SDK client 或发起请求
- **THEN** 敏感配置值 SHALL NOT 被写入 transcript、日志、错误消息或持久化 session

### Requirement: Agent 回调契约兼容
真实 LLM adapter SHALL 兼容 app agent contract：在请求开始时通知 thinking，在每个文本增量到达时通知文本增量，在成功完成时通知 complete，并返回最终 assistant 文本。agent contract 的输入 SHALL 是当前 `TranscriptRecord[]`，由具体 adapter 决定如何投影为 provider 请求。

#### Scenario: 请求开始触发 thinking
- **WHEN** adapter 开始处理一次 transcript 输入
- **THEN** adapter SHALL 在首个文本增量之前调用 `onThinking`

#### Scenario: 文本增量到达触发增量回调
- **WHEN** adapter 接收到新的文本增量
- **THEN** adapter SHALL 调用文本增量回调并传入 `delta` 与 `draft`
- **THEN** `draft` SHALL 是从本次响应开始到当前增量为止的完整 assistant draft

#### Scenario: 成功完成触发 complete
- **WHEN** adapter 成功读到响应完成并得到最终 assistant 文本
- **THEN** adapter SHALL 调用 `onComplete(finalText)`
- **THEN** adapter SHALL resolve 为同一个 `finalText`

#### Scenario: 失败时不触发 complete
- **WHEN** adapter 因配置、网络、SDK stream 或服务错误失败
- **THEN** adapter SHALL reject 一个明确错误
- **THEN** adapter SHALL NOT 调用 `onComplete` 把失败伪装成成功回复

#### Scenario: agent 运行源码行为稳定
- **WHEN** `src/agent/llm-config`、`src/agent/openai-agent` 或 `src/agent/fake-agent` 处理 LLM 运行流程
- **THEN** 系统 SHALL 从 `~/.echo/config.json` 读取 LLM 运行配置，并保持必要字段、可选字段和输出长度限制的校验语义
- **THEN** adapter SHALL 在请求开始时调用 `onThinking`，在文本增量到达时调用增量回调，并在成功完成时调用 `onComplete(finalText)`
- **THEN** fake agent SHALL 支持 thinking、逐字 streaming 和 completion 回调，且测试通过 `createApp(options).runAgent` 注入 fake 或 stub agent 时，CLI 默认真实 adapter 行为 SHALL 不受影响
- **THEN** fake agent SHALL 从传入的 transcript records 中选择最新 user record 作为模拟响应文本来源

#### Scenario: agent 编译与测试路径保持兼容
- **WHEN** `src/agent` 中的运行源码模块参与 TypeScript 编译
- **THEN** agent 模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`
- **THEN** 编译后的 agent 和 app 测试 SHALL 能够通过原有相对路径加载 `dist/src/agent` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

### Requirement: 失败反馈
系统 SHALL 对真实服务接入中的失败提供可见、可测试且不泄密的反馈。失败后应用 SHALL 停止 pending 状态、释放响应锁，并避免把敏感配置值暴露给用户。本地失败反馈 SHALL 记录为 `error` transcript record，而不是伪装成 assistant 回复。

#### Scenario: 服务错误失败
- **WHEN** 模型服务返回错误或 SDK 抛出服务错误
- **THEN** adapter SHALL 产生包含错误类别或状态摘要的错误
- **THEN** 错误内容 SHALL NOT 包含敏感配置值

#### Scenario: stream 中断失败
- **WHEN** stream 在完成前中断
- **THEN** adapter SHALL 产生明确的 stream incomplete 错误
- **THEN** 应用 SHALL 释放 response lock，使用户可以继续输入

#### Scenario: app 层展示本地错误
- **WHEN** 真实 adapter reject 且用户消息已经提交到 transcript
- **THEN** 应用 SHALL 清空 pending preview 并停止 spinner
- **THEN** 应用 SHALL 追加一条本地 `error` transcript record 作为可见反馈
- **THEN** 该错误 record SHALL 被持久化到当前 transcript session
- **THEN** 该错误 record SHALL NOT 进入后续 OpenAI input
