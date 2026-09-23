const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FilePickerContext } = require('../../src/app/state/file-picker-context');
const composerOps = require('../../src/input/composer');
const { INPUT_EVENTS } = require('../../src/input/event-types');
const {renderFilePickerSurface} = require('../../src/render/footer/file-picker-surface');
const {stripAnsi} = require('../../src/render/layout');

function createProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-'));
  fs.mkdirSync(path.join(cwd, 'app'));
  fs.writeFileSync(path.join(cwd, 'app', 'main.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# project\n');
  return cwd;
}

test('FilePickerContext uses Enter to insert directories without entering them', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  assert.equal(picker.getSurface().currentDir, cwd);
  assert.equal(picker.getSurface().entries[0].kind, 'directory');
  assert.equal(picker.getSurface().entries[0].selectable, true);

  picker.handleEvent({type: INPUT_EVENTS.SUBMIT});

  assert.equal(picker.getSurface(), null);
  assert.equal(composerOps.getText(composer), '@app ');
});

test('FilePickerContext uses Right to enter directories and updates absolute cwd', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  picker.handleEvent({type: INPUT_EVENTS.MOVE_RIGHT});

  const surface = picker.getSurface();
  assert.equal(surface.currentDir, path.join(cwd, 'app'));
  assert.equal(surface.entries[0].name, 'main.ts');
  assert.equal(surface.previewMode, 'code');
});

test('FilePickerContext previews text without padded line numbers', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  picker.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});

  const surface = picker.getSurface();
  assert.equal(surface.entries[surface.selectedIndex].name, 'README.md');
  assert.equal(surface.previewLines[2], '1 # project');
  assert.equal(surface.previewMode, 'text');
});

test('FilePickerContext reaches the last preview line without accumulating overflow scroll', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-preview-'));
  fs.writeFileSync(path.join(cwd, 'long.txt'), Array.from({length: 20}, (_, index) => `line ${index + 1}`).join('\n'));
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  picker.handleEvent({type: INPUT_EVENTS.MOVE_RIGHT});
  for (let index = 0; index < 20; index += 1) {
    picker.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  }
  // 键盘与滚轮共用物理行上界：最后一行可见即止，多按不再累积偏移。
  assert.equal(picker.getSurface().previewScroll, 8);
  assert.ok(renderFilePickerSurface(picker.getSurface(), 80, 21).lines.some((line) => stripAnsi(line).includes('20 line 20')));

  picker.handleEvent({type: INPUT_EVENTS.MOVE_UP});

  assert.equal(picker.getSurface().previewScroll, 7);
});

test('FilePickerContext expands text preview window from terminal height', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-preview-height-'));
  fs.writeFileSync(path.join(cwd, 'long.txt'), Array.from({length: 40}, (_value, index) => `line ${index + 1}`).join('\n'));
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}, rows: () => 40});

  picker.open(0);

  const surface = picker.getSurface();
  assert.equal(surface.previewLines[2], '1 line 1');
  assert.equal(surface.previewLines[29], '28 line 28');
});

test('FilePickerContext inserts trailing space after file mention', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  picker.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  picker.handleEvent({type: INPUT_EVENTS.SUBMIT});

  assert.equal(composerOps.getText(composer), '@README.md ');
});

test('FilePickerContext supports selecting directories with files', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  picker.handleEvent({type: INPUT_EVENTS.TEXT, value: ' '});
  picker.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  picker.handleEvent({type: INPUT_EVENTS.TEXT, value: ' '});
  picker.handleEvent({type: INPUT_EVENTS.SUBMIT});

  assert.equal(composerOps.getText(composer), '@app @README.md ');
});

test('FilePickerContext lazy loads direct children without recursive descendants', () => {
  const cwd = createProject();
  fs.mkdirSync(path.join(cwd, 'app', 'nested'));
  fs.writeFileSync(path.join(cwd, 'app', 'nested', 'deep.ts'), 'export const deep = true;\n');
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  let surface = picker.getSurface();
  assert.deepEqual(surface.entries.map((entry) => entry.name), ['app', 'README.md']);
  assert.ok(!surface.entries.some((entry) => entry.name === 'main.ts'));

  picker.handleEvent({type: INPUT_EVENTS.MOVE_RIGHT});
  surface = picker.getSurface();
  assert.deepEqual(surface.entries.map((entry) => entry.name), ['nested', 'main.ts']);

  picker.handleEvent({type: INPUT_EVENTS.MOVE_LEFT});
  surface = picker.getSurface();
  assert.equal(surface.currentDir, cwd);
  assert.deepEqual(surface.entries.map((entry) => entry.name), ['app', 'README.md']);
});

test('FilePickerContext filters the loaded directory without scanning descendants', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  picker.handleEvent({type: INPUT_EVENTS.TEXT, value: 'm'});
  picker.handleEvent({type: INPUT_EVENTS.TEXT, value: 'a'});
  picker.handleEvent({type: INPUT_EVENTS.TEXT, value: 'i'});
  picker.handleEvent({type: INPUT_EVENTS.TEXT, value: 'n'});

  const surface = picker.getSurface();
  assert.deepEqual(surface.entries, []);
  assert.equal(composerOps.getText(composer), '@main');
});

test('FilePickerContext shows notice for empty and missing directories', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-empty-'));
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  assert.deepEqual(picker.getSurface().entries, []);
  assert.match(picker.getSurface().notice, /没有可显示路径/);

  const missingPicker = new FilePickerContext(composerOps.createComposer('@'), {columns: () => 80, cwd: () => path.join(cwd, 'missing'), onChange: () => {}});
  missingPicker.open(0);
  assert.deepEqual(missingPicker.getSurface().entries, []);
  assert.match(missingPicker.getSurface().notice, /读取目录失败/);
});

test('FilePickerContext opens large parent directories without full-tree scanning', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-large-'));
  fs.mkdirSync(path.join(cwd, 'repo'));
  for (let index = 0; index < 200; index += 1) {
    fs.writeFileSync(path.join(cwd, 'repo', `file-${index}.txt`), String(index));
  }
  fs.writeFileSync(path.join(cwd, 'root.txt'), 'root');
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  const surface = picker.getSurface();
  assert.deepEqual(surface.entries.map((entry) => entry.name), ['repo', 'root.txt']);
  assert.equal(surface.notice, undefined);
});

test('FilePickerContext consumes Esc by closing the picker surface', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  let updates = 0;
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => { updates += 1; }});

  picker.open(0);
  assert.equal(picker.hasActiveRequest(), true);

  picker.handleEvent({type: INPUT_EVENTS.ESCAPE});

  assert.equal(picker.hasActiveRequest(), false);
  assert.equal(picker.getSurface(), null);
  assert.equal(composerOps.getText(composer), '@');
  assert.equal(updates, 2);
});

test('FilePickerContext mouse entry handling focuses entries, enters directories, and never inserts mentions directly', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  assert.equal(picker.handlePointerEntry(1, false), true);
  assert.equal(picker.getSurface().entries[picker.getSurface().selectedIndex].name, 'README.md');
  assert.equal(composerOps.getText(composer), '@');

  picker.handlePointerEntry(1, true);
  assert.deepEqual(picker.getSurface().selectedPaths, ['README.md']);
  assert.equal(composerOps.getText(composer), '@');

  picker.handlePointerEntry(0, true);
  assert.equal(picker.getSurface().currentDir, path.join(cwd, 'app'));
  assert.equal(composerOps.getText(composer), '@');
});

test('FilePickerContext ignores unavailable previews without changing selection or composer', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  let updates = 0;
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => { updates += 1; }});
  picker.open(0);
  const opened = updates;

  assert.equal(picker.handleWheel('secondary', 'down'), false);
  assert.equal(updates, opened);
  assert.equal(picker.getSurface().selectedIndex, 0);
  assert.equal(picker.getSurface().focus, 'list');
  assert.equal(updates, opened);
  assert.equal(picker.getSurface().currentDir, cwd);
  assert.deepEqual(picker.getSurface().selectedPaths, []);
  assert.equal(composerOps.getText(composer), '@');
  picker.close();
  assert.equal(picker.handleWheel('secondary', 'up'), false);
  assert.equal(updates, opened + 1);
});

test('FilePickerContext wheel scrolls only the visible text preview range and preserves list selection', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-wheel-preview-'));
  fs.writeFileSync(path.join(cwd, 'long.txt'), Array.from({length: 14}, (_, index) => `line ${index + 1}`).join('\n'));
  const composer = composerOps.createComposer('@');
  let updates = 0;
  const picker = new FilePickerContext(composer, {columns: () => 80, cwd: () => cwd, onChange: () => { updates += 1; }, rows: () => 18});
  picker.open(0);
  const opened = updates;

  assert.equal(picker.handleWheel('secondary', 'up'), false);
  assert.equal(updates, opened);
  for (let index = 0; index < 8; index += 1) {
    assert.equal(picker.handleWheel('secondary', 'down'), true);
  }
  assert.equal(picker.getSurface().previewScroll, 8);
  assert.equal(picker.getSurface().focus, 'preview');
  assert.equal(picker.handleWheel('secondary', 'down'), false);
  assert.equal(updates, opened + 8);
  assert.equal(picker.getSurface().selectedIndex, 0);
  assert.deepEqual(picker.getSurface().selectedPaths, []);
  assert.equal(picker.handleWheel('secondary', 'up'), true);
  assert.equal(picker.getSurface().previewScroll, 7);
  assert.equal(composerOps.getText(composer), '@');
});

test('FilePickerContext wheel reaches file tail after wrapped rows and scrolls within one long line', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-wrap-wheel-'));
  fs.writeFileSync(path.join(cwd, 'long.txt'), [
    ...Array.from({length: 8}, (_, index) => `line ${index + 1}`),
    'W'.repeat(350),
    ...Array.from({length: 4}, (_, index) => `line ${index + 10}`),
    'END_LINE_14'
  ].join('\n'));
  const picker = new FilePickerContext(composerOps.createComposer('@'), {cwd: () => cwd, onChange: () => {}, rows: () => 18, columns: () => 80});
  picker.open(0);
  const rightPane = () => renderFilePickerSurface(picker.getSurface(), 80, 15).lines.map((line) => stripAnsi(line).split('│')[2] || '').join('\n');
  assert.equal(rightPane().includes('END_LINE_14'), false);

  let steps = 0;
  while (picker.handleWheel('secondary', 'down')) steps += 1;
  assert.ok(steps > 8);
  assert.equal(picker.getSurface().previewScroll, steps);
  assert.equal(rightPane().includes('END_LINE_14'), true);
  assert.equal(picker.handleWheel('secondary', 'down'), false);

  fs.writeFileSync(path.join(cwd, 'single.txt'), 'Z'.repeat(600));
  picker.close();
  picker.open(0);
  picker.handlePointerEntry(picker.getSurface().entries.findIndex((entry) => entry.name === 'single.txt'), false);
  assert.equal(picker.handleWheel('secondary', 'down'), true);
  assert.equal(picker.getSurface().previewScroll, 1);
});

test('FilePickerContext recalculates wrapped preview bounds after terminal resize', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-wrap-resize-'));
  fs.writeFileSync(path.join(cwd, 'long.txt'), 'X'.repeat(180));
  let columns = 80;
  let updates = 0;
  const picker = new FilePickerContext(composerOps.createComposer('@'), {
    columns: () => columns, cwd: () => cwd, onChange: () => { updates += 1; }, rows: () => 18
  });
  picker.open(0);
  assert.equal(picker.handleWheel('secondary', 'down'), false);
  assert.equal(picker.getSurface().focus, 'list');
  columns = 30;
  assert.equal(picker.handleWheel('secondary', 'down'), true);
  assert.equal(picker.getSurface().previewScroll, 1);
  assert.equal(picker.getSurface().focus, 'preview');
  assert.equal(updates, 2);
});

test('FilePickerContext wheel leaves empty and short previews untouched', () => {
  const cwd = createProject();
  let updates = 0;
  const picker = new FilePickerContext(composerOps.createComposer('@'), {columns: () => 80, cwd: () => cwd, onChange: () => { updates += 1; }});
  picker.open(0);
  const before = updates;
  assert.equal(picker.handleWheel('secondary', 'down'), false);
  assert.equal(updates, before);
  picker.handleEvent({type: INPUT_EVENTS.TEXT, value: 'missing'});
  const filtered = updates;
  assert.deepEqual(picker.getSurface().entries, []);
  assert.equal(picker.handleWheel('secondary', 'down'), false);
  assert.equal(updates, filtered);
});
