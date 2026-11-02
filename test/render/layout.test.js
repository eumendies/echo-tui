const test = require('node:test');
const assert = require('node:assert/strict');

const ansi = require('../../src/terminal/ansi');
const { createComposer, replaceWithFileMentions, insertText, replaceRange, captureSnapshot } = require('../../src/input/composer');
const {
  charWidth,
  displayWidth,
  renderComposer,
  safeRenderWidth,
  stripAnsi,
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

test('displayWidth fast-paths printable ASCII while keeping ANSI, tab, and newline semantics', () => {
  assert.equal(displayWidth('plain ascii 123'), 15);
  assert.equal(displayWidth(''), 0);
  assert.equal(displayWidth(ansi.cyan('cyan')), 4);
  assert.equal(displayWidth('a\tb'), 9);
  assert.equal(displayWidth('line\nnext'), 8);
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('👨‍👩‍👧‍👦'), 2);
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

test('renderComposer highlights only confirmed file mentions without moving cursor', () => {
  const composer = createComposer('see ');
  replaceWithFileMentions(composer, composer.cursor, composer.cursor, ['src/app.ts']);
  insertText(composer, 'now');
  const plain = renderComposer(composer, 80);
  const highlighted = renderComposer(composer, 80, '> ', {highlightFileMentions: true});

  assert.equal(highlighted.cursorRow, plain.cursorRow);
  assert.equal(highlighted.cursorColumn, plain.cursorColumn);
  assert.match(highlighted.lines.join('\n'), /\x1b\[36m@\x1b\[39m/);
  assert.equal(displayWidth(highlighted.lines.join('')), displayWidth(plain.lines.join('')));
});

test('renderComposer never highlights plain @ text, including existing paths and quoted paths', () => {
  const text = '@src/render/layout.ts @"docs/my note.md" user@example.com pkg@version 请看@这里';
  const composer = createComposer(text);
  const layout = renderComposer(composer, 120, '> ', {highlightFileMentions: true});

  assert.equal(layout.lines.join(''), `> ${text}`);
  assert.deepEqual(composer.fileMentions, []);
});

test('renderComposer highlights confirmed quoted paths but not identical unconfirmed text', () => {
  const composer = createComposer('@"docs/my note.md" ');
  const confirmedStart = composer.cursor;
  replaceWithFileMentions(composer, confirmedStart, confirmedStart, ['docs/my note.md']);
  const layout = renderComposer(composer, 120, '> ', {highlightFileMentions: true});
  const highlightedPath = Array.from('@"docs/my note.md"', (char) => ansi.cyan(char)).join('');

  assert.equal(layout.lines[0], `> @"docs/my note.md" ${highlightedPath} `);
  assert.equal(layout.cursorColumn, displayWidth(stripAnsi(layout.lines[0])));
});

test('renderComposer keeps confirmed highlight at exact boundaries next to Chinese and punctuation', () => {
  const composer = createComposer('');
  replaceWithFileMentions(composer, 0, 0, ['missing-file.ts']);
  replaceRange(composer, composer.chars.length - 1, composer.chars.length, '');
  insertText(composer, '请检查，尤其这里');
  composer.cursor = 0;
  insertText(composer, '🙂e\u0301，');
  const snapshot = captureSnapshot(composer);
  const layout = renderComposer(composer, 120, '> ', {highlightFileMentions: true});
  const colored = composer.chars.slice(composer.fileMentions[0].start, composer.fileMentions[0].end).map(ansi.cyan).join('');

  assert.equal(layout.lines[0], `> 🙂e\u0301，${colored}请检查，尤其这里`);
  assert.deepEqual(captureSnapshot(composer), snapshot);
});

test('renderComposer keeps Unicode ranges and cursor aligned through narrow boxed widths and resize', () => {
  const composer = createComposer('🙂e\u0301 ');
  replaceWithFileMentions(composer, composer.cursor, composer.cursor, ['笔记 e\u0301👩‍💻.md']);
  insertText(composer, '正文');
  const snapshot = captureSnapshot(composer);

  for (const width of [12, 18, 80, 12]) {
    for (const cursor of [0, 1, ...composer.fileMentions.flatMap(({start, end}) => [start, start + 1, end]), composer.chars.length]) {
      composer.cursor = cursor;
      const plain = renderComposer(composer, width, '> ', {startColumn: 2});
      const highlighted = renderComposer(composer, width, '> ', {highlightFileMentions: true, startColumn: 2});
      assert.deepEqual(highlighted.lines.map(stripAnsi), plain.lines);
      assert.equal(highlighted.cursorRow, plain.cursorRow);
      assert.equal(highlighted.cursorColumn, plain.cursorColumn);
      assert.ok(highlighted.lines.every((line) => displayWidth(line) <= safeRenderWidth(width)));
      assert.deepEqual(composer.fileMentions, snapshot.fileMentions);
      assert.equal(composer.chars.join(''), snapshot.text);
    }
  }
});

test('renderComposer stops highlighting a reference after internal editing even if its text is restored', () => {
  const composer = createComposer('');
  replaceWithFileMentions(composer, 0, 0, ['src/app.ts']);
  replaceRange(composer, 3, 3, 'x');
  replaceRange(composer, 3, 4, '');

  const highlighted = renderComposer(composer, 80, '> ', {highlightFileMentions: true});
  assert.equal(highlighted.lines[0], '> @src/app.ts ');
  assert.deepEqual(composer.fileMentions, []);
});
