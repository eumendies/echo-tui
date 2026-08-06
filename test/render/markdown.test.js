const test = require('node:test');
const assert = require('node:assert/strict');

const { createTuiTheme } = require('../../src/config/theme-config');
const { displayWidth, safeRenderWidth, stripAnsi } = require('../../src/render/layout');
const { renderMarkdownLines } = require('../../src/render/markdown');

test('renderMarkdownLines projects headings, paragraphs, lists, quotes, and rules', () => {
  const lines = renderMarkdownLines(
    ['## 标题', '普通段落带 `code` 和 **bold**', '- 一个很长的中文列表项用于测试换行对齐', '2. ordered item', '> quoted text', '---'].join('\n'),
    28,
    '◆ '
  );
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.equal(plainLines[0], '◆ 标题');
  assert.ok(plainLines.some((line) => line.includes('普通段落带 code 和 bold')));
  assert.ok(plainLines.some((line) => line.startsWith('  • 一个很长的中文列表')));
  assert.ok(plainLines.some((line) => line.startsWith('    于测试换行对齐')));
  assert.ok(plainLines.some((line) => line.startsWith('  2. ordered item')));
  assert.ok(plainLines.some((line) => line.startsWith('  │ quoted text')));
  assert.ok(plainLines.some((line) => /^  ─+$/.test(line)));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(28));
  }
});

test('renderMarkdownLines keeps quote gutter styled across wrapped quote lines', () => {
  const lines = renderMarkdownLines('> quoted text that is long enough to wrap onto another terminal line', 28, '◆ ');
  const quoteColor = '\x1b[38;2;0;170;170m';

  assert.ok(lines.length > 1);
  // 首行与换行后的续行竖线都使用 quote 样式作为引用边界。
  assert.ok(lines.every((line) => line.includes(`${quoteColor}│ `)));
  // 竖线样式在其自身作用域内闭合，正文保持默认前景色。
  assert.ok(lines.every((line) => line.includes('│ \x1b[39m')));
  assert.ok(lines.every((line) => !line.slice(line.lastIndexOf('│ ') + 2).includes(quoteColor)));
});

test('renderMarkdownLines highlights fenced code directly without drawing a box', () => {
  const lines = renderMarkdownLines(['```ts', '  const value = `raw`;', '  // **not bold**', '```'].join('\n'), 80, '◆ ');
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.ok(!plainLines.includes('◆ ts'));
  assert.ok(plainLines.includes('◆   const value = `raw`;'));
  assert.ok(plainLines.includes('    // **not bold**'));
  assert.ok(lines.some((line) => line.includes('\x1b[38;2;170;0;170mconst')));
  assert.ok(lines.some((line) => line.includes('\x1b[38;2;0;170;0m`raw`')));
  assert.ok(lines.some((line) => line.includes('\x1b[38;2;85;85;85m// **not bold**')));
  assert.ok(!plainLines.some((line) => /[╭╮╰╯┌┐└┘]/.test(line)));
});

test('renderMarkdownLines applies cross-line code highlighting', () => {
  const lines = renderMarkdownLines(['```txt', 'const text = "first', 'second";', '```'].join('\n'), 80, '◆ ');

  assert.ok(lines[0].includes('\x1b[38;2;0;170;0m"first\x1b[39m'));
  assert.ok(lines[1].includes('\x1b[38;2;0;170;0msecond"\x1b[39m'));
});

test('renderMarkdownLines treats unclosed fenced code blocks as code to the end', () => {
  const lines = renderMarkdownLines(['```js', 'const x = 1;', '**still code**'].join('\n'), 80, '◇ ');
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.deepEqual(plainLines, ['◇ const x = 1;', '  **still code**']);
});

test('renderMarkdownLines keeps inline style ANSI from affecting display width', () => {
  const width = 80;
  const lines = renderMarkdownLines('中文 `code` **bold** *dim* ~~gone~~ [link](https://example.com)', width, '◆ ');
  const plain = lines.map((line) => stripAnsi(line)).join('\n');

  assert.match(plain, /中文 code bold dim gone link \(https:\/\/example\.com\)/);
  assert.ok(lines.some((line) => line.includes('\x1b[38;2;170;85;0mcode\x1b[39m')));
  assert.ok(lines.some((line) => line.includes('\x1b[1mbold\x1b[22m')));
  assert.ok(lines.some((line) => line.includes('\x1b[2mdim\x1b[22m')));
  assert.ok(lines.some((line) => line.includes('\x1b[9mgone\x1b[29m')));
  assert.ok(lines.some((line) => line.includes('\x1b[38;2;0;170;170mlink \(https://example.com\)\x1b[39m')));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(width));
  }
});

test('renderMarkdownLines keeps syntax highlight ANSI from affecting display width', () => {
  const width = 18;
  const lines = renderMarkdownLines(['```js', 'const veryLongIdentifier = "中文中文中文";', '```'].join('\n'), width, '◆ ');

  assert.ok(lines.length > 1);
  assert.ok(lines.some((line) => line.includes('\x1b[38;2;170;0;170m')));
  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(width));
  }
});

test('renderMarkdownLines renders pipe tables with unicode internal separators', () => {
  const lines = renderMarkdownLines(
    ['| Name | Count | Notes |', '| --- | ---: | :---: |', '| alpha | 1 | short |', '| beta | 23 | longer wrapped note |'].join('\n'),
    80,
    '◆ '
  );
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.equal(plainLines.length, 4);
  assert.match(plainLines[0], /^◆ Name\s+│ Count │\s+Notes\s+$/);
  assert.match(plainLines[1], /^  ─+┼─+┼─+$/);
  assert.match(plainLines[2], /^  alpha\s+│\s+1 │\s+short\s+$/);
  assert.match(plainLines[3], /^  beta\s+│\s+23 │ longer wrapped note$/);
  assert.ok(plainLines.every((line) => !line.includes('|')));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(80));
  }
});

test('renderMarkdownLines supports no-outer-pipe tables and escaped pipes', () => {
  const lines = renderMarkdownLines(['Name | Note', '--- | ---', String.raw`alpha | a \| b`].join('\n'), 80, '◆ ');
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.equal(plainLines.length, 3);
  assert.ok(plainLines[0].includes('Name'));
  assert.ok(plainLines[0].includes('│'));
  assert.ok(plainLines[2].includes('a | b'));
  assert.equal((plainLines[2].match(/│/g) ?? []).length, 1);
});

test('renderMarkdownLines wraps wide and chinese table cells within safe width', () => {
  const width = 24;
  const lines = renderMarkdownLines(['| 名称 | 说明 |', '| --- | --- |', '| 中文 | 一个很长的中文说明用于换行 |'].join('\n'), width, '◆ ');
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('│ 一个很长的中文')));
  assert.ok(plainLines.some((line) => line.startsWith('       │ 说明用于换行')));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(width));
  }
});

test('renderMarkdownLines keeps long text table columns readable', () => {
  const markdown = [
    '| 模块 | 场景 | 详细说明 | 预期表现 | 备注 |',
    '| --- | --- | --- | --- | --- |',
    '| 渲染层 | 普通长文本 | 这个单元格包含一段非常长的中文描述，用来测试终端 Markdown 表格在列宽不足时是否能够正确换行，尤其是在中文、英文、数字混合出现的情况下，是否会出现错位、截断、重复绘制或者边框不对齐的问题。 | 表格应保持结构稳定，内容可以自动换行，但不应破坏相邻列的布局。 | 适合测试窄终端窗口。 |'
  ].join('\n');
  const lines = renderMarkdownLines(markdown, 100, '◆ ');
  const plainLines = lines.map((line) => stripAnsi(line));
  const bodyLine = plainLines.find((line) => line.includes('渲染层'));

  assert.ok(bodyLine);
  const cells = bodyLine.slice(displayWidth('◆ ')).split('│').map((cell) => cell.trimEnd());

  assert.equal(cells.length, 5);
  assert.ok(displayWidth(cells[2]) >= 16);
  assert.ok(cells[2].includes('这个单元格包含'));
  assert.ok(!plainLines.some((line) => /│ .{0,4} │/.test(line) && line.includes('这个')));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(100));
  }
});

test('renderMarkdownLines keeps table separators aligned with emoji cells', () => {
  const lines = renderMarkdownLines(['| Status | Note |', '| --- | --- |', '| ✅ | done |', '| 🙂 | ok |', '| 👨‍👩‍👧‍👦 | family |'].join('\n'), 80, '◆ ');
  const plainLines = lines.map((line) => stripAnsi(line));
  const separatorColumns = [plainLines[0], plainLines[2], plainLines[3], plainLines[4]].map((line) => displayWidth(line.slice(0, line.indexOf('│'))));

  assert.deepEqual(separatorColumns, [9, 9, 9, 9]);
  assert.equal(displayWidth(plainLines[1].slice(0, plainLines[1].indexOf('┼'))), 9);
  assert.ok(plainLines.some((line) => line.includes('✅')));
  assert.ok(plainLines.some((line) => line.includes('🙂')));
  assert.ok(plainLines.some((line) => line.includes('👨‍👩‍👧‍👦')));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(80));
  }
});

test('renderMarkdownLines aligns tables with supplementary-plane and VS16 chars', () => {
  const lines = renderMarkdownLines(
    ['| Char | Width |', '| --- | --- |', '| 𠀀 | 2 |', '| ⚠ | 1 |', '| ⚠️ | 2 |', '| ♠ | 1 |', '| ♠️ | 2 |'].join('\n'),
    80,
    '◆ '
  );
  const plainLines = lines.map((line) => stripAnsi(line));
  const firstColumnWidths = [plainLines[0], plainLines[2], plainLines[3], plainLines[4], plainLines[5], plainLines[6]]
    .map((line) => displayWidth(line.slice(0, line.indexOf('│'))));

  // 所有行的第一列边界必须落在同一列：CJK 扩展 B 与 VS16 emoji 按 2 列、文本呈现符号按 1 列。
  assert.deepEqual(firstColumnWidths, [7, 7, 7, 7, 7, 7]);

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(80));
  }
});

test('renderMarkdownLines keeps zero-width chars from shifting table borders', () => {
  const lines = renderMarkdownLines(
    ['| Word | Note |', '| --- | --- |', '| c\u0301afe | combining |', '| a\u200bb | zwsp |'].join('\n'),
    80,
    '◆ '
  );
  const plainLines = lines.map((line) => stripAnsi(line));
  const firstColumnWidths = [plainLines[0], plainLines[2], plainLines[3]]
    .map((line) => displayWidth(line.slice(0, line.indexOf('│'))));

  // 组合音标与 ZWSP 不占列：cafe 视觉宽度 4（c+组合音标=1），列宽 4，边界一致。
  assert.deepEqual(firstColumnWidths, [7, 7, 7]);

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(80));
  }
});

test('renderMarkdownLines falls back safely when table is too narrow', () => {
  const width = 8;
  const lines = renderMarkdownLines(['| A | B | C |', '|---|---|---|', '| 1 | 2 | 3 |'].join('\n'), width, '◆ ');
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('| A |')));
  assert.ok(plainLines.some((line) => line.includes('|---|')));
  assert.ok(!plainLines.some((line) => line.includes('│')));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(width));
  }
});

test('renderMarkdownLines treats unconfirmed table-like text as ordinary text', () => {
  const lines = renderMarkdownLines('A | B | C', 80, '◆ ').map((line) => stripAnsi(line));

  assert.deepEqual(lines, ['◆ A | B | C']);
});

test('renderMarkdownLines renders inline markdown inside table cells', () => {
  const lines = renderMarkdownLines(['| Name | Value |', '| --- | --- |', '| `code` | **bold** *dim* ~~gone~~ [link](https://example.com) |'].join('\n'), 80, '◆ ');
  const plain = lines.map((line) => stripAnsi(line)).join('\n');

  assert.match(plain, /code/);
  assert.match(plain, /bold dim gone link \(https:\/\/example\.com\)/);
  assert.ok(lines.some((line) => line.includes('\x1b[38;2;170;85;0mcode\x1b[39m')));
  assert.ok(lines.some((line) => line.includes('\x1b[1mbold\x1b[22m')));
  assert.ok(lines.some((line) => line.includes('\x1b[2mdim\x1b[22m')));
  assert.ok(lines.some((line) => line.includes('\x1b[9mgone\x1b[29m')));
  assert.ok(lines.some((line) => line.includes('\x1b[38;2;0;170;170mlink \(https://example.com\)\x1b[39m')));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(80));
  }
});

test('renderMarkdownLines applies custom markdown and syntax theme tokens', () => {
  const theme = createTuiTheme({
    markdown: {
      styles: {
        heading: {foreground: [1, 2, 3], bold: true},
        listMarker: {foreground: [4, 5, 6]},
        quote: {foreground: [7, 8, 9], dim: true},
        tableSeparator: {foreground: [10, 11, 12]},
        inlineCode: {foreground: [13, 14, 15]},
        link: {foreground: [16, 17, 18]}
      }
    },
    syntax: {
      keyword: {foreground: [19, 20, 21], bold: true},
      string: {foreground: [22, 23, 24]}
    }
  });
  const markdown = [
    '## Title',
    '- item',
    '> quote',
    '[link](https://example.com) `code`',
    '| A | B |',
    '| --- | --- |',
    '| x | y |',
    '```js',
    'const text = "value";',
    '```'
  ].join('\n');
  const lines = renderMarkdownLines(markdown, 80, '◆ ', theme);
  const rendered = lines.join('\n');

  assert.ok(rendered.includes('\x1b[1m\x1b[38;2;1;2;3mTitle'));
  assert.ok(rendered.includes('\x1b[38;2;4;5;6m•'));
  assert.ok(rendered.includes('\x1b[38;2;7;8;9m│'));
  assert.ok(rendered.includes('quote'));
  assert.ok(rendered.includes('\x1b[38;2;10;11;12m │ '));
  assert.ok(rendered.includes('\x1b[38;2;13;14;15mcode'));
  assert.ok(rendered.includes('\x1b[38;2;16;17;18mlink (https://example.com)'));
  assert.ok(rendered.includes('\x1b[1m\x1b[38;2;19;20;21mconst'));
  assert.ok(rendered.includes('\x1b[38;2;22;23;24m"value"'));
});

test('renderMarkdownLines unwraps markdown fenced tables only when the fence contains a table', () => {
  const tableFence = renderMarkdownLines(['```markdown', '| A | B |', '|---|---|', '| 1 | 2 |', '```'].join('\n'), 80, '◆ ').map((line) => stripAnsi(line));
  const mdCodeFence = renderMarkdownLines(['```md', '# not rendered as heading', '```'].join('\n'), 80, '◆ ').map((line) => stripAnsi(line));
  const tsFence = renderMarkdownLines(['```ts', '| A | B |', '|---|---|', '```'].join('\n'), 80, '◆ ').map((line) => stripAnsi(line));

  assert.ok(tableFence.some((line) => line.includes('│')));
  assert.ok(!tableFence.some((line) => line.includes('```')));
  assert.deepEqual(mdCodeFence, ['◆ # not rendered as heading']);
  assert.deepEqual(tsFence, ['◆ | A | B |', '  |---|---|']);
});

test('renderMarkdownLines unwraps blockquoted markdown fenced tables without affecting non-markdown fences', () => {
  const tableFence = renderMarkdownLines(['> ```markdown', '> | A | B |', '> |---|---|', '> | 1 | 2 |', '> ```'].join('\n'), 80, '◆ ').map((line) =>
    stripAnsi(line)
  );
  const tsFence = renderMarkdownLines(['> ```ts', '> | A | B |', '> |---|---|', '> ```'].join('\n'), 80, '◆ ').map((line) => stripAnsi(line));

  assert.ok(tableFence.some((line) => line.includes('│')));
  assert.ok(!tableFence.some((line) => line.includes('```')));
  assert.deepEqual(tsFence, ['◆ | A | B |', '  |---|---|']);
});
