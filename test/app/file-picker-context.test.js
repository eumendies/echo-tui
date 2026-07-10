const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FilePickerContext } = require('../../src/app/state/file-picker-context');
const composerOps = require('../../src/input/composer');
const { INPUT_EVENTS } = require('../../src/input/event-types');

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
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

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
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

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
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

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
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  picker.handleEvent({type: INPUT_EVENTS.MOVE_RIGHT});
  for (let index = 0; index < 20; index += 1) {
    picker.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  }
  assert.equal(picker.getSurface().previewLines[2], '20 line 20');

  picker.handleEvent({type: INPUT_EVENTS.MOVE_UP});

  assert.equal(picker.getSurface().previewLines[2], '19 line 19');
});

test('FilePickerContext expands text preview window from terminal height', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-picker-preview-height-'));
  fs.writeFileSync(path.join(cwd, 'long.txt'), Array.from({length: 40}, (_value, index) => `line ${index + 1}`).join('\n'));
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}, rows: () => 40});

  picker.open(0);

  const surface = picker.getSurface();
  assert.equal(surface.previewLines[2], '1 line 1');
  assert.equal(surface.previewLines[29], '28 line 28');
});

test('FilePickerContext inserts trailing space after file mention', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  picker.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  picker.handleEvent({type: INPUT_EVENTS.SUBMIT});

  assert.equal(composerOps.getText(composer), '@README.md ');
});

test('FilePickerContext supports selecting directories with files', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

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
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

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
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

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
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  assert.deepEqual(picker.getSurface().entries, []);
  assert.match(picker.getSurface().notice, /没有可显示路径/);

  const missingPicker = new FilePickerContext(composerOps.createComposer('@'), {cwd: () => path.join(cwd, 'missing'), onChange: () => {}});
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
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => {}});

  picker.open(0);
  const surface = picker.getSurface();
  assert.deepEqual(surface.entries.map((entry) => entry.name), ['repo', 'root.txt']);
  assert.equal(surface.notice, undefined);
});

test('FilePickerContext consumes Esc by closing the picker surface', () => {
  const cwd = createProject();
  const composer = composerOps.createComposer('@');
  let updates = 0;
  const picker = new FilePickerContext(composer, {cwd: () => cwd, onChange: () => { updates += 1; }});

  picker.open(0);
  assert.equal(picker.hasActiveRequest(), true);

  picker.handleEvent({type: INPUT_EVENTS.ESCAPE});

  assert.equal(picker.hasActiveRequest(), false);
  assert.equal(picker.getSurface(), null);
  assert.equal(composerOps.getText(composer), '@');
  assert.equal(updates, 2);
});
