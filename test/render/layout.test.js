const test = require('node:test');
const assert = require('node:assert/strict');

const ansi = require('../../src/terminal/ansi');
const { createComposer } = require('../../src/input/composer');
const {
  charWidth,
  displayWidth,
  renderComposer,
  safeRenderWidth,
  tabWidthAt,
  wrapText
} = require('../../src/render/layout');

test('charWidth and displayWidth handle wide chars, combining marks, and ANSI', () => {
  assert.equal(charWidth('你'), 2);
  assert.equal(charWidth('⚠'), 1);
  assert.equal(charWidth('✓'), 1);
  assert.equal(charWidth('✕'), 1);
  assert.equal(charWidth('🙂'), 2);
  assert.equal(charWidth('✅'), 2);
  assert.equal(charWidth('👨‍👩‍👧‍👦'), 2);
  assert.equal(charWidth('👍🏽'), 2);
  assert.equal(charWidth('\ufe0f'), 0);
  assert.equal(charWidth('\u200d'), 0);
  assert.equal(charWidth('🏽'), 0);
  assert.equal(charWidth('\u0301'), 0);
  assert.equal(displayWidth(ansi.cyan('你a')), 3);
  assert.equal(displayWidth('✓ saved'), 7);
  assert.equal(displayWidth('✕ error'), 7);
  assert.equal(displayWidth('✅ done'), 7);
  assert.equal(displayWidth('👨‍👩‍👧‍👦 family'), 9);
});

test('charWidth covers CJK supplementary planes and non-Latin combining marks', () => {
  // CJK 扩展 B（U+20000）与扩展 G（U+30000）按 2 列。
  assert.equal(charWidth('𠀀'), 2);
  assert.equal(charWidth('𰀀'), 2);
  // 谚文初声按 2 列，中声按 0 列（组合进音节）。
  assert.equal(charWidth('ᄀ'), 2);
  assert.equal(charWidth('ᅡ'), 0);
  assert.equal(displayWidth('가'), 2);
  // 泰文组合音标不占列。
  assert.equal(charWidth('\u0e48'), 0);
  assert.equal(displayWidth('\u0e01\u0e48'), 1);
  // 零宽格式符不占列。
  assert.equal(charWidth('\u200b'), 0);
  assert.equal(charWidth('\u200c'), 0);
  assert.equal(charWidth('\u200d'), 0);
  assert.equal(charWidth('\ufeff'), 0);
  assert.equal(displayWidth('a\u200bb'), 2);
});

test('charWidth distinguishes emoji presentation from text presentation', () => {
  // 无 VS16 的文本呈现符号按 1 列。
  assert.equal(charWidth('♠'), 1);
  assert.equal(charWidth('♣'), 1);
  assert.equal(charWidth('♥'), 1);
  assert.equal(charWidth('♦'), 1);
  assert.equal(charWidth('♪'), 1);
  assert.equal(charWidth('⌘'), 1);
  assert.equal(charWidth('☎'), 1);
  assert.equal(charWidth('✈'), 1);
  // VS16 强制 emoji 呈现按 2 列。
  assert.equal(charWidth('⚠️'), 2);
  assert.equal(charWidth('♠️'), 2);
  assert.equal(charWidth('❤️'), 2);
  assert.equal(charWidth('©️'), 2);
  assert.equal(charWidth('™️'), 2);
  // 非 emoji 字符带 VS16 仍按 1 列。
  assert.equal(charWidth('✓️'), 1);
  assert.equal(charWidth('✕️'), 1);
  // VS15 强制文本呈现：❤ 无 emoji 呈现属性且非宽字符，按 1 列。
  assert.equal(charWidth('❤︎'), 1);
  // ⭐（U+2B50）在 EastAsianWidth 中为 W，即使 VS15 文本呈现也按 2 列。
  assert.equal(charWidth('⭐︎'), 2);
});

test('charWidth handles keycap, flag, and ZWJ clusters', () => {
  assert.equal(charWidth('1️⃣'), 2);
  assert.equal(charWidth('🇨🇳'), 2);
  assert.equal(charWidth('👨‍👩‍👧‍👦'), 2);
  assert.equal(charWidth('👍🏽'), 2);
  assert.equal(charWidth('👩‍💻'), 2);
  assert.equal(displayWidth('🇨🇳 flag'), 7);
});

test('safeRenderWidth keeps one column in reserve and falls back for invalid widths', () => {
  assert.equal(safeRenderWidth(80), 79);
  assert.equal(safeRenderWidth(1), 1);
  assert.equal(safeRenderWidth(0), 79);
});

test('wrapText keeps the prefix on wrapped lines', () => {
  assert.deepEqual(wrapText('abcd', 5, '◇ '), ['◇ ab', '◇ cd']);
});

test('tab display width follows the current terminal column and is rendered as spaces', () => {
  assert.equal(tabWidthAt(0), 8);
  assert.equal(tabWidthAt(2), 6);
  assert.equal(displayWidth('▌ \tstack'), 13);
  assert.deepEqual(wrapText('\tstack', 16, '▌ '), ['▌       stack']);
});

test('renderComposer returns wrapped lines and cursor coordinates', () => {
  const composer = createComposer('abcd');

  assert.deepEqual(renderComposer(composer, 6), {
    lines: ['> abc', '  d'],
    cursorRow: 1,
    cursorColumn: 3
  });
});

test('renderComposer expands tabs without changing the composer state', () => {
  const composer = createComposer('\tstack');
  const layout = renderComposer(composer, 16);

  assert.equal(composer.chars.includes('\t'), true);
  assert.equal(layout.lines.includes('\t'), false);
  assert.deepEqual(layout, {
    lines: ['>       stack'],
    cursorRow: 0,
    cursorColumn: 13
  });
});

test('renderComposer highlights file mentions without moving cursor', () => {
  const composer = createComposer('see @src/app.ts now');
  const plain = renderComposer(composer, 80);
  const highlighted = renderComposer(composer, 80, '> ', {highlightFileMentions: true});

  assert.equal(highlighted.cursorRow, plain.cursorRow);
  assert.equal(highlighted.cursorColumn, plain.cursorColumn);
  assert.match(highlighted.lines.join('\n'), /\x1b\[36m@\x1b\[39m/);
  assert.equal(displayWidth(highlighted.lines.join('')), displayWidth(plain.lines.join('')));
});
