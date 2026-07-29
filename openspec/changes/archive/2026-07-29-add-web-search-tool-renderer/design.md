## Context

`web_search` handler 当前把搜索结果格式化为 provider-visible 文本：正常结果包含 `results:` 以及重复的 title、URL、snippet 行；低质量结果会在其前面增加 `warning` 和 `missing_query_terms`；失败结果则使用 `web_search failed` 与 `Reason`。这些文本直接保存到 transcript 并继续发送给 provider，因此不能为了本地显示而改写。

工具消息渲染层已经支持按 `toolName` 选择专属 renderer，并能把相邻且 call id 匹配的 call/result 交给 pair-aware renderer。`read_files` 也已经建立了“保守解析现有文本协议、解析失败回退通用 renderer”的先例。本变更沿用这些边界，不新增 transcript 字段，不让 renderer 读取网络，也不改变搜索工具执行结果。

## Goals / Non-Goals

**Goals:**

- 将 `web_search` 的原始 arguments 和结果文本投影为查询标题、弱化 metadata 与紧凑结果树。
- 让 pending、成功、partial match、无结果、失败、超时和截断状态具有一致的视觉层级。
- 在默认五条搜索结果下兼顾标题、来源路径和 snippet，并对更多结果执行可计数省略。
- 遵守现有 theme semantic token、safe render width 和工具结果展示预算。
- 保持原始 transcript、tool result、provider continuation 和持久化事实不变。

**Non-Goals:**

- 不改变 `web_search` 的 tool schema、搜索质量算法、provider fallback 或 formatter 文本协议。
- 不增加搜索结果选择、键盘导航、展开/折叠或浏览器打开交互。
- 不引入 OSC 8 超链接、favicon、图片或第三方 TUI 组件。
- 不为 `web_fetch` 或其他 web tool 同时增加专属 renderer。
- 不向 transcript details 增加 results、quality 或 display metadata。

## Decisions

### 1. 使用 pair-aware renderer 组合查询与结果

新增独立的 `web-search` tool message renderer。pending preview 和孤立 call 从 `argumentsText` 解析非空 `query`，显示 `Web search · “<query>” · searching`；相邻匹配的 call/result 由 pair-aware renderer 同时读取 query、`ok`、结构化 timeout/truncated 状态和结果文本，完成态不再显示 searching。

该方式能把 query 作为整个结果块的稳定标题，同时确保调用标记直接反映 result 成功或失败。替代方案是分别渲染 call 与 result，但结果区无法自然共享 query 和完成状态，会重复前缀并削弱视觉层级。

### 2. 成功结果使用两行式结果树

完成态首行显示 `Web search · “<query>”`，其后显示弱化 metadata，再按原始结果顺序投影树状列表：

```text
◆ Web search · “Echo TUI GitHub”
  3 results
  ├─ Echo TUI — GitHub
  │  github.com/example/echo-tui · Terminal-native AI assistant…
  └─ Echo TUI Documentation
     echo-tui.dev/docs · Installation and configuration…
```

每个结果使用两个逻辑行：标题行和“display URL · snippet”详情行。display URL 仅在可见投影中移除 HTTP(S) scheme，保留 hostname、path、query 和必要时的 fragment；不只显示 hostname，避免不同页面无法区分。长标题、URL 和 snippet 使用现有宽度工具安全换行，不引入 OSC 8 链接。

替代方案包括表格和完整边框卡片。表格在窄终端与长 snippet 下容易产生碎裂列，卡片则会在连续搜索时制造过多边框和空白；无外围边框的结果树更符合当前 transcript 的轻量视觉语言。

### 3. 将低质量诊断降级为弱化 metadata

正常结果显示 `<n> results`。当现有文本协议带有 low-quality warning 时，metadata 追加 `partial match`；存在 missing terms 时继续追加 `“<term>” not matched` 或等价的有界摘要。整行使用 `toolOutput` 等弱化语义色，不显示独立三角警告、红色错误块或 `warning:`/`missing_query_terms:` 内部字段名。

```text
◆ Web search · “Echo TUI GitHub”
  3 results · partial match · “github” not matched
```

搜索质量不是执行失败，因此不应与 error 状态竞争视觉注意力。替代方案是在结果前放置 warning block，但它会破坏标题到内容的阅读流，并让 best-effort 搜索看起来像运行错误。

### 4. 保守解析现有 result 文本并安全回退

renderer 只识别 `web_search` formatter 当前产生的成功、无结果和失败形状。成功解析要求每个可见结果至少具有连续且非空的 title、HTTP(S) URL 和 snippet；warning、missing terms、`truncated: true` 及尾部输出截断提示只作为已知诊断处理。未知字段、非法 URL、破损编号或无法确定边界的文本返回 `null`，由现有通用 renderer 展示原文。

结构化 `result.details.timedOut` 与 `result.details.truncated` 是超时和截断状态的权威来源；renderer 不从 snippet 或任意正文中的同名字面量推断状态。文本协议解析只用于恢复结果项和 formatter 明确给出的 partial-match 信息。

替代方案是为 tool result 增加结构化 display metadata。该方案更强健，但会扩大到 handler、类型、runtime、journal 兼容和历史迁移；当前 formatter 形状稳定且已有保守文本解析先例，第一版收益不足以覆盖改动成本。

### 5. 使用完整结果项预算并显示省略数量

结果区域沿用现有工具结果逻辑行预算。metadata 占一行，每个结果占两个逻辑行；当全部结果无法放入预算时，只显示预算内的完整结果项，并在树末追加 `… <n> more results`。默认五条结果可以完整显示；请求更多结果时不会显示只有标题而缺少来源或 snippet 的半个结果。

当结构化 truncated 为 true 时，metadata 追加 `truncated`。由于底层截断可能使 renderer 无法知道真实总数，可见计数只描述成功解析出的结果，并使用 `displayed`、`+` 或等价文案避免暗示总数完整。

### 6. 复用现有主题语义，不扩展 theme schema

pending 标记使用现有中性 tool 状态，成功和失败标记分别使用 `toolSuccess` 与 `toolError`；标题使用 `tool`/`text`，URL、snippet、metadata 和省略提示使用 `toolOutput`。partial match 不使用错误色。这样所有内置主题无需迁移，用户自定义主题也能自动得到一致效果。

## Risks / Trade-offs

- [风险] `web_search` formatter 未来改变会让专属解析失败。→ 解析器严格校验并回退通用 renderer；用 fixture 测试锁定当前协议边界。
- [风险] 移除 URL scheme 后，视觉文本不再逐字等同原始 URL。→ 仅修改可见投影并保留 host/path/query；原始 URL 仍存在 transcript 和 provider result 中。
- [风险] 长 URL 或 snippet 换行后会弱化树线连续性。→ 为标题与详情分别使用稳定 continuation prefix，并覆盖窄宽度、宽字符和长内容测试。
- [风险] 结果数量超过预算时用户看不到后续候选。→ 显示准确的省略数量；本变更不改变模型可见的完整结果文本。
- [风险] partial match 信息依赖 formatter 的英文诊断字段。→ 只识别明确固定字段，任何歧义均回退，不从自然语言 snippet 猜测质量。

## Migration Plan

无需数据迁移。发布后，现有和新建 session 中符合当前 `web_search` 文本协议的记录会在重绘时使用专属投影；旧记录或非标准记录继续使用通用 renderer。回滚只需移除 renderer 分发，不会丢失或重写 transcript 数据。

## Open Questions

- 暂无。交互式打开链接或为 web tool 增加结构化 display metadata 可在后续独立变更中评估。
