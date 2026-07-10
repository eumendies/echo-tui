## MODIFIED Requirements

### Requirement: read_files local file reading tool
系统 SHALL 提供本地工具 `read_files`，用于按已知路径读取一个或多个本地文件。该工具 SHALL 接收 JSON object 参数 `{ "files": Array<{ "path": string, "offset"?: number, "limit"?: number }> }`，并 SHALL 返回可回传模型的 bounded tool execution result。`offset` 与 `limit` SHALL 仅对文本文件读取生效；未来图片、PDF 或其他非文本 reader SHALL 可以忽略这些字段而不把字段本身视为错误。文本文件结果 SHALL 在内容块中包含真实的 1-based 文件行号，并 SHALL 使用 metadata 标明返回片段的起止文件行号。

#### Scenario: 默认注册 read_files 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `read_files` 的 tool definition
- **THEN** 该 definition SHALL 要求 `files` 字段为 array
- **THEN** 每个 file item SHALL 要求 `path` 字段为 string，并允许可选的 `offset` 与 `limit` number 字段

#### Scenario: 读取单个 UTF-8 文本文件
- **WHEN** `read_files` 收到包含一个文本文件路径的有效参数
- **THEN** handler SHALL 按当前工作目录解析相对路径
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含文件路径、绝对路径、media/kind metadata、带行号的返回内容和分页 metadata

#### Scenario: 按 offset 和 limit 分页读取文本
- **WHEN** file item 提供 `offset` 和 `limit`
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

#### Scenario: 批量读取多个文件
- **WHEN** `read_files` 收到多个 file items
- **THEN** handler SHALL 按输入顺序读取每个文件
- **THEN** result 文本 SHALL 为每个文件生成独立 envelope
- **THEN** 任一文件失败时整体 result SHALL 标记 `ok: false`，但成功文件的读取结果 SHALL 仍保留在 result 文本中

#### Scenario: 非文本或暂不支持的媒体类型返回明确 metadata
- **WHEN** `read_files` 收到图片、PDF 或其他暂不支持的非文本文件路径
- **THEN** handler SHALL 返回该文件的 path、absolute path、kind/media metadata 和 unsupported 错误说明
- **THEN** handler SHALL NOT 因该 file item 包含 `offset` 或 `limit` 而额外失败
- **THEN** handler SHALL NOT 把二进制内容原样写入 result 文本

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

#### Scenario: 限制读取规模和输出规模
- **WHEN** files 数量、单文件本次返回内容 bytes 或总输出 bytes 超过内置安全上限
- **THEN** handler SHALL 返回 `ok: false` 或在安全边界内截断输出
- **THEN** result 文本 SHALL 明确说明失败或截断原因
- **THEN** result SHALL 在发生输出截断时标记 `truncated: true`
