# local-tool-execution Specification

## Purpose
定义 echo_tui 本地工具 registry、executor 与首个 bash function tool 的外部行为、运行边界和结果语义。
## Requirements
### Requirement: local tool registry and execution boundary
系统 SHALL 提供 provider-neutral 的本地工具执行边界。该边界 SHALL 支持工具定义、工具 handler、工具 registry 和工具 executor，并 SHALL 让 agent adapter 可以按工具名称执行已注册工具而不依赖具体工具实现细节。该边界 SHALL 支持合并内置工具 registry 与启动期成功初始化的 MCP tool registry；未注册或初始化失败的工具 SHALL 继续返回失败结果而不是中断 app。

#### Scenario: 注册工具定义和 handler
- **WHEN** 系统创建本地 tool registry
- **THEN** registry SHALL 能按工具名称保存 tool definition 和对应 handler
- **THEN** registry SHALL 能向 agent adapter 暴露可发送给 provider 的工具定义列表

#### Scenario: 合并 MCP tool registry
- **WHEN** MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** normal mode 默认 tool registry SHALL 包含内置工具和这些 MCP tools
- **THEN** registry SHALL 能按 MCP namespace tool name 找到对应 MCP handler

#### Scenario: 按名称执行已注册工具
- **WHEN** tool executor 收到一个已注册工具名称和 JSON arguments 字符串
- **THEN** executor SHALL 找到对应 handler
- **THEN** executor SHALL 把解析后的参数交给 handler 执行
- **THEN** executor SHALL 返回结构化 tool execution result

#### Scenario: 未注册工具返回失败结果
- **WHEN** tool executor 收到未注册工具名称
- **THEN** executor SHALL 返回失败的 tool execution result
- **THEN** executor SHALL NOT 抛出未捕获异常中断 app

#### Scenario: arguments JSON 无效返回失败结果
- **WHEN** tool executor 收到无法解析为 JSON object 的 arguments 字符串
- **THEN** executor SHALL 返回失败的 tool execution result
- **THEN** 失败结果 SHALL 包含可回传模型的简洁错误说明

### Requirement: MCP tool handler
系统 SHALL 提供 MCP tool handler，用于把 provider-visible MCP namespace tool call 代理到对应 MCP server 的原始 tool。handler SHALL 接收现有 tool executor 解析出的 JSON object arguments，并 SHALL 返回现有 `ToolExecutionResult` 结构。

#### Scenario: MCP handler 调用对应 server tool
- **WHEN** MCP handler 收到 provider-visible tool name `mcp__server__tool`
- **THEN** handler SHALL 反查对应 MCP server 和原始 MCP tool name
- **THEN** handler SHALL 通过 MCP manager 调用该 server tool

#### Scenario: MCP handler 保留 call id 和 tool name
- **WHEN** MCP handler 返回 tool execution result
- **THEN** result SHALL 保留原始 provider tool call id
- **THEN** result SHALL 使用 provider-visible MCP namespace tool name 作为 `toolName`

#### Scenario: MCP handler 异常转失败结果
- **WHEN** MCP manager 调用抛出异常或返回不可用状态
- **THEN** handler SHALL 返回 `ok: false` 的 tool execution result
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

### Requirement: bash command tool
系统 SHALL 提供第一版本地 bash 工具 `run_bash_command`。该工具 SHALL 只执行非交互命令，SHALL 在当前工作区中运行，SHALL 捕获 stdout、stderr、exit code、耗时、可选 timeout 和截断状态，并 SHALL 把模型继续工作所需的信息格式化为紧凑 tool result 文本；完整执行状态 SHALL 继续保留在结构化 result 字段中。

#### Scenario: 执行成功的 bash 命令
- **WHEN** `run_bash_command` 收到 `{ "command": "pwd" }` 形式的有效参数
- **THEN** bash handler SHALL 使用非交互 shell 在当前工作区执行该命令
- **THEN** result SHALL 标记 `ok: true`
- **THEN** 如果 stdout 或 stderr 非空，result 文本 SHALL 包含对应输出
- **THEN** 如果 stdout 和 stderr 均为空，result 文本 SHALL 明确说明命令成功且无输出
- **THEN** result 文本 SHALL NOT 常态包含 command、duration、`timed_out: false` 或 `truncated: false`

#### Scenario: 非零退出码作为工具失败结果
- **WHEN** bash 命令以非零 exit code 结束
- **THEN** bash handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result SHALL 包含该 command、exit code、stdout 和 stderr
- **THEN** 系统 SHALL NOT 仅因非零 exit code 追加本地 `error` transcript record

#### Scenario: 显式 timeout 命令超时
- **WHEN** bash tool 配置了正整数 timeout
- **AND** bash 命令运行超过该 timeout
- **THEN** bash handler SHALL 终止该命令
- **THEN** result SHALL 标记 `timedOut: true` 且 `ok: false`
- **THEN** result 文本 SHALL 包含该 command 并明确说明 timeout

#### Scenario: 输出超过上限
- **WHEN** bash 命令 stdout 和 stderr 输出超过配置的 max output bytes
- **THEN** bash handler SHALL 截断回传文本
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 包含该 command 并明确说明输出已截断

#### Scenario: 不支持交互输入
- **WHEN** bash 命令尝试读取 stdin 或需要 TTY 交互
- **THEN** bash handler SHALL 不提供交互式 stdin 或 TTY
- **THEN** 命令 SHALL 只能通过退出、失败、用户中断或显式 timeout 结束

### Requirement: bash tool availability and execution limits
系统 SHALL 把当前已开发的 `run_bash_command` 暴露给模型。系统 SHALL 默认不为 bash tool 设置自动 timeout，SHALL 依赖 turn-level 中断信号响应用户 Esc；系统 SHALL 继续支持 max output bytes 限制，并 MAY 在用户显式配置正整数 timeoutMs 时启用命令 timeout。

#### Scenario: 默认暴露 bash tool
- **WHEN** 创建默认 tool registry
- **THEN** tool registry SHALL 包含 `run_bash_command`
- **THEN** OpenAI 请求 SHALL 可以发送该工具 schema

#### Scenario: 默认 bash tool 不自动超时
- **WHEN** bash tool 执行命令且未配置正整数 timeoutMs
- **THEN** executor 或 handler SHALL NOT 启动固定时长的 timeout timer
- **THEN** turn-level 取消信号触发时 handler SHALL 尽力终止正在运行的命令

#### Scenario: 应用显式 timeout 和输出上限
- **WHEN** bash tool 执行命令
- **THEN** executor 或 handler SHALL 使用配置的 max output bytes
- **THEN** 正整数 timeoutMs 配置 SHALL 作为显式 timeout 使用
- **THEN** 无效、缺失或 null timeoutMs SHALL 被归一化为无自动 timeout
- **THEN** 无效、缺失或越界 max output bytes 配置 SHALL 被归一化为安全默认值

### Requirement: plan mode readonly bash execution policy
系统 SHALL 在 plan mode 中对 provider tool call 应用只读执行策略。Provider-visible tool registry SHALL 与 normal mode 保持一致以稳定 tools schema；但 provider tool call 在进入 executor 前 SHALL 经过 mode-aware classifier。不符合 plan mode 只读策略的命令或写入型工具 SHALL 被拒绝且不得执行。

#### Scenario: Plan mode registry keeps default tool schema
- **WHEN** 系统为 plan mode 创建 provider-visible tool registry
- **THEN** registry SHALL 包含 normal mode 默认内置工具 definitions
- **AND** registry SHALL 包含 `run_bash_command`
- **AND** registry SHALL 包含 `apply_patch`
- **AND** registry SHALL 与 normal mode 在同一 MCP 状态下暴露相同的 provider-visible tool definition 集合

#### Scenario: Execute allowed readonly git command
- **WHEN** plan mode 下 `run_bash_command` 收到只读 git inspection 命令，例如 `git status --short` 或 `git diff --stat`
- **THEN** classifier SHALL 将该 tool call 判定为 safe
- **AND** executor SHALL 使用普通 bash handler 和共享 bash runner 执行该命令
- **AND** result SHALL 保留 stdout、stderr、exit code、可选 timeout、duration 和 truncated 等既有 bash result 语义

#### Scenario: Reject command outside readonly allowlist
- **WHEN** plan mode 下 `run_bash_command` 收到不在只读 allowlist 内的命令，例如 `npm test`、`git reset --hard HEAD` 或 `python script.py`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令
- **AND** runtime SHALL 返回 `ok: false` 的 tool result
- **AND** result 文本 SHALL 说明当前处于 plan mode，bash 只允许 readonly inspection 命令，并提示需要退出 plan mode 才能执行该命令

#### Scenario: Reject shell metacharacters that can cause side effects
- **WHEN** plan mode 下 `run_bash_command` 收到包含 shell 管道、重定向、多命令连接、命令替换或多行语法的命令
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject git options that write output or mutate repository state
- **WHEN** plan mode 下 `run_bash_command` 收到表面为只读 git 子命令但包含写入型参数或 mutation 子命令，例如 `git diff --output patch.txt`、`git fetch`、`git pull`、`git checkout branch`
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 调用 executor 执行该命令

#### Scenario: Reject write tools in plan mode
- **WHEN** plan mode 下 provider 返回 `apply_patch` 或等价写入型本地 tool call
- **THEN** classifier SHALL 将该 tool call 判定为 rejected
- **AND** runtime SHALL NOT 打开用户授权 surface
- **AND** runtime SHALL NOT 调用 executor 执行该 tool call
- **AND** runtime SHALL 返回 `ok: false` 的 tool result，说明需要退出 plan mode 才能修改文件或系统状态

#### Scenario: Normal mode bash remains unchanged
- **WHEN** 系统为 normal mode 创建默认 tool registry
- **THEN** `run_bash_command` SHALL 保持既有完整 bash tool 行为
- **AND** 高风险 bash 命令 SHALL 继续按既有 approval 策略处理
- **AND** `apply_patch` SHALL 继续按既有 approval 策略处理

### Requirement: apply_patch text editing tool
系统 SHALL 提供本地工具 `apply_patch`，用于应用受支持的 patch 文本来新增或更新 UTF-8 文本文件。该工具 SHALL 接收 JSON object 参数 `{ "patch": string }`，并 SHALL 返回可回传模型的结构化 tool execution result。

#### Scenario: 默认注册 apply_patch 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `apply_patch` 的 tool definition
- **THEN** 该 definition SHALL 要求 `patch` 字段为 string
- **THEN** 该 definition SHALL 声明工具应用 patch 到文本文件

#### Scenario: 应用更新已有文件的 unified diff
- **WHEN** `apply_patch` 收到针对已有文本文件的有效 unified diff
- **THEN** handler SHALL 根据 hunk 的 context lines 和 removed lines 在当前文件中寻找精确唯一匹配
- **THEN** handler SHALL 应用匹配 hunk 并写回更新后的文件内容
- **THEN** result SHALL 标记 `ok: true` 并包含 changed files summary

#### Scenario: 应用省略文件头的更新 patch
- **WHEN** `apply_patch` 收到 `diff --git a/<path> b/<path>` 后直接跟随 `@@` hunk 的 update patch
- **THEN** handler SHALL 从同路径 `diff --git` header 推断目标文件
- **THEN** handler SHALL 按普通 update hunk 的精确唯一匹配规则应用 patch
- **THEN** 如果 `diff --git` 的 old path 和 new path 不同，handler SHALL 拒绝该 patch 作为不支持的 rename/move

#### Scenario: 应用新增文件的 unified diff
- **WHEN** `apply_patch` 收到 `--- /dev/null` 到 `+++ b/<path>` 的有效新增文件 patch
- **THEN** handler SHALL 创建该文本文件
- **THEN** handler SHALL 在必要时创建父目录
- **THEN** 如果目标文件已存在，handler SHALL 返回 `ok: false` 且不得覆盖该文件

#### Scenario: 应用 Begin Patch 新增文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Add File: <path>` / `*** End Patch` 格式的有效新增文件 patch
- **THEN** handler SHALL 创建该文本文件
- **THEN** handler SHALL 将 `+` 前缀行作为新增文件内容
- **THEN** handler SHALL 复用相同路径校验和目标已存在检查

#### Scenario: 应用 Begin Patch 更新文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Update File: <path>` / `*** End Patch` 格式的有效更新文件 patch
- **THEN** handler SHALL 将该 patch 转换为 update chunk 序列
- **THEN** handler SHALL 按 Begin Patch 顺序定位规则应用 chunk
- **THEN** handler SHALL 为该文件维护搜索游标，并从当前游标之后选择第一个精确匹配来定位 anchor、context-only chunk 或修改 chunk
- **THEN** handler SHALL 在每个匹配或替换后推进搜索游标，使后续 chunk 从已处理区域之后继续定位
- **THEN** handler SHALL 将 Begin Patch hunk body 每行第一列解析为操作符，并将第二列开始的内容作为文件文本保留，包括以 `+`、`-`、`@@` 或 `***` 开头的内容
- **THEN** handler SHALL 复用相同 all-or-nothing 写入语义

#### Scenario: Begin Patch context-only chunk 作为后续定位锚点
- **WHEN** `apply_patch` 收到 Begin Patch update，且其中一个 `@@` chunk 只包含 context lines
- **THEN** handler SHALL 接受该 chunk 作为定位锚点
- **THEN** handler SHALL 在当前搜索游标之后为该 context-only chunk 寻找第一个精确匹配
- **THEN** handler SHALL 从该匹配位置之后继续定位后续 chunk
- **THEN** handler SHALL NOT 因同一 context 在后续文件内容中再次出现而返回 multi match 失败
- **THEN** handler SHALL NOT 因该 chunk 自身没有新增或删除行而返回语法失败

#### Scenario: Begin Patch inline context anchor
- **WHEN** `apply_patch` 收到 Begin Patch update，且 chunk header 为 `@@ <context>`
- **THEN** handler SHALL 将 `<context>` 作为单行定位锚点
- **THEN** handler SHALL 在当前搜索游标之后寻找第一个匹配的锚点行
- **THEN** 如果该 chunk 只包含新增行，handler SHALL 在锚点行之后插入新增内容
- **THEN** 如果该 chunk 包含 context lines 或 removed lines，handler SHALL 从锚点行之后继续匹配并应用该 chunk
- **THEN** handler SHALL 在锚点匹配失败时拒绝应用该 patch
- **THEN** handler SHALL NOT 因同一锚点在后续文件内容中再次出现而返回 multi match 失败

#### Scenario: 拒绝无锚点纯插入
- **WHEN** `apply_patch` 收到 Begin Patch update，且修改 chunk 只有新增行、没有 inline context anchor、没有 context lines、也没有 removed lines
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件并在插入位置周围加入上下文
- **THEN** handler SHALL 不写入任何文件

#### Scenario: 拒绝无实际修改的 Begin Patch update
- **WHEN** `apply_patch` 收到 Begin Patch update，且该文件操作只包含 context-only chunk
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入任何文件

#### Scenario: 多文件 patch 以 all-or-nothing 方式应用
- **WHEN** `apply_patch` 收到包含多个文件操作的 patch
- **THEN** handler SHALL 先在内存中解析、校验并应用全部操作
- **THEN** 只有全部操作成功时，handler SHALL 写入所有目标文件
- **THEN** 任一操作失败时，handler SHALL 不写入任何目标文件

#### Scenario: 路径解析和基础路径拒绝
- **WHEN** patch 文件路径是相对路径
- **THEN** handler SHALL 按当前工作目录解析该路径
- **WHEN** patch 文件路径是绝对路径或包含 `..` 的相对路径
- **THEN** handler SHALL 允许该路径并解析到对应绝对路径
- **WHEN** patch 文件路径包含 NUL 或指向 `.git` 内部路径
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入任何文件

#### Scenario: hunk 匹配失败或歧义时拒绝应用
- **WHEN** unified diff update hunk 在目标文件中匹配 0 次或匹配多次
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件或增加上下文
- **THEN** handler SHALL 不写入任何文件
- **WHEN** Begin Patch update chunk 在当前搜索游标之后匹配 0 次
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件或增加上下文
- **THEN** handler SHALL 不写入任何文件

#### Scenario: 拒绝第一版不支持的 patch 类型
- **WHEN** patch 表达删除文件、重命名/移动文件、mode/chmod change、binary patch 或 symlink patch
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 明确说明该 patch 类型不受支持
- **THEN** handler SHALL 不写入任何文件

#### Scenario: patch 输入无效时返回工具失败结果
- **WHEN** `apply_patch` 收到空 patch、非 unified diff 文本、缺少目标路径或格式无法解析的 hunk
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁失败原因

#### Scenario: 限制 patch 和文件规模
- **WHEN** patch 文本、单个目标文件、文件数量或 hunk 数量超过内置安全上限
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入任何文件

### Requirement: ask_user_questions 工具注册
系统 SHALL 在默认本地 tool registry 中注册 `ask_user_questions` 工具定义，使 provider request 可以携带该 function tool schema。该工具的用户交互执行 SHALL 由 agent loop/app callback 处理，而不是由普通 tool executor handler 直接访问 TUI 状态。

#### Scenario: 默认 registry 包含 ask_user_questions
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `ask_user_questions` 的 tool definition
- **THEN** OpenAI 请求 SHALL 可以发送该工具 schema

#### Scenario: ask_user_questions 不通过普通 executor 访问 UI
- **WHEN** agent loop 收到 `ask_user_questions` tool call
- **THEN** 系统 SHALL 通过 interactive tool callback 获取用户回答
- **THEN** 普通 tool executor SHALL NOT 直接读取 TUI 输入或持有用户问题 UI 状态

### Requirement: use_skill 本地工具
系统 SHALL 在默认本地 tool registry 中注册 `use_skill` 工具。该工具 SHALL 接收 JSON object 参数 `{ "name": string, "arguments"?: string | null }`，并 SHALL 返回指定 skill 的完整 markdown 内容作为普通 tool execution result。

#### Scenario: 默认注册 use_skill 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `use_skill` 的 tool definition
- **THEN** 该 definition SHALL 要求 `name` 字段为 string
- **THEN** 该 definition SHALL 允许 `arguments` 字段为 string 或 null

#### Scenario: 执行 use_skill 成功
- **WHEN** `use_skill` 收到已发现的 skill 名称
- **THEN** handler SHALL 读取该 skill 的 `SKILL.md`
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含 skill 名称、来源路径和正文内容

#### Scenario: 执行 use_skill 失败
- **WHEN** `use_skill` 收到空名称、非 string 名称、未知名称或无法读取的 skill
- **THEN** handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result 文本 SHALL 包含简洁失败原因
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: use_skill result 参与 agent continuation
- **WHEN** `use_skill` 执行完成并返回 tool result
- **THEN** agent loop runtime SHALL 追加对应 `tool_call` record 和 `tool_result` record
- **THEN** 后续 provider continuation SHALL 能接收该 skill 内容作为 function call output

### Requirement: apply_patch display metadata
`apply_patch` handler SHALL 为成功解析的 patch input 生成 display-only metadata，使 TUI 可以基于完整事实行序列展示实际编辑结构和可信位置，而无需重新解析 patch 文本或在渲染时读取目标文件。该 metadata SHALL 保持 provider-facing result text 和 patch 执行语义不变。

#### Scenario: 生成完整文件事实行
- **WHEN** `apply_patch` 成功解析 patch input
- **THEN** handler SHALL 为每个成功应用的 update file 记录覆盖完整 post-image 文件的有序 context/added 行
- **THEN** handler SHALL 在对应修改位置插入 removed 行
- **THEN** handler SHALL NOT 在 metadata 中预先折叠 context 或生成 omitted rows
- **THEN** display metadata SHALL NOT 包含只用于版本兼容的 schema version 字段

#### Scenario: 记录成功定位的 update hunk
- **WHEN** `apply_patch` 在目标文件中为 update hunk 找到精确唯一匹配
- **THEN** handler SHALL 按实际匹配位置记录该 hunk 的 context、removed 和 added 展示行
- **THEN** handler SHALL 记录 renderer 推导修改后文件真实行号所需的位置信息
- **THEN** handler SHALL NOT 使用 patch header 中声明的行号替代实际匹配位置
- **THEN** handler SHALL 保持展示行的编辑顺序

#### Scenario: 记录修改区块周边上下文
- **WHEN** update hunk 成功定位
- **THEN** handler SHALL 记录目标文件中的全部未修改 context 行
- **THEN** handler SHALL 保持每个 post-image 文件行只出现一次
- **THEN** renderer SHALL 能够只使用 metadata 计算任意修改区块前后的 context 和省略数量

#### Scenario: 使用修改后文件的行号推进语义
- **WHEN** handler 为成功定位的 hunk 生成 display metadata
- **THEN** context 行 SHALL 对应一个修改后文件真实行号并推进一个行号
- **THEN** added 行 SHALL 对应并占用一个修改后文件真实行号
- **THEN** removed 行 SHALL NOT 占用修改后文件行号
- **THEN** 后续 context 的真实行号 SHALL 包含此前 added 行造成的推进并排除 removed 行

#### Scenario: 记录新增文件内容
- **WHEN** `apply_patch` 成功解析 added file patch
- **THEN** handler SHALL 将每个文件内容行记录为 added 展示行
- **THEN** added 行的修改后文件位置 SHALL 从第 1 行开始依次推进
- **THEN** handler SHALL NOT 将 `*** Add File`、`---`、`+++` 或 hunk header 等 patch 语法记录为展示行

#### Scenario: display metadata 不改变执行语义
- **WHEN** `apply_patch` 成功应用 patch
- **THEN** result SHALL 保留现有包含 changed files summary 的 provider-facing success text
- **THEN** result SHALL 包含供 TUI 使用的 display-only metadata
- **THEN** handler SHALL 继续使用 `oldLines` 和 `newLines` 执行精确 hunk 匹配和文件写入
- **THEN** display metadata SHALL NOT 作为 provider continuation 的 tool result text

#### Scenario: 匹配失败时不伪造位置
- **WHEN** patch 已成功解析但 update hunk 匹配 0 个或多个位置
- **THEN** result SHALL 保持 `ok: false` 和现有简洁失败原因
- **THEN** result MAY 包含解析得到的尝试编辑内容
- **THEN** display metadata 中无法定位的行 SHALL 使用 `postLine: null`
- **THEN** display metadata SHALL NOT 把 patch header 行号记录为真实匹配位置
- **THEN** display metadata SHALL NOT 包含无法确认的目标文件周边上下文
- **THEN** handler SHALL NOT 写入部分文件变更

#### Scenario: 写入失败时保留已模拟的展示结构
- **WHEN** 所有 hunk 已在内存中成功定位和模拟但文件写入失败
- **THEN** result SHALL 保持 `ok: false` 和写入失败原因
- **THEN** result MAY 保留基于内存模拟产生的实际位置和上下文 metadata
- **THEN** handler SHALL NOT 将 display metadata 作为文件已成功写入的证明

#### Scenario: 解析失败时安全降级
- **WHEN** `apply_patch` 无法将 patch input 解析为支持的操作
- **THEN** result SHALL 保持 `ok: false` 和现有简洁解析失败原因
- **THEN** result SHALL NOT require display metadata

### Requirement: grep local text search tool
系统 SHALL 提供本地工具 `grep`，用于在本地文件中搜索文本并返回结构化、受限的匹配结果。该工具 SHALL 接收 JSON object 参数 `{ "pattern": string, "paths"?: string[] | null, "glob"?: string | null, "literal"?: boolean | null, "case_sensitive"?: boolean | null }`。该工具 SHALL 使用本地 ripgrep 执行搜索，但 SHALL NOT 通过 shell 拼接命令。

#### Scenario: 默认注册 grep 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `grep` 的 tool definition
- **THEN** 该 definition SHALL 要求 `pattern` 字段为 string
- **THEN** 该 definition SHALL 允许 `paths`、`glob`、`literal` 和 `case_sensitive` 字段为对应类型或 null

#### Scenario: 固定字符串搜索
- **WHEN** `grep` 收到有效 `pattern` 且 `literal` 为 true 或 null
- **THEN** handler SHALL 使用 ripgrep fixed-string 搜索语义
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 以紧凑列表返回匹配文件路径、1-based 行号、1-based 列号和命中行文本
- **THEN** result 文本 SHALL NOT 常态回显 pattern、paths、glob、literal 或 case_sensitive

#### Scenario: 正则搜索
- **WHEN** `grep` 收到有效 `pattern` 且 `literal` 为 false
- **THEN** handler SHALL 使用 ripgrep regex 搜索语义
- **THEN** 如果 ripgrep 报告正则错误，handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁错误原因

#### Scenario: 限定搜索路径和 glob
- **WHEN** `grep` 收到 `paths` 或 `glob`
- **THEN** handler SHALL 将搜索范围限制在这些路径或 glob 匹配的文件内
- **THEN** handler SHALL 按当前工作目录解析相对路径
- **THEN** handler SHALL 允许绝对路径和包含 `..` 的路径

#### Scenario: 无匹配不是工具失败
- **WHEN** ripgrep 完成搜索且没有找到匹配
- **THEN** handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 显示没有找到匹配
- **THEN** 系统 SHALL NOT 仅因无匹配追加本地 error transcript record

#### Scenario: 限制返回匹配数量
- **WHEN** 匹配数量超过内置 `DEFAULT_MAX_MATCHES`
- **THEN** handler SHALL 只返回前 `DEFAULT_MAX_MATCHES` 条匹配
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 标记 `has_more: true` 并提示收窄搜索范围或 pattern

#### Scenario: 路径拒绝和输入错误
- **WHEN** `pattern` 为空、`paths` 不是 string array、`glob` 类型无效、路径包含 NUL 或路径指向 `.git` 内部
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含对应的简洁失败原因

#### Scenario: ripgrep 不可用或运行失败
- **WHEN** 本机找不到 `rg` 可执行文件或 ripgrep 以搜索错误退出
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含可回传模型的简洁错误说明

### Requirement: glob local file discovery tool
系统 SHALL 提供本地工具 `glob`，用于按 glob pattern 在本地文件系统中发现文件路径并返回结构化、受限的结果。该工具 SHALL 接收 JSON object 参数 `{ "pattern": string, "paths"?: string[] | null }`。该工具 SHALL 使用本地 ripgrep 的 file listing 能力执行发现，但 SHALL NOT 通过 shell 拼接命令。

#### Scenario: 默认注册 glob 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `glob` 的 tool definition
- **THEN** 该 definition SHALL 要求 `pattern` 字段为 string
- **THEN** 该 definition SHALL 允许 `paths` 字段为 string array 或 null

#### Scenario: 按 pattern 发现文件路径
- **WHEN** `glob` 收到有效 `pattern` 且 `paths` 为 null
- **THEN** handler SHALL 在当前工作目录下发现匹配该 pattern 的文件路径
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 以紧凑列表返回匹配文件路径
- **THEN** result 文本 SHALL NOT 常态回显 pattern、paths、returned_paths 或 `has_more: false`

#### Scenario: 限定搜索根路径
- **WHEN** `glob` 收到有效 `paths`
- **THEN** handler SHALL 将文件发现范围限制在这些路径内
- **THEN** handler SHALL 按当前工作目录解析相对路径
- **THEN** handler SHALL 允许绝对路径和包含 `..` 的路径

#### Scenario: 发现 hidden 文件但不返回 git 内部路径
- **WHEN** glob pattern 匹配 hidden 文件路径
- **THEN** handler SHALL 能返回非 `.git` 内部的 hidden 文件路径
- **WHEN** glob pattern 或搜索根会触达 `.git` 内部路径
- **THEN** handler SHALL 拒绝该输入或过滤 `.git` 内部返回路径

#### Scenario: 无匹配不是工具失败
- **WHEN** 文件发现完成且没有找到匹配路径
- **THEN** handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 显示没有匹配文件
- **THEN** 系统 SHALL NOT 仅因无匹配追加本地 error transcript record

#### Scenario: 限制返回路径数量
- **WHEN** 匹配路径数量超过内置 `DEFAULT_MAX_PATHS`
- **THEN** handler SHALL 只返回前 `DEFAULT_MAX_PATHS` 条路径
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 标记 `has_more: true` 并提示收窄 pattern 或 paths

#### Scenario: 路径拒绝和输入错误
- **WHEN** `pattern` 为空、`paths` 不是 string array、pattern 或路径包含 NUL，或路径指向 `.git` 内部
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含对应的简洁失败原因

#### Scenario: ripgrep 不可用或运行失败
- **WHEN** 本机找不到 `rg` 可执行文件或 ripgrep 以文件发现错误退出
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含可回传模型的简洁错误说明

### Requirement: read_files local file reading tool
系统 SHALL 提供本地工具 `read_files`，用于按已知路径读取一个或多个本地文件。该工具 SHALL 接收 JSON object 参数 `{ "files": Array<{ "path": string, "offset"?: number, "limit"?: number }> }`，并 SHALL 返回可回传模型的 bounded tool execution result。`offset` 与 `limit` SHALL 仅对文本文件读取生效；图片 reader 和 PDF 文字提取 reader SHALL 忽略这些字段而不把字段本身视为错误。文本文件结果 SHALL 在内容块中包含真实的 1-based 文件行号。受支持图片文件 result SHALL 携带 provider-neutral 图片附件并在文本中给出简短附件摘要。PDF 文件 result SHALL 包含可提取文字内容和必要页数摘要；handler SHALL NOT 把图片、PDF 原始二进制内容或 base64 原样写入 result 文本。

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

#### Scenario: 读取受支持图片文件
- **WHEN** `read_files` 收到 PNG、JPEG、GIF 或 WebP 图片文件路径
- **THEN** handler SHALL 按当前工作目录解析路径并读取该图片文件
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含图片路径、size bytes 和图片已附加的简短摘要
- **THEN** result SHALL 携带一个 `kind: image` 的 provider-neutral 附件，包含 media type、base64 图片数据、path 和 size bytes
- **THEN** result 文本 SHALL NOT 包含完整 base64 图片数据或原始二进制内容

#### Scenario: 图片读取忽略 offset 和 limit
- **WHEN** `read_files` 收到图片 file item 且该 item 包含 `offset` 或 `limit`
- **THEN** handler SHALL NOT 因这些字段额外失败
- **THEN** handler SHALL 忽略这些字段读取完整图片附件
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
- **THEN** handler SHALL 按输入顺序读取每个文件
- **THEN** result 文本 SHALL 为每个文件生成独立但紧凑的文件段落
- **THEN** 成功读取的图片文件 SHALL 按输入顺序追加对应图片附件
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

#### Scenario: 限制读取规模、图片规模、PDF 规模和输出规模
- **WHEN** files 数量、单文件本次返回文本内容 bytes、单张图片 bytes、单个 PDF bytes 或总输出 bytes 超过内置安全上限
- **THEN** handler SHALL 返回 `ok: false` 或在安全边界内截断输出
- **THEN** result 文本 SHALL 明确说明失败或截断原因
- **THEN** result SHALL 在发生文本输出截断或 PDF 提取文本截断时标记 `truncated: true`
- **THEN** handler SHALL NOT 生成被截断或不完整的图片附件

### Requirement: web_fetch remote content retrieval tool
系统 SHALL 提供本地工具 `web_fetch`，用于读取一个明确 HTTP(S) URL 的远程内容并返回结构化、受限的文本结果。该工具 SHALL 接收 JSON object 参数 `{ "url": string, "offset"?: number | null, "limit"?: number | null }`。该工具 SHALL 只执行 GET 请求，SHALL NOT 支持搜索、浏览器渲染、自定义 headers、cookies、认证或批量 URL 抓取。

#### Scenario: 默认注册 web_fetch 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `web_fetch` 的 tool definition
- **THEN** 该 definition SHALL 要求 `url` 字段为 string
- **THEN** 该 definition SHALL 允许 `offset` 和 `limit` 字段为 number 或 null

#### Scenario: URL 输入安全校验
- **WHEN** `web_fetch` 收到 URL 参数
- **THEN** handler SHALL 要求该 URL 是 absolute `http` 或 `https` URL
- **THEN** handler SHALL 拒绝包含 credentials、空 host、localhost、loopback、link-local、metadata、unspecified 或 multicast 目标的 URL
- **THEN** handler SHALL 对无效 URL 返回 `ok: false` 且包含简洁失败原因

#### Scenario: 执行 GET 请求并返回文本响应
- **WHEN** `web_fetch` 收到有效 URL 且远端返回成功的文本类响应
- **THEN** handler SHALL 执行 GET 请求
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含最终可见 URL、HTTP status 和 content
- **THEN** result 文本 SHALL NOT 常态包含 fetched_bytes、body_truncated false、redirected false、offset、limit、returned_lines 或 `truncated: false`

#### Scenario: HTML 响应投影为可读文本
- **WHEN** `web_fetch` 收到 `text/html` 响应
- **THEN** handler SHALL 将 HTML 轻量投影为可读文本
- **THEN** handler SHALL 移除 script、style、noscript、template 和 svg 内容
- **THEN** handler SHALL 解码常见 HTML entities 并折叠多余空白

#### Scenario: 文本分页和输出限制
- **WHEN** `web_fetch` 收到 `offset` 或 `limit`
- **THEN** handler SHALL 将 `offset` 解释为最终文本的 0-based 行偏移
- **THEN** handler SHALL 最多返回 `limit` 行内容
- **WHEN** 响应 body bytes 或 tool result 输出 bytes 超过内置上限
- **THEN** handler SHALL 在安全边界内截断输出或返回失败
- **THEN** result SHALL 在发生截断时标记 `truncated: true` 或 `body_truncated: true`
- **THEN** result 文本 SHALL 在后续仍有内容时包含 `has_more: true`

#### Scenario: Redirect 重新校验
- **WHEN** 远端返回 HTTP redirect
- **THEN** handler SHALL 在内置 redirect 上限内解析 Location 并继续请求
- **THEN** handler SHALL 对每个 redirect 目标重新执行 URL 安全校验
- **THEN** redirect 超过上限或 redirect 目标不安全时 handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 在最终 URL 与请求 URL 不同时包含 final URL

#### Scenario: HTTP 错误保留有限响应摘要
- **WHEN** 远端返回非 2xx HTTP 状态且响应是支持的文本类内容
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含 HTTP status 和有限响应 body 摘要
- **THEN** 系统 SHALL NOT 仅因 HTTP 错误追加本地 error transcript record

#### Scenario: 非文本媒体不输出二进制内容
- **WHEN** 远端返回图片、PDF、压缩包、音视频或其他非文本媒体类型
- **THEN** handler SHALL 返回该响应的 url、status 和 content_type metadata
- **THEN** handler SHALL 返回 unsupported 说明
- **THEN** handler SHALL NOT 把二进制内容原样写入 result 文本

#### Scenario: 网络失败和超时
- **WHEN** 请求发生 DNS、连接、TLS、读取错误或超过内置 timeout
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含可回传模型的简洁错误说明
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

### Requirement: web_search public web search tool
系统 SHALL 提供本地工具 `web_search`，用于在无需 API key 的情况下通过公共 HTML 搜索页面执行 best-effort 网页搜索，并返回结构化、受限的文本结果。该工具 SHALL 接收 JSON object 参数 `{ "query": string, "count"?: number | null, "offset"?: number | null, "market"?: string | null, "safe_search"?: string | null }`。该工具 SHALL NOT 使用官方搜索 API、用户登录态、cookies、浏览器自动化、代理池或反爬绕过机制。该工具 SHALL 保留多词 query 语义，SHALL 对搜索结果做确定性质量评估，并 SHALL 在结果明显低质量时执行有界重搜和搜索源 fallback。

#### Scenario: 默认注册 web_search 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `web_search` 的 tool definition
- **THEN** 该 definition SHALL 要求 `query` 字段为 string
- **THEN** 该 definition SHALL 允许 `count`、`offset`、`market` 和 `safe_search` 字段为对应类型或 null

#### Scenario: 查询输入校验
- **WHEN** `web_search` 收到空 query、非 string query、超出内置长度上限的 query、无效 count、无效 offset、无效 market 或无效 safe_search
- **THEN** handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result 文本 SHALL 包含对应的简洁失败原因
- **THEN** handler SHALL NOT 发起远程搜索请求

#### Scenario: 执行公共搜索页请求
- **WHEN** `web_search` 收到有效查询参数
- **THEN** handler SHALL 优先向公共 Bing 搜索页面发起有界 GET 请求
- **THEN** handler MAY 在 Bing 结果质量仍低时向公共 DuckDuckGo HTML 搜索页面发起 fallback GET 请求
- **THEN** handler SHALL 使用内置 timeout 限制请求耗时
- **THEN** handler SHALL 使用内置响应体 bytes 上限限制读取规模
- **THEN** handler SHALL NOT 携带 API key、登录 cookie、用户凭据或自定义认证信息

#### Scenario: multi-term query 编码
- **WHEN** `web_search` 构造公共搜索页 URL 且 query 包含空格、中文或其他需要转义的字符
- **THEN** handler SHALL 对 query 参数使用严格百分号编码以保留完整 query 语义
- **THEN** 空格 SHALL 编码为 `%20` 而不是 `+`
- **THEN** handler SHALL NOT 让多词 query 在请求 URL 中退化为只表达第一个 token

#### Scenario: 解析自然网页搜索结果
- **WHEN** 公共搜索页返回可解析的自然网页结果 HTML
- **THEN** handler SHALL 对每条候选结果解析 title、url 和 snippet
- **THEN** handler SHALL 对标题和摘要做轻量 HTML 文本化、常见 HTML entity 解码和空白折叠
- **THEN** handler SHALL 在返回前对候选结果做 query 相关性质量评估

#### Scenario: 过滤不可用结果 URL
- **WHEN** 解析出的候选结果 URL 为空、不是 HTTP(S) URL、指向脚本 URL、指向 Bing 内部跳转或与已返回结果重复
- **THEN** handler SHALL 跳过该候选结果
- **THEN** handler SHALL NOT 把不可用 URL 写入 result 文本

#### Scenario: 搜索结果质量评估
- **WHEN** `web_search` 已解析出自然网页候选结果
- **THEN** handler SHALL 从 query 中提取确定性的结构化匹配项
- **THEN** handler SHALL 根据 title、snippet 和 URL 对每条结果计算相关性覆盖
- **THEN** handler SHALL 识别 query token 缺失或显式 `site:` host 不匹配的低质量结果集
- **THEN** handler SHALL NOT 使用 LLM 或外部服务判断结果质量

#### Scenario: 低质量结果触发重搜
- **WHEN** 一次搜索返回空结果、被拦截/不可解析页面、或质量评估为低质量
- **THEN** handler SHALL 使用原始 query 进入下一个 provider 或 Bing English fallback
- **THEN** handler SHALL 在结果质量达到可接受水平后停止继续重搜
- **THEN** handler SHALL NOT 自动生成短语、`site:` 或领域术语 query variants

#### Scenario: 多次尝试结果合并
- **WHEN** 多次搜索尝试产生候选结果
- **THEN** handler SHALL 按规范化 URL 去重
- **THEN** handler SHALL 优先返回相关性更高的结果
- **THEN** result 文本 SHALL 按最终排序返回每条结果的 title、url 和 snippet
- **THEN** result 文本 SHALL NOT 常态包含 relevance score、provider、attempts、fetched bytes 或 body truncation false metadata

#### Scenario: 搜索结果数量限制
- **WHEN** 可解析结果数量超过请求 count 或内置最大结果数
- **THEN** handler SHALL 只返回允许范围内的前序结果
- **THEN** result SHALL 在输出被限制时标记 `truncated: true`

#### Scenario: 异常搜索页或反爬页面
- **WHEN** 公共搜索页返回验证码、反爬、登录墙、地区提示、异常 HTML 或无法识别的结构
- **THEN** handler SHALL 在仍有 provider fallback 可尝试时继续执行下一次有界重搜
- **THEN** 如果所有尝试都无法得到可用候选结果，handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result 文本 SHALL 说明公共搜索页不可解析或被拦截
- **THEN** handler SHALL NOT 输出原始 HTML
- **THEN** handler SHALL NOT 尝试绕过验证码、反爬或登录限制

#### Scenario: 无自然结果不是工具运行异常
- **WHEN** 公共搜索页可解析但没有自然网页结果
- **THEN** handler SHALL 在仍有 provider fallback 可尝试时继续执行下一次有界重搜
- **THEN** 如果所有尝试都没有自然结果，handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 显示没有搜索结果
- **THEN** 系统 SHALL NOT 仅因无结果追加本地 error transcript record

#### Scenario: 低质量但有结果的最终返回
- **WHEN** handler 已执行 provider fallback 后仍只得到低质量候选结果
- **THEN** handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 标记低质量 warning
- **THEN** result 文本 SHALL 提示结果可能不相关并列出缺失的关键 query terms

#### Scenario: 网络失败、HTTP 错误和超时
- **WHEN** 搜索请求发生 DNS、连接、TLS、读取错误、非成功 HTTP 状态或超过内置 timeout
- **THEN** handler SHALL 在仍有 provider fallback 可尝试时继续执行下一次有界重搜
- **THEN** 如果所有尝试都失败且没有可用候选结果，handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含可回传模型的简洁错误说明
- **THEN** result SHALL 在超时时标记 `timedOut: true`
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: 输出质量 metadata
- **WHEN** `web_search` 返回可接受质量的普通搜索结果
- **THEN** result 文本 SHALL 主要包含 title、url 和 snippet
- **THEN** result 文本 SHALL NOT 常态包含 provider、attempts、quality_score、matched_query_terms 或 missing_query_terms metadata
- **WHEN** `web_search` 返回低质量结果、被截断结果或 fallback 诊断有助于模型判断可靠性
- **THEN** result 文本 SHALL 包含必要的 warning、missing query terms 或截断提示

#### Scenario: 输出规模限制
- **WHEN** 格式化后的 tool result 文本超过内置总输出 bytes 上限
- **THEN** handler SHALL 在安全边界内截断输出
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 包含截断提示

#### Scenario: tool result 参与 agent continuation
- **WHEN** `web_search` 执行完成并返回 tool result
- **THEN** agent loop runtime SHALL 追加对应 `tool_call` record 和 `tool_result` record
- **THEN** `tool_result` record SHALL 保留 `ok`、`timedOut` 和 `truncated` metadata
- **THEN** 后续 provider continuation SHALL 能接收该搜索结果文本作为 function call output

### Requirement: bash 工具执行前高危拦截
系统 SHALL 在执行 `run_bash_command` 的普通 handler 前支持上层风险分类拦截。bash handler SHALL 继续只负责非交互命令执行和结果归一化，不直接读取 TUI 输入或持有授权状态。

#### Scenario: 高危 bash 在 handler 前被拦截
- **WHEN** agent loop runtime 收到被分类为需要授权的 `run_bash_command` tool call
- **THEN** 系统 SHALL 在调用 bash handler 前请求用户授权
- **THEN** 用户拒绝时 bash handler SHALL NOT 被调用

#### Scenario: 安全 bash 继续普通执行
- **WHEN** agent loop runtime 收到被分类为可直接执行的 `run_bash_command` tool call
- **THEN** 系统 SHALL 通过普通 tool executor 调用 bash handler
- **THEN** bash handler SHALL 保持现有 stdout、stderr、exit code、可选 timeout 和截断结果语义

#### Scenario: 风险分类不改变 bash handler 契约
- **WHEN** bash handler 被普通 tool executor 调用
- **THEN** handler SHALL 继续接收已解析的 JSON object 参数和原始 tool call
- **THEN** handler SHALL NOT 依赖 app callback、choice surface 或用户授权上下文

### Requirement: use_skill 尊重 skill 启用状态
`use_skill` 工具 SHALL 只加载当前 enabled skill。对于 discovered 但 disabled 的 skill，handler SHALL 返回失败的 tool execution result，并 SHALL NOT 返回完整 skill 正文。

#### Scenario: use_skill 加载 disabled skill 失败
- **WHEN** `use_skill` 收到名称匹配 disabled skill 的参数
- **THEN** handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result 文本 SHALL 明确说明该 skill 当前 disabled
- **THEN** result 文本 SHALL 提示可通过 `/skills` 启用
- **THEN** result 文本 SHALL NOT 包含该 skill 的完整正文

#### Scenario: use_skill 只列出 enabled 可用项
- **WHEN** `use_skill` 收到未知 skill 名称并返回可用 skill 列表
- **THEN** 该列表 SHALL 只包含 enabled skills
- **THEN** disabled skills SHALL NOT 作为可加载项提供给模型

### Requirement: compact provider-visible local tool result text
系统 SHALL 让内置本地工具的 `tool_result.text` 优先包含模型继续任务所需的观察结果，并避免常态输出已存在于 tool call arguments 的入参、默认值、false 状态和纯调试 metadata。系统 MAY 在 `ToolExecutionResult` 或 transcript record 的结构化字段中继续保留 exit code、duration、timeout、truncated、display 和 attachments 等本地状态。

#### Scenario: 成功结果不回显普通入参
- **WHEN** 内置工具成功执行且没有分页、截断、timeout、低质量、redirect、非零退出码或 warning 状态
- **THEN** result 文本 SHALL NOT 常态回显模型刚传入的 pattern、paths、glob、literal、case_sensitive、offset、limit、url 或 command 等普通入参
- **THEN** result 文本 SHALL 聚焦返回路径、匹配行、文件内容、网页内容、搜索结果或 patch 变更摘要

#### Scenario: 异常和不完整结果保留可行动状态
- **WHEN** 工具结果失败、超时、截断、还有更多内容、搜索低质量、HTTP 非 2xx 或 bash 非零退出
- **THEN** result 文本 SHALL 包含模型能据此修复或继续操作的简洁状态和原因
- **THEN** result 文本 SHALL NOT 为省 token 删除失败 reason、patch hint、`has_more: true`、`truncated: true`、`timed_out: true` 或非零 `exit_code`
- **THEN** bash 失败、超时或截断结果文本 SHALL 保留原始 `command` 以便脱离 tool call 仍可定位失败命令

#### Scenario: 结构化字段不因文本精简而丢失
- **WHEN** handler 生成紧凑 result 文本
- **THEN** result SHALL 继续在结构化字段中保留该工具已有的 `ok`、`truncated`、`timedOut`、`exitCode`、`durationMs`、`attachments` 或 `display` 信息
- **THEN** provider transcript converter SHALL 继续只把 `tool_result.text` 作为 function/tool output 文本注入模型

