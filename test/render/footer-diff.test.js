const test = require('node:test');
const assert = require('node:assert/strict');

const { createComposer } = require('../../src/input/composer');
const { createFooterRenderer, renderFooterLayout } = require('../../src/render/footer');
const { stripAnsi } = require('../../src/render/layout');
const ansi = require('../../src/terminal/ansi');

const STATUS_LINE = {
  projectName: 'echo_tui',
  model: {kind: 'default', label: 'GPT-4o'},
  mode: 'idle'
};

function createFakeOutput() {
  const writes = [];
  return {
    writes,
    write(chunk) {
      writes.push(String(chunk));
    }
  };
}

function createState({text = '', statusLine = STATUS_LINE, slashSuggestions = null}) {
  return {
    composer: createComposer(text),
    commandSurface: null,
    slashSuggestions,
    pending: null,
    working: null,
    statusLine,
    rows: 24,
    width: 80
  };
}

test('render rewrites only the changed composer line and skips untouched rows', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: 'hello'}));
  assert.equal(output.writes.length, 1);
  assert.equal(output.writes[0].includes(ansi.hideCursor()), true);

  output.writes.length = 0;
  renderer.render(createState({text: 'helloX'}));
  assert.equal(output.writes.length, 1);
  const second = output.writes[0];

  // 3.1 未变行不触碰:帧高不变且单行变化,无 clearLine,status line 不再重写。
  assert.equal(second.includes(ansi.clearLine()), false);
  assert.equal(stripAnsi(second).includes('echo_tui'), false);
  // 3.2 变化行原位覆写:新内容写入并清理行尾。
  assert.match(second, /helloX/u);
  assert.equal(second.includes(ansi.clearEndOfLine()), true);
  // 3.6 帧高不变且单行覆写:不输出 hide/show 包裹。
  assert.equal(second.includes(ansi.hideCursor()), false);
  assert.equal(second.includes(ansi.showCursor()), false);
  // 3.6 光标定位回 composer 逻辑位置。
  const layout = renderFooterLayout(createState({text: 'helloX'}));
  assert.ok(second.endsWith(
    `${ansi.cursorUp(layout.lines.length - 1 - layout.cursorRow)}${ansi.carriageReturn()}${ansi.cursorForward(layout.cursorColumn)}`
  ));
});

test('render with an identical frame emits no write', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: 'hello'}));
  output.writes.length = 0;
  renderer.render(createState({text: 'hello'}));

  assert.equal(output.writes.length, 0);
});

test('render with an unchanged frame only repositions the cursor', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: 'hello'}));
  output.writes.length = 0;

  const movedComposer = {...createComposer('hello'), cursor: 2};
  const movedState = {...createState({text: 'hello'}), composer: movedComposer};
  renderer.render(movedState);

  assert.equal(output.writes.length, 1);
  const second = output.writes[0];
  assert.equal(second.includes(ansi.clearLine()), false);
  assert.equal(second.includes(ansi.clearEndOfLine()), false);
  assert.equal(second, `${ansi.carriageReturn()}${ansi.cursorForward(renderFooterLayout(movedState).cursorColumn)}`);
});

test('render appends rows without clearing when the frame grows', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: ''}));
  output.writes.length = 0;

  const suggestions = {selectedIndex: 0, options: [{label: '/help', description: '查看帮助'}, {label: '/status', description: '查看状态'}]};
  renderer.render(createState({text: '/', slashSuggestions: suggestions}));

  assert.equal(output.writes.length, 1);
  const second = output.writes[0];
  assert.equal(second.includes(ansi.clearLine()), false);
  assert.match(second, /\/help/u);
  assert.equal(second.includes(ansi.hideCursor()), true);
});

test('render clears only the surplus rows when the frame shrinks', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);
  const suggestions = {selectedIndex: 0, options: [{label: '/help', description: '查看帮助'}, {label: '/status', description: '查看状态'}]};

  renderer.render(createState({text: '/', slashSuggestions: suggestions}));
  output.writes.length = 0;
  renderer.render(createState({text: ''}));

  assert.equal(output.writes.length, 1);
  const second = output.writes[0];
  const removedRows = renderFooterLayout(createState({text: '/', slashSuggestions: suggestions})).lines.length
    - renderFooterLayout(createState({text: ''})).lines.length;
  assert.equal((second.match(/\x1b\[2K/g) || []).length, removedRows);
  assert.equal(stripAnsi(second).includes('/help'), false);
  assert.equal(second.includes(ansi.hideCursor()), true);
});

test('append with transcript content keeps the whole-frame redraw', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);
  const state = createState({text: 'hello'});

  renderer.render(state);
  const frameLines = renderFooterLayout(state).lines.length;
  output.writes.length = 0;

  renderer.append('已提交的一行\n', state);
  assert.equal(output.writes.length, 1);
  const second = output.writes[0];
  assert.equal(second.includes(ansi.hideCursor()), true);
  assert.equal((second.match(/\x1b\[2K/g) || []).length, frameLines);
  assert.match(second, /已提交的一行/u);
  assert.match(second, /hello/u);
});

test('multi-row changes wrap the sequence with hide and show cursor', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: 'one'}));
  output.writes.length = 0;
  renderer.render(createState({text: 'two', statusLine: {...STATUS_LINE, mode: 'streaming', keyHint: 'Esc 中断'}}));

  assert.equal(output.writes.length, 1);
  const second = output.writes[0];
  assert.equal(second.startsWith(ansi.hideCursor()), true);
  assert.ok(second.endsWith(ansi.showCursor()));
  assert.match(second, /two/u);
  assert.match(second, /Esc 中断/u);
});

test('status line only changes rewrite a single row without hide wrapper', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: 'one'}));
  output.writes.length = 0;
  renderer.render(createState({text: 'one', statusLine: {...STATUS_LINE, mode: 'streaming', keyHint: 'Esc 中断'}}));

  assert.equal(output.writes.length, 1);
  const second = output.writes[0];
  assert.equal(second.includes(ansi.clearLine()), false);
  assert.equal(second.includes(ansi.hideCursor()), false);
  assert.equal(second.includes(ansi.showCursor()), false);
  assert.equal(second.includes(ansi.clearEndOfLine()), true);
  assert.match(second, /Esc 中断/u);
});

test('clear resets incremental memory so the next render is a full frame', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: 'a'}));
  renderer.render(createState({text: 'b'}));
  renderer.clear();
  output.writes.length = 0;

  renderer.render(createState({text: 'b'}));
  assert.equal(output.writes.length, 1);
  assert.equal(output.writes[0].includes(ansi.hideCursor()), true);
  assert.match(output.writes[0], /\bb\b/u);

  output.writes.length = 0;
  renderer.render(createState({text: 'b'}));
  assert.equal(output.writes.length, 0);
});

test('增量重绘为每个重写行隔离 SGR 状态(写入前复位)', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: 'hello'}));
  output.writes.length = 0;
  renderer.render(createState({text: 'helloX'}));

  // 继承的脏背景会被行文字继承,并被行尾 EL 按脏背景擦除(BCE 色块);
  // 因此每个重写行必须先整体复位 SGR 再写入。
  const second = output.writes[0];
  assert.ok(second.includes(`${ansi.reset()}${ansi.carriageReturn()}`));
  assert.match(second, /helloX/u);
  assert.ok(second.includes(ansi.clearEndOfLine()));
});

test('帧增高写入的新行携带 SGR 复位', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: '/'}));
  output.writes.length = 0;
  renderer.render(createState({text: '/', slashSuggestions: {options: [{label: '/clear', description: '清空'}], selectedIndex: 0}}));

  // 增高行位于上一帧之外:用 LF 下移——帧底贴住屏幕最后一行时 LF 触发终端滚动腾行,
  // cursorDown 会被钳制导致新行叠印在底行上;写入前复位 SGR。
  const grown = output.writes[0];
  assert.ok(grown.includes(`\n${ansi.reset()}`));
  assert.ok(grown.includes('▌'));
});

test('帧降低清理的旧行携带 SGR 复位', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: '/', slashSuggestions: {options: [{label: '/clear', description: '清空'}], selectedIndex: 0}}));
  output.writes.length = 0;
  renderer.render(createState({text: ''}));

  // 清理旧行:cursorDown + CR + reset + clearLine,擦除必须使用默认背景。
  const shrunk = output.writes[0];
  assert.ok(shrunk.includes(`${ansi.cursorDown(1)}${ansi.carriageReturn()}${ansi.reset()}${ansi.clearLine()}`));
});

test('整帧清理序列先复位 SGR 再擦除旧行', () => {
  const output = createFakeOutput();
  const renderer = createFooterRenderer(output);

  renderer.render(createState({text: 'a'}));
  output.writes.length = 0;
  renderer.append('transcript\n', createState({text: 'a'}));

  // 上一帧清理发生在写入内容前,起始即复位,避免 clearLine 按继承脏背景擦除。
  const appended = output.writes[0];
  assert.ok(appended.startsWith(`${ansi.hideCursor()}${ansi.reset()}`));
});
