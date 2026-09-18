## Context

assistant Markdown 的终端投影分两层：`src/render/markdown/index.ts` 负责 block 级识别与投影，`src/render/markdown/markdown-inline.ts` 的 `parseInlineSpans` 负责 inline span。inline 解析被普通段落、列表、引用以及 table cell（`markdown-table.ts` 复用同一函数）共享。

现有 inline 候选只有 code、link、strikethrough、bold、italic 五类；`findNextInline` 把所有候选按 `start`/`end` 排序后取最靠前者，形成"先出现的结构优先、互不嵌套"的保守语义。`InlineMatch` 目前要求必有 `style`。

streaming 提交边界由 `getCommittableMarkdownText` 决定：只有完整 block 之前的内容会被确定到终端历史区，最后一块始终 pending、可重渲染；行级投影因此只有在整行稳定后才会被冻结。

约束：不引入第三方依赖与第三方 TUI 库；宽度口径由 `character-width-determination` 固定（EAW Ambiguous 一律 1 列、组合符 0 列）；渲染层不得改变 transcript 原文。

同类参考：codex 在 Markdown 解析前做 mask + 独立的有界数学渲染器（含多行 display 分式）；pi 通过 `grok-mermaid` 依赖实现图表。echo-tui 选择只做行内、零依赖、保守回退的窄路径。

## Goals / Non-Goals

**Goals:**

- 行内 `$...$`、`\(...\)` 在受支持子集内转换为可读 Unicode 近似文本。
- 高置信识别：货币、shell 语法、转义、inline code/链接内部零误伤；不支持即整体回退原文。
- 完全复用既有换行、宽度、streaming 提交与 ANSI 闭合机制；新增 `markdown.styles.math` 主题 token（紫罗兰色系）表达转换结果，无新配置项。
- 纯渲染层：transcript、持久化、provider 输入不变。

**Non-Goals:**

- display 公式（`$$...$$`、`\[...\]`）与多行布局（display 分式、矩阵、`\begin{}` 环境）。
- 完整 TeX 兼容、`\sqrt[n]{}`、嵌套 script 等超出子集的结构。
- 反斜杠可见文本的通用 unescape（`\$` 维持现状字面显示）。
- Mermaid 或其他图表渲染。

## Decisions

### D1: 集成点为 `findNextInline` 新增候选，不做预扫描 mask

math 识别器与现有五类候选并列，由 `start`/`end` 排序决定优先级：code span、link 若更早出现则整体获胜并吞掉其内部文本，数学自然不进入 code/link 内部。codex 用"解析前 mask + protected ranges"保证数学不覆盖受保护结构；我们以候选排序为主，并增加一个重叠护栏：数学候选与 code/link 候选范围相交时放弃转换、退回下一候选，保证链接或代码不会被数学定界符拦腰截断。相比引入第二个解析 pass，这个方案不需要维护受保护区列表；代价是无法转换强调标记内部的公式（见 Risks）。

备选：预处理 mask（如 codex）——需要完整扫描 + 受保护区建模，与当前行式扫描器收益不匹配，否决。

### D2: 独立纯函数模块与有界预算

新增 `src/render/markdown/inline-math.ts`，导出 `findInlineMath(text, from)` 扫描器（返回 `{start, end, text}` 或 null）与内部转换器；无 theme/ANSI 参数、不抛异常。预算（保守内部常量）：

- 快速短路：文本不含 `$` 且不含 `\(` 时直接返回 null。
- 公式长度 ≤ 512 code points；closer 搜索窗口 ≤ 512 code points。
- 解析深度 ≤ 16；单次扫描的 opener 尝试次数封顶。

备选：把转换逻辑内联进 `markdown-inline.ts`——该文件已有 5 个 finder，加入符号表与子集解析器会失控，否决。

### D3: 转换语义为"受限子集 → 单行 Unicode"，失败即整体回退

- 符号：希腊字母（含 `\varpi`、`\varkappa` 等变体）、关系/运算/箭头/集合/逻辑/几何、`\infty`、`\partial`、`\nabla`、大运算符（`\sum`、`\prod`、`\int` 及 `\iint`、`\oint`）、`\aleph`、`\hbar`、`\ell`、`\Re`、`\Im`、`\dagger`、`\prime`、`\circ`、`\vdots`、`\ddots` 等。
- 上下标：`^`/`_` 作用于单 grapheme base，字符经映射表转换：
  - 上标 `0123456789+-=()abcdefghijklmnoprstuvwxyz` → `⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ`
  - 下标 `0123456789+-=()aehijklmnoprstuvx` → `₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ`
  - 任一字符无映射、base 非单 grapheme、重复 script 或 script 连续出现 → 整体失败回退。
- `\frac{a}{b}` → `((a)/(b))`（仅单行）；`\sqrt{x}` → `√(x)`，拒绝 `\sqrt[n]{}`。
- accents：`\hat`、`\bar`、`\tilde`、`\vec`、`\dot`、`\ddot` 仅接受单 grapheme 参数，输出 base + 组合符。
- 定界符：`\left`/`\right` 后随 `( ) [ ] | . < >`，以及 `\langle`、`\rangle`、`\lfloor`、`\rfloor`、`\lceil`、`\rceil`、`\lVert`、`\rVert`、`\lvert`、`\rvert`、`\lbrace`、`\rbrace`、`\lbrack`、`\rbrack`、`\|`。
- 透传：`\mathrm`、`\mathbf`、`\mathit` 作用到参数；`\text{...}`、`\operatorname{...}` 透传文本（含 `{ \ $ % # &` 或控制字符则失败）。
- 空白命令：`\,`、`\;`、`\:`、`\ ` → 单空格；`\!` → 无输出。
- 输出为单行文本（无多行布局）。

### D4: 识别护栏（保守配对，宁可少转不可错转）

- `$` opener 被奇数个反斜杠前置 → 转义，跳过；`$$` 视为 display，跳过。
- `$` 后紧随空白、`(`、`{` → 跳过（shell 形态）。
- 只接受同一行内、未被转义的 closer；closer 后紧邻字母或数字 → 拒绝（货币续写）。
- 公式非空、首尾无空白、不含反引号。
- 纯数字开头且不含 `\ ^ _ = + - * / < >` → 拒绝（货币）。
- 长度 > 1 且全为大写字母 → 拒绝（shell 变量形态）。
- 拒绝后从 opener+1 继续扫描，允许 closer 复用为后续 opener（覆盖 `$HOME then $\alpha$` 场景）。
- `\(`/`\)` 采用同一转义与同行闭合规则，无货币类护栏。

### D5: `math` token 样式与既有合并语义

数学转换结果使用当前 render theme 的 `math` token 样式（紫罗兰色系），由 `findNextInline` 在构造候选时包裹 `markdownStyle(theme, 'math', ...)`；`inline-math.ts` 保持无 theme/ANSI 的纯函数边界。`InlineMatch.style` 回退为必填，`mergeAdjacentSpans` 不再把数学 span 与相邻纯文本合并——这正是样式隔离的要求，ANSI 在每个 span 结束处闭合。

选色：深色主题取 violet-300/400 档，`default` 为 `rgb(190, 165, 255)`；浅色主题取 violet-600/700 档，`default-light` 为 `#6d28d9`；`monochrome` 保持灰度中性色，不引入彩色。所有内置主题逐一补 `math`，与各主题既有 link、inlineCode 色相保持可区分。

备选：保留无样式并让相邻纯文本合并——与"math 专属色"目标冲突，否决；备选：复用 link 或 inlineCode 色——不满足专属语义，否决。

### D6: 宽度与组合符兼容策略

只使用项目宽度口径已覆盖的字符：上下标映射值必须是 `charWidth === 1` 且不落入 WIDE/emoji 区间；accents 组合符必须是零宽（Grapheme_Extend）。该不变式由单元测试遍历映射表锁定。grapheme 切分沿用既有 `splitGraphemes`（组合符触发 Segmenter 回退路径），换行沿用 `renderStyledLine`。

### D7: 测试策略

- 单元：转换矩阵、护栏矩阵、回退矩阵、映射表宽度不变式、预算边界。
- 集成：`renderMarkdownLines` 段落/列表/引用/table cell、code span 与 link 优先级、display 公式原样、每行 `displayWidth ≤ safeRenderWidth`。
- streaming：未闭合保持字面、闭合后重渲染出现转换、提交边界之后行内容稳定。
- 期望值参照 codex 快照样例（其非 display 子集与本子集一致），必要时按本实现预算调整边界用例。

## Risks / Trade-offs

- [误伤普通文本：成对 `$` 被当作数学] → 多层护栏 + 货币/shell/转义回归用例；保守优先，宁可少转不可错转。
- [强调标记内的公式不转换（如 `**$x$**`）] → 与既有"inline 不嵌套"语义一致（code span 在 bold 内同样不解析）；文档标注为已知限制，不在本期扩展。
- [覆盖度有限：复杂表达式回退为原文] → 回退即现状，无回归；Non-Goals 已明确。
- [个别终端把上/下标渲染成 2 列] → 项目宽度口径已固定 Ambiguous=1；测试锁定映射字符集合，不引入终端特判。
- [性能：大量 `$` 触发重复扫描] → 快速短路 + 有界窗口 + 尝试预算；纯字符串操作，无不可控递归。
- [与 display 公式相邻的歧义（`$$`）] → `$$` 永不作为 inline opener，专项用例覆盖。

## Migration Plan

不适用：纯渲染层变更，无持久化、协议或配置迁移。回滚只需移除 `findInlineMath` 注册与 `inline-math.ts`，无状态残留。

## Open Questions

无阻塞项。未来若扩展 display 公式或多行布局，需重新评估 codex 式 mask 方案，另开变更。
