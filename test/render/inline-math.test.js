const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findInlineMath,
  INLINE_MATH_SYMBOL_MAP,
  INLINE_MATH_BLACKBOARD_MAP,
  INLINE_MATH_ACCENT_MAP,
  INLINE_MATH_SUPERSCRIPT_MAP,
  INLINE_MATH_SUBSCRIPT_MAP
} = require('../../src/render/markdown/inline-math');
const { DEFAULT_TUI_THEME, createTuiTheme } = require('../../src/config/theme-config');
const { charWidth, displayWidth, safeRenderWidth, stripAnsi } = require('../../src/render/layout');
const { renderMarkdownLines } = require('../../src/render/markdown');

/** 对整段文本运行 findInlineMath 扫描，返回“已转换”的拼接结果（未转换部分保留原文）。 */
function projectMath(text) {
  let result = '';
  let index = 0;

  while (index < text.length) {
    const match = findInlineMath(text, index);
    if (!match) {
      result += text.slice(index);
      break;
    }
    result += text.slice(index, match.start) + match.text;
    index = match.end;
  }

  return result;
}

test('findInlineMath converts supported symbols, scripts, fractions, roots, accents, and delimiters', () => {
  const cases = [
    ['$\\alpha^2 + \\beta_{10}$', 'α² + β₁₀'],
    ['\\(\\alpha^2\\)', 'α²'],
    ['$x^2$', 'x²'],
    ['$x^{-1}$', 'x⁻¹'],
    ['$a_i^j$', 'aᵢʲ'],
    ['$\\frac{a}{b}$', '((a)/(b))'],
    ['$\\dfrac{1}{2}$', '((1)/(2))'],
    ['$\\sqrt{x}$', '√(x)'],
    ['$\\sqrt{x^2+y^2}$', '√(x²+y²)'],
    ['$\\hat{x}_1$', 'x\u0302₁'],
    ['$\\bar{\\Psi}$', 'Ψ\u0304'],
    ['$\\vec{v}$', 'v\u20d7'],
    ['$\\tilde{x}$', 'x\u0303'],
    ['$\\dot{x}$', 'x\u0307'],
    ['$\\ddot{x}$', 'x\u0308'],
    ['$\\left(\\frac{a}{b}\\right)$', '(((a)/(b)))'],
    ['$\\left. x \\right|$', ' x |'],
    ['$\\langle x \\rangle$', '⟨ x ⟩'],
    ['$\\lfloor x \\rfloor$', '⌊ x ⌋'],
    ['$\\lVert v \\rVert$', '‖ v ‖'],
    ['$\\mathbb{R}^n$', 'ℝⁿ'],
    ['$\\mathbb{Z} \\subset \\mathbb{Q}$', 'ℤ ⊂ ℚ'],
    ['$\\text{if}$', 'if'],
    ['$\\mathrm{dx}$', 'dx'],
    ['$a\\,b$', 'a b'],
    ['$\\pi \\approx 3.14$', 'π ≈ 3.14'],
    ['$\\infty$', '∞'],
    ['$A \\cup B \\cap C$', 'A ∪ B ∩ C'],
    ['$a \\to b \\Rightarrow c$', 'a → b ⇒ c'],
    ['$\\sum_{i=1}^{n} x_i$', '∑ᵢ₌₁ⁿ xᵢ'],
    ['$\\int_0^1 f(x)\\,dx$', '∫₀¹ f(x) dx'],
    ['$\\forall x \\in A$', '∀ x ∈ A']
  ];

  for (const [source, expected] of cases) {
    if (expected === '') continue; // 占位保护，不参与断言
    assert.equal(projectMath(source), expected, `source: ${source}`);
  }
});

test('findInlineMath keeps currency, shell, and prose patterns unchanged', () => {
  const cases = [
    ['Costs $5 and $10.', 'Costs $5 and $10.'],
    ['$5', '$5'],
    ['$HOME', '$HOME'],
    ['${HOME} and $(echo x)', '${HOME} and $(echo x)'],
    ['$USD$+$\\alpha$', '$USD$+α'],
    ['$42$', '$42$'],
    ['\\$5.00 and $\\alpha$', '\\$5.00 and α'],
    ['$HOME then $\\alpha$', '$HOME then α'],
    ['$x$y', '$x$y'],
    ['$x$ y', 'x y'],
    ['Run echo $$ to print PID. Then $\\alpha$', 'Run echo $$ to print PID. Then α'],
    ['$$E = mc^2$$', '$$E = mc^2$$'],
    ['\\[ y = x \\]', '\\[ y = x \\]'],
    ['$a`b$', '$a`b$'],
    ['$x\ny$', '$x\ny$'],
    ['$\\alpha', '$\\alpha']
  ];

  for (const [source, expected] of cases) {
    assert.equal(projectMath(source), expected, `source: ${source}`);
  }
});

test('findInlineMath falls back verbatim for unsupported expressions', () => {
  const cases = [
    '$\\unknown{x}$',
    '$\\frac{a}{b}^2$',
    '$x^2^3$',
    '$x^{q}$',
    '$\\sqrt[3]{x}$',
    '$\\begin{matrix}a\\end{matrix}$',
    '${a+b}^2$',
    '$\\hat{xy}$',
    '$^2$',
    '$x}$',
    '$\\frac{a}$',
    '$\\text{\\alpha}$'
  ];

  for (const source of cases) {
    assert.equal(projectMath(source), source, `source: ${source}`);
  }
});

test('findInlineMath respects budgets for long and deeply nested input', () => {
  const longFormula = `$${'a'.repeat(600)}$`;
  const deepFormula = `$${'\\frac{'.repeat(20)}a${'}'.repeat(20)}$`;

  assert.equal(projectMath(longFormula), longFormula);
  assert.equal(projectMath(deepFormula), deepFormula);
});

test('findInlineMath match positions cover the full delimiters', () => {
  const text = 'before $\\alpha$ after';
  const match = findInlineMath(text, 0);

  assert.ok(match);
  assert.equal(text.slice(match.start, match.end), '$\\alpha$');
  assert.equal(match.text, 'α');
});

test('inline math mapping tables only contain width-safe characters', () => {
  for (const [key, value] of Object.entries(INLINE_MATH_SUPERSCRIPT_MAP)) {
    assert.equal(charWidth(value), 1, `superscript ${key}`);
  }
  for (const [key, value] of Object.entries(INLINE_MATH_SUBSCRIPT_MAP)) {
    assert.equal(charWidth(value), 1, `subscript ${key}`);
  }
  for (const [key, value] of Object.entries(INLINE_MATH_SYMBOL_MAP)) {
    assert.equal(charWidth(value), 1, `symbol ${key}`);
  }
  for (const [key, value] of Object.entries(INLINE_MATH_BLACKBOARD_MAP)) {
    assert.equal(charWidth(value), 1, `blackboard ${key}`);
  }
  for (const [key, value] of Object.entries(INLINE_MATH_ACCENT_MAP)) {
    assert.equal(charWidth(value), 0, `accent ${key}`);
  }

  // 组合符与被修饰字符合成单个 grapheme，整体宽度仍为 1。
  assert.equal(displayWidth('x\u0302'), 1);
  assert.equal(displayWidth('Ψ\u0304'), 1);
});

test('rendered inline math stays within safe width and does not break wrapping', () => {
  const width = 18;
  const lines = renderMarkdownLines('结果 $\\alpha^2 + \\beta_{10} + \\sqrt{x^2+y^2}$ 完成', width, '◆ ');
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.join('\n').includes('α² + β₁₀'));
  assert.ok(plainLines.join('\n').includes('√(x²+y²)'));
  assert.ok(!plainLines.join('\n').includes('$'));
  assert.ok(!plainLines.join('\n').includes('\\'));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(width));
  }
});

test('rendered inline math uses the math theme token and closes its style', () => {
  const width = 80;
  const defaultColor = '\x1b[38;2;190;165;255m';
  const lines = renderMarkdownLines('值 $\\alpha^2$ 结束', width, '◆ ');
  const rendered = lines.join('\n');

  // 转换结果使用 math token 颜色，并在 span 结束处闭合。
  assert.ok(rendered.includes(`${defaultColor}α²\x1b[39m`));
  // 相邻纯文本不被 math 样式包裹。
  assert.ok(!rendered.includes(`${defaultColor}值`));
  assert.ok(!rendered.includes(`${defaultColor} 结束`));

  // 默认 token 值由代码内常量提供。
  assert.deepEqual(DEFAULT_TUI_THEME.markdown.styles.math, {foreground: {kind: 'rgb', value: [190, 165, 255]}});
});

test('inline math color follows theme overrides and stays off for fallback text', () => {
  const width = 80;
  const overridden = createTuiTheme({markdown: {styles: {math: {foreground: '#010203'}}}});
  const rendered = renderMarkdownLines('值 $\\alpha^2$ 结束', width, '◆ ', overridden).join('\n');

  assert.ok(rendered.includes('\x1b[38;2;1;2;3mα²\x1b[39m'));
  assert.ok(!rendered.includes('\x1b[38;2;190;165;255m'));

  // 回退原文不携带 math 样式。
  const fallback = renderMarkdownLines('值 $\\unknown{x}$ 结束', width, '◆ ').join('\n');
  assert.ok(fallback.includes('$\\unknown{x}$'));
  assert.ok(!fallback.includes('\x1b[38;2;190;165;255m'));

  // ANSI 不影响 display width。
  assert.equal(displayWidth(rendered.split('\n')[0]), displayWidth(stripAnsi(rendered.split('\n')[0])));
});

test('math conversion does not swallow inline code or link structures', () => {
  const codeSource = '`$\\alpha$`';
  const codeLines = renderMarkdownLines(codeSource, 80, '◆ ').map((line) => stripAnsi(line));
  assert.ok(codeLines.some((line) => line.includes('$\\alpha$')));

  const linkSource = '[text](https://example.com/path)';
  const linkLines = renderMarkdownLines(linkSource, 80, '◆ ').map((line) => stripAnsi(line));
  assert.ok(linkLines.some((line) => line.includes('(https://example.com/path)')));

  // closer 落在链接文本内的数学候选应放弃，不得把链接截断成普通文本。
  const overlapSource = '$x$ [link](url)';
  const overlapLines = renderMarkdownLines(overlapSource, 80, '◆ ').map((line) => stripAnsi(line));
  assert.ok(overlapLines.some((line) => line.includes('x')));
  assert.ok(overlapLines.some((line) => line.includes('link (url)')));
});
