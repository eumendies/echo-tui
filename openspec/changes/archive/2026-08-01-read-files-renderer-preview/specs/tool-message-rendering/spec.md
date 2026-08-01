## MODIFIED Requirements

### Requirement: read_files result projection
系统 SHALL 为 `read_files` tool result 提供专属终端投影。该投影 SHALL 解析 `read_files` 现有文本 envelope，并 SHALL 按结果类型显示树状路径头部、状态和受展示预算约束的内容预览，同时保持原始 transcript record 和 provider-visible result 文本不变。

#### Scenario: 文本文件结果显示有界预览
- **WHEN** `read_files` result 包含 `--- text: <path>` envelope 和 `content:` fenced block
- **THEN** renderer SHALL 显示包含 `<path>` 和 `text` 类型的结果头部
- **THEN** renderer SHALL 显示紧凑读取摘要，例如读取行号范围或行数
- **THEN** renderer SHALL 显示 `content:` fenced block 内的前若干带行号正文行作为有界预览
- **THEN** 预览行数 SHALL 由 read_files 专属展示预算决定，且 SHALL NOT 常态显示完整正文
- **THEN** renderer SHALL NOT 显示 `--- text:`、`content:` 或 fence marker 作为可见噪音

#### Scenario: 文本文件分页或截断状态
- **WHEN** 文本结果 envelope 包含 `has_more: true` 或 `content_truncated: true`
- **THEN** renderer SHALL 隐藏对用户价值较低的 `has_more` 分页内部状态
- **THEN** renderer SHALL 在该文件结果头部或等价位置显示 `content_truncated` 截断状态
- **THEN** renderer SHALL 保留可见读取摘要

#### Scenario: 目录结果展示预算内子项
- **WHEN** `read_files` result 包含 `--- directory: <path>` envelope 和 `entries:` 列表
- **THEN** renderer SHALL 显示包含 `<path>`、`directory` 类型和 entries 计数的结果头部
- **THEN** renderer SHALL 以易读列表展示展示预算内的目录直接子项
- **THEN** 子项 SHALL 保留名称或路径、类型，以及存在时的文件大小信息
- **THEN** 当 entries 超出展示预算时，renderer SHALL 显示可计数省略提示，如 `… +N more`

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

## ADDED Requirements

### Requirement: read_files tree projection structure
系统 SHALL 将 `read_files` result 投影为使用 box-drawing 字符的树状结构。每个 envelope header SHALL 使用 `├─` 前缀，最后一个 envelope SHALL 使用 `└─` 闭合；内容行 SHALL 使用与 header 竖线同列的 `│` rail，最后一个 envelope 的内容行 rail SHALL 闭合为空格。树线、行号 gutter 与正文 SHALL 统一使用 `toolOutput` 或等价低强调语义色，且 SHALL NOT 应用语法高亮或固定 ANSI 调色板。

#### Scenario: 多 envelope 树状连接
- **WHEN** result 包含多个可解析 envelope
- **THEN** 非最后一个 envelope 的 header SHALL 使用 `├─` 前缀
- **THEN** 最后一个 envelope 的 header SHALL 使用 `└─` 前缀
- **THEN** 非最后一个 envelope 的内容行 SHALL 使用与 header 竖线同列的 `│` rail
- **THEN** 最后一个 envelope 的内容行 SHALL 使用空白闭合 rail
- **THEN** 树线、行号 gutter 与正文 SHALL 保持层级与列对齐

#### Scenario: 单一 envelope 闭合
- **WHEN** result 只包含一个可解析 envelope
- **THEN** 该 header SHALL 使用 `└─` 前缀
- **THEN** 该 envelope 的内容行 SHALL 使用空白闭合 rail

#### Scenario: 低强调单色样式
- **WHEN** renderer 显示 envelope header、行号 gutter 或正文预览
- **THEN** renderer SHALL 使用当前主题的 `toolOutput` 或等价低强调语义样式
- **THEN** renderer SHALL NOT 对预览正文应用 syntax theme、markdown 样式或固定 RGB/256 色值

### Requirement: read_files content display budget
系统 SHALL 使用 read_files 专属总展示预算 30 个物理行，且 SHALL 不影响共享的 `TOOL_RESULT_MAX_DISPLAY_LINES` 常量（grep 等其他 renderer 保持现状）。每个 envelope header SHALL 固定占用 1 行；剩余预算 SHALL 由所有内容型 envelope（成功 text 与 directory）等分，单文件场景占满剩余预算，多文件场景按请求顺序均分，总投影行数 SHALL NOT 超过预算。所有内容行 SHALL 在输出前按可用宽度做尾部省略，保证 1 源行对应 1 个物理行。

#### Scenario: 单文本文件占满预算
- **WHEN** result 只包含一个成功 text envelope 且无 `output_truncated` 标记
- **THEN** renderer SHALL 显示 1 行 header，并将剩余预算全部用于该文件的预览
- **THEN** 当文件内容行数足够时，总投影行数 SHALL 等于 30

#### Scenario: 多文本文件等分预算
- **WHEN** result 包含 N 个成功 text envelope
- **THEN** 每个 envelope SHALL 获得 `floor(剩余预算 / N)` 行预览
- **THEN** 总投影行数 SHALL NOT 超过 30

#### Scenario: 混合 text 与 directory 等分
- **WHEN** result 同时包含成功 text 与 directory envelope
- **THEN** text 与 directory SHALL 按内容型 envelope 总数等分剩余预算
- **THEN** 每个 directory SHALL 在分配行数内显示 entries，超出时显示可计数省略提示
- **THEN** 总投影行数 SHALL NOT 超过 30

#### Scenario: text 内容超出预算显示省略提示
- **WHEN** 成功 text envelope 的 `content:` 行数超过其分配的行数预算
- **THEN** renderer SHALL 显示预算内前若干行，并将最后一行替换为可计数省略提示，如 `… +N more`
- **THEN** 分配行数不足 2 行时 SHALL 只显示 1 行预览且不加省略提示
- **THEN** 省略 SHALL 只影响终端可见投影，不得删除原始 result 文本中的内容行

#### Scenario: output_truncated 提示计入预算
- **WHEN** result 包含 `output_truncated` 标记
- **THEN** renderer SHALL 在整块末尾保留一行截断提示，且该行 SHALL 计入总预算
- **THEN** 内容行分配 SHALL 在扣除提示行后计算，总投影行数 SHALL NOT 超过 30

#### Scenario: 内容行宽度省略
- **WHEN** 预览行或 directory entries 行超过可用显示宽度
- **THEN** renderer SHALL 按当前 safe render width 做尾部省略
- **THEN** 每个 renderer 返回行 SHALL NOT 包含原始换行或回车，也 SHALL NOT 超过 safe render width
