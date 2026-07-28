const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  EDIT_FILE_TOOL_NAME,
  createEditFileCallLabel,
  createEditFileDisplayFile,
  createEditFileToolHandler
} = require('../../src/tools/edit-file-tool-handler');
const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');
const {ChangeHistoryContext} = require('../../src/app/state/change-history-context');

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tui-edit-file-'));
}

function createCall(args, callId = 'call_edit') {
  return {callId, toolName: EDIT_FILE_TOOL_NAME, argumentsText: JSON.stringify(args)};
}

function createConfig(fileEditMode) {
  return {
    agentType: 'fake',
    apiKey: '',
    model: 'fake',
    tools: {bash: {timeoutMs: null, maxOutputBytes: 65_536}, fileEditMode}
  };
}

test('edit_file definition and call label expose bounded search-and-replace arguments', () => {
  const handler = createEditFileToolHandler();

  assert.equal(handler.definition.name, 'edit_file');
  assert.deepEqual(handler.definition.parameters.required, ['path', 'old_string', 'new_string']);
  assert.equal(createEditFileCallLabel(JSON.stringify({path: 'src/a.ts', old_string: 'secret', new_string: 'value'})), 'edit_file(src/a.ts)');
  assert.equal(createEditFileCallLabel(JSON.stringify({path: 'src/a.ts', old_string: 'secret', new_string: 'value', replace_all: true})), 'edit_file(src/a.ts, replace all)');
  assert.equal(createEditFileCallLabel('{broken'), 'edit_file');
});

test('edit_file replaces a unique inline match and records full line display facts', () => {
  const cwd = createWorkspace();
  const filePath = path.join(cwd, 'src.txt');
  fs.writeFileSync(filePath, 'alpha\nconst enabled = false;\nomega\n');
  const calls = {before: [], after: []};
  const handler = createEditFileToolHandler({cwd});
  const args = {path: 'src.txt', old_string: 'false', new_string: 'true'};
  const result = handler.execute(args, createCall(args), {
    changeRecorder: {
      captureFileBefore(value) { calls.before.push(value); },
      captureFileAfter(value) { calls.after.push(value); },
      invalidate() {}
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Replaced 1 occurrence in src.txt.');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'alpha\nconst enabled = true;\nomega\n');
  assert.deepEqual(calls, {before: [filePath], after: [filePath]});
  assert.deepEqual(result.details.display, {
    kind: 'edit_file',
    files: [{
      path: 'src.txt',
      kind: 'updated',
      lines: [
        {kind: 'context', text: 'alpha', postLine: 1},
        {kind: 'removed', text: 'const enabled = false;', postLine: null},
        {kind: 'added', text: 'const enabled = true;', postLine: 2},
        {kind: 'context', text: 'omega', postLine: 3}
      ]
    }]
  });
});

test('edit_file rejects zero and ambiguous matches without writing', () => {
  const cwd = createWorkspace();
  const filePath = path.join(cwd, 'a.txt');
  fs.writeFileSync(filePath, 'same\nsame\n');
  const handler = createEditFileToolHandler({cwd});

  const missingArgs = {path: 'a.txt', old_string: 'missing', new_string: 'new'};
  const ambiguousArgs = {path: 'a.txt', old_string: 'same', new_string: 'new'};
  const missing = handler.execute(missingArgs, createCall(missingArgs));
  const ambiguous = handler.execute(ambiguousArgs, createCall(ambiguousArgs));

  assert.equal(missing.ok, false);
  assert.match(missing.text, /matched 0 locations/);
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.text, /matched 2 locations/);
  assert.match(ambiguous.text, /replace_all/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'same\nsame\n');
});

test('edit_file replace_all uses original non-overlapping matches and preserves distant regions', () => {
  const cwd = createWorkspace();
  const filePath = path.join(cwd, 'many.txt');
  fs.writeFileSync(filePath, 'old first\nkeep 1\nkeep 2\nold second\n');
  const handler = createEditFileToolHandler({cwd});
  const args = {path: 'many.txt', old_string: 'old', new_string: 'old-new', replace_all: true};
  const result = handler.execute(args, createCall(args));

  assert.equal(result.ok, true);
  assert.match(result.text, /2 occurrences/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'old-new first\nkeep 1\nkeep 2\nold-new second\n');
  assert.deepEqual(result.details.display.files[0].lines.filter((line) => line.kind !== 'context').map((line) => [line.kind, line.text]), [
    ['removed', 'old first'],
    ['added', 'old-new first'],
    ['removed', 'old second'],
    ['added', 'old-new second']
  ]);
});

test('edit_file validates parameters and target safety before writing', () => {
  const cwd = createWorkspace();
  fs.mkdirSync(path.join(cwd, 'dir'));
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.writeFileSync(path.join(cwd, 'binary.txt'), Buffer.from([0xff, 0xfe]));
  fs.writeFileSync(path.join(cwd, 'nul.txt'), 'a\0b');
  fs.writeFileSync(path.join(cwd, 'large.txt'), '12345');
  const handler = createEditFileToolHandler({cwd, maxFileBytes: 4});
  const cases = [
    [{path: 'x', old_string: '', new_string: 'a'}, /non-empty/],
    [{path: 'x', old_string: 'a', new_string: 'a'}, /must be different/],
    [{path: 'missing.txt', old_string: 'a', new_string: 'b'}, /does not exist/],
    [{path: 'dir', old_string: 'a', new_string: 'b'}, /not a regular file/],
    [{path: '.git/config', old_string: 'a', new_string: 'b'}, /.git paths are not allowed/],
    [{path: 'binary.txt', old_string: 'a', new_string: 'b'}, /not valid UTF-8/],
    [{path: 'nul.txt', old_string: 'a', new_string: 'b'}, /appears to be binary/],
    [{path: 'large.txt', old_string: 'a', new_string: 'b'}, /exceeds 4 bytes/]
  ];

  for (const [args, pattern] of cases) {
    const result = handler.execute(args, createCall(args));
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.match(result.text, pattern);
  }
});

test('edit_file accepts absolute and parent paths while preserving one existing target', () => {
  const cwd = createWorkspace();
  const nested = path.join(cwd, 'nested');
  const target = path.join(cwd, 'target.txt');
  fs.mkdirSync(nested);
  fs.writeFileSync(target, 'before\n');
  const handler = createEditFileToolHandler({cwd: nested});
  const parentArgs = {path: '../target.txt', old_string: 'before', new_string: 'middle'};
  const absoluteArgs = {path: target, old_string: 'middle', new_string: 'after'};

  assert.equal(handler.execute(parentArgs, createCall(parentArgs)).ok, true);
  assert.equal(handler.execute(absoluteArgs, createCall(absoluteArgs)).ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'after\n');
});

test('edit_file write failure leaves the target unchanged and does not mark it updated', () => {
  const cwd = createWorkspace();
  const target = path.join(cwd, 'failure.txt');
  fs.writeFileSync(target, 'before\n');
  const originalWriteFileSync = fs.writeFileSync;
  const calls = {before: 0, after: 0};
  const args = {path: 'failure.txt', old_string: 'before', new_string: 'after'};

  fs.writeFileSync = (...values) => {
    if (values[0] === target) throw new Error('simulated write failure');
    return originalWriteFileSync(...values);
  };
  try {
    const result = createEditFileToolHandler({cwd}).execute(args, createCall(args), {
      changeRecorder: {
        captureFileBefore() { calls.before += 1; },
        captureFileAfter() { calls.after += 1; },
        invalidate() {}
      }
    });

    assert.equal(result.ok, false);
    assert.match(result.text, /simulated write failure/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');
    assert.deepEqual(calls, {before: 1, after: 0});
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
});

test('edit_file display projection merges multiple replacements on one logical line', () => {
  const before = 'old + old\nnext\n';
  const after = 'new + new\nnext\n';
  const display = createEditFileDisplayFile('same-line.txt', before, after, [
    {oldStart: 0, oldEnd: 3, postStart: 0, postEnd: 3},
    {oldStart: 6, oldEnd: 9, postStart: 6, postEnd: 9}
  ]);

  assert.deepEqual(display.lines, [
    {kind: 'removed', text: 'old + old', postLine: null},
    {kind: 'added', text: 'new + new', postLine: 1},
    {kind: 'context', text: 'next', postLine: 2}
  ]);
});

test('edit_file display projection handles whole-line deletion and multiline replacement', () => {
  const deleted = createEditFileDisplayFile('delete.txt', 'a\nremove\nb\n', 'a\nb\n', [
    {oldStart: 2, oldEnd: 9, postStart: 2, postEnd: 2}
  ]);
  const multiline = createEditFileDisplayFile('multi.txt', 'a\nold\nb\n', 'a\nnew 1\nnew 2\nb\n', [
    {oldStart: 2, oldEnd: 5, postStart: 2, postEnd: 13}
  ]);

  assert.deepEqual(deleted.lines, [
    {kind: 'context', text: 'a', postLine: 1},
    {kind: 'removed', text: 'remove', postLine: null},
    {kind: 'context', text: 'b', postLine: 2}
  ]);
  assert.deepEqual(multiline.lines.filter((line) => line.kind !== 'context'), [
    {kind: 'removed', text: 'old', postLine: null},
    {kind: 'added', text: 'new 1', postLine: 2},
    {kind: 'added', text: 'new 2', postLine: 3}
  ]);
});

test('edit_file display projection preserves consecutive line deletions at one anchor', () => {
  const display = createEditFileDisplayFile('delete-all.txt', 'drop\ndrop\nkeep\n', 'keep\n', [
    {oldStart: 0, oldEnd: 5, postStart: 0, postEnd: 0},
    {oldStart: 5, oldEnd: 10, postStart: 0, postEnd: 0}
  ]);

  assert.deepEqual(display.lines, [
    {kind: 'removed', text: 'drop', postLine: null},
    {kind: 'removed', text: 'drop', postLine: null},
    {kind: 'context', text: 'keep', postLine: 1}
  ]);
});

test('edit_file display projection includes both lines when deleting only a newline', () => {
  const display = createEditFileDisplayFile('join.txt', 'left\nright', 'leftright', [
    {oldStart: 4, oldEnd: 5, postStart: 4, postEnd: 4}
  ]);

  assert.deepEqual(display.lines, [
    {kind: 'removed', text: 'left', postLine: null},
    {kind: 'removed', text: 'right', postLine: null},
    {kind: 'added', text: 'leftright', postLine: 1}
  ]);
});

test('default registry exposes exactly the selected file edit tool', () => {
  const patchNames = createDefaultToolRegistry(createConfig('apply_patch')).listDefinitions().map((item) => item.name);
  const editNames = createDefaultToolRegistry(createConfig('edit_file')).listDefinitions().map((item) => item.name);
  const fallbackNames = createDefaultToolRegistry(createConfig('invalid')).listDefinitions().map((item) => item.name);

  assert.equal(patchNames.includes('apply_patch'), true);
  assert.equal(patchNames.includes('edit_file'), false);
  assert.equal(editNames.includes('apply_patch'), false);
  assert.equal(editNames.includes('edit_file'), true);
  assert.equal(fallbackNames.includes('apply_patch'), true);
});

test('edit_file updates share the existing checkpoint and undo restores the first snapshot', () => {
  const cwd = createWorkspace();
  const filePath = path.join(cwd, 'undo.txt');
  fs.writeFileSync(filePath, 'one\n');
  const history = new ChangeHistoryContext();
  history.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const handler = createEditFileToolHandler({cwd});

  const first = {path: 'undo.txt', old_string: 'one', new_string: 'two'};
  const second = {path: 'undo.txt', old_string: 'two', new_string: 'three'};
  assert.equal(handler.execute(first, createCall(first, 'first'), {changeRecorder: history.createRecorder()}).ok, true);
  assert.equal(handler.execute(second, createCall(second, 'second'), {changeRecorder: history.createRecorder()}).ok, true);
  history.finalizeCheckpoint();

  assert.equal(history.getSummary().fileCount, 1);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'three\n');
  assert.equal(history.executeUndo().ok, true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'one\n');
});
