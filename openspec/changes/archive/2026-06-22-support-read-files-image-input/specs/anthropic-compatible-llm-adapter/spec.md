## ADDED Requirements

### Requirement: Anthropic 图片工具结果转换
系统 SHALL 在 Anthropic provider 边界内把带图片附件的 `tool_result` transcript record 转换为 Anthropic Messages API 可接收的 `tool_result` 内容。转换 SHALL 保留原有工具结果文本，并 SHALL 将每个受支持图片附件作为 `image` content block 发送给模型。

#### Scenario: 转换带图片附件的 read_files tool result
- **WHEN** transcript records 包含具备 tool use id、output text 和图片附件的 `read_files` `tool_result` record
- **THEN** Anthropic 转换器 SHALL 生成对应 `tool_result` block 并保留 `tool_use_id`
- **THEN** `tool_result` 内容 SHALL 包含来自 record text 的文本内容
- **THEN** `tool_result` 内容 SHALL 为每个图片附件包含 Anthropic `image` block
- **THEN** image block SHALL 使用附件的 media type 和 base64 数据

#### Scenario: 多图片附件按顺序转换
- **WHEN** 一个或多个 Anthropic `tool_result` records 携带多个图片附件
- **THEN** Anthropic 转换器 SHALL 按 transcript 顺序和附件顺序转换图片 block
- **THEN** 转换器 SHALL NOT 丢弃同一工具结果中的后续图片附件

#### Scenario: 没有图片附件时保持纯文本转换
- **WHEN** transcript records 中的 `tool_result` record 不包含图片附件
- **THEN** Anthropic 转换器 SHALL 保持既有纯文本 `tool_result` 转换行为
- **THEN** 转换器 SHALL NOT 额外生成 image block

#### Scenario: 图片附件格式无效时降级为文本 metadata
- **WHEN** `tool_result` record 携带缺少 media type、缺少 base64 数据或 Anthropic 不支持格式的图片附件
- **THEN** Anthropic 转换器 SHALL NOT 构造无效 image block
- **THEN** 转换器 SHALL 保留该 tool result 的文本 metadata
- **THEN** 转换器 SHALL NOT 因单个无效附件中断整个请求构造
