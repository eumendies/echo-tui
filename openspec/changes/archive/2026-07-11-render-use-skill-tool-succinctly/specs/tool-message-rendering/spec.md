## ADDED Requirements

### Requirement: use_skill succinct transcript projection
系统 SHALL 为 `use_skill` tool call 和相邻匹配的 tool result 提供专属终端 transcript 投影。成功加载 skill 时，该投影 SHALL 只显示 `Using skill · <skill-name>` 或等价摘要，并 SHALL 隐藏 arguments、source path、skill 正文、resource 列表和成功 tool result body。该投影 SHALL 只改变 TUI 可见输出，不得改变 transcript record、tool result 文本、provider continuation、session 持久化或 compaction 输入语义。

#### Scenario: 成功加载 skill 只显示使用摘要
- **WHEN** transcript 包含相邻且 `toolCallId` 匹配的 `use_skill` tool call 和 `ok: true` tool result
- **AND** tool call arguments 包含非空 `name` 字符串 `openspec-explore`
- **AND** tool result 文本包含完整 skill 正文
- **THEN** renderer SHALL 显示 `Using skill · openspec-explore` 或等价摘要
- **THEN** renderer SHALL NOT 显示 tool call arguments
- **THEN** renderer SHALL NOT 显示 skill 正文、source path、resource 列表或成功 tool result body

#### Scenario: 成功加载 skill 不显示 arguments
- **WHEN** `use_skill` tool call arguments 包含 `name` 和非空 `arguments`
- **AND** 对应 tool result 标记成功
- **THEN** renderer SHALL 显示正在使用的 skill 名称
- **THEN** renderer SHALL NOT 显示 `arguments` 字段名或 arguments 文本

#### Scenario: pending use_skill 调用使用摘要
- **WHEN** footer pending preview 或单独 transcript tool call 包含 `toolName` 为 `use_skill` 且 arguments 包含非空 `name`
- **THEN** renderer SHALL 显示 `Using skill · <skill-name>` 或等价摘要
- **THEN** renderer SHALL NOT 显示完整 JSON arguments

#### Scenario: use_skill 加载失败显示短诊断
- **WHEN** transcript 包含相邻且 `toolCallId` 匹配的 `use_skill` tool call 和 `ok: false` tool result
- **THEN** renderer SHALL 显示 `Using skill · <skill-name>` 或等价调用摘要
- **THEN** renderer SHALL 显示 bounded failure text，帮助用户理解加载失败原因
- **THEN** renderer SHALL 继续遵守现有工具结果显示截断和 safe render width 约束

#### Scenario: use_skill 记录事实保持不变
- **WHEN** `use_skill` call 或 result 被专属 renderer 投影
- **THEN** transcript record 中保存的 `toolName`、`argumentsText`、`text`、`ok` 和 `toolCallId` SHALL 保持不变
- **THEN** 后续 provider continuation SHALL 继续接收原始完整 tool result 文本而不是渲染后的 `Using skill` 摘要

#### Scenario: use_skill malformed 记录安全降级
- **WHEN** `use_skill` tool call arguments 无法解析出非空 skill name
- **THEN** renderer SHALL 显示 `Using skill` 或等价安全摘要，或者使用通用 tool call fallback
- **THEN** renderer SHALL NOT 抛出异常或中断 transcript 渲染
- **THEN** renderer SHALL NOT 为了恢复名称而展示完整成功 skill 正文
