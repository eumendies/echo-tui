## ADDED Requirements

### Requirement: OpenAI Responses 图片工具结果转换
系统 SHALL 在 OpenAI Responses provider 边界内把带图片附件的 `tool_result` transcript record 转换为模型可见的视觉输入。转换 SHALL 保留原有 function call output 的文本 metadata，并 SHALL 将每个受支持图片附件作为同一续传上下文中的图片输入发送给模型。

#### Scenario: 转换带图片附件的 read_files tool result
- **WHEN** transcript records 包含具备 call id、output text 和图片附件的 `read_files` `tool_result` record
- **THEN** OpenAI Responses 转换器 SHALL 继续生成对应 `function_call_output`，并把 record text 映射为 output
- **THEN** 转换器 SHALL 为图片附件生成 OpenAI Responses 可接收的图片输入内容
- **THEN** 图片输入 SHALL 保留附件 media type 和 base64 数据
- **THEN** 后续 provider request SHALL 让模型能够同时看到工具文本 metadata 和图片内容

#### Scenario: 多图片附件按顺序转换
- **WHEN** 一个或多个 `tool_result` records 携带多个图片附件
- **THEN** OpenAI Responses 转换器 SHALL 按 transcript 顺序和附件顺序转换图片输入
- **THEN** 转换器 SHALL NOT 丢弃同一工具结果中的后续图片附件

#### Scenario: 没有图片附件时保持纯文本转换
- **WHEN** transcript records 中的 `tool_result` record 不包含图片附件
- **THEN** OpenAI Responses 转换器 SHALL 保持既有纯文本 `function_call_output` 转换行为
- **THEN** 转换器 SHALL NOT 额外生成图片输入内容

#### Scenario: 图片附件格式无效时降级为文本 metadata
- **WHEN** `tool_result` record 携带缺少 media type、缺少 base64 数据或 provider 不支持格式的图片附件
- **THEN** OpenAI Responses 转换器 SHALL NOT 构造无效图片输入
- **THEN** 转换器 SHALL 保留该 tool result 的文本 metadata
- **THEN** 转换器 SHALL NOT 因单个无效附件中断整个请求构造

### Requirement: OpenAI Chat Completions 图片工具结果转换
系统 SHALL 在 OpenAI Chat Completions provider 边界内把带图片附件的 `tool_result` transcript record 转换为模型可见的视觉输入。转换 SHALL 保留原有 tool message 的文本 metadata，并 SHALL 将每个受支持图片附件作为同一续传上下文中的 `image_url` 内容发送给模型。

#### Scenario: 转换带图片附件的 read_files tool result
- **WHEN** transcript records 包含具备 tool call id、output text 和图片附件的 `read_files` `tool_result` record
- **THEN** OpenAI Chat 转换器 SHALL 继续生成对应 role 为 `tool` 的 message，并把 record text 映射为 content
- **THEN** 转换器 SHALL 为图片附件生成 OpenAI Chat Completions 可接收的 `image_url` 内容
- **THEN** 图片内容 SHALL 保留附件 media type 和 base64 数据
- **THEN** 后续 provider request SHALL 让模型能够同时看到工具文本 metadata 和图片内容

#### Scenario: 多图片附件按顺序转换
- **WHEN** 一个或多个 OpenAI Chat `tool_result` records 携带多个图片附件
- **THEN** OpenAI Chat 转换器 SHALL 按 transcript 顺序和附件顺序转换图片内容
- **THEN** 转换器 SHALL NOT 丢弃同一工具结果中的后续图片附件

#### Scenario: 没有图片附件时保持纯文本转换
- **WHEN** transcript records 中的 `tool_result` record 不包含图片附件
- **THEN** OpenAI Chat 转换器 SHALL 保持既有纯文本 `tool` message 转换行为
- **THEN** 转换器 SHALL NOT 额外生成图片内容

#### Scenario: 图片附件格式无效时降级为文本 metadata
- **WHEN** `tool_result` record 携带缺少 media type、缺少 base64 数据或 Chat Completions 不支持格式的图片附件
- **THEN** OpenAI Chat 转换器 SHALL NOT 构造无效图片内容
- **THEN** 转换器 SHALL 保留该 tool result 的文本 metadata
- **THEN** 转换器 SHALL NOT 因单个无效附件中断整个请求构造
