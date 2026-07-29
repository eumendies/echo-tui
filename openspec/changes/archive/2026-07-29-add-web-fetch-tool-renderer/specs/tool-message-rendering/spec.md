## ADDED Requirements

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
