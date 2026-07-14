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

### Requirement: Memory tool semantic and result projection
系统 SHALL 为仅操作 agent memory 的 `add_memory`、`read_memory`、`update_memory` 和 `remove_memory` 提供专属终端投影。调用投影 SHALL 分别使用 `Remembering`、`Recalling`、`Revising` 和 `Forgetting` 或等价动作摘要，并根据 catalog/item 目标展示有意义的 content 或 catalog 上下文。正常投影 SHALL NOT 显示完整 arguments JSON、item id、时间戳、enabled、scope 或内部 JSON 字段名。Footer pending preview、孤立 transcript call 和完成 pair 中的 call SHALL 使用一致摘要规则。

#### Scenario: Memory call 使用 agent memory 语义摘要
- **WHEN** memory tool call 包含可识别的 catalog/item 或 content 参数
- **THEN** renderer SHALL 显示对应的 Remembering、Recalling、Revising 或 Forgetting 摘要
- **THEN** item add 或 update SHALL 显示 bounded content preview；catalog update SHALL 显示旧名称及存在时的 rename 方向
- **THEN** item 与 catalog remove SHALL 使用不同摘要；renderer SHALL NOT 为恢复被删内容而显示 item id 或搜索其他 transcript records
- **THEN** renderer SHALL NOT 依赖 `type` 参数区分 user 与 agent memory

#### Scenario: Pending memory call 使用同一摘要
- **WHEN** footer pending preview 或孤立 transcript call 包含任一 memory tool
- **THEN** renderer SHALL 使用与完成 pair 相同的动作摘要
- **THEN** renderer SHALL NOT 短暂展示 raw arguments JSON

#### Scenario: 成对 memory mutation 成功时隐藏 result body
- **WHEN** 成功的 `add_memory`、`update_memory` 或 `remove_memory` call 与同 call id result 相邻
- **THEN** renderer SHALL 只显示语义化调用摘要
- **THEN** renderer SHALL NOT 显示成功 result JSON、id、时间戳或存储快照

#### Scenario: 成对 memory read 展示内容列表或失败诊断
- **WHEN** 成功 `read_memory` result 包含 agent memories
- **THEN** renderer SHALL 使用一致的分点列表展示每个非空 content
- **THEN** renderer SHALL NOT 显示 catalog description、item id、enabled、createdAt、updatedAt 或 result JSON 结构
- **WHEN** 成功结果的 memories 为空
- **THEN** renderer SHALL 显示空状态
- **WHEN** memory call/result 失败
- **THEN** renderer SHALL 显示带失败状态的调用摘要和受既有预算限制的失败文本

### Requirement: Memory renderer safety and record preservation
Memory 专属 renderer SHALL 只改变终端可见投影，不得改变 transcript record、tool result、provider continuation、session 持久化或 compaction 输入。无法解析 call/result JSON 时 SHALL 使用不含 raw JSON 的安全摘要，而不是回退展示内部 payload。所有可见行 SHALL 遵守现有 safe render width 和 tool result 总行数预算。

#### Scenario: Malformed memory record 安全降级
- **WHEN** memory tool call arguments 或成功 result 无法解析为预期 JSON
- **THEN** renderer SHALL 显示按工具名生成的安全调用摘要；成功 mutation result 可隐藏或显示安全完成摘要，成功 read result SHALL 显示 unavailable 状态
- **THEN** renderer SHALL NOT 展示 malformed 原文或抛出异常

#### Scenario: Memory renderer 保留原始事实
- **WHEN** memory call 或 result 被专属 renderer 投影
- **THEN** 原始 `toolName`、`argumentsText`、`text`、`ok` 和 `toolCallId` SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result JSON 而不是渲染后的摘要或列表

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
