## MODIFIED Requirements

### Requirement: read_files local file reading tool
系统 SHALL 提供本地工具 `read_files`，用于按已知路径读取一个或多个本地文件。该工具 SHALL 接收 JSON object 参数 `{ "files": Array<{ "path": string, "offset"?: number, "limit"?: number }> }`，并 SHALL 返回可回传模型的 bounded tool execution result。`offset` 与 `limit` SHALL 仅对文本文件读取生效；图片 reader 和 PDF 文字提取 reader SHALL 忽略这些字段而不把字段本身视为错误。文本文件结果 SHALL 在内容块中包含真实的 1-based 文件行号。受支持图片文件 result SHALL 携带 provider-neutral 图片附件并在文本中给出简短附件摘要；未超过最终附件大小上限的图片 SHALL 保持原始字节，超过该上限但未超过源文件安全上限的图片 SHALL 按 `tools.readFiles.autoCompressImages` 设置压缩或失败。PDF 文件 result SHALL 包含可提取文字内容和必要页数摘要；handler SHALL NOT 把图片、PDF 原始二进制内容或 base64 原样写入 result 文本。

#### Scenario: 默认注册 read_files 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `read_files` 的 tool definition
- **THEN** 该 definition SHALL 要求 `files` 字段为 array
- **THEN** 每个 file item SHALL 要求 `path` 字段为 string，并允许可选的 `offset` 与 `limit` number 字段

#### Scenario: 读取单个 UTF-8 文本文件
- **WHEN** `read_files` 收到包含一个文本文件路径的有效参数
- **THEN** handler SHALL 按当前工作目录解析相对路径
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含文件路径和带行号的返回内容
- **THEN** result 文本 SHALL NOT 常态包含 absolute path、media type、kind、offset、limit、returned lines 或 `has_more: false`

#### Scenario: 按 offset 和 limit 分页读取文本
- **WHEN** file item 提供 `offset` 和 `limit`
- **THEN** 文本 reader SHALL 将 `offset` 解释为 0-based 行偏移
- **THEN** 文本 reader SHALL 最多返回 `limit` 行内容
- **THEN** result 文本 SHALL 通过返回内容的 1-based 行号表达片段位置
- **THEN** 如果后续仍有内容，result 文本 SHALL 包含 `has_more: true`

#### Scenario: 文本内容包含真实文件行号
- **WHEN** `read_files` 返回文本文件内容
- **THEN** result 文本 SHALL 使用明确的带行号内容块呈现文本内容
- **THEN** 内容块中的每一行 SHALL 带有对应的 1-based 文件行号
- **THEN** 第一条返回内容的行号 SHALL 等于 `offset + 1`
- **THEN** 行号 SHALL 作为工具结果辅助信息呈现，而不是被视为文件真实内容

#### Scenario: 空返回片段标明无内容
- **WHEN** 文本读取结果返回 0 行内容
- **THEN** result 文本 SHALL 明确表示该片段没有返回内容
- **THEN** result 文本 SHALL 不得暗示存在文件第 0 行

#### Scenario: 读取未超限的受支持图片文件
- **WHEN** `read_files` 收到未超过最终附件大小上限的 PNG、JPEG、GIF 或 WebP 图片文件路径
- **THEN** handler SHALL 按当前工作目录解析路径并读取该图片文件
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含图片路径、原始 size bytes 和图片已附加的简短摘要
- **THEN** result SHALL 携带一个 `kind: image` 的 provider-neutral 附件，包含 media type、原始 base64 图片数据、path 和 size bytes
- **THEN** result 文本 SHALL NOT 包含完整 base64 图片数据或原始二进制内容

#### Scenario: 自动压缩超限 read_files 图片
- **WHEN** `read_files` 收到超过最终附件大小上限但未超过源文件安全上限的受支持图片
- **AND** `tools.readFiles.autoCompressImages` 为 `true`
- **THEN** handler SHALL 使用受限图片处理流程缩小并按原媒体类型重新编码图片
- **THEN** 只有输出 bytes 不超过最终附件大小上限时 result SHALL 标记 `ok: true` 并生成图片附件
- **THEN** 附件 SHALL 保留原路径和媒体类型，并使用压缩输出的 Base64 与 size bytes
- **THEN** result 文本 SHALL 包含原始大小、输出大小和图片已压缩的简短摘要
- **THEN** result 文本 SHALL NOT 包含完整 base64 图片数据或原始二进制内容

#### Scenario: 关闭自动压缩时超限图片保持失败
- **WHEN** `read_files` 收到超过最终附件大小上限的受支持图片
- **AND** `tools.readFiles.autoCompressImages` 为 `false`
- **THEN** handler SHALL 返回包含图片路径和大小上限的失败结果
- **THEN** handler SHALL NOT 解码、重新编码或生成该图片附件

#### Scenario: 图片压缩无法安全完成
- **WHEN** 图片超过源文件安全上限、解码像素上限，或在有限压缩尝试后仍超过最终附件大小上限
- **THEN** handler SHALL 返回 `ok: false` 和可回传模型的明确失败原因
- **THEN** handler SHALL NOT 生成原始、部分或仍然超限的图片附件
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: 动态 GIF 压缩保留动画
- **WHEN** 自动压缩流程处理受支持的动态 GIF
- **THEN** handler SHALL 保留 GIF 媒体类型和动画帧
- **THEN** handler SHALL 仅在完整输出满足最终附件大小与处理安全边界时生成附件

#### Scenario: 图片读取忽略 offset 和 limit
- **WHEN** `read_files` 收到图片 file item 且该 item 包含 `offset` 或 `limit`
- **THEN** handler SHALL NOT 因这些字段额外失败
- **THEN** handler SHALL 忽略这些字段读取或压缩完整图片附件
- **THEN** result 文本 SHALL NOT 常态回显被忽略的 offset 或 limit

#### Scenario: 读取包含可提取文字的 PDF 文件
- **WHEN** `read_files` 收到 PDF 文件路径且该 PDF 包含可提取文字
- **THEN** handler SHALL 按当前工作目录解析路径并读取该 PDF 文件
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含 PDF 路径、页数摘要和从 PDF 中提取出的文字内容
- **THEN** result 文本 SHALL NOT 包含 PDF 原始二进制内容或 base64 内容
- **THEN** result SHALL NOT 为 PDF 生成图片附件或 document 附件

#### Scenario: PDF 读取忽略 offset 和 limit
- **WHEN** `read_files` 收到 PDF file item 且该 item 包含 `offset` 或 `limit`
- **THEN** handler SHALL NOT 因这些字段额外失败
- **THEN** handler SHALL 不把这些字段解释为 PDF 页码范围
- **THEN** result 文本 SHALL NOT 常态回显被忽略的 offset 或 limit

#### Scenario: PDF 没有可提取文字时返回明确失败
- **WHEN** `read_files` 收到扫描版 PDF 或其他没有可提取文字的 PDF
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含该 PDF 的路径和无可提取文字的失败原因
- **THEN** handler SHALL NOT 尝试 OCR 或页面渲染
- **THEN** handler SHALL NOT 为该 PDF 生成附件

#### Scenario: PDF 解析失败时返回明确失败
- **WHEN** `read_files` 收到加密、损坏或 PDF 文本提取库无法解析的 PDF
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁解析失败原因
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: 批量读取多个文件
- **WHEN** `read_files` 收到多个 file items
- **THEN** handler SHALL 按输入顺序读取并处理每个文件
- **THEN** result 文本 SHALL 为每个文件生成独立但紧凑的文件段落
- **THEN** 成功读取或压缩的图片文件 SHALL 按输入顺序追加对应图片附件
- **THEN** 成功读取的 PDF 文件 SHALL 按输入顺序保留对应文字提取结果
- **THEN** 任一文件失败时整体 result SHALL 标记 `ok: false`，但成功文件的文本内容、PDF 提取内容和图片附件 SHALL 仍保留在 result 中

#### Scenario: 暂不支持的非文本媒体类型返回明确错误
- **WHEN** `read_files` 收到 BMP 或其他暂不支持的非文本、非 PDF 文件路径
- **THEN** handler SHALL 返回该文件路径和 unsupported 错误说明
- **THEN** handler SHALL NOT 因该 file item 包含 `offset` 或 `limit` 而额外失败
- **THEN** handler SHALL NOT 把二进制内容原样写入 result 文本
- **THEN** handler SHALL NOT 为该文件生成图片附件

#### Scenario: 路径解析和基础路径拒绝
- **WHEN** file path 是相对路径
- **THEN** handler SHALL 按当前工作目录解析该路径
- **WHEN** file path 是绝对路径或包含 `..` 的相对路径
- **THEN** handler SHALL 允许该路径并解析到对应绝对路径
- **WHEN** file path 包含 NUL 或指向 `.git` 内部路径
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL NOT 读取该文件内容

#### Scenario: 文件输入无效或不可读取时返回工具失败结果
- **WHEN** `read_files` 收到空 files、非 array files、缺少 path、目录路径、不存在路径或不可读文件
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含对应文件的简洁失败原因
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: 限制读取规模、图片处理规模、PDF 规模和输出规模
- **WHEN** files 数量、单文件本次返回文本内容 bytes、图片源文件 bytes、图片解码像素、图片最终附件 bytes、单个 PDF bytes 或总输出 bytes 超过对应内置安全上限
- **THEN** handler SHALL 在允许压缩的图片场景中只生成满足最终附件上限的完整输出，否则 SHALL 返回 `ok: false` 或在文本安全边界内截断输出
- **THEN** result 文本 SHALL 明确说明失败、压缩或截断原因
- **THEN** result SHALL 在发生文本输出截断或 PDF 提取文本截断时标记 `truncated: true`
- **THEN** handler SHALL NOT 生成部分、损坏或超过最终附件上限的图片附件
