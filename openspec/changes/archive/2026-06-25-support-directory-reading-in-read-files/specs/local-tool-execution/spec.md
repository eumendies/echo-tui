## MODIFIED Requirements

### Requirement: read_files local file reading tool
系统 SHALL 提供本地工具 `read_files`，用于按已知路径读取一个或多个本地文件或目录。该工具 SHALL 接收 JSON object 参数 `{ "files": Array<{ "path": string, "offset"?: number, "limit"?: number }> }`，并 SHALL 返回可回传模型的 bounded tool execution result。`offset` 与 `limit` SHALL 对文本文件表示行分页，对目录表示直接子项分页；图片 reader 和 PDF 文字提取 reader SHALL 忽略这些字段而不把字段本身视为错误。文本文件结果 SHALL 在内容块中包含真实的 1-based 文件行号，并 SHALL 使用 metadata 标明返回片段的起止文件行号。目录结果 SHALL 只包含稳定排序后的直接子项及分页 metadata，不得递归读取后代或自动读取子文件内容。受支持图片文件结果 SHALL 包含人类可读 metadata，并 SHALL 通过 provider-neutral 图片附件把图片内容提供给后续模型请求。PDF 文件结果 SHALL 包含人类可读 metadata 和可提取文字内容；handler SHALL NOT 把图片、PDF 原始二进制内容或 base64 原样写入 result 文本。

#### Scenario: 默认注册 read_files 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `read_files` 的 tool definition
- **THEN** 该 definition SHALL 要求 `files` 字段为 array
- **THEN** 每个 file item SHALL 要求 `path` 字段为 string，并允许可选的 `offset` 与 `limit` number 字段
- **THEN** tool description SHALL 明确该工具支持读取文件和已知目录的直接子项

#### Scenario: 读取单个 UTF-8 文本文件
- **WHEN** `read_files` 收到包含一个文本文件路径的有效参数
- **THEN** handler SHALL 按当前工作目录解析相对路径
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含文件路径、绝对路径、media/kind metadata、带行号的返回内容和分页 metadata

#### Scenario: 按 offset 和 limit 分页读取文本
- **WHEN** file item 指向文本文件并提供 `offset` 和 `limit`
- **THEN** 文本 reader SHALL 将 `offset` 解释为 0-based 行偏移
- **THEN** 文本 reader SHALL 最多返回 `limit` 行内容
- **THEN** result 文本 SHALL 包含 total lines 或 unknown、returned lines、has_more 状态、start_line 和 end_line

#### Scenario: 文本内容包含真实文件行号
- **WHEN** `read_files` 返回文本文件内容
- **THEN** result 文本 SHALL 使用明确的带行号内容块呈现文本内容
- **THEN** 内容块中的每一行 SHALL 带有对应的 1-based 文件行号
- **THEN** 第一条返回内容的行号 SHALL 等于 `offset + 1`
- **THEN** 行号 SHALL 作为工具结果辅助信息呈现，而不是被视为文件真实内容

#### Scenario: 空返回片段标明无结束行
- **WHEN** 文本读取结果返回 0 行内容
- **THEN** result 文本 SHALL 显示 `returned_lines: 0`
- **THEN** result 文本 SHALL 不得暗示存在文件第 0 行
- **THEN** result 文本 SHALL 使用明确空值语义表示没有 `end_line`

#### Scenario: 读取目录的直接子项
- **WHEN** `read_files` 收到一个可读取的目录路径
- **THEN** handler SHALL 返回 `kind: directory` 的成功 envelope
- **THEN** result SHALL 只包含该目录的直接子项
- **THEN** handler SHALL NOT 递归进入子目录
- **THEN** handler SHALL NOT 自动读取任何子文件内容
- **THEN** result 文本 SHALL 明确表示目录读取不递归

#### Scenario: 目录项包含可复用路径和必要 metadata
- **WHEN** `read_files` 返回目录直接子项
- **THEN** 每个条目 SHALL 包含可直接用于后续工具调用的 `path`
- **THEN** 每个条目 SHALL 标记为 `file`、`directory`、`symlink` 或 `other`
- **THEN** 普通文件条目 SHALL 包含 `size_bytes`
- **THEN** 目录、符号链接和其他特殊条目 SHALL NOT 要求计算递归大小或解析链接目标

#### Scenario: 目录项稳定排序并排除 git metadata
- **WHEN** directory reader 枚举目录直接子项
- **THEN** handler SHALL 排除名称为 `.git` 的直接子项
- **THEN** handler SHALL 在分页前按条目名称使用确定性字典序排序
- **THEN** handler SHALL 包含其他隐藏文件和隐藏目录

#### Scenario: 按 offset 和 limit 分页读取目录
- **WHEN** file item 指向目录并提供 `offset` 或 `limit`
- **THEN** directory reader SHALL 将 `offset` 解释为稳定排序后的 0-based 条目偏移
- **THEN** directory reader SHALL 将 `limit` 解释为最多返回条目数
- **THEN** 省略或显式提供 `limit` 时，实际返回条目数均 SHALL NOT 超过内置单目录安全上限
- **THEN** result 文本 SHALL 包含 offset、limit、returned_entries、total_entries 和 has_more

#### Scenario: 读取空目录
- **WHEN** `read_files` 收到一个可读取的空目录路径
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 显示 `returned_entries: 0`、`total_entries: 0` 和 `has_more: false`
- **THEN** result SHALL 包含明确的空 entries 结果

#### Scenario: 读取受支持图片文件
- **WHEN** `read_files` 收到 PNG、JPEG、GIF 或 WebP 图片文件路径
- **THEN** handler SHALL 按当前工作目录解析路径并读取该图片文件
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含 path、absolute path、kind、media type、size bytes 和图片已附加的 metadata
- **THEN** result SHALL 携带一个 `kind: image` 的 provider-neutral 附件，包含 media type、base64 图片数据、path 和 size bytes
- **THEN** result 文本 SHALL NOT 包含完整 base64 图片数据或原始二进制内容

#### Scenario: 图片读取忽略 offset 和 limit
- **WHEN** `read_files` 收到图片 file item 且该 item 包含 `offset` 或 `limit`
- **THEN** handler SHALL NOT 因这些字段额外失败
- **THEN** handler SHALL 忽略这些字段读取完整图片附件
- **THEN** result 文本 SHALL 明确表示 offset/limit 对图片读取不生效或已忽略

#### Scenario: 读取包含可提取文字的 PDF 文件
- **WHEN** `read_files` 收到 PDF 文件路径且该 PDF 包含可提取文字
- **THEN** handler SHALL 按当前工作目录解析路径并读取该 PDF 文件
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含 path、absolute path、kind、media type、size bytes 和 PDF 文字提取 metadata
- **THEN** result 文本 SHALL 包含从 PDF 中提取出的文字内容
- **THEN** result 文本 SHALL NOT 包含 PDF 原始二进制内容或 base64 内容
- **THEN** result SHALL NOT 为 PDF 生成图片附件或 document 附件

#### Scenario: PDF 读取忽略 offset 和 limit
- **WHEN** `read_files` 收到 PDF file item 且该 item 包含 `offset` 或 `limit`
- **THEN** handler SHALL NOT 因这些字段额外失败
- **THEN** handler SHALL 不把这些字段解释为 PDF 页码范围
- **THEN** result 文本 SHALL 明确表示 offset/limit 对 PDF 文字提取不生效或已忽略

#### Scenario: PDF 没有可提取文字时返回明确失败
- **WHEN** `read_files` 收到扫描版 PDF 或其他没有可提取文字的 PDF
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含该 PDF 的 path、absolute path、kind/media metadata 和无可提取文字的失败原因
- **THEN** handler SHALL NOT 尝试 OCR 或页面渲染
- **THEN** handler SHALL NOT 为该 PDF 生成附件

#### Scenario: PDF 解析失败时返回明确失败
- **WHEN** `read_files` 收到加密、损坏或 PDF 文本提取库无法解析的 PDF
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁解析失败原因
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: 批量读取多个文件或目录
- **WHEN** `read_files` 收到多个包含文件或目录的 items
- **THEN** handler SHALL 按输入顺序读取每个路径
- **THEN** result 文本 SHALL 为每个路径生成独立 envelope
- **THEN** 成功读取的图片文件 SHALL 按输入顺序追加对应图片附件
- **THEN** 成功读取的 PDF 文件 SHALL 按输入顺序保留对应文字提取结果
- **THEN** 成功读取的目录 SHALL 按输入顺序保留对应直接子项结果
- **THEN** 任一路径失败时整体 result SHALL 标记 `ok: false`，但其他成功文件的文本内容、PDF 提取内容、图片附件和目录结果 SHALL 仍保留在 result 中

#### Scenario: 暂不支持的非文本媒体类型返回明确 metadata
- **WHEN** `read_files` 收到 BMP 或其他暂不支持的非文本、非 PDF 文件路径
- **THEN** handler SHALL 返回该文件的 path、absolute path、kind/media metadata 和 unsupported 错误说明
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
- **THEN** handler SHALL NOT 读取该文件或目录内容

#### Scenario: 输入无效或路径不可读取时返回工具失败结果
- **WHEN** `read_files` 收到空 files、非 array files、缺少 path、不存在路径、不可读文件或不可读目录
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含对应路径的简洁失败原因
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: 限制读取规模、目录条目、图片规模、PDF 规模和输出规模
- **WHEN** files 数量、单文件本次返回文本内容 bytes、单目录返回条目数、单张图片 bytes、单个 PDF bytes 或总输出 bytes 超过内置安全上限
- **THEN** handler SHALL 返回 `ok: false` 或在安全边界内截断输出
- **THEN** result 文本 SHALL 明确说明失败、分页或截断原因
- **THEN** result SHALL 在发生文本输出截断、目录输出截断或 PDF 提取文本截断时标记 `truncated: true`
- **THEN** handler SHALL NOT 生成被截断或不完整的图片附件
