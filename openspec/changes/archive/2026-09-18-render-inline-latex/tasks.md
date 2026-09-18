## 1. inline-math 模块

- [x] 1.1 新建 `src/render/markdown/inline-math.ts`：导出 `findInlineMath(text, from)` 扫描器（`$`/`\(` 配对、转义奇偶、同行闭合、快速短路）与内部转换器；纯函数、无 theme/ANSI、不抛异常；核心函数 JSDoc、中文注释。
- [x] 1.2 实现受限子集转换：符号表（希腊字母/关系/运算/箭头/集合/逻辑/大运算符等）、上下标映射与单 grapheme base 约束、`\frac`、`\sqrt`、accents、`\left/\right` 与命名定界符、`\mathbb`、`\text`/`\mathrm` 透传、空白命令。
- [x] 1.3 实现识别护栏与预算：`$$` 跳过、opener 后随空白/`(`/`{` 拒绝、closer 后随字母数字拒绝、纯数字与全大写规则、反引号拒绝、长度/深度/扫描预算；任何不支持返回 null（整体回退）。
- [x] 1.4 导出映射表供测试遍历；上下标映射值 `charWidth === 1`、accents 组合符零宽的宽度不变式由测试锁定，不引入运行时断言。

## 2. 接入 inline 管线

- [x] 2.1 `src/render/markdown/markdown-inline.ts`：`findNextInline` 增加 `findInlineMath` 候选。
- [x] 2.2 验证候选排序语义：code span 或 link 先出现时数学不转换；数学先出现时正常转换，并确认既有 finder 行为不变。
- [x] 2.3 确认无 theme、无 config、无 ANSI 变化；宽度与换行路径不修改。

## 3. 测试

- [x] 3.1 新增 `test/render/inline-math.test.js`：转换矩阵（符号、`x^2`、`\beta_{10}`、`\frac`、`\sqrt`、accents、定界符、`\text` 透传）。
- [x] 3.2 护栏矩阵：`$5 and $10`、`$HOME`、`${HOME}`、`$(echo x)`、`\$5.00 and $\alpha$`、`$USD$`、`$42$`、含反引号内容、未闭合、超长、超深——断言原文保留且不抛错。
- [x] 3.3 回退矩阵：`\unknown{x}`、`\frac{a}{b}^2`、`x^2^3`、`\sqrt[3]{x}`、`\begin{matrix}`、`{a+b}^2` 整体回退。
- [x] 3.4 映射与宽度不变式：遍历上下标映射与 accents，断言 `charWidth` 为 1 / 0；断言转换输出逐行 `displayWidth ≤ safeRenderWidth`。
- [x] 3.5 `test/render/markdown.test.js` 集成：段落/列表/引用/table cell、code span 与 link 优先级、`$$...$$` 与 `\[...\]` 原样、每行宽度约束。
- [x] 3.6 streaming 稳定性：未闭合 `$` 保持字面、闭合后重渲染出现转换、提交边界之后行内容稳定。

## 4. 文档

- [x] 4.1 `docs/tui-architecture.md`：inline parser 描述补充行内数学转换、回退语义与已知限制（强调标记内不转换、display 公式不转换）。

## 5. 验证

- [x] 5.1 `npm run typecheck`
- [x] 5.2 `npm test`
- [x] 5.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.4 `openspec validate render-inline-latex --strict`
- [x] 5.5 手工 TUI 验证：fake agent 输出含 `$\alpha^2$`、货币、shell 变量、窄宽度换行、table cell、streaming 逐字出现、math 颜色渲染（多主题）等场景。

## 6. math theme token

- [x] 6.1 `src/config/theme-config.ts`：`MarkdownThemeStyles` 新增 `math` token；`DEFAULT_TUI_THEME.markdown.styles.math = {foreground: rgb(190, 165, 255)}`。
- [x] 6.2 24 个内置主题 JSON 逐一补 `math` 配色（深色主题 violet-300/400 档、浅色主题 violet-600/700 档、`monochrome` 保持灰度；`default.json` 与代码默认严格一致）。
- [x] 6.3 `src/render/markdown/markdown-inline.ts`：数学候选包裹 `markdownStyle(theme, 'math', ...)`；`InlineMatch.style` 回退为必填。
- [x] 6.4 测试：theme-config math token 覆盖/无效回退/内置主题完整性；inline-math 默认渲染含 ANSI、`stripAnsi` 后宽度不变、自定义覆盖生效、样式闭合不泄漏。
- [x] 6.5 `docs/tui-architecture.md`：行内数学"无样式"措辞更新为 `math` token。
- [x] 6.6 验证：`npm run typecheck` / `npm test` / `node --check` / `openspec validate render-inline-latex --strict`。
