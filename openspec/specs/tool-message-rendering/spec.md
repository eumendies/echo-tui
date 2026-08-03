# tool-message-rendering Specification

## Purpose
定义工具调用和工具结果在终端 transcript 中的专属可见投影行为。渲染层只改变 TUI 输出，不改变 transcript、tool result、附件、provider continuation 或持久化事实内容。
## Requirements
### Requirement: read_files tool call projection
系统 SHALL 为 `read_files` tool call 提供专属终端投影。该投影 SHALL 使用 sentence case 工具名 `Read files`，并 SHALL 用 `·` 分隔的路径摘要替代完整 arguments JSON，以减少 transcript 噪音。

#### Scenario: 单路径读取调用
- **WHEN** transcript 包含 `toolName` 为 `read_files` 且 arguments 包含单个 `{ "path": "src/foo.ts" }` 的 tool call
- **THEN** renderer SHALL 显示 `Read files · src/foo.ts` 或等价的单路径摘要
- **THEN** renderer SHALL NOT 在调用行展示完整 JSON arguments
- **THEN** renderer SHALL NOT 使用 `read_files(src/foo.ts)` 函数调用形式

#### Scenario: 带 offset 和 limit 的读取调用
- **WHEN** `read_files` tool call 的单个文件参数包含 `offset` 或 `limit`
- **THEN** renderer SHALL 在路径摘要中表达分页范围
- **THEN** 用户 SHALL 能从调用行看出读取的是同一路径的局部内容

#### Scenario: 多路径读取调用
- **WHEN** `read_files` tool call 请求多个路径
- **THEN** renderer SHALL 在调用行摘要展示多个路径或路径数量
- **THEN** 当路径过多或行宽不足时，renderer SHALL 使用省略形式而不是输出不可读的完整 JSON

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

### Requirement: bash tool rail projection
系统 SHALL 为 `run_bash_command` 的 tool call 和相邻匹配的 tool result 提供专属 rail 投影。该投影 SHALL 在首行保留工具调用标记，并使用当前 render theme 的不同语义颜色将命令区与结果区表示为连续的左侧 rail；完成的成功调用标记 SHALL 使用 success 语义色，完成的失败调用标记、命令 rail 和标题 SHALL 使用 error 语义色，pending 调用标记 SHALL 使用 muted 语义色。系统 SHALL NOT 将有效 bash 命令显示为 `Bash('...')` 形式或将原始换行显示为字面量转义文本。

#### Scenario: 成功的 call/result 对使用双段 rail
- **WHEN** transcript 包含相邻且 call id 匹配的 `run_bash_command` tool call 与成功 tool result
- **THEN** renderer SHALL 以命令 rail 显示调用标记和命令内容
- **THEN** renderer SHALL 以与命令 rail 不同的结果 rail 显示执行结果，并以空 rail 行分隔两个区域
- **THEN** renderer SHALL 使用当前 render theme 的语义颜色，而不是固定 ANSI 调色板

#### Scenario: 调用标记反映执行状态
- **WHEN** bash call 与成功或失败的 result 成对渲染
- **THEN** 成功调用的 `◆` SHALL 使用 success 语义色
- **THEN** 失败调用的 `◆` SHALL 使用 error 语义色
- **THEN** 失败调用的命令 rail 和标题 SHALL 使用 error 语义色

#### Scenario: 无结果的 pending 调用使用 rail 预览
- **WHEN** footer pending preview 或单独 tool call 只包含有效的 `run_bash_command` 调用
- **THEN** renderer SHALL 使用与完成态一致的命令 rail 结构显示命令
- **THEN** renderer SHALL 显示运行中状态且 SHALL NOT 伪造执行结果

### Requirement: bash command structure and embedded script preview
系统 SHALL 从有效 bash call arguments 的原始 `command` 字符串投影命令结构。普通多行命令 SHALL 保留其逻辑行和缩进；视觉换行 SHALL NOT 伪造 shell 续行符。系统 SHALL 对边界可安全识别的 heredoc 和长 `-c`/`-e` 内嵌脚本分别显示 shell 头部与脚本正文，并对超出展示预算的脚本显示可计数省略行。`-c`/`-e` 内嵌脚本解析 SHALL NOT 将匹配点之前或之后的多行 shell 上下文合并为单个 renderer row；当无法把 inline script 边界安全限定在单个 shell 逻辑行或整个 command 内时，renderer SHALL 回退为普通多行命令投影。

#### Scenario: heredoc 保留 shell 前置上下文
- **WHEN** bash 命令包含 heredoc marker 之前的多行 shell 前置命令和一个闭合 heredoc 正文
- **THEN** renderer SHALL 显示从命令起始到 marker 的完整 shell 头部
- **THEN** renderer SHALL 将 heredoc 正文作为逐逻辑行的脚本预览显示
- **THEN** 超出脚本展示预算的正文 SHALL 显示隐藏逻辑行数量

#### Scenario: 无法安全拆分的复杂命令
- **WHEN** bash 命令包含无法可靠识别边界的引用、转义或命令替换
- **THEN** renderer SHALL 不拆分或省略命令片段
- **THEN** renderer SHALL 将原始命令按显示宽度安全换行显示

#### Scenario: 长内嵌脚本受限显示
- **WHEN** 可识别的 heredoc 或 `-c`/`-e` 脚本超过脚本展示预算
- **THEN** renderer SHALL 显示预算内的脚本逻辑行
- **THEN** renderer SHALL 显示包含隐藏逻辑行数量的省略提示

#### Scenario: 多行 shell 命令中的 inline script 不吞并上下文
- **WHEN** bash 命令包含多个 shell 逻辑行
- **AND** 其中一行包含 `node -e "..."`、`python -c "..."` 或等价的 `-c`/`-e` inline script 调用
- **AND** inline script 匹配点之前或之后仍存在其他 shell 逻辑行
- **THEN** renderer SHALL 保留这些 shell 逻辑行的独立投影顺序
- **THEN** renderer SHALL NOT 将匹配点前后的 shell 文本合并为单个包含原始换行符的 renderer row
- **THEN** footer pending preview 和 transcript rail SHALL 为每条可见 shell 行保留正确 rail prefix 或 continuation prefix

### Requirement: bash execution status and result projection
系统 SHALL 在 bash 完成态的调用标题中显示紧凑执行状态，包括成功或失败、退出码，以及存在时的耗时、超时或截断事实。超时和截断事实 SHALL 只来自结构化 result 字段，不能从 stdout、stderr 或 result 文本中的同名字面量推断。结果区 SHALL NOT 显示 `output`、`stdout` 或 `stderr` 标题。系统 SHALL 以现有错误语义颜色强调 stderr，并以现有弱化样式显示无输出、超时和截断提示。stdout 与 stderr SHALL 共用同一个结果展示预算。

#### Scenario: 成功输出不显示冗余标题
- **WHEN** bash result 成功且仅包含 stdout
- **THEN** 标题 SHALL 显示成功状态、退出码和可用耗时
- **THEN** 结果 rail SHALL 直接显示 stdout，且 SHALL NOT 显示 `output` 标题

#### Scenario: stdout 与 stderr 同时存在
- **WHEN** bash result 同时包含非空 stdout 和 stderr
- **THEN** 结果 rail SHALL 直接连续显示两个通道的既有结果内容，且 SHALL NOT 插入 stdout 或 stderr 标题
- **THEN** stderr 内容 SHALL 使用错误语义颜色
- **THEN** stdout 与 stderr 的可见逻辑行总数 SHALL 受同一个结果展示预算限制

#### Scenario: 输出文本中的状态字面量不改变结构化状态
- **WHEN** bash stdout、stderr 或 result text 包含 `timed_out: true` 或 `truncated: true` 字面量，但 result 结构化字段未设置对应事实
- **THEN** 标题 SHALL NOT 显示超时或截断状态
- **THEN** 结果区 SHALL NOT 追加超时或截断提示

#### Scenario: 失败、超时或截断
- **WHEN** bash result 为非零退出、超时或输出截断
- **THEN** 标题 SHALL 显示对应状态和可用执行元数据
- **THEN** renderer SHALL 保留可见的 stderr、超时或截断提示，而不将其隐藏为通用输出标题

#### Scenario: heredoc 分隔符按 shell 规则闭合
- **WHEN** bash 命令包含 `<<EOF` heredoc
- **THEN** renderer SHALL 只将完全等于 `EOF` 的逻辑行视为闭合分隔符
- **THEN** 带前导空格的 `EOF` SHALL 作为正文保留
- **WHEN** bash 命令包含 `<<-EOF` heredoc
- **THEN** renderer SHALL 只在移除前导 tab 后完全等于 `EOF` 时闭合，且前导空格 SHALL NOT 被移除

### Requirement: bash renderer layout safety and record preservation
bash 专属 renderer SHALL 只改变终端可见投影，不得改变 transcript record、tool result、provider continuation 或持久化内容。命令、脚本和结果的每一可见行 SHALL 遵守 safe render width；每一返回给 transcript 或 footer 的可见行 SHALL 是单物理行安全投影，不得包含原始 `\n`、`\r` 或会让终端产生未预算额外物理行的未展开控制字符。无法解析有效 `command` arguments 的记录 SHALL 降级到通用 tool renderer。

#### Scenario: 窄终端中的 rail 投影
- **WHEN** terminal width 较窄，且 bash 命令、脚本行或结果行超过可用宽度
- **THEN** renderer SHALL 按 safe render width 换行或截断内容并按需省略非必要状态细节
- **THEN** renderer SHALL NOT 输出超过 safe render width 的可见行

#### Scenario: 原始工具事实保持不变
- **WHEN** bash call 或 result 被 rail renderer 投影
- **THEN** 原始 `argumentsText`、result text、退出码、耗时、超时和截断字段 SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result 而不是渲染后的 rail 文本

#### Scenario: 无效调用参数降级
- **WHEN** `run_bash_command` tool call 的 argumentsText 不是包含非空 `command` 字符串的有效 JSON object
- **THEN** renderer SHALL 降级到通用 tool call renderer
- **THEN** renderer SHALL NOT 抛出异常或中断 transcript 渲染

#### Scenario: renderer 返回行不包含原始换行或回车
- **WHEN** bash call、bash call/result 对或 bash pending preview 包含多行 command、长 inline script 或多行 stdout/stderr
- **THEN** renderer 返回的每个可见行元素 SHALL NOT 包含原始 `\n` 或 `\r`
- **THEN** 每个可见行元素的显示宽度 SHALL 小于或等于当前 safe render width
- **THEN** footer 局部重绘 SHALL 能按返回行数量清理 pending preview，而不会遗留重复的旧 `Bash · running` 块

### Requirement: 共享文件编辑 diff-style projection
系统 SHALL 将现有 `apply_patch` diff-style result renderer 泛化为 `apply_patch` 与 `edit_file` 共用的文件编辑投影。两种工具的成功结果在具有合法持久化 display metadata 时 SHALL 使用相同的按文件标题、增删统计、单列定位 gutter、上下文折叠、红绿背景、长行换行、修改区块公平预算和 safe render width 语义。该投影 SHALL 只改变 TUI 可见输出，不得改变 transcript、tool result、provider continuation 或 session 持久化事实。

#### Scenario: edit_file 调用使用路径摘要
- **WHEN** footer pending preview、孤立 call 或完成 call/result pair 包含参数合法的 `edit_file` 调用
- **THEN** 调用行 SHALL 显示 `Edit file · <path>` 或等价路径摘要
- **THEN** `replace_all` 为 true 时调用行 SHALL 追加 `· replace all` 或等价 modifier
- **THEN** 调用行 SHALL NOT 显示完整 `old_string`、`new_string` 或原始 arguments JSON
- **THEN** 调用行 SHALL NOT 使用 `edit_file(<path>)` 函数调用形式
- **THEN** 完成调用前缀 SHALL 按相邻 result 的成功或失败状态着色

#### Scenario: edit_file 成功结果使用共享 diff renderer
- **WHEN** `edit_file` result 标记成功且包含合法文件编辑 display metadata
- **THEN** result area SHALL 显示文件路径和 added/removed 逻辑行统计
- **THEN** context、removed、added 和 omitted rows SHALL 使用与 `apply_patch` 相同的 gutter、背景、折叠和换行语义
- **THEN** result area SHALL NOT 同时显示冗余 provider-facing 成功文本

#### Scenario: 行内替换显示完整行变化
- **WHEN** `edit_file` 只替换一行中的部分字符串
- **THEN** renderer SHALL 显示修改前完整逻辑行为 removed row
- **THEN** renderer SHALL 显示修改后完整逻辑行为 added row
- **THEN** renderer SHALL NOT 把孤立的 old/new 子串伪装成完整文件行

#### Scenario: 多个远距离替换保留修改区块
- **WHEN** `edit_file` metadata 包含同一文件中的多个相离修改区块
- **THEN** renderer SHALL 保留每个修改区块至少一个实际 changed row
- **THEN** renderer SHALL 优先折叠区块之间的 unchanged context，而不是把整个首尾区间显示为一次大替换

#### Scenario: edit_file 失败或 metadata 非法时安全降级
- **WHEN** `edit_file` result 失败、没有 display metadata 或 metadata 校验失败
- **THEN** renderer SHALL 显示有界失败文本或降级到通用 tool result renderer
- **THEN** renderer SHALL NOT 读取目标文件、重新执行替换、抛出异常或中断 transcript rendering

#### Scenario: 历史 apply_patch metadata 保持兼容
- **WHEN** `/resume` 加载包含既有 `apply_patch` display metadata 的 session
- **THEN** 共享 renderer SHALL 继续渲染原文件分组、行位置、上下文和增删样式
- **THEN** 系统 SHALL NOT 要求重写或迁移旧 transcript records

### Requirement: web_search query and lifecycle projection
系统 SHALL 为 `web_search` pending call、孤立 call 和相邻且 call id 匹配的 call/result pair 提供专属终端投影。投影 SHALL 使用可读的 `Web search · “<query>”` 或等价语义标题替代完整 arguments JSON，并 SHALL 让 pending、成功和失败状态通过标题或调用标记清晰可辨。

#### Scenario: Pending 搜索调用显示查询摘要
- **WHEN** footer pending preview 或孤立 transcript call 的 `toolName` 为 `web_search`
- **AND** arguments 包含非空 `query` 字符串 `Echo TUI GitHub`
- **THEN** renderer SHALL 显示 `Web search · “Echo TUI GitHub”` 或等价查询摘要
- **THEN** renderer SHALL 表达 searching 或等价 pending 状态
- **THEN** renderer SHALL NOT 显示完整 arguments JSON、`count`、`offset`、`market` 或 `safe_search` 字段名

#### Scenario: 完成的搜索对共享查询标题和结果状态
- **WHEN** transcript 包含相邻且 call id 匹配的 `web_search` call 与 result
- **THEN** renderer SHALL 将二者投影为一个共享查询标题的工具块
- **THEN** 成功调用标记 SHALL 使用 success 语义状态，失败调用标记 SHALL 使用 error 语义状态
- **THEN** 完成态 SHALL NOT 继续显示 searching 状态

### Requirement: web_search result tree projection
系统 SHALL 将可安全解析的成功 `web_search` result 投影为紧凑结果树。每个可见结果 SHALL 保留标题、可区分具体页面的 URL 信息和 snippet，并 SHALL 隐藏 `results:`、`url:`、`snippet:` 等 provider-facing 协议字段名。

#### Scenario: 普通成功结果使用两行式结果项
- **WHEN** 成功 `web_search` result 包含一个或多个合法的 title、HTTP(S) URL 和 snippet 结果
- **THEN** renderer SHALL 按原始结果顺序显示结果树
- **THEN** 每个完整结果项 SHALL 使用标题行和 URL/snippet 详情行或等价紧凑结构
- **THEN** 可见 URL SHALL 至少保留 hostname 和用于区分具体页面的 path/query 信息
- **THEN** renderer SHALL NOT 常态显示原始编号、`results:`、`url:` 或 `snippet:` 字段名

#### Scenario: 默认五条结果完整投影
- **WHEN** 成功结果包含默认数量的五个合法结果且各字段可被解析
- **THEN** renderer SHALL 在既有工具结果逻辑行预算内显示五个完整结果项及结果数量 metadata
- **THEN** renderer SHALL NOT 为了显示更多标题而显示缺少 URL 或 snippet 的半个结果项

#### Scenario: 超出展示预算时按完整结果省略
- **WHEN** 可解析结果数量超过专属 renderer 的展示预算
- **THEN** renderer SHALL 只显示预算内的完整结果项
- **THEN** renderer SHALL 在结果树末尾显示被省略的结果数量
- **THEN** 省略 SHALL 只影响终端可见投影，不得删除原始 tool result 中的结果

#### Scenario: 无搜索结果显示空状态
- **WHEN** 成功 `web_search` result 明确表示 `no search results`
- **THEN** renderer SHALL 在查询标题下显示 `no results` 或等价空状态
- **THEN** renderer SHALL NOT 显示空的结果树或 provider-facing 协议字段

### Requirement: web_search quality metadata projection
系统 SHALL 将 `web_search` 的结果数量、partial-match 信息、未匹配 query terms 和结构化截断状态投影为标题下方的弱化 metadata。partial match SHALL 被表达为搜索覆盖状态而不是执行错误，且 SHALL NOT 使用独立 warning block、错误色警告符号或原始诊断字段名。

#### Scenario: 正常结果只显示结果数量
- **WHEN** 成功 `web_search` result 可解析且没有 low-quality 或 truncated 状态
- **THEN** metadata SHALL 显示已解析结果数量
- **THEN** metadata SHALL NOT 显示 partial match、warning 或内部质量字段

#### Scenario: 部分匹配结果弱化显示覆盖状态
- **WHEN** 成功 result 的已知诊断表示结果可能不相关或不完整
- **THEN** metadata SHALL 显示 `partial match` 或等价客观状态
- **THEN** 存在明确 missing query terms 时，metadata SHALL 以有界可读文本显示这些 term 未匹配
- **THEN** renderer SHALL NOT 显示独立的三角 warning、红色错误块、`warning:` 或 `missing_query_terms:` 字段名

#### Scenario: 截断状态来自结构化 details
- **WHEN** `web_search` result 的结构化 `details.truncated` 为 true
- **THEN** metadata SHALL 显示 truncated 或等价状态
- **THEN** renderer SHALL NOT 因 title、URL、snippet 或任意自然语言正文包含 `truncated` 字面量而推断截断状态
- **THEN** 当真实结果总数无法从截断文本确定时，renderer SHALL 避免把已解析数量表述为完整总数

### Requirement: web_search renderer safety and record preservation
`web_search` 专属 renderer SHALL 只改变终端可见投影，不得改变 transcript record、tool result、provider continuation、session 持久化或搜索工具执行语义。失败文本 SHALL 有界显示；无法安全解析的 call 或 result SHALL 降级到通用 tool renderer。所有可见行 SHALL 遵守 safe render width 和现有工具结果展示预算。

#### Scenario: 搜索失败或超时显示短诊断
- **WHEN** 相邻匹配的 `web_search` result 标记失败
- **THEN** renderer SHALL 显示带失败状态的查询标题和有界失败原因
- **THEN** 当且仅当结构化 `details.timedOut` 为 true 时，renderer SHALL 表达 timeout 状态
- **THEN** renderer SHALL NOT 把失败 result 伪装为搜索结果树

#### Scenario: 非标准调用参数安全降级
- **WHEN** `web_search` call arguments 无法解析为包含非空 `query` 的预期 JSON object
- **THEN** renderer SHALL 使用通用 tool call renderer 或等价安全摘要
- **THEN** renderer SHALL NOT 抛出异常或中断 footer/transcript 渲染

#### Scenario: 非标准结果文本安全降级
- **WHEN** `web_search` result 不符合已知成功、无结果或失败文本协议，或者结果项缺少合法 title、HTTP(S) URL 或 snippet
- **THEN** renderer SHALL 使用通用 tool result renderer 展示有界原始文本
- **THEN** renderer SHALL NOT 伪造结果项、质量状态或结果数量

#### Scenario: 窄终端与长字段安全换行
- **WHEN** terminal width 较窄，或 query、title、URL、snippet、missing term 超过可用宽度
- **THEN** renderer SHALL 按 safe render width 换行或截断可见内容
- **THEN** 每个 renderer 返回行 SHALL NOT 包含原始换行或回车，也 SHALL NOT 超过当前 safe render width
- **THEN** tree prefix 和 continuation prefix SHALL 保持结果项层级可辨认

#### Scenario: 原始搜索事实保持不变
- **WHEN** `web_search` call 或 result 被专属 renderer 投影
- **THEN** 原始 `toolName`、`argumentsText`、`text`、`ok`、`toolCallId`、`timedOut` 和 `truncated` 字段 SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result 文本而不是渲染后的标题、metadata 或结果树

### Requirement: web_fetch inline query and lifecycle projection
系统 SHALL 为 `web_fetch` pending call、孤立 call 和相邻且 call id 匹配的 call/result pair 提供专属终端投影。投影 SHALL 使用 `Web fetch · <display-url> · <metadata>` 或等价单行逻辑标题替代完整 arguments JSON；URL、HTTP status、redirect、range、截断和生命周期 metadata SHALL 位于 tool call 标题同一逻辑行，而不是固定显示为独立 metadata 行。

#### Scenario: Pending fetch 显示 URL 摘要
- **WHEN** footer pending preview 或孤立 transcript call 的 `toolName` 为 `web_fetch`
- **AND** arguments 包含合法 URL `https://example.com/docs`、offset 或 limit
- **THEN** renderer SHALL 显示 `Web fetch · example.com/docs · fetching` 或等价摘要
- **THEN** renderer SHALL NOT 显示完整 arguments JSON、`url`、`offset` 或 `limit` 字段名

#### Scenario: 完成结果 metadata 保持在调用标题
- **WHEN** transcript 包含相邻且 call id 匹配的 `web_fetch` call 与可解析 result
- **THEN** renderer SHALL 将 call 与 result 投影为一个共享 URL 身份的工具块
- **THEN** HTTP status、range、redirect、truncated 或其他可用状态 SHALL 作为同一逻辑标题的后缀
- **THEN** renderer SHALL NOT 为这些 metadata 固定增加标题下方的独立 metadata 行
- **THEN** 终端宽度不足时标题 MAY 使用 continuation prefix 物理换行，但仍 SHALL 保持为同一标题块

#### Scenario: 长 URL 有界显示
- **WHEN** requested 或 final URL 超过标题展示预算
- **THEN** renderer SHALL 对 display URL 使用保留 host 和末尾 path/query 语义的有界省略
- **THEN** renderer SHALL 优先保留 HTTP status、timeout、failure 和截断等关键 metadata
- **THEN** renderer SHALL NOT 输出超过 safe render width 的标题行

### Requirement: web_fetch document rail projection
系统 SHALL 将可安全解析的 `web_fetch` 标题与正文投影为 Bash 风格的连续 `◆ ▌` 文档摘录 rail 块。rail SHALL 隐藏 `content:`、fence marker 和 provider-facing envelope 字段；正文 rail 前缀 SHALL 始终使用统一的弱化语义色，正文 SHALL 使用普通内容语义色，且正文颜色不得改变左侧 rail 颜色。

#### Scenario: 成功正文使用文档 rail
- **WHEN** 成功 `web_fetch` result 包含合法 response envelope 和非空正文
- **THEN** renderer SHALL 使用 `◆ ▌` 标题和连续 `  ▌` document rail，按原始逻辑行顺序显示正文
- **THEN** 空正文逻辑行 SHALL 保留可见 rail，以表达段落结构
- **THEN** renderer SHALL NOT 显示 `content:`、opening/closing fence 或原始状态字段名

#### Scenario: rail 前缀颜色保持统一
- **WHEN** 标题、普通正文、空行、错误正文或省略提示使用不同内容语义色
- **THEN** 每一行 document rail 前缀 SHALL 独立使用同一个 `toolOutput` 或等价弱化颜色
- **THEN** rail 颜色 SHALL NOT 跟随正文的 text/error/muted 颜色变化

#### Scenario: 正文预算按完整逻辑行截断
- **WHEN** 可解析正文超过十个逻辑展示行
- **THEN** renderer SHALL 显示预算内的前九个完整逻辑行
- **THEN** 第十个逻辑展示行 SHALL 显示被省略的正文行数量
- **THEN** 视觉省略 SHALL NOT 修改原始 result text 或 offloading artifact

#### Scenario: 空正文不绘制空 rail
- **WHEN** response envelope 明确包含空正文
- **THEN** tool call 标题 SHALL 显示 `no readable content` 或等价状态
- **THEN** renderer SHALL NOT 绘制没有正文内容的 document rail

### Requirement: web_fetch inline response metadata and error projection
系统 SHALL 将可解析的 redirect、分页、响应截断、预览截断、offloading、HTTP 错误和 unsupported media 状态压缩到 tool call 标题的 inline metadata，并根据结果类型决定显示正文 rail 或短诊断。timeout/truncated 等状态 SHALL 以结构化 result details 为权威来源，不得从任意正文中的同名字面量推断。

#### Scenario: Redirect 标题同时表达 requested 与 final URL
- **WHEN** 成功 result 明确表示 requested URL 与 final URL 不同
- **THEN** 标题 SHALL 使用 `<requested> → <final>` 或等价形式表达 redirect
- **THEN** 标题 SHALL 在 URL 身份后继续显示 HTTP status
- **THEN** renderer SHALL NOT 在正文 rail 中重复 `url:` 或 `final_url:` 字段

#### Scenario: 分页范围和后续内容 inline 显示
- **WHEN** call 包含 offset/limit 且 result envelope 可确定已返回正文行范围
- **THEN** 标题 SHALL 使用一基 `lines <start>–<end>` 或等价可读范围
- **WHEN** result 同时包含 `has_more: true`
- **THEN** 同一标题 SHALL 追加 `more` 或等价状态
- **THEN** renderer SHALL NOT 显示 `offset:`、`limit:` 或 `has_more:` 内部字段名

#### Scenario: 不同截断原因 inline 显示
- **WHEN** 结构化 `details.truncated` 为 true 且 envelope 可识别具体截断原因
- **THEN** 标题 SHALL 按事实显示 `response truncated`、`preview truncated`、`full result saved` 或等价 modifiers
- **WHEN** 结构化 truncated 为 true 但无法安全细分原因
- **THEN** 标题 SHALL 显示通用 `truncated` 状态
- **THEN** renderer SHALL NOT 因正文含有 `body_truncated: true`、`Output was truncated.` 或 marker-like 文本而推断截断

#### Scenario: HTTP 错误保留有价值正文
- **WHEN** `web_fetch` result 标记失败但包含可信 HTTP status 和合法正文 envelope
- **THEN** 调用 marker SHALL 使用 error 语义状态，标题 SHALL 显示 HTTP status
- **THEN** renderer SHALL 使用 document rail 显示有界错误正文
- **THEN** 标题 SHALL NOT 在明确 HTTP status 之外重复无信息量的 `failed`

#### Scenario: Timeout 或网络失败显示短诊断
- **WHEN** result 为没有 HTTP 正文 envelope 的 timeout、URL 拒绝、redirect 拒绝或网络失败
- **THEN** 标题 SHALL 显示 `timed out` 或 `failed` 生命周期状态
- **THEN** renderer SHALL 在同一个连续 `▌` rail 块中显示有界短诊断原因
- **THEN** 只有结构化 `details.timedOut` 为 true 时标题 SHALL 显示 timed out

#### Scenario: Unsupported media 不绘制正文 rail
- **WHEN** result 符合 unsupported media envelope
- **THEN** 标题 SHALL 显示可用 HTTP status、`unsupported` 和 content type
- **THEN** renderer SHALL 在同一个连续 `▌` rail 块中显示有界 unsupported 原因
- **THEN** renderer SHALL NOT 伪造或展开二进制正文内容

### Requirement: web_fetch renderer safety and record preservation
`web_fetch` 专属 renderer SHALL 只改变终端可见投影，不得改变 transcript record、tool result、provider continuation、offloading artifact、session 持久化或网络执行语义。renderer SHALL 保守识别完整和结构化截断的 response envelope；无法安全解析的 call 或 result SHALL 降级到通用 tool renderer。所有返回行 SHALL 遵守 safe render width 且不得包含隐藏物理换行。

#### Scenario: 正文内 fence 不提前结束 envelope
- **WHEN** 完整 response envelope 的正文内部包含一行或多行 fence marker 文本
- **THEN** renderer SHALL 使用 formatter 的最末 closing fence 确定完整正文边界
- **THEN** renderer SHALL 保留预算内的内部 fence 正文，而不是提前结束或伪造后续字段

#### Scenario: 结构化截断 result 只显示可信正文前缀
- **WHEN** `details.truncated` 为 true 且 result preview 在 closing fence 之前结束
- **THEN** renderer MAY 在 header 与 content opener 均可信时显示可验证的正文前缀
- **THEN** renderer SHALL 在标题 inline metadata 中显示截断状态
- **THEN** 若 header 或正文起点不可信，renderer SHALL 使用通用 fallback

#### Scenario: 非标准调用或结果安全降级
- **WHEN** call arguments 缺少合法 HTTP(S) URL，或 result 包含未知 header、非法 URL/status/range、歧义 marker 或无法确定的正文边界
- **THEN** renderer SHALL 使用通用 tool renderer 展示有界原始内容
- **THEN** renderer SHALL NOT 伪造 URL、HTTP status、range、redirect、正文或截断类型
- **THEN** renderer SHALL NOT 抛出异常或中断 footer/transcript rendering

#### Scenario: 窄终端和宽字符安全换行
- **WHEN** terminal width 较窄，或 URL、inline metadata、正文、诊断包含长文本或宽字符
- **THEN** renderer SHALL 按 safe render width 换行或有界截断
- **THEN** 每个 renderer 返回行 SHALL NOT 包含原始换行或回车，也 SHALL NOT 超过当前 safe render width
- **THEN** document rail 和 continuation prefix SHALL 保持层级与颜色一致

#### Scenario: 原始 fetch 事实保持不变
- **WHEN** `web_fetch` call 或 result 被专属 renderer 投影
- **THEN** 原始 `toolName`、`argumentsText`、`text`、`ok`、`toolCallId`、`timedOut`、`truncated` 和 attachments SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result 文本而不是渲染后的标题或文档 rail
- **THEN** 已写入的完整 offloading artifact SHALL 保持不变且继续可由模型通过现有工具读取

### Requirement: grep query and lifecycle projection
系统 SHALL 为 `grep` pending call、孤立 call 和相邻且 call id 匹配的 call/result pair 提供专属终端投影。投影 SHALL 使用 `Grep · “<pattern>”` 或等价的人类可读标题替代完整 arguments JSON，并 SHALL 通过调用标记或标题让 pending、成功、无匹配和失败状态清晰可辨。

#### Scenario: Pending grep 显示查询摘要
- **WHEN** footer pending preview 或孤立 transcript call 的 `toolName` 为 `grep`
- **AND** arguments 包含非空 pattern `needle`
- **THEN** renderer SHALL 显示 `Grep · “needle” · searching` 或等价查询和 pending 状态
- **THEN** renderer SHALL NOT 显示完整 arguments JSON

#### Scenario: 查询语义选项显示在第一行
- **WHEN** 合法 `grep` arguments 包含 `literal: false` 或显式 case_sensitive
- **THEN** renderer SHALL 在第一行查询标题中显示 `regex`、`case sensitive` 或 `ignore case` 等对应查询语义
- **THEN** 查询语义 SHALL 位于生命周期或结果状态之前，或者以等价顺序保持与 pattern 的直接关联
- **THEN** renderer SHALL NOT 将 regex 或大小写语义混入第二行搜索范围 metadata

#### Scenario: 搜索范围显示在第二行
- **WHEN** 合法 `grep` arguments 包含 paths 或 glob，或者使用默认当前目录搜索范围
- **THEN** renderer SHALL 在标题下方显示有界的搜索范围 metadata
- **THEN** metadata SHALL 表达 paths，并在存在时表达 glob 文件过滤条件
- **THEN** renderer SHALL NOT 把字段名和值以原始 JSON 形式展示

#### Scenario: 查询标题过长时安全换行
- **WHEN** pattern、regex、显式大小写语义和生命周期或结果状态无法放入一个 safe render width
- **THEN** renderer SHALL 使用与第一行标题一致的 continuation prefix 安全换行
- **THEN** renderer SHALL 保持查询语义与 pattern 的标题层级
- **THEN** 第二行 SHALL 继续只表达搜索范围和 glob 文件过滤条件

#### Scenario: 完成 pair 使用共享标题和结果状态
- **WHEN** transcript 包含相邻且 call id 匹配的 `grep` call 与 result
- **THEN** renderer SHALL 将二者投影为一个共享查询标题的工具块
- **THEN** 成功调用标记 SHALL 使用 success 语义状态，失败调用标记 SHALL 使用 error 语义状态
- **THEN** 完成态 SHALL NOT 继续显示 searching 状态

### Requirement: grep grouped match tree projection
系统 SHALL 在成功 `grep` result 包含合法结构化 display metadata 时，将匹配项按原始顺序投影为有界文件树。renderer SHALL 用文件节点、1-based 行列 gutter 和代码片段表达每个可见匹配，并 SHALL 使用当前主题的低强调语义色，而不是 syntax theme 或固定 ANSI 调色板。

#### Scenario: 单文件多个匹配使用文件节点和 gutter
- **WHEN** 成功 result 的 display metadata 包含同一路径下多个相邻匹配
- **THEN** renderer SHALL 只为该连续文件组显示一个文件节点
- **THEN** 每个可见匹配 SHALL 显示 metadata 中的 1-based line、1-based column 和行文本
- **THEN** 行列 gutter、树线和代码正文 SHALL 保持层级与列对齐

#### Scenario: 多文件匹配形成有序结果树
- **WHEN** 成功 result 的 display metadata 包含多个路径的匹配
- **THEN** renderer SHALL 按 metadata 原始顺序显示文件组和组内匹配
- **THEN** renderer SHALL 使用 `├─`、`└─`、`│` 或等价树形元素区分文件层级
- **THEN** renderer SHALL NOT 从 provider-visible `path:line:column: text` 结果文本反向推断文件分组

#### Scenario: 结果树保持低强调样式
- **WHEN** renderer 显示一个或多个匹配行文本
- **THEN** renderer SHALL 使用当前主题的 `toolOutput` 或等价低强调语义样式投影树线、文件路径、行列 gutter 和代码片段
- **THEN** renderer SHALL NOT 对匹配正文应用 syntax theme 或跨行语法扫描状态
- **THEN** renderer SHALL NOT 为 grep 写死 RGB 或 256 色值

#### Scenario: 无匹配显示紧凑空状态
- **WHEN** 成功 result 的合法 display metadata 包含空 matches 数组
- **THEN** 标题 SHALL 显示 `no matches` 或等价空状态
- **THEN** renderer SHALL NOT 显示空文件树或重复的无匹配正文

### Requirement: grep result count and display budget
系统 SHALL 区分 `grep` handler 的结构化截断事实与 renderer 为控制终端占用而执行的展示省略。结果数量、more-available 状态和可见省略数量 SHALL 从结构化 result details 与 display metadata 得出，不得从匹配正文中的同名字面量推断。

#### Scenario: 未截断结果显示捕获数量
- **WHEN** 成功 result 的 `details.truncated` 为 false 且 display metadata 包含 N 个匹配
- **THEN** 标题 SHALL 显示 N 个 match 的数量语义
- **THEN** renderer SHALL NOT 把 TUI 自身未展示的行误报为 handler 截断

#### Scenario: Handler 截断显示 more available
- **WHEN** 成功 result 的 `details.truncated` 为 true
- **THEN** 标题 SHALL 将 metadata 中的匹配数量表达为已捕获或已显示数量，并 SHALL 表达 more available
- **THEN** renderer SHALL NOT 将该数量表述为完整搜索总数

#### Scenario: 超出 renderer 预算时显示可计数省略
- **WHEN** 合法匹配树在当前 terminal width 下超过专属 renderer 的最终物理行预算
- **THEN** renderer SHALL 只投影预算内的匹配内容
- **THEN** 结果树末尾 SHALL 显示被 renderer 省略的 metadata 匹配数量
- **THEN** 省略 SHALL NOT 删除或修改 result text、display metadata 或 `details.truncated`

### Requirement: grep renderer safety and record preservation
`grep` 专属 renderer SHALL 只改变终端可见投影，不得改变 tool execution、transcript record、provider continuation 或 session 持久化事实。失败诊断 SHALL 有界显示；无法安全解析的 arguments 或 display metadata SHALL 降级到通用 tool renderer。所有可见行 SHALL 遵守 safe render width、grapheme 和 Tab 展开规则。

#### Scenario: grep 失败显示短诊断
- **WHEN** 相邻匹配的 `grep` result 标记失败且包含非空失败原因
- **THEN** renderer SHALL 显示带 failed 状态的查询标题和有界诊断
- **THEN** renderer SHALL NOT 把失败文本伪装为匹配树

#### Scenario: 非标准调用参数安全降级
- **WHEN** `grep` call arguments 不是预期 JSON object，或 pattern、paths、glob、literal、case_sensitive 的类型不可信
- **THEN** renderer SHALL 使用通用 tool call renderer
- **THEN** renderer SHALL NOT 抛出异常或中断 footer/transcript 渲染

#### Scenario: 缺失或非法 display metadata 安全降级
- **WHEN** 成功 `grep` result 缺少 display metadata，或者 metadata 中的 kind、matches、path、line、column、text 任一必要字段非法
- **THEN** renderer SHALL 使用通用 tool result renderer 展示有界原始文本
- **THEN** renderer SHALL NOT 部分构造、伪造或重排匹配树

#### Scenario: 窄终端、宽字符和 Tab 安全投影
- **WHEN** terminal width 较窄，或 pattern、path、匹配正文包含长文本、宽字符或 Tab
- **THEN** renderer SHALL 按当前可见列展开 Tab，并按 safe render width 换行或截断内容
- **THEN** 每个 renderer 返回行 SHALL NOT 包含原始换行或回车，也 SHALL NOT 超过 safe render width
- **THEN** tree prefix、行列 gutter 和 continuation prefix SHALL 保持层级可辨认

#### Scenario: 原始 grep 事实保持不变
- **WHEN** `grep` call 或 result 被专属 renderer 投影
- **THEN** 原始 `toolName`、`argumentsText`、result text、`ok`、`toolCallId`、`exitCode`、`truncated` 和 display metadata SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result 文本而不是渲染后的标题、scope 或匹配树
- **THEN** session 重放 SHALL 使用持久化 metadata 产生等价投影，历史缺少 metadata 的记录 SHALL 无需迁移并安全降级

### Requirement: glob query and lifecycle projection
系统 SHALL 为 `glob` pending call、孤立 call 和相邻且 call id 匹配的 call/result pair 提供专属终端投影。投影 SHALL 使用 `Glob · “<pattern>”` 或等价的人类可读标题替代完整 arguments JSON，并 SHALL 通过调用标记或标题让 pending、成功、无文件和失败状态清晰可辨。

#### Scenario: Pending glob 显示查询摘要
- **WHEN** footer pending preview 或孤立 transcript call 的 `toolName` 为 `glob`
- **AND** arguments 包含非空 pattern `**/*.ts`
- **THEN** renderer SHALL 显示 `Glob · “**/*.ts” · searching` 或等价查询和 pending 状态
- **THEN** renderer SHALL NOT 显示完整 arguments JSON

#### Scenario: 搜索范围显示在第二行
- **WHEN** 合法 `glob` arguments 包含 paths，或者使用默认当前目录搜索范围
- **THEN** renderer SHALL 在标题下方显示有界的搜索范围 metadata
- **THEN** metadata SHALL 表达 paths，且 SHALL NOT 把字段名和值以原始 JSON 形式展示

#### Scenario: 查询标题过长时安全换行
- **WHEN** pattern 和生命周期或结果状态无法放入一个 safe render width
- **THEN** renderer SHALL 使用与第一行标题一致的 continuation prefix 安全换行
- **THEN** 第二行 SHALL 继续只表达搜索范围

#### Scenario: 完成 pair 使用共享标题和结果状态
- **WHEN** transcript 包含相邻且 call id 匹配的 `glob` call 与 result
- **THEN** renderer SHALL 将二者投影为一个共享查询标题的工具块
- **THEN** 成功和无文件调用的 `◆` SHALL 使用 `toolSuccess` 语义状态，失败调用的 `◆` SHALL 使用 `toolError` 语义状态
- **THEN** pending 调用 SHALL 保持中性 marker，完成态 SHALL NOT 继续显示 searching 状态

### Requirement: glob flat path tree projection
系统 SHALL 在成功 `glob` result 包含合法结构化 display metadata 时，将路径按 metadata 原始顺序投影为有界的扁平文件路径树。每个可见文件 SHALL 使用一条完整路径而不重建目录节点，并 SHALL 使用当前主题的低强调语义色，而不是 syntax theme 或固定 ANSI 调色板。

#### Scenario: 多个文件形成扁平路径树
- **WHEN** 成功 result 的 display metadata 包含多个文件路径
- **THEN** renderer SHALL 按 metadata 原始顺序显示路径
- **THEN** renderer SHALL 使用 `├─`、`└─` 或等价树形元素区分列表项
- **THEN** 每个文件 SHALL 常态占用一个逻辑节点，renderer SHALL NOT 为路径中的目录段额外生成层级节点

#### Scenario: 路径树保持低强调样式
- **WHEN** renderer 显示一个或多个文件路径
- **THEN** renderer SHALL 使用当前主题的 `toolOutput` 或等价低强调语义样式投影树线、路径和省略提示
- **THEN** renderer SHALL NOT 对路径应用 syntax theme
- **THEN** renderer SHALL NOT 为 glob 写死 RGB 或 256 色值

#### Scenario: 无匹配显示紧凑空状态
- **WHEN** 成功 result 的合法 display metadata 包含空 paths 数组
- **THEN** 标题 SHALL 显示 `no files` 或等价空状态
- **THEN** renderer SHALL NOT 显示空路径树或重复的无匹配正文

### Requirement: glob result count and display budget
系统 SHALL 区分 `glob` handler 的结构化截断事实与 renderer 为控制终端占用而执行的展示省略。结果数量、more-available 状态和可见省略数量 SHALL 从结构化 result details 与 display metadata 得出，不得从路径文本中的同名字面量推断。

#### Scenario: 未截断结果显示捕获数量
- **WHEN** 成功 result 的 `details.truncated` 为 false 且 display metadata 包含 N 个路径
- **THEN** 标题 SHALL 显示 N 个 file 的数量语义
- **THEN** renderer SHALL NOT 把 TUI 自身未展示的路径误报为 handler 截断

#### Scenario: Handler 截断显示 more available
- **WHEN** 成功 result 的 `details.truncated` 为 true
- **THEN** 标题 SHALL 将 metadata 中的路径数量表达为已捕获或已显示数量，并 SHALL 表达 more available
- **THEN** renderer SHALL NOT 将该数量表述为完整发现总数

#### Scenario: 超出 renderer 预算时显示可计数省略
- **WHEN** 合法路径树在当前 terminal width 下超过专属 renderer 的最终物理行预算
- **THEN** renderer SHALL 只投影预算内的文件路径
- **THEN** 路径树末尾 SHALL 显示被 renderer 省略的 metadata 路径数量
- **THEN** 省略 SHALL NOT 删除或修改 result text、display metadata 或 `details.truncated`

### Requirement: glob renderer safety and record preservation
`glob` 专属 renderer SHALL 只改变终端可见投影，不得改变 tool execution、transcript record、provider continuation 或 session 持久化事实。失败诊断 SHALL 有界显示；无法安全解析的 arguments 或 display metadata SHALL 降级到通用 tool renderer。所有可见行 SHALL 遵守 safe render width、grapheme 和 Tab 展开规则。

#### Scenario: glob 失败显示短诊断
- **WHEN** 相邻匹配的 `glob` result 标记失败且包含非空失败原因
- **THEN** renderer SHALL 显示带 failed 状态的查询标题和有界诊断
- **THEN** renderer SHALL NOT 把失败文本伪装为路径树

#### Scenario: 非标准调用参数安全降级
- **WHEN** `glob` call arguments 不是预期 JSON object，或 pattern、paths 的类型不可信
- **THEN** renderer SHALL 使用通用 tool call renderer
- **THEN** renderer SHALL NOT 抛出异常或中断 footer/transcript 渲染

#### Scenario: 缺失或非法 display metadata 安全降级
- **WHEN** 成功 `glob` result 缺少 display metadata，或者 metadata 中的 kind、paths 或任一路径类型非法
- **THEN** renderer SHALL 使用通用 tool result renderer 展示有界原始文本
- **THEN** renderer SHALL NOT 部分构造、伪造或重排路径树

#### Scenario: 窄终端、宽字符、Tab 和控制换行安全投影
- **WHEN** terminal width 较窄，或 pattern、scope、文件路径包含长文本、宽字符、Tab、CR 或 LF
- **THEN** renderer SHALL 折叠标题和路径中的控制换行，按当前可见列展开 Tab，并按 safe render width 换行或截断内容
- **THEN** 每个 renderer 返回行 SHALL NOT 包含原始换行或回车，也 SHALL NOT 超过 safe render width
- **THEN** tree prefix 和 continuation prefix SHALL 保持层级可辨认；固定树结构无法适配时 SHALL 安全降级

#### Scenario: 原始 glob 事实保持不变
- **WHEN** `glob` call 或 result 被专属 renderer 投影
- **THEN** 原始 `toolName`、`argumentsText`、result text、`ok`、`toolCallId`、`exitCode`、`truncated` 和 display metadata SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result 文本而不是渲染后的标题、scope 或路径树
- **THEN** session 重放 SHALL 使用持久化 metadata 产生等价投影，历史缺少 metadata 的记录 SHALL 无需迁移并安全降级

### Requirement: 统一的 tool call sentence case 标题
系统 SHALL 在 transcript 和 footer pending preview 中使用 sentence case 的用户可读 tool call 标题。可见标题 SHALL NOT 直接使用 snake_case、camelCase 或 PascalCase 协议标识符；工具名称、可信参数摘要和生命周期或结果状态 SHALL 使用 ` · ` 或等价的自然语言层级分隔，且 SHALL NOT 使用 `Tool name(arguments)` 函数调用语法。

#### Scenario: 内置工具名称统一为 sentence case
- **WHEN** renderer 投影 `ask_user_questions`、`read_files`、`apply_patch`、`edit_file`、`create_todos` 或 `complete_todo` tool call
- **THEN** 可见标题 SHALL 分别使用 `Ask user questions`、`Read files`、`Apply patch`、`Edit file`、`Create todos` 或 `Complete todo`
- **THEN** 可见标题 SHALL NOT 包含对应的 snake_case、camelCase 或 PascalCase 名称

#### Scenario: 参数摘要使用 middle dot 分隔
- **WHEN** 专属 renderer 能从 tool call arguments 中安全生成有界参数摘要
- **THEN** renderer SHALL 使用 `Tool name · <summary>` 或等价自然语言结构显示标题
- **THEN** renderer SHALL NOT 将参数摘要包裹在紧跟工具名的小括号中
- **THEN** 现有生命周期或结果状态 SHALL 继续作为独立语义片段显示

#### Scenario: 无需参数摘要的调用只显示工具名
- **WHEN** tool call 不需要向用户展示参数摘要，例如 todo 状态操作
- **THEN** renderer SHALL 只显示 sentence case 工具名或已有自然语言动作摘要
- **THEN** renderer SHALL NOT 追加空小括号

#### Scenario: 已符合自然语言规范的专属标题保持语义
- **WHEN** renderer 投影 `Bash`、`Glob`、`Grep`、`Web search`、`Web fetch` 或 `Using skill` 标题
- **THEN** renderer SHALL 保留这些既有自然语言工具身份、参数摘要和状态语义
- **THEN** renderer SHALL 继续使用现有 safe render width、rail、tree 或结果预算规则

### Requirement: 通用与 MCP tool call 标题 fallback
系统 SHALL 为没有专属投影或专属参数解析失败的 tool call 提供 sentence case 通用标题。通用 fallback SHALL 在首行显示工具身份，并 SHALL 将非空原始 arguments 作为后续低强调、有界内容显示，而不是将其拼入函数调用式标题。标准 MCP tool name SHALL 保留 MCP、server 和具体工具三层身份。

#### Scenario: 通用 snake_case 或驼峰名称转为 sentence case
- **WHEN** 通用 renderer 收到名称为 `generic_tool`、`readMemory` 或 `AskUserQuestions` 的 tool call
- **THEN** 首行 SHALL 显示 `Generic tool`、`Read memory` 或 `Ask user questions`
- **THEN** 原始 `toolName` SHALL 保持不变

#### Scenario: 通用 arguments 分层显示
- **WHEN** 通用 tool call 包含非空 `argumentsText`
- **THEN** renderer SHALL 在工具标题后的低强调行中有界显示原始 arguments
- **THEN** arguments 行 SHALL 遵守 safe render width、Tab 展开和单物理行安全规则
- **THEN** 标题 SHALL NOT 使用 `Tool name(arguments)` 形式

#### Scenario: 标准 MCP 工具保留来源身份
- **WHEN** 通用 renderer 收到 `mcp__<server>__<tool>` 形式的 tool name
- **THEN** 标题 SHALL 显示 `MCP · <server> · <tool display name>` 或等价三层身份
- **THEN** tool display name SHALL 使用 sentence case
- **THEN** 非空 arguments SHALL 按通用 arguments 分层规则显示

#### Scenario: 专属参数解析失败时安全降级
- **WHEN** 内置工具的专属 renderer 无法安全解析 arguments
- **THEN** renderer SHALL 使用统一通用标题和 arguments fallback
- **THEN** renderer SHALL NOT 伪造参数摘要、抛出异常或中断 transcript/footer 渲染

#### Scenario: pending 与 transcript 使用一致标题
- **WHEN** 同一个 tool call 先出现在 footer pending preview，随后成为 transcript tool call
- **THEN** 两处 SHALL 使用相同的 sentence case 工具身份和参数摘要结构
- **THEN** 格式化 SHALL NOT 修改 `toolName`、`argumentsText`、tool result、provider continuation 或持久化事实

