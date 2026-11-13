const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {AppContext} = require('../../src/app/state/app-context');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {createTranscriptStore} = require('../../src/persistence/transcript-store');
const {createApplyPatchToolHandler} = require('../../src/tools/apply-patch-tool-handler');
const {createBashToolHandler} = require('../../src/tools/bash-tool-handler');
const {createEditFileToolHandler} = require('../../src/tools/edit-file-tool-handler');
const {createToolExecutor} = require('../../src/tools/tool-executor');
const {createToolRegistry} = require('../../src/tools/tool-registry');

function createHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-partial-undo-'));
  const cwd = path.join(root, 'work');
  const rootDir = path.join(root, 'sessions');
  fs.mkdirSync(cwd);
  const config = new UserConfigContext({readFile: () => '{}'});
  t.after(() => {
    config.close();
    fs.rmSync(root, {recursive: true, force: true});
  });
  const settings = {
    getFilePath: (_cwd, id) => path.join(root, `${id}.settings.json`),
    read: () => ({kind: 'missing'}),
    write() {},
    remove() {}
  };
  function createApp() {
    return new AppContext(
      {getSize: () => ({columns: 80, rows: 24})},
      createTranscriptStore({rootDir}), cwd, process.version, undefined, settings, config
    );
  }
  const app = createApp();
  const executor = createToolExecutor(createToolRegistry([
    createApplyPatchToolHandler({cwd}), createEditFileToolHandler({cwd}), createBashToolHandler({cwd})
  ]));
  let nextCall = 0;
  async function run(toolName, args) {
    nextCall += 1;
    const call = {callId: `call-${nextCall}`, toolName, argumentsText: JSON.stringify(args)};
    const result = await executor.execute(call, {changeRecorder: app.changeHistoryContext.createRecorder()});
    assert.equal(result.ok, true, result.text);
    return result;
  }
  function begin(text) {
    app.beginChangeCheckpoint();
    app.transcriptContext.appendRecord({role: 'user', text});
  }
  return {app, cwd, createApp, run, begin};
}

test('finite undo preserves shell-only files and permits earlier file restores after resume and fork', async (t) => {
  const {app, cwd, createApp, run, begin} = createHarness(t);
  const target = path.join(cwd, 'file.txt');
  const earlierFile = path.join(cwd, 'earlier.txt');
  fs.writeFileSync(target, 'before\n');
  fs.writeFileSync(earlierFile, 'original\n');
  begin('earlier turn');
  await run('edit_file', {path: 'earlier.txt', old_string: 'original', new_string: 'earlier edit'});
  app.transcriptContext.appendRecord({role: 'assistant', text: 'earlier answer'});
  app.finalizeChangeCheckpoint();
  const earlier = app.changeHistoryContext.last.id;
  const originalRecords = structuredClone(app.transcriptContext.getResidentRecords());

  begin('edit, run shell, edit again');
  await run('apply_patch', {patch: '*** Begin Patch\n*** Add File: created.txt\n+created\n*** End Patch'});
  await run('edit_file', {path: 'file.txt', old_string: 'before', new_string: 'middle'});
  await run('run_bash_command', {command: "printf shell > shell-only.txt"});
  await run('edit_file', {path: 'file.txt', old_string: 'middle', new_string: 'after'});
  app.finalizeChangeCheckpoint();
  const summary = app.changeHistoryContext.getSummary();
  assert.equal(summary.status, 'ready');
  assert.equal(summary.fileCount, 2);
  assert.ok(summary.untrackedReason);
  assert.equal(app.changeHistoryContext.history.length, 2);

  const sessionId = app.transcriptContext.getCurrentSessionId();
  const resumed = createApp();
  assert.ok(resumed.loadTranscriptSession(sessionId));
  assert.deepEqual(resumed.changeHistoryContext.getSummary(), summary);
  assert.equal((await resumed.executeUndo()).ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');
  assert.equal(fs.existsSync(path.join(cwd, 'created.txt')), false);
  assert.equal(fs.readFileSync(path.join(cwd, 'shell-only.txt'), 'utf8'), 'shell');
  assert.deepEqual(resumed.transcriptContext.getResidentRecords(), originalRecords);
  assert.deepEqual(resumed.transcriptContext.changeHistory, resumed.changeHistoryContext.getHistory());
  assert.equal(resumed.changeHistoryContext.history[0].id, earlier);
  assert.equal(resumed.changeHistoryContext.getSummary().status, 'ready');
  assert.ok(resumed.changeHistoryContext.getSummary().undoneUntrackedNotice);
  assert.equal(resumed.changeHistoryContext.history.length, 1);

  const loaded = createApp();
  assert.ok(loaded.loadTranscriptSession(sessionId));
  assert.equal(loaded.changeHistoryContext.getSummary().status, 'ready');
  assert.ok(loaded.changeHistoryContext.getSummary().undoneUntrackedNotice);
  assert.equal(loaded.changeHistoryContext.history.length, 1);
  const fork = loaded.forkTranscriptSession();
  assert.equal(fork.ok, true);
  const forked = createApp();
  assert.ok(forked.loadTranscriptSession(loaded.transcriptContext.getCurrentSessionId()));
  assert.equal(forked.changeHistoryContext.getSummary().status, 'ready');
  assert.ok(forked.changeHistoryContext.getSummary().undoneUntrackedNotice);
  assert.equal(forked.changeHistoryContext.history[0].id, earlier);
  assert.equal((await forked.executeUndo()).ok, true);
  assert.equal(fs.readFileSync(earlierFile, 'utf8'), 'original\n');
  assert.equal(fs.readFileSync(path.join(cwd, 'shell-only.txt'), 'utf8'), 'shell');
  assert.deepEqual(forked.transcriptContext.getResidentRecords(), []);
  assert.equal(forked.changeHistoryContext.getSummary().status, 'none');
  const source = createApp();
  assert.ok(source.loadTranscriptSession(sessionId));
  assert.equal(source.changeHistoryContext.getSummary().status, 'ready');
  assert.ok(source.changeHistoryContext.getSummary().undoneUntrackedNotice);
});

test('shell changes to a controlled file refuse all restores without truncating the transcript', async (t) => {
  const {app, cwd, run, begin, createApp} = createHarness(t);
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'before\n');
  begin('edit then shell changes the same path');
  await run('apply_patch', {patch: '*** Begin Patch\n*** Add File: created.txt\n+created\n*** End Patch'});
  await run('edit_file', {path: 'file.txt', old_string: 'before', new_string: 'after'});
  await run('run_bash_command', {command: 'printf shell > file.txt'});
  app.finalizeChangeCheckpoint();
  const history = app.changeHistoryContext.getHistory();
  const records = structuredClone(app.transcriptContext.getResidentRecords());

  const resumed = createApp();
  assert.ok(resumed.loadTranscriptSession(app.transcriptContext.getCurrentSessionId()));
  const result = await resumed.executeUndo();
  assert.equal(result.reason, 'conflict');
  assert.ok(result.message.includes(target));
  assert.equal(fs.readFileSync(target, 'utf8'), 'shell');
  assert.equal(fs.readFileSync(path.join(cwd, 'created.txt'), 'utf8'), 'created\n');
  assert.deepEqual(resumed.changeHistoryContext.getHistory(), history);
  assert.deepEqual(resumed.transcriptContext.getResidentRecords(), records);
});

test('finite undo with no controlled writes rolls back conversation without leaving a hard boundary', async (t) => {
  const {app, run, begin} = createHarness(t);
  begin('a read-only script outside the allowlist');
  await run('run_bash_command', {command: 'node -e "console.log(1)"'});
  app.finalizeChangeCheckpoint();
  assert.equal(app.changeHistoryContext.getSummary().fileCount, 0);
  assert.equal((await app.executeUndo()).ok, true);
  assert.deepEqual(app.transcriptContext.getResidentRecords(), []);
  assert.equal((await app.executeUndo()).reason, 'none');
});

test('finite undo can retry a failed journal commit after files reached their baseline', async (t) => {
  const {app, cwd, run, begin, createApp} = createHarness(t);
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'before\n');
  begin('earlier turn');
  app.finalizeChangeCheckpoint();
  begin('edit with an untracked script');
  await run('edit_file', {path: 'file.txt', old_string: 'before', new_string: 'after'});
  await run('run_bash_command', {command: 'node -e "console.log(1)"'});
  app.finalizeChangeCheckpoint();
  const original = app.transcriptContext.transcriptStore.appendSession;
  app.transcriptContext.transcriptStore.appendSession = () => { throw new Error('disk unavailable'); };
  const result = await app.executeUndo();
  assert.equal(result.reason, 'restore_failed');
  assert.equal(app.changeHistoryContext.getSummary().status, 'ready');
  assert.equal(app.transcriptContext.getResidentRecords().length, 2);
  assert.equal(app.changeHistoryContext.history[0].untrackedReason, undefined);
  assert.equal(app.transcriptContext.changeHistory[0].untrackedReason, undefined);
  app.transcriptContext.transcriptStore.appendSession = original;

  const resumed = createApp();
  assert.ok(resumed.loadTranscriptSession(app.transcriptContext.getCurrentSessionId()));
  assert.equal((await resumed.executeUndo()).ok, true);
  assert.equal(resumed.changeHistoryContext.getSummary().status, 'ready');
  assert.ok(resumed.changeHistoryContext.getSummary().undoneUntrackedNotice);
  assert.equal(resumed.transcriptContext.getResidentRecords().length, 1);
  assert.equal((await resumed.executeUndo()).ok, true);
  assert.deepEqual(resumed.transcriptContext.getResidentRecords(), []);
});

test('continuing past an untracked turn rejects changes to an earlier controlled file', async (t) => {
  const {app, cwd, run, begin, createApp} = createHarness(t);
  const target = path.join(cwd, 'earlier.txt');
  fs.writeFileSync(target, 'original\n');
  begin('edit earlier file');
  await run('edit_file', {path: 'earlier.txt', old_string: 'original', new_string: 'after'});
  app.finalizeChangeCheckpoint();
  const originalRecords = structuredClone(app.transcriptContext.getResidentRecords());
  begin('shell changes the earlier file');
  await run('apply_patch', {patch: '*** Begin Patch\n*** Add File: newer.txt\n+newer\n*** End Patch'});
  await run('run_bash_command', {command: 'printf shell > earlier.txt'});
  app.finalizeChangeCheckpoint();
  assert.equal((await app.executeUndo()).ok, true);
  assert.equal(fs.existsSync(path.join(cwd, 'newer.txt')), false);

  const resumed = createApp();
  const sessionId = app.transcriptContext.getCurrentSessionId();
  assert.ok(resumed.loadTranscriptSession(sessionId));
  assert.equal(resumed.changeHistoryContext.getSummary().status, 'ready');
  assert.ok(resumed.changeHistoryContext.getSummary().undoneUntrackedNotice);
  const result = await resumed.executeUndo();
  assert.equal(result.reason, 'conflict');
  assert.ok(result.message.includes(target));
  assert.equal(fs.readFileSync(target, 'utf8'), 'shell');
  assert.deepEqual(resumed.transcriptContext.getResidentRecords(), originalRecords);
  assert.equal(resumed.changeHistoryContext.history.length, 1);
});

test('controlled symlink updates undo their target and persist its identity', async (t) => {
  const {app, cwd, run, begin, createApp} = createHarness(t);
  const target = path.join(cwd, 'real.conf');
  const link = path.join(cwd, 'dotfiles.conf');
  fs.writeFileSync(target, 'before\n');
  fs.symlinkSync(target, link);
  begin('edit linked dotfiles');
  await run('apply_patch', {patch: '*** Begin Patch\n*** Update File: dotfiles.conf\n@@\n-before\n+after\n*** End Patch'});
  app.finalizeChangeCheckpoint();
  assert.equal(app.changeHistoryContext.getSummary().status, 'ready');
  assert.equal(fs.readFileSync(target, 'utf8'), 'after\n');
  const resumed = createApp();
  assert.ok(resumed.loadTranscriptSession(app.transcriptContext.getCurrentSessionId()));
  assert.equal((await resumed.executeUndo()).ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});

test('repointing an edited symlink to equal content rejects undo', async (t) => {
  const {app, cwd, run, begin} = createHarness(t);
  const target = path.join(cwd, 'real.conf');
  const other = path.join(cwd, 'other.conf');
  const link = path.join(cwd, 'dotfiles.conf');
  fs.writeFileSync(target, 'before\n');
  fs.symlinkSync(target, link);
  begin('edit linked dotfiles');
  await run('apply_patch', {patch: '*** Begin Patch\n*** Update File: dotfiles.conf\n@@\n-before\n+after\n*** End Patch'});
  app.finalizeChangeCheckpoint();
  fs.writeFileSync(other, 'after\n');
  fs.unlinkSync(link);
  fs.symlinkSync(other, link);
  assert.equal((await app.executeUndo()).reason, 'conflict');
  assert.equal(fs.readFileSync(other, 'utf8'), 'after\n');
  assert.equal(app.transcriptContext.getResidentRecords().length, 1);
});

test('non-UTF8 patch baselines survive persistence, restore and retry without changing bytes', async (t) => {
  const {app, cwd, run, begin, createApp} = createHarness(t);
  const target = path.join(cwd, 'non-utf8.txt');
  const bytes = Buffer.from('fffe410a', 'hex');
  fs.writeFileSync(target, bytes);
  begin('patch a file whose text decoding is lossy');
  await run('apply_patch', {patch: '*** Begin Patch\n*** Update File: non-utf8.txt\n@@\n-��A\n+after\n*** End Patch'});
  app.finalizeChangeCheckpoint();
  const sessionId = app.transcriptContext.getCurrentSessionId();
  assert.equal(app.changeHistoryContext.last.files[0].snapshot.contentBase64, bytes.toString('base64'));
  const original = app.transcriptContext.transcriptStore.appendSession;
  app.transcriptContext.transcriptStore.appendSession = () => { throw new Error('disk unavailable'); };
  assert.equal((await app.executeUndo()).reason, 'restore_failed');
  assert.deepEqual(fs.readFileSync(target), bytes);
  app.transcriptContext.transcriptStore.appendSession = original;
  const resumed = createApp();
  assert.ok(resumed.loadTranscriptSession(sessionId));
  assert.equal((await resumed.executeUndo()).ok, true);
  assert.deepEqual(fs.readFileSync(target), bytes);
});
