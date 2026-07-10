## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: bash command tool
系统 SHALL 提供第一版本地 bash 工具 `run_bash_command`。该工具 SHALL 只执行非交互命令，SHALL 在当前工作区中运行，SHALL 捕获 stdout、stderr、exit code、耗时、timeout 和截断状态，并 SHALL 把模型继续工作所需的信息格式化为紧凑 tool result 文本；完整执行状态 SHALL 继续保留在结构化 result 字段中。

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

#### Scenario: 命令超时
- **WHEN** bash 命令运行超过配置的 timeout
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
- **THEN** 命令 SHALL 只能通过退出、失败或 timeout 结束

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
