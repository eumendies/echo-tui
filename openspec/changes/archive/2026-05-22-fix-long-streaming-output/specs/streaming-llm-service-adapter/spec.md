## MODIFIED Requirements

### Requirement: 真实 LLM 服务配置
系统 SHALL 通过用户级 JSON 配置文件创建真实 LLM adapter。配置 SHALL 从 `~/.echo/config.json` 读取，并包含创建 OpenAI SDK client 和发起文本响应所需的运行参数；敏感字段 SHALL 只驻留在运行时内存中，不得硬编码在源码、测试 fixture、文档示例或 OpenSpec artifacts 中。系统 SHALL NOT 要求用户配置客户端输出 token 上限；默认请求 SHALL NOT 发送 `max_output_tokens`。

#### Scenario: 从用户级配置文件创建配置
- **WHEN** CLI 启动默认真实 adapter
- **THEN** 系统 SHALL 从 `~/.echo/config.json` 读取 LLM 运行配置
- **THEN** 系统 SHALL 使用读取到的配置创建 OpenAI SDK client 和模型请求参数

#### Scenario: 缺少必要配置时明确失败
- **WHEN** CLI 默认真实 adapter 缺少创建 client 或发起响应所需的必要配置
- **THEN** 系统 SHALL 明确提示缺少必要配置
- **THEN** 系统 SHALL NOT 发起真实模型请求
- **THEN** 错误提示 SHALL NOT 包含敏感字段值

#### Scenario: 默认不发送客户端输出长度限制
- **WHEN** 用户级配置文件未提供服务端专有输出长度参数
- **THEN** 系统 SHALL NOT 在 OpenAI request 中发送 `max_output_tokens`
- **THEN** 系统 SHALL 让模型服务端决定本次响应的输出长度上限

### Requirement: OpenAI SDK 流式请求
真实 LLM adapter SHALL 使用 OpenAI 官方 SDK 发起文本对话请求，并默认使用流式模式。请求输入 SHALL 来自本地 transcript 转换结果，且 SHALL NOT 包含工具调用、多模态输入或后台任务调度相关定义。默认请求 SHALL NOT 包含客户端输出 token 上限。

#### Scenario: 构造流式文本请求
- **WHEN** 用户提交普通非 slash 消息并触发真实 adapter
- **THEN** adapter SHALL 通过 OpenAI 官方 SDK 发起流式文本响应请求
- **THEN** 请求参数 SHALL 包含配置中的模型名和 transcript 转换后的输入
- **THEN** 请求参数 SHALL 默认不包含 `max_output_tokens`

#### Scenario: 不发送工具调用定义
- **WHEN** adapter 构造首版文本响应请求
- **THEN** 请求参数 SHALL NOT 包含 tools、function calling、多模态输入或后台任务调度相关字段

#### Scenario: 敏感配置不进入持久化内容
- **WHEN** adapter 使用配置创建 SDK client 或发起请求
- **THEN** 敏感配置值 SHALL NOT 被写入 transcript、日志、错误消息或持久化 session

### Requirement: SDK 流式文本增量处理
真实 LLM adapter SHALL 消费 OpenAI SDK 提供的流式文本增量，累积最终 assistant draft，并把未知或暂不支持的非文本事件限制在 adapter 内部处理。已知错误、服务端 incomplete 或无效 stream SHALL 显式结束为对应语义，而不是被误报为未知本地 stream 未完成。

#### Scenario: 处理文本增量
- **WHEN** SDK stream 产生新的文本增量
- **THEN** adapter SHALL 读取该增量文本
- **THEN** adapter SHALL 将该增量追加到当前 draft
- **THEN** adapter SHALL 通过文本增量回调把增量和完整 draft 交给 app 层

#### Scenario: 处理完成事件
- **WHEN** SDK stream 表示本次文本响应完成
- **THEN** adapter SHALL 以累积出的完整 assistant 文本完成本次 agent 调用

#### Scenario: 处理服务端 incomplete 事件
- **WHEN** SDK stream 产生 `response.incomplete` 事件
- **THEN** adapter SHALL 将其识别为服务端未完整结束
- **THEN** adapter SHALL 使用事件中的 incomplete details 生成明确错误摘要（如存在）
- **THEN** adapter SHALL NOT 将其误报为本地“模型响应流未完成”兜底错误

#### Scenario: 忽略暂不支持的非文本事件
- **WHEN** SDK stream 产生首版不支持的非文本事件
- **THEN** adapter SHALL 不把该事件暴露给 app 层
- **THEN** adapter SHALL 处理后续 stream 事件

#### Scenario: stream 异常失败
- **WHEN** SDK stream 在完成前抛错或中断
- **THEN** adapter SHALL 以明确 stream 错误结束本次调用
- **THEN** adapter SHALL NOT 把部分 draft 伪装成成功完成的 assistant 回复

### Requirement: 失败反馈
系统 SHALL 对真实服务接入中的失败提供可见、可测试且不泄密的反馈。失败后应用 SHALL 停止 pending 状态、释放响应锁，并避免把敏感配置值暴露给用户。若失败前已经生成 partial assistant draft，系统 SHALL 先保留该 partial assistant 内容，再追加本地 error record 表示失败事实。

#### Scenario: 服务错误失败
- **WHEN** 模型服务返回错误或 SDK 抛出服务错误
- **THEN** adapter SHALL 产生包含错误类别或状态摘要的错误
- **THEN** 错误内容 SHALL NOT 包含敏感配置值

#### Scenario: stream 中断失败且没有 partial draft
- **WHEN** stream 在完成前中断且尚未产生文本增量
- **THEN** adapter SHALL 产生明确的 stream incomplete 错误
- **THEN** 应用 SHALL 释放 response lock，使用户可以继续输入

#### Scenario: stream 中断失败且已有 partial draft
- **WHEN** stream 在完成前中断或返回 incomplete，且本次响应已经产生 partial draft
- **THEN** 应用 SHALL 先追加一条 assistant transcript record 保存 partial draft
- **THEN** 应用 SHALL 再追加一条本地 error record 表示响应未完整结束
- **THEN** 应用 SHALL 释放 response lock，使用户可以继续输入

#### Scenario: app 层展示本地错误
- **WHEN** 真实 adapter reject 且用户消息已经提交到 transcript
- **THEN** 应用 SHALL 清空 pending preview 并停止 spinner
- **THEN** 应用 SHALL 追加一条本地 error 消息作为可见反馈
- **THEN** 该错误消息 SHALL 被持久化到当前 transcript session
