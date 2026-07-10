## ADDED Requirements

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
系统 SHALL 在 table cell 内容中复用普通文本的 inline Markdown 投影。inline 样式 SHALL 不影响列宽和 display width 计算，且 SHALL NOT 泄漏 ANSI 样式到后续 cell 或 row。

#### Scenario: table cell 支持 inline code
- **WHEN** table cell 内容包含 inline code
- **THEN** inline code 内容 SHALL 使用与普通段落一致的代码样式显示
- **THEN** inline code marker SHALL NOT 作为普通反引号噪声显示

#### Scenario: table cell 支持 bold italic link
- **WHEN** table cell 内容包含 bold、italic 或 Markdown link
- **THEN** render 层 SHALL 使用与普通段落一致的 inline 样式显示对应文本
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

## MODIFIED Requirements

### Requirement: Markdown block elements
系统 SHALL 支持 heading、list、blockquote、horizontal rule、fenced code block 和 pipe table 的终端投影。每类 block SHALL 使用克制 ANSI 样式表达结构，同时保持现有 assistant 前缀和多行缩进规则。

#### Scenario: heading 使用强调样式
- **WHEN** assistant Markdown 包含 `#` 到 `######` heading
- **THEN** heading 内容 SHALL 以强调样式显示
- **THEN** heading marker SHALL NOT 作为普通 `#` 噪声原样显示，除非该行无法被识别为 heading

#### Scenario: 无序列表使用统一 bullet
- **WHEN** assistant Markdown 包含 `-`、`*` 或 `+` 无序列表项
- **THEN** render 层 SHALL 使用统一 bullet 样式显示列表项
- **THEN** 长列表项换行后的 continuation lines SHALL 与列表文本起始列对齐

#### Scenario: 有序列表保留编号
- **WHEN** assistant Markdown 包含有序列表项
- **THEN** render 层 SHALL 保留可见编号 marker
- **THEN** 长列表项换行后的 continuation lines SHALL 与列表文本起始列对齐

#### Scenario: blockquote 使用引用前缀
- **WHEN** assistant Markdown 包含 blockquote 行
- **THEN** render 层 SHALL 使用轻量引用前缀显示引用内容
- **THEN** 引用内容 SHALL 继续按当前 terminal width 换行

#### Scenario: horizontal rule 使用当前宽度分割线
- **WHEN** assistant Markdown 包含 horizontal rule
- **THEN** render 层 SHALL 按当前 terminal safe render width 渲染克制分割线

#### Scenario: pipe table 使用轻量表格投影
- **WHEN** assistant Markdown 包含有效 pipe table
- **THEN** render 层 SHALL 按当前 terminal width 渲染无外框表格投影
- **THEN** 表格 SHALL 保持 assistant block 的 role 前缀和多行缩进规则

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
