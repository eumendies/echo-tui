## MODIFIED Requirements

### Requirement: bash command tool
系统 SHALL 提供第一版本地 bash 工具 `run_bash_command`。该工具 SHALL 只执行非交互命令，SHALL 在当前工作区中运行，SHALL 捕获 stdout、stderr、exit code、耗时、可选 timeout 和截断状态，并 SHALL 把模型继续工作所需的信息格式化为紧凑 tool result 文本；完整执行状态 SHALL 继续保留在结构化 result 字段中。输出超过模型可见上限时，共享 runner SHALL 把完整已采集终端输出转存到当前项目分区的用户级文件，并 SHALL 让 tool result 保留输出尾部。

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

#### Scenario: 输出超过上限且转存成功
- **WHEN** bash 命令 stdout、stderr 或合并终端输出超过配置的 max output bytes
- **AND** 共享 runner 成功创建 offloading 文件
- **THEN** runner SHALL 把完整已采集终端输出写入该文件
- **THEN** bash handler SHALL 返回以 `[tool result truncated: <absolute-path>]` 开始的尾部预览
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 包含该 command 和 exit code

#### Scenario: 不支持交互输入
- **WHEN** bash 命令尝试读取 stdin 或需要 TTY 交互
- **THEN** bash handler SHALL 不提供交互式 stdin 或 TTY
- **THEN** 命令 SHALL 只能通过退出、失败、用户中断或显式 timeout 结束

### Requirement: web_fetch remote content retrieval tool
系统 SHALL 提供本地工具 `web_fetch`，用于读取一个明确 HTTP(S) URL 的远程内容并返回结构化、受限的文本结果。该工具 SHALL 接收 JSON object 参数 `{ "url": string, "offset"?: number | null, "limit"?: number | null }`。该工具 SHALL 只执行 GET 请求，SHALL NOT 支持搜索、浏览器渲染、自定义 headers、cookies、认证或批量 URL 抓取。格式化文本超过模型可见输出上限时，工具 SHALL 把完整已格式化结果转存到当前项目分区的用户级文件，并 SHALL 向模型保留结果开头。

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
- **WHEN** 响应 body bytes 超过内置响应读取上限
- **THEN** handler SHALL 继续在安全边界内停止读取或返回失败
- **WHEN** 已格式化 tool result 超过模型可见输出上限且 offloading 成功
- **THEN** handler SHALL 保存完整已格式化结果并返回以 `[tool result truncated: <absolute-path>]` 结束的开头预览
- **THEN** result SHALL 在发生任一截断时标记 `truncated: true`
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

### Requirement: read_files PDF extracted-text offloading
系统 SHALL 在 `read_files` 成功提取 PDF 文本并完成结果格式化后应用 context offloading。包含 PDF 已提取文本的格式化结果超过独立的 65,536-byte 模型可见阈值且文件写入成功时，系统 SHALL 保存应用该阈值前的完整格式化结果，并 SHALL 只返回结果开头和位于末尾的统一截断路径标记。该有效阈值 SHALL NOT 超过 `read_files` 的模型可见总输出上限。普通文本与目录读取的总输出行为、PDF metadata、文件大小限制、提取内容硬上限和失败语义 SHALL 保持不变。

#### Scenario: 未超限 PDF 结果保持原格式
- **WHEN** PDF 格式化结果未超过 65,536-byte PDF 模型可见阈值
- **THEN** handler SHALL 返回完整 PDF metadata 和已提取文本
- **THEN** handler SHALL NOT 创建 offloading 文件或添加截断路径标记

#### Scenario: 超限 PDF 提取结果成功转存
- **WHEN** PDF 提取成功且最终格式化结果超过 65,536-byte PDF 模型可见阈值
- **AND** 系统成功写入 offloading 文件
- **THEN** 文件 SHALL 包含应用总输出上限前的完整格式化结果
- **THEN** result 文本 SHALL 保留 UTF-8 安全的结果开头并以 `[tool result truncated: <absolute-path>]` 结束
- **THEN** result SHALL 标记 `truncated: true`

#### Scenario: PDF offloading 失败时安全降级
- **WHEN** PDF 格式化结果超过上限但 offloading 文件写入失败
- **THEN** handler SHALL 返回现有总输出上限内的 UTF-8 安全开头预览
- **THEN** result 文本 SHALL NOT 包含无效文件路径
- **THEN** 原本成功的 PDF 提取 SHALL NOT 变成失败结果

#### Scenario: 普通 read_files 结果保持既有总输出上限
- **WHEN** `read_files` 只返回文本文件、目录或图片 metadata
- **THEN** handler SHALL 继续使用既有 256,000-byte 默认总输出上限
- **THEN** PDF 的独立 65,536-byte 阈值 SHALL NOT 提前截断这些结果

