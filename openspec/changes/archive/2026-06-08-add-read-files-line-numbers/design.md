## Context

`read_files` 是模型理解本地源码的主要入口之一。当前文本结果已经包含 path、absolute path、media metadata、`offset`、`limit`、`total_lines`、`returned_lines`、`has_more` 和 `content_truncated`，但 `content` 代码块里的每一行没有真实文件行号。模型在后续解释代码、定位缺陷或构造 patch 时需要自行从 offset 推算行号，容易出现 off-by-one 或片段内数行错误。

现有 `offset` 语义是 0-based 行偏移；用户和代码引用常用的 `file_path:line_number` 是 1-based 文件行号。本设计需要明确二者关系，并让工具输出直接服务后续定位。

## Goals / Non-Goals

**Goals:**

- 文本文件读取结果默认包含真实 1-based 文件行号。
- 结果 metadata 明确给出本次返回片段的 `start_line` 和 `end_line`。
- 保持现有 tool schema、分页、截断、批量读取、错误处理和非文本文件行为不变。
- 让测试覆盖分页片段行号、完整读取行号以及空内容边界。

**Non-Goals:**

- 不新增 `line_numbers` 参数或其他 provider-facing schema 字段。
- 不同时返回 raw content 和 numbered content，避免输出翻倍。
- 不改变 `offset` 的 0-based 语义。
- 不支持二进制、图片或 PDF 内容读取。

## Decisions

1. **默认在内容块中添加真实文件行号**

   `read_files` 面向模型 continuation，主要用途是代码理解和定位。默认添加行号可以让模型直接引用 `path:line`，也能减少后续 patch 定位误差。相比增加可选参数，默认行为更简单，不需要模型记住额外开关。

2. **使用 1-based 文件行号，而不是片段内相对行号**

   当请求 `offset: 100` 时，第一条内容行应显示 `101`。这样行号与编辑器、测试失败堆栈和代码引用格式一致。`offset` 继续保留为工具输入的 0-based metadata，`start_line` 用于桥接模型可读语义。

3. **将内容字段命名为 `content_with_line_numbers`**

   行号不是文件真实内容的一部分，字段名需要明确提示模型不要把行号当作可复制的源码。保留 fenced code block 结构，以维持现有 tool result 的可读性和 transcript 渲染稳定性。

4. **`end_line` 表示实际返回内容的最后一个文件行号**

   对返回 N 行的片段，`start_line = offset + 1`，`end_line = offset + N`。如果返回 0 行，`end_line` 使用 `none` 或等价空值文本，避免暗示存在文件第 0 行。

## Risks / Trade-offs

- **输出 token 增加** → 每行会多出行号前缀；通过既有单文件内容 bytes 和总输出 bytes 上限继续控制规模。
- **模型误复制行号到 patch** → 使用 `content_with_line_numbers` 字段名和清晰分隔符，降低把行号当源码的风险。
- **现有测试断言失效** → 更新 read_files 输出测试，明确新格式是有意契约变更。
- **空文件或 offset 超过文件末尾的语义不清** → 在 metadata 中保留 `returned_lines: 0`，并让 `end_line` 显示为空值语义。
