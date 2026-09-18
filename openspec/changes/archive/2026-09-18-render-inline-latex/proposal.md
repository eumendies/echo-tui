## Why

LLM 在技术讨论、数学和论文类对话中经常输出行内 LaTeX（`$...$`、`\(...\)`）。当前 inline 解析只处理 inline code、bold、italic 和 link，TeX 源码会原样进入可见投影：`$\alpha^2 + \beta_{10}$`、`\frac{a}{b}` 这类文本在终端里噪声大、几乎不可读。终端无法排版真正的数学公式，但可以把一个受限子集近似转换为 Unicode 文本（如 `α² + β₁₀`），codex、pi 等同类工具已经用这一路径证明可行。转换必须严格限定在渲染投影层，并保守处理非数学的 `$` 场景（货币、shell 变量、转义），避免误伤普通文本。

## What Changes

- 新增行内数学转换：普通文本中的 `$...$` 与 `\(...\)` 在被确认为数学表达式时，转为 Unicode 近似文本。
- 受支持子集：符号表（希腊字母、运算/关系/箭头/集合/逻辑等）、上下标（`x^2`→`x²`、`\beta_{10}`→`β₁₀`）、行内 `\frac{a}{b}`→`((a)/(b))`、`\sqrt{x}`→`√(x)`、单字素 accents（`\hat`、`\bar`、`\vec` 等）、`\left/\right` 定界符、`\mathbb`、`\text`/`\mathrm` 等透传。
- 保守回退：任一子片段超出子集、解析失败、超长或未在同行闭合 → 整个表达式原样保留，绝不输出半转换结果。
- 识别边界：`$` 后随空白/`(`/`{`、closer 后随字母数字、纯数字开头且无运算符、全大写单词等场景不视为数学；转义 `\$` 不参与转换；inline code 与链接内部不转换；display 公式（`$$...$$`、`\[...\]`）保留原文，本期不转换。
- 主题化样式：成功转换的数学文本使用当前 render theme 新增的 `markdown.styles.math` token（紫罗兰色系）；用户可在 `theme.json` 覆盖，24 个内置主题逐一配色。
- 纯渲染层行为：transcript 原文、持久化、provider 请求输入均不变；复用既有 display-width 换行与主题机制，不新增依赖、配置项或其他主题语义。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `markdown-terminal-rendering`: 新增行内数学（`$...$`、`\(...\)`）转换需求，包括受限 TeX 子集到 Unicode 的转换语义、整体回退语义、货币/shell/代码/链接等识别边界，以及转换文本与既有宽度、换行、streaming 稳定边界的兼容约束。
- `footer-theme-config`: 默认 token 语义新增 Markdown `inline math` token；内置主题 JSON 覆盖约束随之扩展。

## Impact

- 新增 `src/render/markdown/inline-math.ts`：纯函数扫描器与转换器（符号表、上下标映射、有界预算），无 ANSI 输出。
- `src/render/markdown/markdown-inline.ts`：`findNextInline` 增加数学候选，转换结果携带 `math` token 样式并入既有 `mergeAdjacentSpans` 与换行路径；`InlineMatch.style` 回退为必填。
- `src/config/theme-config.ts`：`MarkdownThemeStyles` 新增 `math` token 与默认色。
- `src/config/themes/*.json`：24 个内置主题补 `math` 配色。
- 测试：新增 `test/render/inline-math.test.js`（转换、边界、回退、宽度约束）；`test/render/markdown.test.js` 补充段落与表格集成用例。
- 文档：`docs/tui-architecture.md` 的 inline parser 与 Markdown 子集描述同步。
- 无协议、配置、依赖或持久化影响。
