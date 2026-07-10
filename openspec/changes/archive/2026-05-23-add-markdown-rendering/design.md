## Context

当前 render 层以 `src/render/blocks.ts` 为 transcript block 投影入口，依赖 `src/render/layout.ts` 做 ANSI 剥离、display width 和 wrap 计算。assistant 正式消息和 streaming pending preview 目前都按纯文本逐行 wrap，并通过 `◆` / `◇` 前缀区分状态。LLM 回复常包含 Markdown，尤其是标题、列表、代码块和 inline code；如果继续按纯文本显示，结构信息会被符号噪声和普通换行淹没。

本 change 只改变 render projection，不改变 transcript record schema、agent input、persistence、OpenAI adapter 或 slash command 行为。transcript 仍保存原始 Markdown 文本，resize/destructive replay 时重新按当前 terminal width 投影。

## Goals / Non-Goals

**Goals:**

- 为 assistant final transcript block 提供 Markdown-aware 终端投影。
- 为 streaming pending preview 提供容错 Markdown-aware 投影，并继续遵守 terminal rows 动态高度预算。
- 支持高价值 Markdown 子集：heading、paragraph、unordered/ordered list、blockquote、horizontal rule、inline code、fenced code block。
- 代码块不画边框、不做卡片，只对代码内容直接高亮显示，并保留原始缩进；代码块内部不解析 inline Markdown。
- 保持中文宽字符、ANSI 样式和 resize replay 下的布局稳定性。

**Non-Goals:**

- 不实现完整 CommonMark 兼容。
- 不支持 HTML Markdown 渲染、复杂 table 布局、嵌套列表完美排版、任务列表状态控件或语法级代码高亮。
- 不改变 user/error transcript 的渲染语义。
- 不引入第三方 TUI 库、bundler、loader 或持久化格式迁移。

## Decisions

### Decision 1: 在 render 层新增轻量 Markdown 投影模块

新增 `src/render/markdown.ts`，负责把 assistant Markdown 文本解析并投影为可见行。`blocks.ts` 继续负责 role 前缀、消息块间距和调用路径；Markdown 模块只处理 assistant 内容内部结构。

替代方案：在 `blocks.ts` 内直接堆叠 Markdown 分支。拒绝原因是 `blocks.ts` 已承载 banner、user、assistant、error、pending 等职责，继续扩展会让 role block 与 Markdown 内部语法耦合。

### Decision 2: 默认手写 Markdown subset parser

第一版使用按行扫描的 tolerant parser，而不是引入完整 Markdown parser 或终端 Markdown renderer。解析状态主要区分 normal 与 fenced code block，并识别 heading/list/quote/rule/paragraph。

替代方案：引入 `markdown-it` 或 `marked`。拒绝原因是本项目依赖面很小，且需要完全控制 ANSI、display width、footer 高度预算和 code block 视觉约束；完整 parser 的收益小于集成复杂度。

### Decision 3: 代码块直接高亮，不画框

fenced code block SHALL 不输出边框、卡片、语言标签或额外 box drawing。代码内容按行直接高亮，例如用 dim/white/yellow 等现有 ANSI helper 做整体代码样式。代码内容保留原始缩进，并按当前宽度 wrap 或截断策略保持安全输出。语法级代码高亮复杂度较高，后续独立 change 再设计。

替代方案：使用带边框代码卡片。拒绝原因是用户明确要求“代码不用框起来，直接高亮显示”，且 box 会增加 footer/pending 高度和 resize 清理复杂度。

### Decision 4: transcript 保存原文，render 生成投影

Markdown 渲染结果不写回 transcript，也不持久化 ANSI。最终 assistant record 与 partial assistant draft 都继续保存模型返回的原始文本。

替代方案：保存渲染后的 ANSI 文本。拒绝原因是会污染 agent 上下文、破坏 `/resume` 后按终端宽度重绘的能力，并让未来样式变更需要迁移历史数据。

### Decision 5: pending preview 使用同一 Markdown 投影但必须容错

streaming draft 可能包含未闭合 fence、半个 list item 或不完整 inline marker。Markdown renderer SHALL 对 partial text 容错：未闭合 fenced code block 视为持续到 draft 末尾，无法识别的 Markdown 片段按普通文本显示。footer 仍在 Markdown 投影后按总行数折叠尾部。

替代方案：pending preview 保持纯文本，仅 final block 渲染 Markdown。拒绝原因是 streaming 期间正是用户阅读长输出的主要阶段；只要 parser tolerant，复用同一投影能保持体验一致。

## Risks / Trade-offs

- [Risk] 手写 subset 与完整 Markdown 行为不一致 → Mitigation: 明确非目标，并为常见 LLM 输出模式建立测试覆盖。
- [Risk] ANSI 样式影响 wrap 或 display width → Mitigation: wrap 时基于原始 text/span 计算宽度，输出阶段再应用 ANSI；测试覆盖 inline code、中文和长行。
- [Risk] Markdown 投影增加 pending preview 行数，影响 footer 高度 → Mitigation: 高度预算在投影后执行，继续使用现有折叠摘要和尾部保留策略。
- [Risk] partial streaming Markdown 反复改变结构导致视觉跳动 → Mitigation: parser 保守识别，未闭合或不完整结构优先按普通文本或持续代码块处理，不抛错。
- [Risk] 代码块高亮不等于语法高亮，用户可能期待语言级着色 → Mitigation: proposal 和 docs 明确第一版只做代码内容整体高亮，不做 token-level syntax highlight；语法级代码高亮后续独立 change 再设计。
