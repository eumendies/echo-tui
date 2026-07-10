## MODIFIED Requirements

### Requirement: OpenAI SDK 流式请求
真实 LLM adapter SHALL 使用 OpenAI 官方 SDK 发起对话请求，并默认使用流式模式。请求输入 SHALL 从当前本地 transcript records 派生，包含可发送的多轮上下文。启用本地工具时，请求 SHALL 包含已注册 function tools；未启用工具时，请求 SHALL 保持纯文本行为且 SHALL NOT 包含 tools。默认请求 SHALL NOT 包含客户端输出 token 上限。

#### Scenario: 构造流式文本请求
- **WHEN** 用户提交普通非 slash 消息并触发真实 adapter
- **THEN** adapter SHALL 通过 OpenAI 官方 SDK 发起流式文本响应请求
- **THEN** 请求参数 SHALL 包含配置中的模型名和从 transcript records 派生的 OpenAI input
- **THEN** 请求参数 SHALL 默认不包含 `max_output_tokens`
- **THEN** OpenAI input SHALL 包含本轮刚提交的 user record

#### Scenario: 携带已提交多轮上下文
- **WHEN** 当前 transcript records 已包含此前完成的 user / assistant / system records，且用户提交新普通消息
- **THEN** adapter SHALL 在本次 OpenAI input 中按 transcript 顺序包含这些可发送 records
- **THEN** adapter SHALL NOT 只发送当前用户文本

#### Scenario: 未启用工具时不发送工具调用定义
- **WHEN** adapter 构造请求且本地 tool registry 为空
- **THEN** 请求参数 SHALL NOT 包含 tools、function calling、多模态输入或后台任务调度相关字段

#### Scenario: 启用工具时发送 function tool 定义
- **WHEN** adapter 构造请求且本地 tool registry 包含已启用工具
- **THEN** 请求参数 SHALL 包含这些工具对应的 OpenAI function tool schema
- **THEN** 请求参数 SHALL NOT 包含本次未注册或未启用的工具定义

#### Scenario: 敏感配置不进入持久化内容
- **WHEN** adapter 使用配置创建 SDK client 或发起请求
- **THEN** 敏感配置值 SHALL NOT 被写入 transcript、日志、错误消息或持久化 session

### Requirement: OpenAI transcript input 转换
真实 LLM adapter SHALL 在 OpenAI provider 边界内把本地 `TranscriptRecord[]` 转换为 OpenAI Responses API 的结构化 input。转换器 SHALL 发送本次模型请求支持的 transcript role，包括 user、assistant、system、tool_call 和 tool_result；转换器 SHALL NOT 把本地错误反馈发送给模型。

#### Scenario: 转换 user assistant system records
- **WHEN** transcript records 包含 `user`、`assistant` 或 `system` role
- **THEN** OpenAI 转换器 SHALL 将这些 records 转换为 OpenAI input message
- **THEN** 转换后的 message SHALL 保留原 role 语义并把 transcript `text` 映射为 OpenAI message `content`

#### Scenario: 转换 tool_call record
- **WHEN** transcript records 包含具备 tool call id、tool name 和 arguments 的 `tool_call` record
- **THEN** OpenAI 转换器 SHALL 将该 record 转换为 Responses API `function_call` input item
- **THEN** 转换后的 item SHALL 保留 call id、name 和 arguments

#### Scenario: 转换 tool_result record
- **WHEN** transcript records 包含具备 tool call id 和 output text 的 `tool_result` record
- **THEN** OpenAI 转换器 SHALL 将该 record 转换为 Responses API `function_call_output` input item
- **THEN** 转换后的 item SHALL 保留 call id 并把 record text 映射为 output

#### Scenario: 过滤 error records
- **WHEN** transcript records 包含 `error` role
- **THEN** OpenAI 转换器 SHALL NOT 把该 record 放入 OpenAI input
- **THEN** 后续普通 user / assistant / system / tool_call / tool_result records SHALL 继续按顺序参与转换

#### Scenario: 跳过暂不支持的 role
- **WHEN** transcript records 包含本次 change 未支持的 role
- **THEN** OpenAI 转换器 SHALL NOT 把该 record 放入 OpenAI input
- **THEN** 转换器 SHALL NOT 因未知 role 中断本次请求构造

### Requirement: Agent 回调契约兼容
真实 LLM adapter SHALL 兼容 app agent contract：在请求开始时通知 thinking，在每个文本增量到达时通知文本增量，在 assistant segment、tool call 和 tool result 产生时通知 app 层追加对应 transcript record，在成功完成时通知 complete，并返回最终 assistant 文本。agent contract 的输入 SHALL 是当前 `TranscriptRecord[]`，由具体 adapter 决定如何投影为 provider 请求。

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
- **WHEN** 本地工具执行完成
- **THEN** adapter SHALL 调用 tool result 回调并传入 provider-neutral tool result

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

## ADDED Requirements

### Requirement: OpenAI function tool call loop
真实 OpenAI adapter SHALL 支持 Responses API function tool call loop。启用工具后，adapter SHALL 解析模型产生的 function call，执行本地工具，将 `function_call_output` 回传模型，并继续请求直到最终 assistant 文本完成或发生错误。

#### Scenario: 模型调用 bash 工具并继续生成回复
- **WHEN** OpenAI stream 产生 `run_bash_command` function call
- **THEN** adapter SHALL 执行对应本地工具
- **THEN** adapter SHALL 把工具结果作为 `function_call_output` 放入下一次 OpenAI request input
- **THEN** adapter SHALL 继续读取后续模型响应直到最终完成

#### Scenario: function call arguments delta 被累积到 done
- **WHEN** OpenAI stream 产生 function call arguments delta 或 done 事件
- **THEN** adapter SHALL 以 done 事件中的完整 arguments 作为工具执行参数
- **THEN** adapter SHALL NOT 使用未完成的 partial arguments 执行工具

#### Scenario: 单轮多个工具调用按顺序处理
- **WHEN** 同一次响应中出现多个 function call
- **THEN** adapter SHALL 按 provider 输出顺序为每个 call 追加 tool call、执行工具并追加 tool result
- **THEN** 下一次 continuation request SHALL 包含这些 tool result

#### Scenario: 工具执行失败回传模型
- **WHEN** 本地工具返回 `ok: false` 的 tool result
- **THEN** adapter SHALL 仍把该 tool result 作为 function call output 回传模型
- **THEN** adapter SHALL NOT 仅因工具业务失败中断整个 agent turn
