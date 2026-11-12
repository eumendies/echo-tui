const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { APPLY_PATCH_TOOL_NAME, createApplyPatchToolHandler } = require('../../src/tools/apply-patch-tool-handler');
const { EDIT_FILE_TOOL_NAME, createEditFileToolHandler } = require('../../src/tools/edit-file-tool-handler');

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tui-line-ending-'));
}

function writeFile(cwd, name, content) {
  fs.writeFileSync(path.join(cwd, name), content, 'utf8');
  return name;
}

function readFile(cwd, name) {
  return fs.readFileSync(path.join(cwd, name), 'utf8');
}

function patchCall(patch) {
  return { callId: 'call_patch', toolName: APPLY_PATCH_TOOL_NAME, argumentsText: JSON.stringify({ patch }) };
}

function editCall(args) {
  return { callId: 'call_edit', toolName: EDIT_FILE_TOOL_NAME, argumentsText: JSON.stringify(args) };
}

function runPatch(cwd, lines) {
  return createApplyPatchToolHandler({ cwd }).execute({ patch: lines.join('\n') }, patchCall(lines.join('\n')));
}

function runEdit(cwd, args) {
  return createEditFileToolHandler({ cwd }).execute(args, editCall(args));
}

test('apply_patch updates a CRLF file and keeps CRLF line endings', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'line1\r\nline2\r\nline3\r\n');

  const result = runPatch(cwd, [
    '*** Begin Patch', '*** Update File: a.txt', '@@', ' line1', '-line2', '+LINE2', ' line3', '*** End Patch'
  ]);

  assert.equal(result.ok, true);
  assert.equal(readFile(cwd, 'a.txt'), 'line1\r\nLINE2\r\nline3\r\n');
});

test('apply_patch produces the same result for LF and CRLF files', () => {
  const patch = [
    '*** Begin Patch', '*** Update File: a.txt', '@@', ' line1', '-line2', '+LINE2', ' line3', '*** End Patch'
  ];
  const lfCwd = createWorkspace();
  const crlfCwd = createWorkspace();
  writeFile(lfCwd, 'a.txt', 'line1\nline2\nline3\n');
  writeFile(crlfCwd, 'a.txt', 'line1\r\nline2\r\nline3\r\n');

  assert.equal(runPatch(lfCwd, patch).ok, true);
  assert.equal(runPatch(crlfCwd, patch).ok, true);
  assert.equal(readFile(lfCwd, 'a.txt').replace(/\r\n/g, '\n'), readFile(crlfCwd, 'a.txt').replace(/\r\n/g, '\n'));
});

test('apply_patch keeps context lines on their original line ending in a mixed file', () => {
  const cwd = createWorkspace();
  // keep 是少数派 LF，old/end 是 CRLF；只有 old 被替换。
  writeFile(cwd, 'a.txt', 'keep\nold\r\nend\r\n');

  const result = runPatch(cwd, [
    '*** Begin Patch', '*** Update File: a.txt', '@@', ' keep', '-old', '+new', ' end', '*** End Patch'
  ]);

  assert.equal(result.ok, true);
  assert.equal(readFile(cwd, 'a.txt'), 'keep\nnew\r\nend\r\n');
});

test('apply_patch uses the dominant line ending for added lines', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'a\r\nb\r\nc\n');

  const result = runPatch(cwd, [
    '*** Begin Patch', '*** Update File: a.txt', '@@', ' a', '+NEW', ' b', ' c', '*** End Patch'
  ]);

  assert.equal(result.ok, true);
  assert.equal(readFile(cwd, 'a.txt'), 'a\r\nNEW\r\nb\r\nc\n');
});

test('apply_patch preserves the missing trailing newline when appending', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'line1\nline2');

  const result = runPatch(cwd, [
    '*** Begin Patch', '*** Update File: a.txt', '@@', ' line1', ' line2', '+line3', '*** End Patch'
  ]);

  assert.equal(result.ok, true);
  assert.equal(readFile(cwd, 'a.txt'), 'line1\nline2\nline3');
});

test('apply_patch rejects files containing bare CR on update and delete', () => {
  const updateCwd = createWorkspace();
  writeFile(updateCwd, 'a.txt', 'line1\rline2\r');
  const update = runPatch(updateCwd, [
    '*** Begin Patch', '*** Update File: a.txt', '@@', '-line1', '+x', '*** End Patch'
  ]);
  assert.equal(update.ok, false);
  assert.match(update.text, /bare CR line endings/);
  assert.equal(readFile(updateCwd, 'a.txt'), 'line1\rline2\r');

  const deleteCwd = createWorkspace();
  writeFile(deleteCwd, 'a.txt', 'line1\rline2\r');
  const removed = runPatch(deleteCwd, ['*** Begin Patch', '*** Delete File: a.txt', '*** End Patch']);
  assert.equal(removed.ok, false);
  assert.match(removed.text, /bare CR line endings/);
  assert.equal(readFile(deleteCwd, 'a.txt'), 'line1\rline2\r');
});

test('apply_patch display lines never carry line ending characters', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'line1\r\nline2\r\n');

  const updated = runPatch(cwd, [
    '*** Begin Patch', '*** Update File: a.txt', '@@', '-line2', '+LINE2', '*** End Patch'
  ]);
  const updateLines = updated.details.display.files[0].lines.map((line) => line.text);
  assert.equal(updateLines.some((text) => text.includes('\r') || text.includes('\n')), false);

  const deleted = runPatch(cwd, ['*** Begin Patch', '*** Delete File: a.txt', '*** End Patch']);
  const deleteLines = deleted.details.display.files[0].lines.map((line) => line.text);
  assert.deepEqual(deleteLines, ['line1', 'LINE2']);
});

test('edit_file matches an LF old_string inside a CRLF file and keeps CRLF', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'a\r\nb\r\nc\r\n');

  const result = runEdit(cwd, { path: 'a.txt', old_string: 'a\nb', new_string: 'X' });

  assert.equal(result.ok, true);
  assert.equal(readFile(cwd, 'a.txt'), 'X\r\nc\r\n');
});

test('edit_file replace_all works across CRLF matches', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'x\r\ny\r\nx\r\ny\r\n');

  const result = runEdit(cwd, { path: 'a.txt', old_string: 'x\ny', new_string: 'Z', replace_all: true });

  assert.equal(result.ok, true);
  assert.equal(readFile(cwd, 'a.txt'), 'Z\r\nZ\r\n');
});

test('edit_file does not duplicate carriage returns when new_string already uses CRLF', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'a\r\nb\r\nc\r\n');

  const result = runEdit(cwd, { path: 'a.txt', old_string: 'b\nc', new_string: 'B\r\nC' });

  assert.equal(result.ok, true);
  assert.equal(readFile(cwd, 'a.txt'), 'a\r\nB\r\nC\r\n');
  assert.equal(readFile(cwd, 'a.txt').includes('\r\r'), false);
});

test('edit_file rejects a replacement that only differs by line endings', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'a\r\nb\r\n');

  const result = runEdit(cwd, { path: 'a.txt', old_string: 'a\nb', new_string: 'a\r\nb' });

  assert.equal(result.ok, false);
  assert.match(result.text, /must be different/);
  assert.equal(readFile(cwd, 'a.txt'), 'a\r\nb\r\n');
});

test('edit_file lets the replacement decide the trailing newline', () => {
  const removeCwd = createWorkspace();
  writeFile(removeCwd, 'a.txt', 'a\r\nb\r\n');
  assert.equal(runEdit(removeCwd, { path: 'a.txt', old_string: 'b\n', new_string: 'B' }).ok, true);
  assert.equal(readFile(removeCwd, 'a.txt'), 'a\r\nB');

  const addCwd = createWorkspace();
  writeFile(addCwd, 'a.txt', 'a\nb');
  assert.equal(runEdit(addCwd, { path: 'a.txt', old_string: 'b', new_string: 'b\n' }).ok, true);
  assert.equal(readFile(addCwd, 'a.txt'), 'a\nb\n');
});

test('edit_file rejects files containing bare CR', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'a\rb\r');

  const result = runEdit(cwd, { path: 'a.txt', old_string: 'a', new_string: 'X' });

  assert.equal(result.ok, false);
  assert.match(result.text, /bare CR line endings/);
  assert.equal(readFile(cwd, 'a.txt'), 'a\rb\r');
});

test('edit_file display metadata keeps line numbers aligned on CRLF files', () => {
  const cwd = createWorkspace();
  writeFile(cwd, 'a.txt', 'one\r\ntwo\r\nthree\r\nfour\r\n');

  const result = runEdit(cwd, { path: 'a.txt', old_string: 'two\nthree', new_string: 'TWO\nTHREE' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.details.display.files[0].lines.map((line) => [line.kind, line.text, line.postLine]), [
    ['context', 'one', 1],
    ['removed', 'two', null],
    ['removed', 'three', null],
    ['added', 'TWO', 2],
    ['added', 'THREE', 3],
    ['context', 'four', 4]
  ]);
});
