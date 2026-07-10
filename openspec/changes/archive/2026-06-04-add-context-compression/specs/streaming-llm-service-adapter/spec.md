## MODIFIED Requirements

### Requirement: 真实 LLM 服务配置
系统 SHALL 通过用户级 JSON 配置文件创建真实 LLM adapter。配置 SHALL 从 `~/.echo/config.json` 读取，并包含创建 OpenAI SDK client 和发起文本响应所需的运行参数；敏感字段 SHALL 只驻留在运行时内存中，不得硬编码在源码、测试 fixture、文档示例或 OpenSpec artifacts 中。系统 SHALL NOT 要求用户配置客户端输出 token 上限；默认请求 SHALL NOT 发送 `max_output_tokens`。系统 SHALL 支持包含多个模型 profile 与持久化当前选择的配置。模型 profile SHALL 支持可选的 `contextWindow` 配置项，用于上下文压缩的窗口解析；缺省时由内置映射表或默认值回退。

#### Scenario: 从用户级配置文件创建配置
- **WHEN** CLI 启动默认真实 adapter
- **THEN** 系统 SHALL 从 `~/.echo/config.json` 读取 LLM 运行配置
- **THEN** 系统 SHALL 使用读取到的配置创建 OpenAI SDK client 和模型请求参数

#### Scenario: 从多模型配置创建当前生效配置
- **WHEN** `~/.echo/config.json` 中的 `llm.models` 包含多个有效模型 profile，且 `llm.selectedModel` 指向其中一个 profile id
- **THEN** 系统 SHALL 使用被选中的 profile 解析当前生效模型名
- **THEN** profile 缺省的 `apiKey` 或 `baseURL` SHALL 从 `llm` 顶层配置继承
- **THEN** profile 中显式配置的 `apiKey` 或 `baseURL` SHALL 覆盖 `llm` 顶层配置

#### Scenario: 多模型配置缺少 selectedModel 时使用安全默认
- **WHEN** `llm.models` 是非空有效数组，但 `llm.selectedModel` 缺失或为空
- **THEN** 系统 SHALL 使用第一个有效 profile 作为当前生效模型
- **THEN** 系统 SHALL NOT 因缺少 `selectedModel` 而阻止默认真实 adapter 启动

#### Scenario: selectedModel 指向已删除 profile 时使用安全默认
- **WHEN** `llm.models` 是非空有效数组，但 `llm.selectedModel` 指向不存在或无效的 profile
- **THEN** 系统 SHALL 使用第一个有效 profile 作为当前生效模型
- **THEN** 系统 SHALL NOT 因 stale `selectedModel` 阻止默认真实 adapter 启动

#### Scenario: 缺少必要配置时明确失败
- **WHEN** CLI 默认真实 adapter 缺少创建 client 或发起响应所需的必要配置
- **THEN** 系统 SHALL 明确提示缺少必要配置
- **THEN** 系统 SHALL NOT 发起真实模型请求
- **THEN** 错误提示 SHALL NOT 包含敏感字段值

#### Scenario: 默认不发送客户端输出长度限制
- **WHEN** 用户级配置文件未提供服务端专有输出长度参数
- **THEN** 系统 SHALL NOT 在 OpenAI request 中发送 `max_output_tokens`
- **THEN** 系统 SHALL 让模型服务端决定本次响应的输出长度上限

#### Scenario: 选择持久化后后续请求使用新模型
- **WHEN** `/model` 命令已将某个 profile id 写入 `llm.selectedModel`
- **THEN** 后续普通用户消息触发真实 adapter 时 SHALL 重新读取 `~/.echo/config.json`
- **THEN** 后续 OpenAI 请求参数 SHALL 使用新选择的模型 profile 解析出的模型名和 provider 配置

#### Scenario: 读取模型 profile 的上下文窗口配置
- **WHEN** 当前生效模型 profile 配置了有效的 `contextWindow`
- **THEN** 系统 SHALL 在解析生效配置时携带该上下文窗口值
- **THEN** 该值 SHALL 可供上下文压缩的窗口解析使用

### Requirement: OpenAI transcript input 转换
真实 LLM adapter SHALL 在 OpenAI provider 边界内把本地 `TranscriptRecord[]` 转换为 OpenAI Responses API 的结构化 input。转换器 SHALL 发送本次模型请求支持的 transcript role，包括 user、assistant、system、tool_call 和 tool_result；转换器 SHALL NOT 把本地错误反馈或压缩提示发送给模型。当存在压缩状态时，adapter SHALL 只投影活跃区间 `records[activeStartIndex:]`，并在内置 system prompt 之后、活跃区间之前注入一条携带摘要文本的 `user` 消息。

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

#### Scenario: 存在压缩状态时只投影活跃区间并注入摘要
- **WHEN** 发起 provider 请求时存在压缩状态（含摘要文本和活跃区间起点索引 `activeStartIndex`）
- **THEN** adapter SHALL 只投影 `records[activeStartIndex:]` 的活跃区间记录
- **THEN** adapter SHALL 在内置 system prompt 之后、活跃区间之前注入一条携带摘要文本的 `user` 消息

#### Scenario: 无压缩状态时投影全部记录
- **WHEN** 转换时不存在压缩状态
- **THEN** 转换器 SHALL 按现有规则投影全部可发送记录
- **THEN** 转换器 SHALL NOT 注入摘要消息

### Requirement: SDK 流式文本增量处理
真实 LLM adapter SHALL 消费 OpenAI SDK 提供的流式文本增量，累积最终 assistant draft，并把未知或暂不支持的非文本事件限制在 adapter 内部处理。已知错误、服务端 incomplete 或无效 stream SHALL 显式结束为对应语义，而不是被误报为未知本地 stream 未完成。adapter SHALL 在收到完成事件时捕获其携带的 `usage` 信息（如存在），用于上下文长度的真值校准。

#### Scenario: 处理文本增量
- **WHEN** SDK stream 产生新的文本增量
- **THEN** adapter SHALL 读取该增量文本
- **THEN** adapter SHALL 将该增量追加到当前 draft
- **THEN** adapter SHALL 通过文本增量回调把增量和完整 draft 交给 app 层

#### Scenario: 处理完成事件
- **WHEN** SDK stream 表示本次文本响应完成
- **THEN** adapter SHALL 以累积出的完整 assistant 文本完成本次 agent 调用
- **THEN** adapter SHALL 在完成事件携带 `usage` 时捕获其 `input_tokens` 供长度校准使用

#### Scenario: 完成事件缺少 usage 时不阻断
- **WHEN** SDK stream 完成事件未携带 `usage`
- **THEN** adapter SHALL 正常以累积文本完成本次调用
- **THEN** adapter SHALL NOT 因缺少 `usage` 而报错

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

## ADDED Requirements

### Requirement: 发请求前上下文压缩检查
agent loop runtime SHALL 在构造 provider 请求前执行上下文压缩检查。当预估上下文长度超过当前模型上下文窗口阈值且记录足以压缩时，runtime SHALL 先同步生成结构化摘要、更新并落盘压缩状态，再继续本轮 provider 请求；否则 SHALL 直接按现有流程发送请求。压缩 SHALL 在发请求前同步完成，不得改写完整 `records[]`。

#### Scenario: 超阈值时先压缩再发请求
- **WHEN** agent loop runtime 即将发起 provider 请求且预估上下文长度超过窗口阈值且记录足以压缩
- **THEN** runtime SHALL 先同步生成结构化摘要并更新压缩状态
- **THEN** runtime SHALL 在压缩状态落盘后再发起本轮 provider 请求
- **THEN** runtime SHALL NOT 删除或改写完整 `records[]`

#### Scenario: 未超阈值时直接发请求
- **WHEN** agent loop runtime 即将发起 provider 请求且预估上下文长度未超过窗口阈值
- **THEN** runtime SHALL NOT 触发压缩
- **THEN** runtime SHALL 按现有流程发起 provider 请求
