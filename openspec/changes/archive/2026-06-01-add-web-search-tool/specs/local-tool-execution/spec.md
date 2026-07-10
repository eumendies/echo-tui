## ADDED Requirements

### Requirement: web_search public web search tool
系统 SHALL 提供本地工具 `web_search`，用于在无需 API key 的情况下通过公共 Bing 搜索页面执行 best-effort 网页搜索，并返回结构化、受限的文本结果。该工具 SHALL 接收 JSON object 参数 `{ "query": string, "count"?: number | null, "offset"?: number | null, "market"?: string | null, "safe_search"?: string | null }`。该工具 SHALL NOT 使用官方搜索 API、用户登录态、cookies、浏览器自动化、代理池或反爬绕过机制。

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
- **THEN** handler SHALL 向公共 Bing 搜索页面发起有界 GET 请求
- **THEN** handler SHALL 使用内置 timeout 限制请求耗时
- **THEN** handler SHALL 使用内置响应体 bytes 上限限制读取规模
- **THEN** handler SHALL NOT 携带 API key、登录 cookie、用户凭据或自定义认证信息

#### Scenario: 解析自然网页搜索结果
- **WHEN** 公共搜索页返回可解析的自然网页结果 HTML
- **THEN** handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 包含 provider、query、count、offset、returned_results 和 truncated metadata
- **THEN** result 文本 SHALL 按搜索页顺序返回每条结果的 title、url 和 snippet
- **THEN** handler SHALL 对标题和摘要做轻量 HTML 文本化、常见 HTML entity 解码和空白折叠

#### Scenario: 过滤不可用结果 URL
- **WHEN** 解析出的候选结果 URL 为空、不是 HTTP(S) URL、指向脚本 URL、指向 Bing 内部跳转或与已返回结果重复
- **THEN** handler SHALL 跳过该候选结果
- **THEN** handler SHALL NOT 把不可用 URL 写入 result 文本

#### Scenario: 搜索结果数量限制
- **WHEN** 可解析结果数量超过请求 count 或内置最大结果数
- **THEN** handler SHALL 只返回允许范围内的前序结果
- **THEN** result SHALL 在输出被限制时标记 `truncated: true`
- **THEN** result 文本 SHALL 提示模型可以通过更具体 query 或分页参数继续搜索

#### Scenario: 异常搜索页或反爬页面
- **WHEN** 公共搜索页返回验证码、反爬、登录墙、地区提示、异常 HTML 或无法识别的结构
- **THEN** handler SHALL 返回 `ok: false` 的 tool result
- **THEN** result 文本 SHALL 说明公共搜索页不可解析或被拦截
- **THEN** handler SHALL NOT 输出原始 HTML
- **THEN** handler SHALL NOT 尝试绕过验证码、反爬或登录限制

#### Scenario: 无自然结果不是工具运行异常
- **WHEN** 公共搜索页可解析但没有自然网页结果
- **THEN** handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 显示 `returned_results: 0`
- **THEN** 系统 SHALL NOT 仅因无结果追加本地 error transcript record

#### Scenario: 网络失败、HTTP 错误和超时
- **WHEN** 搜索请求发生 DNS、连接、TLS、读取错误、非成功 HTTP 状态或超过内置 timeout
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含可回传模型的简洁错误说明
- **THEN** result SHALL 在超时时标记 `timedOut: true`
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: 输出规模限制
- **WHEN** 格式化后的 tool result 文本超过内置总输出 bytes 上限
- **THEN** handler SHALL 在安全边界内截断输出
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 明确说明输出已截断

#### Scenario: tool result 参与 agent continuation
- **WHEN** `web_search` 执行完成并返回 tool result
- **THEN** agent loop runtime SHALL 追加对应 `tool_call` record 和 `tool_result` record
- **THEN** `tool_result` record SHALL 保留 `ok`、`timedOut` 和 `truncated` metadata
- **THEN** 后续 provider continuation SHALL 能接收该搜索结果文本作为 function call output
