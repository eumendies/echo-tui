const test = require('node:test');
const assert = require('node:assert/strict');

const {createTuiTheme} = require('../../src/config/theme-config');
const {displayWidth, stripAnsi} = require('../../src/render/layout');
const {
  READ_FILES_MAX_DISPLAY_LINES,
  renderReadFilesToolResultLines
} = require('../../src/render/tool-message-renderers/read-files');

const THEME = createTuiTheme();
const WIDTH = 80;
const SAFE_WIDTH = WIDTH - 1;

function createResultRecord(text) {
  return {
    role: 'tool_result',
    toolCallId: 'call-1',
    text,
    toolName: 'read_files',
    ok: true,
    details: {kind: 'read_files', truncated: false}
  };
}

function createTextEnvelope(path, lines, extraBodyLines = []) {
  return [
    `--- text: ${path}`,
    ...extraBodyLines,
    '',
    'content:',
    '```',
    ...lines,
    '```'
  ].join('\n');
}

function createDirectoryEnvelope(path, entries) {
  return [
    `--- directory: ${path}`,
    'entries:',
    ...entries
  ].join('\n');
}

function numberedLines(start, count, textFn = (number) => `line ${number}`) {
  return Array.from({length: count}, (_, index) => `${start + index} │ ${textFn(start + index)}`);
}

test('read_files 单文本文件占满 30 行专属预算', () => {
  const record = createResultRecord(createTextEnvelope('src/foo.ts', numberedLines(1, 29)));
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  assert.equal(lines.length, READ_FILES_MAX_DISPLAY_LINES);
  assert.match(stripAnsi(lines[0]), /^  └─ text: src\/foo\.ts/);
  assert.match(stripAnsi(lines[0]), /lines: 1-29 \(29\)/);
  assert.match(stripAnsi(lines[1]), /1 │ line 1/);
  assert.match(stripAnsi(lines[29]), /29 │ line 29/);
});

test('read_files 多文本文件等分预算且最后一个 envelope 闭合', () => {
  const record = createResultRecord([
    createTextEnvelope('a.ts', numberedLines(1, 10)),
    createTextEnvelope('b.ts', numberedLines(1, 10)),
    createTextEnvelope('c.ts', numberedLines(1, 10))
  ].join('\n\n'));
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  // H=3, contentCount=3 → p=floor(27/3)=9；内容 10 行超预算 → 各 8 行预览 + 1 提示 = 9 行。
  assert.equal(lines.length, READ_FILES_MAX_DISPLAY_LINES);
  assert.match(stripAnsi(lines[0]), /^  ├─ text: a\.ts/);
  assert.match(stripAnsi(lines[9]), /^  │ … \+2 more$/);
  assert.match(stripAnsi(lines[10]), /^  ├─ text: b\.ts/);
  assert.match(stripAnsi(lines[20]), /^  └─ text: c\.ts/);
  // 非最后一个文件的内容行使用竖线 rail；a.ts 预览内行号 1-5，宽度为 1。
  assert.match(stripAnsi(lines[1]), /^  │ 1 │ line 1$/);
  // 最后一个文件使用空白闭合 rail。
  assert.match(stripAnsi(lines[21]), /^ {4}1 │ line 1$/);
});

test('read_files 混合 text 与 directory 等分预算', () => {
  const record = createResultRecord(
    createTextEnvelope('a.ts', numberedLines(1, 20)) + '\n\n' +
    createDirectoryEnvelope('src/lib', Array.from({length: 20}, (_, index) => `- file${index}.ts; file; size_bytes: 100`))
  );
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  // H=2, contentCount=2 → p=floor(28/2)=14；text 20 行与 directory 20 条都超预算 → 各 13 + 1 提示。
  assert.equal(lines.length, READ_FILES_MAX_DISPLAY_LINES);
  assert.match(stripAnsi(lines[0]), /^  ├─ text: a\.ts/);
  assert.match(stripAnsi(lines[14]), /^  │ … \+7 more$/);
  assert.match(stripAnsi(lines[15]), /^  └─ directory: src\/lib/);
  assert.match(stripAnsi(lines[15]), /entries: 20/);
  assert.match(stripAnsi(lines[16]), /• file0\.ts  file, size_bytes: 100/);
  assert.match(stripAnsi(lines[28]), /• file12\.ts  file, size_bytes: 100/);
  assert.match(stripAnsi(lines[29]), /^    … \+7 more$/);
});

test('read_files 单目录超出预算显示计数省略提示', () => {
  const entries = Array.from({length: 30}, (_, index) => `- file${index}.ts; file; size_bytes: 100`);
  const record = createResultRecord(createDirectoryEnvelope('src', entries));
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  // H=1, contentCount=1 → p=floor(29/1)=29 → 1 + 28 条 + 1 提示 = 30 行。
  assert.equal(lines.length, READ_FILES_MAX_DISPLAY_LINES);
  assert.match(stripAnsi(lines[0]), /entries: 30/);
  assert.match(stripAnsi(lines[29]), /… \+2 more/);
});

test('read_files 文本内容超出预算显示省略提示', () => {
  const record = createResultRecord(createTextEnvelope('src/long.ts', numberedLines(1, 35)));
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  // 内容 35 行、预算 29 → 28 行预览 + … +7 more = 29 行 + header = 30 行。
  assert.equal(lines.length, READ_FILES_MAX_DISPLAY_LINES);
  assert.match(stripAnsi(lines[28]), /28 │ line 28/);
  assert.match(stripAnsi(lines[29]), /^ {4}… \+7 more$/);
});

test('read_files 预览行号在该文件内右对齐', () => {
  const record = createResultRecord(createTextEnvelope('a.ts', numberedLines(1, 10)));
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  // 预览覆盖行号 1-10，最大宽度 2，单行号 1 右对齐成 ` 1 │ `；闭合 rail 为 4 空格。
  assert.match(stripAnsi(lines[1]), /^ {5}1 │ line 1$/);
  assert.match(stripAnsi(lines[2]), /^ {5}2 │ line 2$/);
});

test('read_files 空文件只显示 lines: empty 摘要', () => {
  const record = createResultRecord(createTextEnvelope('a.ts', []));
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  assert.equal(lines.length, 1);
  assert.match(stripAnsi(lines[0]), /lines: empty/);
});

test('read_files 空目录只显示 entries: 0', () => {
  const record = createResultRecord(createDirectoryEnvelope('src', ['(empty)']));
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  assert.equal(lines.length, 1);
  assert.match(stripAnsi(lines[0]), /entries: 0/);
});

test('read_files 错误 envelope 只保留 header 诊断', () => {
  const record = createResultRecord('--- text: missing.ts\nerror: file not found\nreason: ENOENT');
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  assert.equal(lines.length, 1);
  assert.match(stripAnsi(lines[0]), /error: file not found/);
});

test('read_files image/pdf envelope 只占 header 行', () => {
  const imageLines = renderReadFilesToolResultLines(
    createResultRecord('--- image: a.png\nsize_bytes: 100\nimage_attached: true'),
    WIDTH,
    THEME
  );
  assert.ok(imageLines);
  assert.equal(imageLines.length, 1);
  assert.match(stripAnsi(imageLines[0]), /image: a\.png/);

  const pdfLines = renderReadFilesToolResultLines(
    createResultRecord('--- pdf: a.pdf\npages: 2\npages_with_text: 2\nextracted_text:\n```\ncontent\n```'),
    WIDTH,
    THEME
  );
  assert.ok(pdfLines);
  assert.equal(pdfLines.length, 1);
  assert.match(stripAnsi(pdfLines[0]), /pages: 2/);
});

test('read_files 内容行按可用宽度尾部省略', () => {
  const longLine = `1 │ ${'x'.repeat(120)}`;
  const record = createResultRecord(createTextEnvelope('a.ts', [longLine]));
  const lines = renderReadFilesToolResultLines(record, 40, THEME);

  assert.ok(lines);
  for (const line of lines) {
    assert.ok(displayWidth(stripAnsi(line)) <= 39, `line width ${displayWidth(stripAnsi(line))} exceeds safe width`);
  }
});

test('read_files output_truncated 标记保留提示行并计入预算', () => {
  const record = createResultRecord(createTextEnvelope('a.ts', numberedLines(1, 10)) + '\n\nOutput was truncated.');
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  // H=1, marker=1 → p=floor(28/1)=28 → 1 header + 10 预览 + 1 提示 = 12 行。
  assert.equal(lines.length, 12);
  assert.match(stripAnsi(lines[lines.length - 1]), /^  output_truncated: true$/);
});

test('read_files 非标准 result 文本返回 null 降级', () => {
  assert.equal(renderReadFilesToolResultLines(createResultRecord('not an envelope'), WIDTH, THEME), null);
  assert.equal(renderReadFilesToolResultLines(createResultRecord(''), WIDTH, THEME), null);
});

test('read_files 渲染行不包含原始换行或回车', () => {
  const record = createResultRecord(createTextEnvelope('a.ts', numberedLines(1, 5)));
  const lines = renderReadFilesToolResultLines(record, WIDTH, THEME);

  assert.ok(lines);
  for (const line of lines) {
    assert.ok(!/[\n\r]/u.test(stripAnsi(line)), 'renderer line must not contain raw newline');
  }
});
