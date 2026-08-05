# markdown-terminal-rendering Specification

## Purpose
定义 assistant Markdown 文本在终端中的可见投影行为。Markdown 渲染只影响 render 层输出，不改变 transcript、agent input 或持久化事实内容。

## Requirements
### Requirement: Markdown-aware assistant rendering
系统 SHALL 为 assistant Markdown 文本提供终端可见投影。投影 SHALL 支持常见 LLM Markdown 子集，并在不改变原始 transcript 文本的前提下，根据当前 terminal width 生成 ANSI styled lines。

#### Scenario: assistant final message 渲染 Markdown
- **WHEN** assistant transcript record 包含 Markdown 文本
- **THEN** render 层 SHALL 把该文本解析为 Markdown-aware terminal projection
- **THEN** transcript record 中保存的原始文本 SHALL 保持不变

#### Scenario: 普通段落按当前宽度换行
- **WHEN** Markdown 文本包含普通段落
- **THEN** render 层 SHALL 按当前 terminal safe render width 对段落内容换行
- **THEN** wrapped continuation lines SHALL 与 assistant block 的视觉缩进保持一致

#### Scenario: 不支持的 Markdown 降级为普通文本
- **WHEN** Markdown 文本包含当前子集不支持的语法
- **THEN** render 层 SHALL 将其作为普通文本安全显示
- **THEN** 渲染 SHALL NOT 抛出错误或中断 app rendering

### Requirement: Markdown block elements
系统 SHALL 支持 heading、list、blockquote、horizontal rule、fenced code block 和 pipe table 的终端投影。每类 block SHALL 使用当前 render theme 的 Markdown token 表达结构，同时保持现有 assistant 前缀和多行缩进规则。

#### Scenario: heading 使用强调样式
- **WHEN** assistant Markdown 包含 `#` 到 `######` heading
- **THEN** heading 内容 SHALL 以当前 render theme 的 heading 样式显示
- **THEN** heading marker SHALL NOT 作为普通 `#` 噪声原样显示，除非该行无法被识别为 heading

#### Scenario: 无序列表使用统一 bullet
- **WHEN** assistant Markdown 包含 `-`、`*` 或 `+` 无序列表项
- **THEN** render 层 SHALL 使用统一 bullet 样式显示列表项
- **THEN** bullet 颜色 SHALL 使用当前 render theme 的 list marker token
- **THEN** 长列表项换行后的 continuation lines SHALL 与列表文本起始列对齐

#### Scenario: 有序列表保留编号
- **WHEN** assistant Markdown 包含有序列表项
- **THEN** render 层 SHALL 保留可见编号 marker
- **THEN** 编号 marker 颜色 SHALL 使用当前 render theme 的 list marker token
- **THEN** 长列表项换行后的 continuation lines SHALL 与列表文本起始列对齐

#### Scenario: blockquote 使用引用前缀
- **WHEN** assistant Markdown 包含 blockquote 行
- **THEN** render 层 SHALL 使用轻量引用前缀显示引用内容
- **THEN** 引用前缀和引用内容 SHALL 使用当前 render theme 的 quote token
- **THEN** 引用内容 SHALL 继续按当前 terminal width 换行

#### Scenario: horizontal rule 使用当前宽度分割线
- **WHEN** assistant Markdown 包含 horizontal rule
- **THEN** render 层 SHALL 按当前 terminal safe render width 渲染克制分割线
- **THEN** 分割线 SHALL 使用当前 render theme 的 rule token

#### Scenario: pipe table 使用轻量表格投影
- **WHEN** assistant Markdown 包含有效 pipe table
- **THEN** render 层 SHALL 按当前 terminal width 渲染无外框表格投影
- **THEN** 表格 SHALL 保持 assistant block 的 role 前缀和多行缩进规则
- **THEN** 表格 header、divider 和 column separator SHALL 使用当前 render theme 的 table token

### Requirement: Markdown pipe table rendering
系统 SHALL 为 assistant Markdown 中的 GFM 风格 pipe table 提供终端投影。表格投影 SHALL 使用无外框 + Unicode 内部分隔线的轻量样式，并 SHALL 不改变 transcript 中保存的原始 Markdown 文本。

#### Scenario: 渲染基础 pipe table
- **WHEN** assistant Markdown 包含连续的 table header、delimiter 和 body rows
- **THEN** render 层 SHALL 将其识别为 table block
- **THEN** render 层 SHALL 以对齐后的列和 Unicode 内部分隔线显示表格
- **THEN** render 层 SHALL NOT 在表格外部绘制完整 box、card 或外框

#### Scenario: 使用 Unicode 内部分隔线
- **WHEN** render 层渲染有效 pipe table
- **THEN** render 层 SHALL 使用 `│` 分隔列
- **THEN** render 层 SHALL 使用 `─` 和 `┼` 渲染 header/body 分隔线
- **THEN** render 层 SHALL NOT 使用 ASCII pipe 作为可见表格分隔符

#### Scenario: 支持无外侧 pipe 的表格
- **WHEN** assistant Markdown 包含没有首尾 `|` 但包含有效 delimiter row 的 pipe table
- **THEN** render 层 SHALL 将其识别为 table block
- **THEN** render 层 SHALL 按与有外侧 pipe 相同的表格投影规则显示

#### Scenario: 非表格 pipe 文本安全降级
- **WHEN** assistant Markdown 中的 pipe 文本没有紧邻的有效 delimiter row
- **THEN** render 层 SHALL 将其作为普通文本显示
- **THEN** 渲染 SHALL NOT 抛出错误或中断 app rendering

### Requirement: Table structure parsing
系统 SHALL 解析 pipe table 的单元格、delimiter alignment 和 escaped pipe。表格结构识别 SHALL 只在普通 Markdown 流或被允许 unwrap 的 markdown fence 中生效，不应误解析普通代码块。

#### Scenario: escaped pipe 不作为列分隔符
- **WHEN** table cell 内容包含 escaped pipe `\|`
- **THEN** render 层 SHALL 将该 pipe 保留为 cell 内容的一部分
- **THEN** render 层 SHALL NOT 因该 escaped pipe 增加额外列

#### Scenario: delimiter alignment 控制 cell 对齐
- **WHEN** table delimiter cell 为 `:---`、`---:` 或 `:---:`
- **THEN** render 层 SHALL 分别按 left、right 或 center alignment 渲染该列内容

#### Scenario: table rows column count 归一化
- **WHEN** body row 的 cell 数少于或多于 header/delimiter 列数
- **THEN** render 层 SHALL 将 row 归一化到 table column count
- **THEN** 渲染 SHALL 保持稳定且不抛出错误

#### Scenario: code fence 内普通表格文本不解析
- **WHEN** 非 `md` 或 `markdown` fenced code block 内包含 pipe table 文本
- **THEN** render 层 SHALL 按代码块内容显示这些文本
- **THEN** render 层 SHALL NOT 将其解析为 table block

### Requirement: Table cell inline Markdown
系统 SHALL 在 table cell 内容中复用普通文本的 inline Markdown 投影。inline 样式 SHALL 来自当前 render theme，且 SHALL 不影响列宽和 display width 计算，且 SHALL NOT 泄漏 ANSI 样式到后续 cell 或 row。

#### Scenario: table cell 支持 inline code
- **WHEN** table cell 内容包含 inline code
- **THEN** inline code 内容 SHALL 使用与普通段落一致的 theme code 样式显示
- **THEN** inline code marker SHALL NOT 作为普通反引号噪声显示

#### Scenario: table cell 支持 bold italic link
- **WHEN** table cell 内容包含 bold、italic 或 Markdown link
- **THEN** render 层 SHALL 使用与普通段落一致的 theme inline 样式显示对应文本
- **THEN** link SHALL 保留 URL 的可见信息

#### Scenario: table cell inline 样式不影响列宽
- **WHEN** table cell inline 样式产生 ANSI escape sequence
- **THEN** render 层 SHALL 基于无 ANSI 的可见文本计算列宽和 wrap
- **THEN** 每条输出行 SHALL 不超过当前 terminal safe render width

### Requirement: Responsive table width
系统 SHALL 根据当前 terminal safe render width 计算表格列宽。表格内容 SHALL 在列宽内换行；当终端过窄无法安全显示结构化表格时，render 层 SHALL 安全降级为普通文本投影。

#### Scenario: table 按当前宽度换行
- **WHEN** table cell 内容超过分配的 column width
- **THEN** render 层 SHALL 在该 cell 内换行
- **THEN** 同一 row 的其他 cell SHALL 按该 row 的最大 wrapped 高度补齐显示

#### Scenario: 中文宽字符参与列宽计算
- **WHEN** table cell 包含中文或其他宽字符
- **THEN** render 层 SHALL 使用 display width 而不是 JavaScript string length 计算列宽、padding 和 wrap

#### Scenario: 极窄宽度安全降级
- **WHEN** 当前 terminal width 无法容纳 table 的最小列宽和必要分隔符
- **THEN** render 层 SHALL 安全降级为普通文本或原始 pipe row 投影
- **THEN** 渲染 SHALL NOT 抛出错误或输出超过 safe render width 的行

### Requirement: Markdown fenced table unwrap
系统 SHALL 保守支持 `md` / `markdown` fenced code block 中的 table unwrap。只有当该 fence 内容包含有效 table header + delimiter 时，render 层 SHALL 将 fence 内容作为 Markdown table 渲染；否则 SHALL 保持代码块语义。

#### Scenario: markdown fence 内有效 table unwrap
- **WHEN** assistant Markdown 包含 `md` 或 `markdown` fenced code block
- **AND** fence 内容包含有效 pipe table header 和 delimiter
- **THEN** render 层 SHALL 移除 fence marker 的可见投影
- **THEN** render 层 SHALL 将 fence 内容按 Markdown table 渲染

#### Scenario: markdown fence 内非 table 内容保持代码块
- **WHEN** assistant Markdown 包含 `md` 或 `markdown` fenced code block
- **AND** fence 内容不包含有效 pipe table header 和 delimiter
- **THEN** render 层 SHALL 按 fenced code block 内容显示
- **THEN** render 层 SHALL NOT 对该内容执行普通 Markdown block 解析

#### Scenario: 非 markdown fence 不 unwrap
- **WHEN** assistant Markdown 包含非 `md` 或 `markdown` fenced code block
- **THEN** render 层 SHALL 按 fenced code block 内容显示
- **THEN** render 层 SHALL NOT 将其中的 table-like 文本解析为 table block

### Requirement: Code block direct highlighting
系统 SHALL 直接高亮显示 fenced code block 内容，不为代码块绘制边框、卡片、语言标签或 box。代码块 SHALL 保留原始缩进，代码内容内部 SHALL NOT 解析 inline Markdown。代码块内容 SHALL 使用通用、跨行的语法 token 高亮；第一版所有 fenced code block 共享同一套通用高亮规则，而不是按语言使用不同 parser。语法高亮 SHALL 只影响终端可见投影，不改变 transcript 中保存的原始 Markdown 文本。

#### Scenario: fenced code block 使用通用语法高亮
- **WHEN** assistant Markdown 包含 fenced code block
- **THEN** render 层 SHALL 以通用语法 token 样式直接显示代码内容
- **THEN** render 层 SHALL NOT 在代码块周围绘制边框、卡片或 box drawing
- **THEN** render 层 SHALL NOT 显示 fenced code block 的语言类型标签

#### Scenario: 所有语言共享第一版通用规则
- **WHEN** assistant Markdown 包含带语言标签或不带语言标签的 fenced code block
- **THEN** render 层 SHALL 使用同一套通用高亮规则处理代码内容
- **THEN** render 层 SHALL NOT 因未知语言、空语言或不支持的语言标签抛出错误

#### Scenario: 代码块保留缩进
- **WHEN** fenced code block 内容包含前导空格或缩进
- **THEN** render 层 SHALL 在终端投影中保留这些缩进

#### Scenario: 代码块内部不解析 inline Markdown
- **WHEN** fenced code block 内容包含 `**bold**`、`` `inline` `` 或链接语法
- **THEN** render 层 SHALL 把这些内容作为代码文本显示
- **THEN** render 层 SHALL NOT 对代码内容执行 inline Markdown 样式解析

#### Scenario: 未闭合 fenced code block 容错
- **WHEN** assistant Markdown 或 streaming draft 包含未闭合 fenced code block
- **THEN** render 层 SHALL 将 fence 之后到文本末尾的内容作为代码块显示
- **THEN** render 层 SHALL 对当前可见代码内容应用安全的通用高亮投影
- **THEN** 渲染 SHALL NOT 抛出错误

### Requirement: Generic cross-line syntax highlighting
系统 SHALL 为 fenced code block 内容提供通用跨行语法高亮。高亮器 SHALL 以完整 code block 为输入，按顺序扫描代码文本并生成 semantic token spans；token spans SHALL 使用当前 render theme 的 syntax token styles，并复用现有 display-width aware wrapping 和 ANSI 样式闭合规则。高亮器 SHALL 至少识别通用字符串、注释、数字、关键字、函数名、变量标识符、操作符和标点 token；无法识别的文本 SHALL 作为普通代码文本显示。

#### Scenario: 通用 token 被高亮
- **WHEN** fenced code block 包含字符串、注释、数字、关键字、函数调用、变量标识符、操作符或标点
- **THEN** render 层 SHALL 将可识别片段映射为当前 render theme 的对应 semantic token 样式
- **THEN** render 层 SHALL 将无法识别片段作为普通代码文本显示

#### Scenario: 字符串状态跨行延续
- **WHEN** fenced code block 中的字符串 token 在当前行没有闭合，并且后续行继续属于该字符串
- **THEN** 高亮器 SHALL 在后续行保持字符串 token 状态，直到遇到对应闭合 delimiter 或 code block 结束
- **THEN** 渲染 SHALL 保持稳定且不隐藏已生成内容

#### Scenario: 块注释状态跨行延续
- **WHEN** fenced code block 中的块注释 token 在当前行没有闭合
- **THEN** 高亮器 SHALL 在后续行保持注释 token 状态，直到遇到块注释闭合 marker 或 code block 结束
- **THEN** 渲染 SHALL 保持稳定且不隐藏已生成内容

#### Scenario: 高亮不改变 wrapping 语义
- **WHEN** 高亮后的代码行超过当前 terminal safe render width
- **THEN** render 层 SHALL 按现有 display width 规则换行
- **THEN** ANSI 样式 SHALL NOT 计入 display width
- **THEN** 每个 token 样式 SHALL 在对应 span 结束处闭合，不泄漏到后续 span 或行

#### Scenario: streaming preview 使用同一高亮规则
- **WHEN** assistant 正在 streaming 且 pending draft 包含 fenced code block
- **THEN** footer pending preview SHALL 使用与最终 assistant transcript 相同的通用跨行高亮规则和当前 render theme syntax token 投影当前 draft
- **THEN** partial token、未闭合字符串、未闭合注释或未闭合 fence SHALL NOT 中断 streaming preview 渲染

### Requirement: Syntax highlight theme configuration
系统 SHALL 支持用户通过 `~/.echo/theme.json` 控制语法高亮颜色和强调样式。语法高亮 theme SHALL 是 render theme 的一部分，并 SHALL 以 semantic token kind 为单位覆盖默认主题。系统 SHALL NOT 从 `~/.echo/config.json` 的 `tui.syntaxHighlight` 读取语法高亮配置。

#### Scenario: 无配置时使用默认主题
- **WHEN** 用户级 `theme.json` 不存在 syntax 配置
- **THEN** render 层 SHALL 使用内置默认 render theme 中的 syntax token 样式
- **THEN** fenced code block SHALL 继续按通用高亮规则显示

#### Scenario: 用户配置覆盖 token 颜色
- **WHEN** 用户级 `theme.json` 提供有效的 syntax token 样式覆盖
- **THEN** render 层 SHALL 将有效覆盖合并到默认 render theme
- **THEN** 未被覆盖的 token kind SHALL 继续使用默认 render theme syntax 样式

#### Scenario: 高亮配置错误不阻断聊天
- **WHEN** 用户级 `theme.json` 中的 syntax 配置缺失字段、包含未知 token kind、未知颜色或错误类型
- **THEN** 系统 SHALL 忽略无效的高亮配置项或回退到默认 render theme
- **THEN** 系统 SHALL NOT 因该配置错误阻止应用启动、普通消息提交或 assistant 渲染
- **THEN** 系统 SHALL NOT 把高亮配置错误写入 transcript record

#### Scenario: 旧高亮配置不生效
- **WHEN** 用户级 `~/.echo/config.json` 包含 `tui.syntaxHighlight`
- **THEN** render 层 SHALL NOT 使用该配置控制 fenced code block 高亮
- **THEN** 语法高亮 SHALL 只由当前 render theme 决定

### Requirement: Inline Markdown styles
系统 SHALL 对普通文本中的 inline code、bold、italic 和 links 提供安全的终端投影。inline color/style SHALL 来自当前 render theme，且 SHALL 不影响 display width 计算，且 SHALL NOT 泄漏 ANSI 样式到后续行。

#### Scenario: inline code 高亮显示
- **WHEN** 普通段落、列表项或引用中包含 inline code
- **THEN** inline code 内容 SHALL 使用当前 render theme 的 inline code 样式显示
- **THEN** inline code marker SHALL NOT 作为普通反引号噪声显示

#### Scenario: bold 和 italic 使用 ANSI 样式
- **WHEN** 普通段落、列表项或引用中包含 bold 或 italic 标记
- **THEN** render 层 SHALL 使用当前 render theme 的 bold 或 italic 样式显示对应文本
- **THEN** 样式 SHALL 在对应 inline span 结束处闭合

#### Scenario: link 保留目标信息
- **WHEN** 普通段落、列表项或引用中包含 Markdown link
- **THEN** render 层 SHALL 显示 link text
- **THEN** render 层 SHALL 保留 URL 的可见信息，避免用户无法看到目标地址
- **THEN** link 文本 SHALL 使用当前 render theme 的 link 样式

### Requirement: Streaming Markdown preview stability
系统 SHALL 在 assistant streaming pending preview 中使用容错 Markdown 投影，并继续按 terminal rows 动态限制 preview 高度。Markdown 投影 SHALL 在折叠前生成可见行，折叠后仅显示摘要与尾部可见行；当 streaming draft 包含已确认 table 时，该投影 SHALL 使用 table-aware rendering。

#### Scenario: streaming preview 渲染 Markdown draft
- **WHEN** assistant 正在 streaming 且 draft 包含 Markdown
- **THEN** footer pending preview SHALL 使用 Markdown-aware terminal projection 显示 draft
- **THEN** projection SHALL 容忍 partial Markdown 结构

#### Scenario: streaming preview 渲染已确认 table
- **WHEN** assistant 正在 streaming 且 draft 已包含有效 table header 和 delimiter
- **THEN** footer pending preview SHALL 使用 table-aware terminal projection 显示该 table
- **THEN** projection SHALL 在后续 rows 到达时基于完整 draft 重新计算表格宽度和换行

#### Scenario: partial table 不阻塞 streaming preview
- **WHEN** assistant 正在 streaming 且 draft 只包含疑似 table header 但尚未包含有效 delimiter
- **THEN** footer pending preview SHALL 将该内容作为普通文本安全显示
- **THEN** projection SHALL NOT 抛出错误或隐藏已生成内容

#### Scenario: 长 Markdown preview 仍受高度预算限制
- **WHEN** Markdown-aware streaming projection 的行数超过当前 pending preview 高度预算
- **THEN** footer SHALL 折叠 preview 头部并显示摘要
- **THEN** footer SHALL 只保留最新尾部可见行

#### Scenario: 折叠不改变最终 assistant 原文
- **WHEN** streaming Markdown preview 被折叠显示
- **THEN** 系统 SHALL 继续在内存中保留完整原始 draft
- **THEN** assistant 完成后追加的 transcript record SHALL 包含完整原始 Markdown 文本

### Requirement: Footer tool pending 与 working 状态投影
系统 SHALL 在 footer 临时区域支持工具调用 pending preview 与本轮 working 状态投影。pending preview SHALL 显示在 footer 上部；working spinner SHALL 显示在 pending preview 下方、divider 上方，并紧贴 divider。

#### Scenario: tool call pending preview 显示在 footer
- **WHEN** app 存在未完成的 tool call pending 状态
- **THEN** footer SHALL 显示该工具调用的用户可读 preview
- **THEN** preview SHALL 使用与正式 tool call 记录兼容的工具名称和参数投影
- **THEN** preview SHALL 随 footer redraw 更新，而不是进入 transcript/scrollback 区域

#### Scenario: working spinner 从首字后持续到本轮结束
- **WHEN** 本轮 assistant 首个文本增量到达
- **THEN** footer SHALL 开始显示 working spinner 和本轮已耗时
- **WHEN** 本轮继续 streaming、执行工具或等待 continuation 响应
- **THEN** working spinner SHALL 持续显示并更新帧与耗时
- **WHEN** 本轮 complete 或 fail
- **THEN** footer SHALL 停止显示 working spinner

#### Scenario: working spinner 紧贴 divider 上方
- **WHEN** footer 同时存在 pending preview、working 状态和 composer 输入区
- **THEN** footer SHALL 按 pending preview、working line、divider、composer surface 的顺序渲染
- **THEN** working line SHALL 位于 divider 正上方
- **THEN** pending preview SHALL NOT 插入 working line 与 divider 之间

### Requirement: Tool call prefix 状态着色
系统 SHALL 在终端可见投影中根据相邻工具结果状态为 tool call 行的 `◆` prefix 着色。该着色 SHALL 只影响 render 层输出，不改变 transcript record 中保存的原始 tool call 或 tool result 文本。

#### Scenario: 成功工具调用使用成功 prefix 样式
- **WHEN** render 层投影相邻的 tool call record 和 `ok: true` tool result record
- **THEN** tool call 行的 `◆` prefix SHALL 使用成功样式
- **THEN** tool result 输出文本 SHALL 继续按现有截断和换行规则显示

#### Scenario: 失败工具调用使用失败 prefix 样式
- **WHEN** render 层投影相邻的 tool call record 和 `ok: false` tool result record
- **THEN** tool call 行的 `◆` prefix SHALL 使用失败样式
- **THEN** tool result 输出文本 SHALL 继续保留可读错误内容

#### Scenario: 历史或缺少状态的工具调用安全降级
- **WHEN** render 层投影缺少相邻 result 状态的历史 tool call record
- **THEN** renderer SHALL 使用既有中性样式显示该 call
- **THEN** renderer SHALL NOT 抛出错误或隐藏该记录

### Requirement: 表格列宽基于准确显示宽度对齐
系统 SHALL 使用统一的 grapheme 级终端显示宽度计算 pipe table 的列宽、单元格 padding、对齐与换行。宽字符、零宽字符、emoji 和变体选择符 SHALL 全部按 `character-width-determination` 能力定义的规则参与列宽计算（Ambiguous 字符一律按 1 列），保证渲染行的可见宽度与计算宽度一致，不产生边框错位。

#### Scenario: 宽字符与 emoji 参与列宽计算
- **WHEN** 表格 cell 包含 CJK 扩展 B 宽字符、ZWJ 家族 emoji 或旗帜 emoji
- **THEN** render 层 SHALL 按 2 列计算这些 cluster 的宽度并据此分配列宽、padding 和对齐
- **THEN** 表格每行渲染后的可见宽度 SHALL 落在分配的列宽内，边框 SHALL 保持对齐

#### Scenario: 零宽字符不破坏列宽
- **WHEN** 表格 cell 包含组合音标、变体选择符或零宽格式符
- **THEN** render 层 SHALL 将这些字符按 0 列计算，不额外撑大列宽或改变 padding

#### Scenario: VS16 与文本呈现符号宽度正确
- **WHEN** 表格 cell 包含带 VS16 的 emoji（如 `⚠️`）或无 VS16 的文本呈现符号（如 `♠`）
- **THEN** render 层 SHALL 分别按 2 列与 1 列计算，行可见宽度与列宽计算保持一致

#### Scenario: 换行不对齐不发生在 cluster 内部
- **WHEN** 表格 cell 内容在列宽内换行
- **THEN** 换行点 SHALL 落在 grapheme cluster 边界，不拆分 ZWJ 序列或旗帜 emoji
