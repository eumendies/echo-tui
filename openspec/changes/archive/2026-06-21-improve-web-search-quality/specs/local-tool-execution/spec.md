## MODIFIED Requirements

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
- **THEN** result 文本 SHALL 显示 `returned_results: 0`
- **THEN** 系统 SHALL NOT 仅因无结果追加本地 error transcript record

#### Scenario: 低质量但有结果的最终返回
- **WHEN** handler 已执行 provider fallback 后仍只得到低质量候选结果
- **THEN** handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 标记 `quality: low`
- **THEN** result 文本 SHALL 提示结果可能不相关并列出缺失的关键 query terms

#### Scenario: 网络失败、HTTP 错误和超时
- **WHEN** 搜索请求发生 DNS、连接、TLS、读取错误、非成功 HTTP 状态或超过内置 timeout
- **THEN** handler SHALL 在仍有 provider fallback 可尝试时继续执行下一次有界重搜
- **THEN** 如果所有尝试都失败且没有可用候选结果，handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含可回传模型的简洁错误说明
- **THEN** result SHALL 在超时时标记 `timedOut: true`
- **THEN** handler SHALL NOT 抛出未捕获异常中断 app

#### Scenario: 输出质量 metadata
- **WHEN** `web_search` 返回 tool result 文本
- **THEN** result 文本 SHALL 包含 provider、returned_results、truncated、attempts 和 quality metadata
- **THEN** result 文本 SHALL 包含 matched_query_terms 和 missing_query_terms metadata

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
