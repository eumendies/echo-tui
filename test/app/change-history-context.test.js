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

test('ChangeHistoryContext refuses a checkpoint when a file changed after the controlled edit', () => {
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

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'conflict');
  assert.match(result.message, /file\.txt/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'external\n');
  assert.equal(context.getSummary().status, 'ready');

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

test('ChangeHistoryContext reports the stack delta for every mutation path', () => {
  const cwd = createTempDir();
  const context = new ChangeHistoryContext();

  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const pushed = context.finalizeCheckpoint();

  assert.equal(pushed.kind, 'push');
  assert.strictEqual(pushed.checkpoint, context.last);

  // 重复 finalize：current 已为 null，没有改动就没有增量。
  assert.equal(context.finalizeCheckpoint(), null);

  context.beginCheckpoint({cwd, transcriptStartIndex: 1});
  context.invalidate('写入型 bash 不可追踪');
  // invalidate 只清空内存栈，增量由随后的 finalize 表达。
  assert.equal(context.history.length, 0);

  const reset = context.finalizeCheckpoint();

  assert.equal(reset.kind, 'reset');
  assert.deepEqual(reset.history.map((checkpoint) => checkpoint.status), ['invalid']);
  assert.strictEqual(reset.history[0], context.history[0]);

  // 无 current 时 invalidate 是空操作：栈与增量都不变。
  const before = context.getHistory();
  context.invalidate('再次失效');
  assert.deepEqual(context.getHistory(), before);
  assert.equal(context.finalizeCheckpoint(), null);

  fs.rmSync(cwd, {recursive: true, force: true});
});

for (const change of ['content', 'removed', 'permissions', 'symlink', 'directory', 'recreated']) {
  test(`ChangeHistoryContext checks all files before restoring any on ${change} conflicts`, (t) => {
    const cwd = createTempDir();
    t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
    const first = path.join(cwd, 'first.txt');
    const conflict = path.join(cwd, 'conflict.txt');
    const context = new ChangeHistoryContext();
    context.beginCheckpoint({cwd, transcriptStartIndex: 0});
    const recorder = context.createRecorder();
    for (const target of [first, conflict]) {
      fs.writeFileSync(target, 'before');
      recorder.captureFileBefore(target);
      fs.writeFileSync(target, 'after');
      recorder.captureFileAfter(target);
    }
    if (change === 'recreated') {
      fs.unlinkSync(conflict);
      recorder.captureFileAfter(conflict);
    }
    context.finalizeCheckpoint();

    if (change === 'content' || change === 'recreated') fs.writeFileSync(conflict, 'external');
    if (change === 'removed') fs.unlinkSync(conflict);
    if (change === 'permissions') fs.chmodSync(conflict, 0o700);
    if (change === 'symlink' || change === 'directory') {
      fs.unlinkSync(conflict);
      if (change === 'symlink') fs.symlinkSync(first, conflict);
      else fs.mkdirSync(conflict);
    }

    const result = context.executeUndo();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'conflict');
    assert.ok(result.message.includes(conflict));
    assert.equal(fs.readFileSync(first, 'utf8'), 'after');
    assert.equal(context.getSummary().status, 'ready');
  });
}

test('ChangeHistoryContext preserves a modified newly created file on undo conflict', (t) => {
  const cwd = createTempDir();
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const target = path.join(cwd, 'created.txt');
  const context = new ChangeHistoryContext();
  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'created');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();
  fs.writeFileSync(target, 'manual');
  assert.equal(context.executeUndo().reason, 'conflict');
  assert.equal(fs.readFileSync(target, 'utf8'), 'manual');
});

test('ChangeHistoryContext warns for legacy files without fingerprints and preserves their restore behavior', (t) => {
  const cwd = createTempDir();
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const target = path.join(cwd, 'legacy.txt');
  fs.writeFileSync(target, 'external');
  const context = new ChangeHistoryContext();
  context.restoreHistory([{
    id: 'legacy', createdAt: new Date().toISOString(), cwd, transcriptStartIndex: 0, status: 'ready',
    files: [{path: target, snapshot: {exists: true, content: 'before'}, state: 'updated'}]
  }]);
  assert.equal(context.getSummary().uncheckedFileCount, 1);
  assert.equal(context.executeUndo().ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before');
});

test('ChangeHistoryContext separates the next undo notice from new turns and older safety metadata', (t) => {
  const cwd = createTempDir();
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const context = new ChangeHistoryContext();
  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  context.finalizeCheckpoint();
  const oldest = context.last.id;
  context.beginCheckpoint({cwd, transcriptStartIndex: 1});
  context.finalizeCheckpoint();
  const earlier = context.last.id;
  context.beginCheckpoint({cwd, transcriptStartIndex: 1});
  context.createRecorder().markUntracked('untracked bash');
  assert.equal(context.history.length, 2);
  assert.equal(context.finalizeCheckpoint().kind, 'push');
  assert.equal(context.getSummary().untrackedReason, 'untracked bash');
  assert.equal(context.executeUndo().ok, true);
  context.markLastUsed();
  assert.equal(context.history.length, 2);
  assert.equal(context.last.id, earlier);
  assert.equal(context.getSummary().status, 'ready');
  assert.equal(context.getSummary().untrackedReason, undefined);
  assert.equal(context.getSummary().undoneUntrackedNotice, '此前 Shell 操作的影响仍可能保留。');
  assert.deepEqual(context.last.files, []);

  const restored = new ChangeHistoryContext();
  restored.restoreHistory(context.getHistory());
  assert.equal(restored.getSummary().status, 'ready');
  restored.beginCheckpoint({cwd, transcriptStartIndex: 1});
  restored.finalizeCheckpoint();
  assert.equal(restored.getSummary().untrackedReason, undefined);
  assert.equal(restored.getSummary().undoneUntrackedNotice, undefined);
  assert.equal(restored.executeUndo().ok, true);
  restored.markLastUsed();
  assert.equal(restored.getSummary().status, 'ready');
  assert.ok(restored.getSummary().undoneUntrackedNotice);
  assert.equal(restored.executeUndo().ok, true);
  restored.markLastUsed();
  assert.equal(restored.last.id, oldest);
  assert.equal(restored.last.untrackedEffects, 'retained');
  assert.equal(restored.getSummary().untrackedReason, undefined);
  assert.equal(restored.getSummary().undoneUntrackedNotice, undefined);
  assert.equal(restored.executeUndo().ok, true);
  restored.markLastUsed();
  assert.equal(restored.getSummary().status, 'none');
});

test('ChangeHistoryContext blocks legacy files without fingerprints after passing untracked operations', (t) => {
  const cwd = createTempDir();
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const target = path.join(cwd, 'legacy.txt');
  fs.writeFileSync(target, 'shell');
  const context = new ChangeHistoryContext();
  context.restoreHistory([{
    id: 'legacy', createdAt: new Date().toISOString(), cwd, transcriptStartIndex: 0, status: 'ready',
    files: [{path: target, snapshot: {exists: true, content: 'before'}, state: 'updated'}]
  }]);
  context.beginCheckpoint({cwd, transcriptStartIndex: 1});
  context.finalizeCheckpoint();
  context.beginCheckpoint({cwd, transcriptStartIndex: 1});
  context.markUntracked('untracked bash');
  context.finalizeCheckpoint();
  assert.equal(context.executeUndo().ok, true);
  context.markLastUsed();
  assert.ok(context.getSummary().undoneUntrackedNotice);
  assert.equal(context.executeUndo().ok, true);
  context.markLastUsed();
  assert.equal(context.last.id, 'legacy');
  assert.equal(context.last.untrackedEffects, 'retained');
  assert.equal(context.getSummary().status, 'invalid');
  assert.match(context.getSummary().reason, /旧记录无法检查/);
  assert.equal(context.executeUndo().reason, 'invalid');
  assert.equal(fs.readFileSync(target, 'utf8'), 'shell');
  const restored = new ChangeHistoryContext();
  restored.restoreHistory(context.getHistory());
  assert.equal(restored.getSummary().status, 'invalid');
});

test('ChangeHistoryContext does not copy a previous round shell fact into a new checkpoint', (t) => {
  const cwd = createTempDir();
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const context = new ChangeHistoryContext();
  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  context.markUntracked('本轮执行 shell');
  context.finalizeCheckpoint();
  for (let round = 1; round <= 3; round += 1) {
    context.beginCheckpoint({cwd, transcriptStartIndex: round});
    context.finalizeCheckpoint();
    assert.equal(context.getSummary().untrackedReason, undefined);
    assert.equal(context.getSummary().undoneUntrackedNotice, undefined);
    assert.equal(context.last.untrackedEffects, undefined);
  }
});

test('ChangeHistoryContext bounds conflict paths and reports the omitted count', (t) => {
  const cwd = createTempDir();
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const context = new ChangeHistoryContext();
  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const recorder = context.createRecorder();
  for (let index = 0; index < 12; index += 1) {
    const target = path.join(cwd, `conflict-${index}.txt`);
    recorder.captureFileBefore(target);
    fs.writeFileSync(target, 'controlled');
    recorder.captureFileAfter(target);
    fs.writeFileSync(target, 'external');
  }
  context.finalizeCheckpoint();
  const result = context.executeUndo();
  assert.equal(result.reason, 'conflict');
  assert.match(result.message, /12 个文件已变化，未执行回退.*前 5 个.*另有 7 个/);
  assert.equal(result.message.split('\n').length, 6);
  for (const file of fs.readdirSync(cwd)) assert.equal(fs.readFileSync(path.join(cwd, file), 'utf8'), 'external');
});

test('independent shell undo sequences can leave two adjacent pending notices', () => {
  const context = new ChangeHistoryContext();
  const append = (shell) => {
    context.beginCheckpoint({cwd: '/tmp', transcriptStartIndex: 0});
    if (shell) context.markUntracked('shell');
    context.finalizeCheckpoint();
  };
  const undo = () => {
    assert.equal(context.executeUndo().ok, true);
    context.markLastUsed();
  };
  append(false);
  append(true);
  undo();
  append(false);
  append(true);
  undo();
  assert.deepEqual(context.getHistory().map((checkpoint) => checkpoint.untrackedEffects), ['notice', 'notice']);
  undo();
  assert.equal(context.last.untrackedEffects, 'notice');
  assert.ok(context.getSummary().undoneUntrackedNotice);
});

test('development journals with an after fingerprint but no baseline fingerprint can retry a restore', (t) => {
  const cwd = createTempDir();
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const target = path.join(cwd, 'intermediate.txt');
  fs.writeFileSync(target, 'before');
  const context = new ChangeHistoryContext();
  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'after');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();
  const intermediate = context.getHistory();
  delete intermediate[0].files[0].beforeFingerprint;
  fs.writeFileSync(target, 'before');
  context.restoreHistory(intermediate);
  assert.equal(context.executeUndo().ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before');
});

test('undo reuses the conflict check file read as its rollback backup', (t) => {
  const cwd = createTempDir();
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const target = path.join(cwd, 'single-read.txt');
  fs.writeFileSync(target, 'before');
  const context = new ChangeHistoryContext();
  context.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const recorder = context.createRecorder();
  recorder.captureFileBefore(target);
  fs.writeFileSync(target, 'after');
  recorder.captureFileAfter(target);
  context.finalizeCheckpoint();
  let reads = 0;
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === target) reads += 1;
    return original(file, ...args);
  });
  assert.equal(context.executeUndo().ok, true);
  assert.equal(reads, 1);
});
