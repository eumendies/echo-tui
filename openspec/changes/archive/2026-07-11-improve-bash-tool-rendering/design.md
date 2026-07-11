## Context

现有 bash 专属 renderer 将 `command` 参数转换为单行 `Bash('...')` 文本，再交给通用前缀换行逻辑处理。这个投影会把命令换行变成字面量转义字符，无法表达 heredoc、长 `-c`/`-e` 内嵌脚本及其输出之间的边界。

工具调用和结果在正常 agent 流中会以相邻记录成组追加，transcript 重放时也会按相邻且匹配的 call id 聚合。footer pending 预览则只有 tool call 参数。所有渲染必须使用当前 render theme、遵守 safe render width，且只投影既有事实记录。

## Goals / Non-Goals

**Goals:**

- 为 `run_bash_command` 建立轻量、连续的 rail 专属投影，清楚区分命令区与结果区。
- 保留可审计的 shell 上下文和多行结构，并对可安全识别的内嵌脚本提供折叠预览。
- 让 pending、完成态、transcript 重放和 resize recovery 共享相同的视觉语义。
- 在成功、失败、超时、截断、无输出与窄终端下保持清晰且不越界。

**Non-Goals:**

- 不改变 bash 工具的参数 schema、执行策略、输出截断策略、approval 流程或 provider-visible 文本。
- 不实现完整 shell parser、脚本语法高亮、交互式展开折叠或新的 theme 配置字段。
- 不改变其他 tool 的通用或专属 renderer。

## Decisions

### 使用无边框的双段 rail，而非 frame、band 或通用函数调用行

调用首行保留 `◆` 标记；命令区各行使用当前 theme 的 tool 语义色左 rail，结果区各行使用 muted 左 rail。两段之间使用一条空的 muted rail 作为连续转场，整个块末尾保留空行以避免相邻调用粘连。

frame 会使连续 transcript 过于厚重，band 会引入大面积背景色；通用 `Bash('...')` 无法承载脚本结构。rail 只增加一列视觉锚点，适合高频工具记录。

### 将匹配的 bash call/result 作为 pair-aware block 渲染

新增 bash 的 pair-aware 渲染入口，同时读取 call 的原始命令与 result 的状态、退出码、耗时、超时和截断元数据。完成态标题仅显示一次紧凑状态，例如成功/失败、退出码和可用耗时；调用标记按完成状态使用 success 或 error 语义色，pending 使用 muted 色。失败态的命令 rail 和标题同样使用 error 语义色，以便用户快速扫到失败块；命令正文仍保持普通文本色，避免整段脚本过度告警。结果区不显示 `output`、`stdout` 或 `stderr` 标题，直接以 rail 和 stdout/stderr 的文本颜色显示既有结果顺序。

这避免拆分 renderer 只能得到布尔成功状态的问题。pending 预览仍走 call-only rail，标题或末行显示运行中状态；解析失败时保持通用 renderer fallback。

### 保守解析命令，优先保证完整可见

renderer 从 JSON arguments 提取原始 `command`。普通命令按原始逻辑行投影；视觉换行不会伪造 shell 续行符。对于可确定边界的 heredoc，保留从命令起始到 heredoc marker 的完整 shell 头部，将 marker 与脚本正文分区，并按逻辑脚本行折叠。对于可确定闭合边界的长 `-c`/`-e` 参数，显示 shell 头部和折叠脚本正文。

正则识别无法可靠处理转义引号、嵌套引用或复杂命令替换时，renderer 不拆分命令，直接原样多行投影。相比错误分割并省略命令片段，此方案更适合执行审计。

### 命令和结果采用独立的展示预算

脚本正文和结果输出各自按逻辑行设置展示预算。stdout 与 stderr 先转为带样式的单一结果行序列，再应用同一个结果展示预算；超出预算时显示包含隐藏行数的省略行，避免两个通道各自占满预算。每个逻辑行再按可用显示宽度换行或截断，确保任何物理行不超出 safe render width。结果沿用现有结构化 timeout 和 truncated 字段作为状态事实来源，不从输出文本中的同名字面量推断状态，也不改写保存内容。

输出标题会与 rail 色块重复，因此不显示 `output`、`stdout` 或 `stderr` 文案。stderr 继续使用 error 语义色，但不额外插入标签，以保持类似普通终端的连续输出阅读体验。

### 复用现有 theme 语义 token

命令 rail、结果 rail、成功/错误状态、代码样式和弱化文字分别映射到已有 blocks 与 footer 的语义颜色。不得将 demo 调色板或原始 ANSI 色值固化到 renderer；自定义 theme 仍能影响该投影。

## Risks / Trade-offs

- [shell 语法的启发式解析误判] → 仅在边界可确定时拆分；heredoc 闭合遵守 `<<` 精确匹配与 `<<-` 仅去除前导 tab 的规则，其余输入完整降级为原始命令显示。
- [长脚本或输出占据 transcript] → 为脚本和输出设置独立逻辑行预算与可计数省略行。
- [窄终端导致 rail 和内容越界] → 以 safe render width 为唯一宽度上限，按需省略状态细节而不依赖最小卡片宽度。
- [实时 append 与重放不一致] → pair-aware renderer、pending renderer 和完整 transcript 重放共享命令解析及 rail 行构造函数。
- [新增样式破坏自定义主题] → 只消费既有 theme 语义 token，并覆盖默认与自定义 theme 的渲染测试。
