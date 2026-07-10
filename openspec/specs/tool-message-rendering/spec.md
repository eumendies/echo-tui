# tool-message-rendering Specification

## Purpose
定义工具调用和工具结果在终端 transcript 中的专属可见投影行为。渲染层只改变 TUI 输出，不改变 transcript、tool result、附件、provider continuation 或持久化事实内容。

## Requirements

### Requirement: read_files tool call projection
系统 SHALL 为 `read_files` tool call 提供专属终端投影。该投影 SHALL 使用原始 snake_case 工具名 `read_files`，并 SHALL 用路径摘要替代完整 arguments JSON，以减少 transcript 噪音。

#### Scenario: 单路径读取调用
- **WHEN** transcript 包含 `toolName` 为 `read_files` 且 arguments 包含单个 `{ "path": "src/foo.ts" }` 的 tool call
- **THEN** renderer SHALL 显示 `read_files(src/foo.ts)` 或等价的单路径摘要
- **THEN** renderer SHALL NOT 在调用行展示完整 JSON arguments

#### Scenario: 带 offset 和 limit 的读取调用
- **WHEN** `read_files` tool call 的单个文件参数包含 `offset` 或 `limit`
- **THEN** renderer SHALL 在路径摘要中表达分页范围
- **THEN** 用户 SHALL 能从调用行看出读取的是同一路径的局部内容

#### Scenario: 多路径读取调用
- **WHEN** `read_files` tool call 请求多个路径
- **THEN** renderer SHALL 在调用行摘要展示多个路径或路径数量
- **THEN** 当路径过多或行宽不足时，renderer SHALL 使用省略形式而不是输出不可读的完整 JSON

### Requirement: read_files result projection
系统 SHALL 为 `read_files` tool result 提供专属终端投影。该投影 SHALL 解析 `read_files` 现有文本 envelope，并 SHALL 按结果类型显示清晰的路径头部、状态和关键内容，同时保持原始 transcript record 和 provider-visible result 文本不变。

#### Scenario: 文本文件结果
- **WHEN** `read_files` result 包含 `--- text: <path>` envelope 和 `content:` fenced block
- **THEN** renderer SHALL 显示包含 `<path>` 和 `text` 类型的结果头部
- **THEN** renderer SHALL 显示紧凑读取摘要，例如读取行号范围或行数
- **THEN** renderer SHALL NOT 常态显示 fenced block 内的正文内容
- **THEN** renderer SHALL NOT 常态显示 `--- text:`、`content:` 或 fence marker 作为可见噪音

#### Scenario: 文本文件分页或截断状态
- **WHEN** 文本结果 envelope 包含 `has_more: true` 或 `content_truncated: true`
- **THEN** renderer SHALL 隐藏对用户价值较低的 `has_more` 分页内部状态
- **THEN** renderer SHALL 在该文件结果头部或等价位置显示 `content_truncated` 截断状态
- **THEN** renderer SHALL 保留可见读取摘要

#### Scenario: 目录结果
- **WHEN** `read_files` result 包含 `--- directory: <path>` envelope 和 `entries:` 列表
- **THEN** renderer SHALL 显示包含 `<path>` 和 `directory` 类型的结果头部
- **THEN** renderer SHALL 以易读列表展示目录直接子项
- **THEN** 子项 SHALL 保留名称或路径、类型，以及存在时的文件大小信息

#### Scenario: 图片结果
- **WHEN** `read_files` result 包含 `--- image: <path>` envelope、`size_bytes` 和 `image_attached: true`
- **THEN** renderer SHALL 显示图片路径、image 类型、大小和 attached 状态
- **THEN** renderer SHALL NOT 展开或伪造图片二进制内容

#### Scenario: PDF 结果
- **WHEN** `read_files` result 包含 `--- pdf: <path>` envelope、页数元数据和 `extracted_text:` fenced block
- **THEN** renderer SHALL 显示 PDF 路径、pdf 类型和页数相关元数据
- **THEN** renderer SHALL NOT 常态显示 `extracted_text:` fenced block 或其中的提取文本正文

#### Scenario: 错误或不支持的媒体结果
- **WHEN** `read_files` result envelope 包含 `error:` 或 `reason:` 字段
- **THEN** renderer SHALL 显示失败路径、类型和错误原因
- **THEN** renderer SHALL 让用户能区分是单个路径失败还是整个工具调用失败

### Requirement: read_files renderer safety and fallback
`read_files` 专属 renderer SHALL 只影响终端可见投影，不改变 transcript、tool execution result、附件或 agent continuation 语义。无法安全解析的记录 SHALL 降级到通用 tool renderer。

#### Scenario: 非标准 result 文本降级
- **WHEN** `read_files` result 文本不符合已知 envelope 格式
- **THEN** renderer SHALL 使用通用 tool result renderer 展示原始文本
- **THEN** renderer SHALL NOT 抛出异常或中断 app rendering

#### Scenario: 非标准 call arguments 降级
- **WHEN** `read_files` tool call 的 argumentsText 不是可解析的预期 JSON object
- **THEN** renderer SHALL 使用通用 tool call renderer 或等价安全摘要
- **THEN** renderer SHALL NOT 丢失用户理解该调用所需的工具名信息

#### Scenario: 渲染宽度约束
- **WHEN** 当前 terminal width 较窄或路径、目录项、元数据行较长
- **THEN** renderer SHALL 按现有 safe render width 规则换行或截断显示
- **THEN** renderer SHALL NOT 输出超过 safe render width 的可见行

#### Scenario: 原始记录保持不变
- **WHEN** `read_files` tool call 或 tool result 被专属 renderer 投影
- **THEN** transcript record 中保存的 `toolName`、`argumentsText`、`text`、`attachments` 和 `truncated` 字段 SHALL 保持不变
- **THEN** 后续 provider continuation SHALL 继续接收原始 tool result 文本而不是渲染后的文本
