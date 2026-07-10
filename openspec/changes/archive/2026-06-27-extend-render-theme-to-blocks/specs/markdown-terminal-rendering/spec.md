## MODIFIED Requirements

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
