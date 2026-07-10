## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Generic cross-line syntax highlighting
系统 SHALL 为 fenced code block 内容提供通用跨行语法高亮。高亮器 SHALL 以完整 code block 为输入，按顺序扫描代码文本并生成 semantic token spans；token spans SHALL 复用现有 display-width aware wrapping 和 ANSI 样式闭合规则。高亮器 SHALL 至少识别通用字符串、注释、数字、关键字、函数名、操作符和标点 token；无法识别的文本 SHALL 作为普通代码文本显示。

#### Scenario: 通用 token 被高亮
- **WHEN** fenced code block 包含字符串、注释、数字、关键字、函数调用、操作符或标点
- **THEN** render 层 SHALL 将可识别片段映射为对应 semantic token 样式
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
- **THEN** footer pending preview SHALL 使用与最终 assistant transcript 相同的通用跨行高亮规则投影当前 draft
- **THEN** partial token、未闭合字符串、未闭合注释或未闭合 fence SHALL NOT 中断 streaming preview 渲染

### Requirement: Syntax highlight theme configuration
系统 SHALL 支持用户通过可选配置控制语法高亮颜色。配置 SHALL 位于用户级配置文件的 TUI 配置区域，并 SHALL 以 semantic token kind 为单位覆盖内置默认主题。语法高亮配置缺失或局部无效时，系统 SHALL 使用默认主题安全降级；配置错误 SHALL NOT 阻断普通消息提交或向 transcript 写入错误记录。

#### Scenario: 无配置时使用默认主题
- **WHEN** 用户级配置文件不存在 `tui.syntaxHighlight` 配置
- **THEN** render 层 SHALL 使用内置默认语法高亮主题
- **THEN** fenced code block SHALL 继续按通用高亮规则显示

#### Scenario: 用户配置覆盖 token 颜色
- **WHEN** 用户级配置文件提供有效的 `tui.syntaxHighlight.colors` token 样式覆盖
- **THEN** render 层 SHALL 将有效覆盖合并到内置默认主题
- **THEN** 未被覆盖的 token kind SHALL 继续使用默认主题样式

#### Scenario: 高亮配置错误不阻断聊天
- **WHEN** 用户级配置文件中的 `tui.syntaxHighlight` 配置缺失字段、包含未知 token kind、未知颜色或错误类型
- **THEN** 系统 SHALL 忽略无效的高亮配置项或回退到默认主题
- **THEN** 系统 SHALL NOT 因该配置错误阻止应用启动、普通消息提交或 assistant 渲染
- **THEN** 系统 SHALL NOT 把高亮配置错误写入 transcript record
