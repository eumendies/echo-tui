## ADDED Requirements

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
