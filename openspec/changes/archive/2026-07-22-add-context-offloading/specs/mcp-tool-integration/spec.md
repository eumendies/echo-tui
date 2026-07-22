## ADDED Requirements

### Requirement: MCP 超大文本结果转存
系统 SHALL 在 MCP tool 的可读文本或结构化结果格式化完成后应用 context offloading。格式化结果超过模型可见上限且文件写入成功时，系统 SHALL 保存完整格式化结果，并 SHALL 只返回结果开头和位于末尾的统一截断路径标记。该行为 SHALL 保留原始 provider tool call id、provider-visible tool name、`ok` 状态和纯文本 continuation 语义。

#### Scenario: 超大 MCP 文本结果转存成功
- **WHEN** MCP server 返回的格式化文本结果超过模型可见上限
- **AND** 系统成功写入 offloading 文件
- **THEN** 系统 SHALL 保存截断前的完整格式化文本
- **THEN** result 文本 SHALL 保留格式化结果开头
- **THEN** result 文本 SHALL 以 `[tool result truncated: <absolute-path>]` 结束

#### Scenario: MCP 结构化结果使用相同规则
- **WHEN** MCP server 返回的 structured content 或 legacy tool result 序列化后超过模型可见上限
- **THEN** 系统 SHALL 对序列化后的文本应用与普通 MCP text content 相同的开头预览和 offloading 规则
- **THEN** 系统 SHALL NOT 向模型可见结果添加额外 offloading metadata 字段

#### Scenario: MCP offloading 失败时继续返回有界结果
- **WHEN** MCP 格式化结果超过上限但 offloading 文件写入失败
- **THEN** 系统 SHALL 继续返回现有安全上限内的 MCP 文本预览
- **THEN** result 文本 SHALL NOT 包含无效文件路径
- **THEN** MCP tool call SHALL NOT 仅因 offloading 失败而变为未捕获异常

