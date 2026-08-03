## ADDED Requirements

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

## MODIFIED Requirements

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
