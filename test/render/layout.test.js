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
