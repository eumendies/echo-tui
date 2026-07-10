const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ChangeHistoryContext } = require('../../src/app/state/change-history-context');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-undo-'));
}

test('ChangeHistoryContext restores updated and added files and marks checkpoint used', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  const created = path.join(cwd, 'created.txt');
  fs.writeFileSync(target, 'before\n', 'utf8');
  const context = new ChangeHistoryContext();

  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'middle\n', 'utf8');
  recorder.captureFileAfter(target);
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'after\n', 'utf8');
  recorder.captureFileAfter(target);
  recorder.captureFileBefore(created);
  fs.writeFileSync(created, 'created\n', 'utf8');
  recorder.captureFileAfter(created);
  context.finalizeCheckpoint();

  assert.deepEqual(context.last.files.map((entry) => ({path: path.basename(entry.path), state: entry.state})), [
    {path: 'file.txt', state: 'updated'},
    {path: 'created.txt', state: 'created'}
  ]);
  assert.deepEqual(context.getSummary(), {
    status: 'ready',
    checkpointId: context.last.id,
    fileCount: 2,
    restoreFileCount: 1,
    deleteFileCount: 1
  });

  const result = context.executeUndo();

  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');
  assert.equal(fs.existsSync(created), false);

  context.markLastUsed();
  assert.deepEqual(context.getSummary(), {status: 'none'});

  fs.rmSync(cwd, {recursive: true, force: true});
});

test('ChangeHistoryContext leaves snapshot-only entries pending and does not restore them', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'before\n', 'utf8');
  const context = new ChangeHistoryContext();

  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'after\n', 'utf8');
  context.finalizeCheckpoint();

  assert.equal(context.last.files[0].state, 'pending');
  assert.deepEqual(context.getSummary(), {
    status: 'ready',
    checkpointId: context.last.id,
    fileCount: 0,
    restoreFileCount: 0,
    deleteFileCount: 0
  });

  const result = context.executeUndo();

  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'after\n');

  fs.rmSync(cwd, {recursive: true, force: true});
});

test('ChangeHistoryContext reports invalid checkpoints and refuses file changes', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'before\n', 'utf8');
  const context = new ChangeHistoryContext();

  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  context.invalidate('写入型 bash 不可追踪');
  context.finalizeCheckpoint();

  assert.deepEqual(context.getSummary(), {status: 'invalid', reason: '写入型 bash 不可追踪'});
  const result = context.executeUndo();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid');
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');

  fs.rmSync(cwd, {recursive: true, force: true});
});

test('ChangeHistoryContext restores checkpoint even when file changed after the loop', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'before\n', 'utf8');
  const context = new ChangeHistoryContext();

  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'after\n', 'utf8');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();
  fs.writeFileSync(target, 'external\n', 'utf8');

  const result = context.executeUndo();

  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');

  fs.rmSync(cwd, {recursive: true, force: true});
});

test('ChangeHistoryContext restores multiple checkpoints from newest to oldest', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'before\n', 'utf8');
  const context = new ChangeHistoryContext();

  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  let recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'first\n', 'utf8');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();

  context.beginCheckpoint({cwd, transcriptStartIndex: 1});
  recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'second\n', 'utf8');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();

  assert.equal(context.getSummary().checkpointId, context.last.id);
  let result = context.executeUndo();
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'first\n');

  context.markLastUsed();
  assert.equal(context.getSummary().checkpointId, context.last.id);
  result = context.executeUndo();
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');

  context.markLastUsed();
  assert.deepEqual(context.getSummary(), {status: 'none'});

  fs.rmSync(cwd, {recursive: true, force: true});
});

test('ChangeHistoryContext keeps invalid checkpoint as a boundary and drops older history', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'before\n', 'utf8');
  const context = new ChangeHistoryContext();

  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  let recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'first\n', 'utf8');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();

  context.beginCheckpoint({cwd, transcriptStartIndex: 1});
  context.invalidate('写入型 bash 不可追踪');
  context.finalizeCheckpoint();

  assert.equal(context.history.length, 1);
  assert.equal(context.history[0].status, 'invalid');
  assert.deepEqual(context.getSummary(), {status: 'invalid', reason: '写入型 bash 不可追踪'});

  const result = context.executeUndo();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid');
  assert.equal(fs.readFileSync(target, 'utf8'), 'first\n');

  context.beginCheckpoint({cwd, transcriptStartIndex: 2});
  recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'third\n', 'utf8');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();

  assert.equal(context.getSummary().status, 'ready');
  assert.equal(context.executeUndo().ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'first\n');
  context.markLastUsed();
  assert.deepEqual(context.getSummary(), {status: 'invalid', reason: '写入型 bash 不可追踪'});

  fs.rmSync(cwd, {recursive: true, force: true});
});

test('ChangeHistoryContext exposes one persisted history for undo and diff fallback', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  const created = path.join(cwd, 'created.txt');
  fs.writeFileSync(target, 'before\n', 'utf8');
  const context = new ChangeHistoryContext();

  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  let recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'after\n', 'utf8');
  recorder.captureFileAfter(target);
  recorder.captureFileBefore(created);
  fs.writeFileSync(created, 'created\n', 'utf8');
  recorder.captureFileAfter(created);
  context.finalizeCheckpoint();

  let history = context.getHistory();
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].files.map((entry) => ({
    path: path.basename(entry.path),
    exists: entry.snapshot.exists,
    state: entry.state
  })), [
    {path: 'file.txt', exists: true, state: 'updated'},
    {path: 'created.txt', exists: false, state: 'created'}
  ]);

  context.beginCheckpoint({cwd, transcriptStartIndex: 1});
  context.invalidate('写入型 bash 不可追踪');
  context.finalizeCheckpoint();
  history = context.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'invalid');
  assert.equal(history[0].invalidReason, '写入型 bash 不可追踪');

  context.beginCheckpoint({cwd, transcriptStartIndex: 2});
  recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'third\n', 'utf8');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();
  assert.equal(context.getHistory().length, 2);

  assert.equal(context.executeUndo().ok, true);
  context.markLastUsed();
  assert.equal(context.getHistory().length, 1);
  assert.equal(context.getHistory()[0].invalidReason, '写入型 bash 不可追踪');

  fs.rmSync(cwd, {recursive: true, force: true});
});
