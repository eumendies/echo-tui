## ADDED Requirements

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
系统 SHALL 支持 heading、list、blockquote、horizontal rule 和 fenced code block 的终端投影。每类 block SHALL 使用克制 ANSI 样式表达结构，同时保持现有 assistant 前缀和多行缩进规则。

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

### Requirement: Code block direct highlighting
系统 SHALL 直接高亮显示 fenced code block 内容，不为代码块绘制边框、卡片、语言标签或 box。代码块 SHALL 保留原始缩进，代码内容内部 SHALL NOT 解析 inline Markdown。

#### Scenario: fenced code block 直接高亮
- **WHEN** assistant Markdown 包含 fenced code block
- **THEN** render 层 SHALL 以代码样式直接显示代码内容
- **THEN** render 层 SHALL NOT 在代码块周围绘制边框、卡片或 box drawing
- **THEN** render 层 SHALL NOT 显示 fenced code block 的语言类型标签

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
- **THEN** 渲染 SHALL NOT 抛出错误

### Requirement: Inline Markdown styles
系统 SHALL 对普通文本中的 inline code、bold、italic 和 links 提供安全的终端投影。inline 样式 SHALL 不影响 display width 计算，且 SHALL NOT 泄漏 ANSI 样式到后续行。

#### Scenario: inline code 高亮显示
- **WHEN** 普通段落、列表项或引用中包含 inline code
- **THEN** inline code 内容 SHALL 使用代码样式高亮显示
- **THEN** inline code marker SHALL NOT 作为普通反引号噪声显示

#### Scenario: bold 和 italic 使用 ANSI 样式
- **WHEN** 普通段落、列表项或引用中包含 bold 或 italic 标记
- **THEN** render 层 SHALL 使用克制 ANSI 样式显示对应文本
- **THEN** 样式 SHALL 在对应 inline span 结束处闭合

#### Scenario: link 保留目标信息
- **WHEN** 普通段落、列表项或引用中包含 Markdown link
- **THEN** render 层 SHALL 显示 link text
- **THEN** render 层 SHALL 保留 URL 的可见信息，避免用户无法看到目标地址

### Requirement: Streaming Markdown preview stability
系统 SHALL 在 assistant streaming pending preview 中使用容错 Markdown 投影，并继续按 terminal rows 动态限制 preview 高度。Markdown 投影 SHALL 在折叠前生成可见行，折叠后仅显示摘要与尾部可见行。

#### Scenario: streaming preview 渲染 Markdown draft
- **WHEN** assistant 正在 streaming 且 draft 包含 Markdown
- **THEN** footer pending preview SHALL 使用 Markdown-aware terminal projection 显示 draft
- **THEN** projection SHALL 容忍 partial Markdown 结构

#### Scenario: 长 Markdown preview 仍受高度预算限制
- **WHEN** Markdown-aware streaming projection 的行数超过当前 pending preview 高度预算
- **THEN** footer SHALL 折叠 preview 头部并显示摘要
- **THEN** footer SHALL 只保留最新尾部可见行

#### Scenario: 折叠不改变最终 assistant 原文
- **WHEN** streaming Markdown preview 被折叠显示
- **THEN** 系统 SHALL 继续在内存中保留完整原始 draft
- **THEN** assistant 完成后追加的 transcript record SHALL 包含完整原始 Markdown 文本
