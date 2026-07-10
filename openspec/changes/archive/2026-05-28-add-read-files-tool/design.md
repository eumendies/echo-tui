## Context

现有本地工具边界已经支持 `run_bash_command` 和 `apply_patch`：前者用于搜索、验证和非交互 shell 操作，后者用于受控文本编辑。模型在读取已知文件时仍常需要通过 bash 拼接 `cat`、`sed` 或 `python`，这会把简单文件读取暴露给 shell 解析、命令注入和不可控输出规模。

`read_files` 需要成为一个默认注册的 provider-neutral 工具，复用现有 `ToolDefinition` / `ToolHandler` / `ToolExecutionResult` 模型，不改变 transcript、agent loop 或 session persistence schema。第一版重点解决文本文件读取；同时输入和输出不能把工具身份锁死为“文本行读取”，需要允许未来增加图片、PDF 等 reader。

## Goals / Non-Goals

**Goals:**

- 提供 `read_files` 工具，支持一次读取一个或多个本地文件。
- 输入保持简单：`files[].path` 必填，`files[].offset` / `files[].limit` 可选且仅对文本 reader 生效。
- 文本 reader 返回 UTF-8 文本的分页内容、行数 metadata、`has_more` 和截断状态。
- 对暂不支持的非文本资源返回明确的 media/kind metadata 和 unsupported 错误；未来图片/PDF reader 可以忽略 `offset` / `limit`。
- 复用现有工具执行和 OpenAI tool conversion 管线，不引入新运行时 schema。

**Non-Goals:**

- 第一版不实现图片理解、PDF 文本抽取、目录递归、glob 展开或 grep 搜索。
- 第一版不新增专属 transcript role 或专属 TUI tool result renderer。
- 第一版不替代 `run_bash_command` 的文件发现能力；未知路径搜索仍由 bash/rg 完成。
- 第一版不改变 `apply_patch` 的路径解析或编辑语义。

## Decisions

### 1. 使用 plural `read_files`，输入为 `files[]`

工具接收：

```json
{
  "files": [
    { "path": "src/app/main.ts", "offset": 0, "limit": null }
  ]
}
```

选择 plural 是因为源码阅读经常需要同时查看多个已知文件。相比单文件工具，多文件读取能减少 tool call 次数；相比引入 `mode` / `selection`，`offset` / `limit` 更容易被模型稳定调用。

替代方案：使用单数 `read_file` 或抽象 `selection` 对象。单数工具更适合多模态，但会增加源码阅读的调用次数；抽象 selection 为未来留口更大，但第一版输入复杂度过高。

### 2. `offset` / `limit` 只对文本生效，非文本 reader 可忽略

第一版文本 reader 将 `offset` 解释为 0-based 行偏移，`limit` 解释为最多返回行数。未来图片 reader 可以忽略两者；PDF reader 可以选择忽略或复用为页偏移/页数，但无需改变第一版工具输入。

替代方案：在输入中增加 `mode`、`selectionType` 或 `range.kind`。这些字段能更精确表达未来资源切片，但当前没有 PDF/image reader，过早暴露会诱导模型调用未实现能力。

### 3. 输出采用统一文件 envelope，而不是裸文本

每个文件结果包含 `path`、`absolute_path`、`kind`、`media_type`、读取范围、总行数/返回行数、`has_more` 和 content/error。这样文本、unsupported binary 和未来图片/PDF 都能放在同一个 tool result 文本中。

文本内容不默认加行号，避免模型把行号复制进 patch；需要定位时可以通过 `offset` / `limit` 分页继续读取。

### 4. 路径语义与 `apply_patch` 保持一致

相对路径按当前工作目录解析，绝对路径和包含 `..` 的路径允许；包含 NUL 或指向 `.git` 内部路径的请求拒绝。这样模型可以先读取再编辑同一类路径，不会出现 read/edit 能力边界不一致。

### 5. 限制读取和输出字节规模，失败可部分返回

handler 需要限制文件数量、单文件本次返回内容 bytes 和总输出 bytes。`limit` 只表达文本分页请求，不额外设置行数上限；如果调用方省略 `limit`，文本 reader 从 `offset` 读取到文件结束，最终由单文件返回内容大小和总输出 bytes 边界控制。批量请求中任一文件失败时，整体 `ok` 为 `false`，但 result text 仍包含成功文件内容和失败文件错误，帮助模型用已有信息继续修正。

## Risks / Trade-offs

- [Risk] plural 工具批量读取可能让一次 tool result 过大 → 通过 `maxFiles`、`maxFileContentBytes`、`maxTotalOutputBytes` 限制，并在 result 中显式标记 `truncated`。
- [Risk] `offset` / `limit` 对非文本静默忽略可能让模型误以为非文本被分页 → 非文本 envelope 明确写出 `kind`、`media_type` 和 unsupported 或未来 reader 状态；只是不因 offset/limit 本身失败。
- [Risk] 非 UTF-8 或二进制文件被误当文本导致乱码 → 使用 NUL/replacement-character 等轻量 sniff 识别不可读文本，返回 unsupported metadata 而不是输出乱码。
- [Risk] 新工具和 bash 读取能力重叠 → system prompt/tool description 应明确 `read_files` 用于已知路径读取，bash 继续用于搜索、列目录和验证命令。
