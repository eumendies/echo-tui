## Context

`web_fetch` 当前把明确 URL 的读取结果格式化为 provider-visible 文本。正常响应以最终 URL 开头，随后包含 status、可选 redirect/pagination/truncation 字段和 `content:` fenced block；HTTP 非 2xx、unsupported media 与请求失败则使用不同的失败 envelope。这些文本保存到 transcript 并继续发送给 provider，不能为了本地显示而改写。

现有工具渲染层已经支持 pair-aware renderer，且 `web_search` 已采用“保守解析当前文本协议、不可解析时回退通用 renderer”的方式生成专属投影。`web_fetch` 可沿用这一边界，但正文是任意外部文本，可能包含 fence、状态字段字面量或被 context offloading 截断，因此解析必须比搜索结果更谨慎。

## Goals / Non-Goals

**Goals:**

- 将 `web_fetch` 调用和结果投影为紧凑单行逻辑标题与文档摘录 rail。
- 将 HTTP status、redirect、分页、截断、offloading 和生命周期状态放在 tool call 标题同一逻辑行，不增加独立 metadata 行。
- 对成功响应和带正文的 HTTP 错误保留有界正文预览，同时隐藏 provider-facing envelope 字段和 fence marker。
- 让 pending、成功、redirect、空正文、HTTP 错误、timeout、unsupported 和截断状态清晰可辨。
- 保持树/rail 前缀颜色独立于正文颜色，并遵守 safe render width 与现有主题语义。
- 保持 transcript、tool result、provider continuation、offloading artifact 和持久化事实不变。

**Non-Goals:**

- 不改变 `web_fetch` tool schema、URL 安全校验、网络执行、HTML-to-text、分页、formatter 或 offloading 逻辑。
- 不增加浏览器打开、链接点击、正文展开/折叠、语法高亮或交互式翻页。
- 不尝试从正文推断网页标题、content type、HTTP 状态或截断事实。
- 不增加 OSC 8 超链接、图标、图片/PDF 展示或第三方 TUI 依赖。
- 不向 transcript details 增加 status、redirect、content、range 或 display metadata。

## Decisions

### 1. 使用 pair-aware renderer 组合请求 URL 与响应状态

新增独立 `web-fetch` renderer。pending preview 和孤立 call 从 `argumentsText` 解析 URL、offset 和 limit，显示：

```text
◆ ▌ Web fetch · example.com/docs · fetching
```

相邻匹配的 call/result 由 pair-aware renderer 同时读取请求参数、result `ok`、结构化 timeout/truncated 状态和结果文本。完成态标题使用以下逻辑结构：

```text
◆ ▌ Web fetch · <display-url> · <status> · <modifiers>
```

所有 metadata 都是同一逻辑标题的组成部分；终端宽度不足时可以按 continuation prefix 物理换行，但不能另建固定 metadata 行。替代方案是像搜索结果一样在标题下放 metadata，该形式更容易布局，但会让每次正文读取额外占一行，也不符合本次确定的紧凑方向。

### 2. 标题优先保留 URL 身份、状态和关键异常

普通成功标题显示去掉 HTTP(S) scheme 的 URL 与 `200 OK` 等状态。URL 过长时进行中间省略，优先保留 host 和末尾 path/query 语义，避免状态被极长 URL 挤到不可读位置。metadata 顺序为：URL、HTTP status、range、redirect/truncation/more 等 modifiers。

redirect 完成态使用 `requested → final` 表达来源与实际正文归属：

```text
◆ ▌ Web fetch · example.com/start → example.com/final · 200 OK
```

若标题预算不足，优先保留 final URL 与 redirect 事实，再压缩 requested URL。替代方案是只显示 final URL 和 `redirected`，更短但隐藏了网络跳转来源，对审计和理解不利。

### 3. 正文使用与 Bash 一致的连续 rail

可解析正文与标题组成同一个无外围边框的 `▌` rail 块，标题和正文之间保留一行 rail 分隔：

```text
◆ ▌ Web fetch · platform.openai.com/docs/guides/tools · 200 OK
  ▌
  ▌ Tools
  ▌ Use tools to give models access to external data…
  ▌ …
```

标题 rail 跟随 pending/success/error 状态色，正文及分隔行 rail 始终使用 `toolOutput` 弱化色，正文使用 `text`。rail 与内容必须分别着色，不能因标题、正文或错误内容的语义色不同而让正文左侧竖线变色。正文内空逻辑行仍显示 rail，以保留段落结构。

表格不适合任意网页正文，完整边框卡片会在连续 fetch 中制造过多视觉重量。复用 Bash 的 `◆ ▌` 连续块结构可以统一工具输出层级，同时通过 URL 标题和正文配色保持 fetch 与命令输出的语义区分。

### 4. 正文预算按完整逻辑行分配

正文最多使用十个逻辑展示行。正文不超过预算时全部显示；超过预算时显示前九行，并用第十行表达 `… <n> more lines`。视觉截断只影响本地投影，原始 result 和 offloading artifact 保持完整。

当 envelope 明确表示空正文时，标题追加 `no readable content`，不绘制空 rail。正文物理换行继续遵守 safe render width；逻辑行预算不通过切断 ANSI 或宽字符来实现。

### 5. 将分页与截断压缩成标题 modifiers

call 参数和已解析正文行数可把 offset/limit 投影成人类可读的一基行号范围，例如 `lines 41–80`；`has_more: true` 追加 `more`。默认从开头读取且无分页时不显示冗余范围。

截断类型按现有 envelope 和结构化 details 区分：

- `body_truncated: true` → `response truncated`
- 输出 cap 且没有 artifact → `preview truncated`
- 存在 offloading marker → `preview truncated · full result saved`
- 只有结构化 `details.truncated` 可确认但无法分类 → `truncated`

结构化 `details.truncated` 是“发生截断”的权威来源；renderer 不能因正文含有 `body_truncated: true`、`Output was truncated.` 或 marker-like 字面量而改变状态。文本协议只用于在结构化 truncated 已成立时细分展示原因。

### 6. 区分 HTTP 错误、请求失败和 unsupported media

HTTP 非 2xx 仍可能包含有价值正文，因此使用 error marker、HTTP status 和文档 rail，不再重复 `failed`：

```text
◆ ▌ Web fetch · example.com/missing · 404 Not Found
  ▌
  ▌ The requested page could not be found.
```

timeout、URL 校验、redirect 拒绝或网络失败没有可信 HTTP 正文时，标题显示 `timed out` 或 `failed`，并在同一个连续 `▌` rail 块中显示有界 reason。unsupported media 显示 `unsupported`、可用 status 与 content type，并在连续 rail 中显示短诊断，不伪造正文内容。

### 7. 保守解析任意正文与截断 envelope

完整 response envelope 以已知 header、`content:` opener 和最末 formatter closing fence 为边界；正文内部出现 ````` `` 不得被误识别为 envelope 结束。若 result 被 preview/offloading 截断而没有 closing fence，只有在结构化 `details.truncated` 为 true、header 与 content opener 均可信时，renderer 才可显示已保留的正文前缀。

对简单 failure、unsupported 和带正文 HTTP error 分别识别固定 formatter 形状。未知 header、非法 URL/status/range、歧义 marker 或无法确定正文边界时返回 `null`，由通用 renderer 展示有界原文。

替代方案是扩展 transcript details 增加结构化 display metadata。它能减少文本解析，但会扩大到 handler、类型、runtime、journal 和历史兼容；当前变更只修改可见投影，第一版沿用 `web_search` 的保守解析策略更符合范围。

### 8. 复用现有主题语义

pending marker 使用中性 tool 状态，成功使用 `toolSuccess`，HTTP/网络失败和 unsupported 使用 `toolError`。标题正文使用 `text`，rail、截断/省略提示和失败短诊断使用 `toolOutput`。不扩展 theme schema，所有内置及用户主题继续通过现有 semantic token 生效。

## Risks / Trade-offs

- [风险] 任意网页正文可能模拟 envelope 或 offloading marker。→ 只在固定 header 边界和结构化状态共同成立时解释控制字段，完整正文使用最末 closing fence。
- [风险] 极长 requested/final URL 与 metadata 同行后会产生多行标题。→ URL 中间省略并按 metadata 优先级压缩；物理换行仍属于同一标题块。
- [风险] 截断 preview 可能在 header、URL 或正文字符中间结束。→ 仅展示可验证的部分；无法安全恢复时使用通用 fallback。
- [风险] 隐藏 offloading 绝对路径降低用户手动定位 artifact 的便利性。→ 标题显示 `full result saved`，原始路径仍保留在 transcript/provider result 中；后续可独立评估可复制路径 UI。
- [风险] HTML-to-text 与 JSON/text 的正文风格不同。→ 第一版统一按纯文本文档 rail 展示，不猜测媒体语义或做语法高亮。

## Migration Plan

无需数据迁移。发布后，现有和新建 session 中符合当前 `web_fetch` formatter 协议的记录会在重绘时使用专属投影；旧格式或非标准记录继续使用通用 renderer。回滚只需移除 renderer 分发，不会重写 transcript 或删除 offloading artifact。

## Open Questions

- 暂无。正文展开、artifact 路径交互和 web content 语法高亮可在后续独立变更中评估。
