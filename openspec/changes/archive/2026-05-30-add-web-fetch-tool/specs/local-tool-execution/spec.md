## ADDED Requirements

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
- **THEN** result 文本 SHALL 包含 url、final_url、status、content_type、fetched_bytes、offset、limit、returned_lines、has_more、truncated 和 content

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

#### Scenario: Redirect 重新校验
- **WHEN** 远端返回 HTTP redirect
- **THEN** handler SHALL 在内置 redirect 上限内解析 Location 并继续请求
- **THEN** handler SHALL 对每个 redirect 目标重新执行 URL 安全校验
- **THEN** redirect 超过上限或 redirect 目标不安全时 handler SHALL 返回 `ok: false`

#### Scenario: HTTP 错误保留有限响应摘要
- **WHEN** 远端返回非 2xx HTTP 状态且响应是支持的文本类内容
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含 HTTP status、content_type 和有限响应 body 摘要
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
