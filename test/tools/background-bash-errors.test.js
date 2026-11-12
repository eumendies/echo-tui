const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runner = require('../../src/tools/bash-command-runner');
const {startBashProcess, runBashCommand, hasUnconfirmedBashCommands} = runner;
const {createBackgroundTaskManager, MAX_CONCURRENT_BACKGROUND_TASKS} = require('../../src/tools/background-bash');
const {createBashToolHandler} = require('../../src/tools/bash-tool-handler');
const {AppContext} = require('../../src/app/state/app-context');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {createTranscriptStore} = require('../../src/persistence/transcript-store');
const {createHistoryCommandPorts} = require('../../src/app/command/history-command-ports');

// 使用真实 runner 和 manager，仅替换进程事件边界；无需当前环境允许信号投递。
function createProcessHarness(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bg-error-'));
  const child = new EventEmitter();
  child.pid = 123456;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = t.mock.fn();
  child.stdout.destroy = t.mock.fn();
  child.stderr.destroy = t.mock.fn();
  child.kill = () => {
    child.emit('error', Object.assign(new Error('kill EPERM'), {code: 'EPERM'}));
    return false;
  };
  t.mock.method(childProcess, 'spawn', () => child);
  t.mock.method(process, 'kill', () => { throw Object.assign(new Error('kill EPERM'), {code: 'EPERM'}); });
  const manager = createBackgroundTaskManager({rootDir: path.join(cwd, 'state')});
  t.after(async () => {
    child.emit('close', 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    fs.rmSync(cwd, {recursive: true, force: true});
  });
  return {cwd, child, manager};
}

test('an error after spawn does not resolve the runner before close', async (t) => {
  const {cwd, child} = createProcessHarness(t);
  const handle = startBashProcess({cwd, command: 'test command'});
  child.emit('spawn');
  await handle.started;
  let completed = false;
  const finished = handle.wait().then((result) => { completed = true; return result; });
  handle.stop();
  await Promise.resolve();
  assert.equal(completed, false);
  child.emit('close', 0, null);
  const result = await finished;
  assert.equal(completed, true);
  assert.equal(result.error, 'kill EPERM');
});

test('a pre-aborted foreground runner observes synchronous kill errors and still waits for close', async (t) => {
  const {cwd, child} = createProcessHarness(t);
  const controller = new AbortController();
  controller.abort();
  const handle = startBashProcess({cwd, command: 'test command', abortSignal: controller.signal});
  await assert.rejects(handle.started, /kill EPERM/);
  let completed = false;
  const finished = handle.wait().then((result) => { completed = true; return result; });
  await Promise.resolve();
  assert.equal(completed, false);
  child.emit('close', 0, null);
  assert.equal((await finished).error, 'kill EPERM');
});

test('pre-abort after a successful spawn handoff derives execution from the PID', async (t) => {
  const {cwd, child, manager} = createProcessHarness(t);
  child.kill = () => true;
  const controller = new AbortController();
  controller.abort();
  const pending = manager.start({cwd, shell: '/bin/bash', command: 'test command', sessionId: 'session-a', timeoutMs: null, abortSignal: controller.signal});
  child.emit('spawn');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.hasActiveWriteTask('session-a'), true);
  child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.mayHaveExecuted, true);
  assert.equal(manager.hasActiveWriteTask('session-a'), false);
});

test('handoff error with a PID retains write protection until close and marks untracked execution', async (t) => {
  const {cwd, child, manager} = createProcessHarness(t);
  let startup;
  const start = manager.start;
  manager.start = async (options) => (startup = await start(options));
  const controller = new AbortController();
  controller.abort();
  const untracked = [];
  const handler = createBashToolHandler({cwd, background: manager, sessionId: 'session-a'});
  let completed = false;
  const pending = handler.execute({background: true, command: 'test command'}, {callId: 'error', toolName: 'run_bash_command', argumentsText: '{}'}, {
    abortSignal: controller.signal,
    changeRecorder: {captureFileBefore() {}, captureFileAfter() {}, invalidate() { assert.fail('must retain controlled history'); }, markUntracked(reason) { untracked.push(reason); }}
  }).then((result) => { completed = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(manager.hasActiveWriteTask('session-a'), true);
  assert.equal(manager.listManaged('session-a')[0].state, 'stopping');
  child.emit('close', 0, null);
  assert.equal((await pending).ok, false);
  assert.equal(startup.mayHaveExecuted, true);
  assert.match(startup.message, /后台命令启动交接失败.*EPERM/);
  assert.equal(untracked.length, 1);
  assert.equal(manager.hasActiveWriteTask('session-a'), false);
});

test('cleanup deadline retains unknown process protection and a later close releases it', async (t) => {
  const {cwd, child, manager} = createProcessHarness(t);
  const controller = new AbortController();
  controller.abort();
  const result = await manager.start({cwd, shell: '/bin/bash', command: 'test command', sessionId: 'session-a', timeoutMs: null, abortSignal: controller.signal});
  assert.equal(result.ok, false);
  assert.equal(result.mayHaveExecuted, true);
  assert.match(result.message, /尚未确认进程结束/);
  assert.equal(manager.listManaged('session-a')[0].reason, 'cleanup_timeout');
  assert.equal(manager.hasActiveWriteTask('session-a'), true);
  child.emit('close', 0, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.hasActiveWriteTask('session-a'), false);
});

test('foreground cancellation protects undo immediately and clears it on close before the deadline', async (t) => {
  const {cwd, child} = createProcessHarness(t);
  const controller = new AbortController();
  const pending = runBashCommand({cwd, command: 'test command', abortSignal: controller.signal});
  child.emit('spawn');
  controller.abort();
  assert.equal(hasUnconfirmedBashCommands(cwd), true);
  child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.terminationUnconfirmed, undefined);
  assert.equal(hasUnconfirmedBashCommands(cwd), false);
  assert.equal(child.unref.mock.callCount(), 0);
});

for (const cancellation of ['timeout', 'abort']) {
  test(`foreground ${cancellation} returns a bounded error on EPERM without releasing undo safety`, async (t) => {
    const {cwd, child, manager} = createProcessHarness(t);
    const config = new UserConfigContext({readFile: () => '{}'});
    t.after(() => config.close());
    const app = new AppContext(
      {getSize: () => ({columns: 80, rows: 24})}, createTranscriptStore({rootDir: path.join(cwd, 'transcripts')}),
      cwd, process.version, undefined,
      {getFilePath: () => path.join(cwd, 'settings.json'), read: () => ({kind: 'missing'}), write() {}, remove() {}}, config, manager
    );
    app.beginChangeCheckpoint();
    app.transcriptContext.appendRecord({role: 'user', text: 'earlier turn'});
    app.finalizeChangeCheckpoint();
    const ports = createHistoryCommandPorts(app);
    const controller = new AbortController();
    const output = t.mock.fn();
    const pending = runBashCommand({cwd, command: 'test command', timeoutMs: cancellation === 'timeout' ? 10 : null, abortSignal: controller.signal, onOutput: output});
    child.emit('spawn');
    child.stdout.emit('data', Buffer.from('partial output'));
    if (cancellation === 'abort') {
      controller.abort();
      assert.equal(hasUnconfirmedBashCommands(cwd), true);
      assert.equal(ports.undo.getSummary().status, 'invalid');
      assert.match((await app.executeUndo()).message, /尚未确认命令结束/);
    }
    const result = await pending;
    assert.equal(result.terminationUnconfirmed, true);
    assert.equal(result.timedOut, cancellation === 'timeout');
    assert.match(result.error, /无法确认进程终止.*123456.*EPERM/);
    assert.equal(result.output, 'partial output');
    assert.equal(child.unref.mock.callCount(), 1);
    assert.equal(child.stdout.destroy.mock.callCount(), 1);
    assert.equal(hasUnconfirmedBashCommands(cwd), true);
    assert.equal(ports.undo.getSummary().status, 'invalid');
    assert.match((await app.executeUndo()).message, /尚未确认命令结束/);
    app.beginChangeCheckpoint();
    app.finalizeChangeCheckpoint();
    assert.ok(app.changeHistoryContext.last.untrackedReason);
    child.stdout.emit('data', Buffer.from('late output'));
    assert.equal(output.mock.callCount(), 1);
    child.emit('close', 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(hasUnconfirmedBashCommands(cwd), false);
    assert.equal(ports.undo.getSummary().status, 'ready');
    assert.equal((await app.executeUndo()).ok, true);
  });
}

test('unknown processes at the task cap do not ask the user to stop un-stoppable entries', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bg-unknown-cap-'));
  const completions = [];
  t.mock.method(runner, 'startBashProcess', () => {
    const started = Promise.reject(new Error('kill EPERM'));
    void started.catch(() => {});
    const finished = new Promise((resolve) => completions.push(resolve));
    return {pid: 123456, started, stop() {}, wait: () => finished};
  });
  t.after(async () => {
    for (const finish of completions) finish({command: 'test', exitCode: 0, signal: null, timedOut: false});
    await new Promise((resolve) => setImmediate(resolve));
    fs.rmSync(cwd, {recursive: true, force: true});
  });
  const manager = createBackgroundTaskManager({rootDir: path.join(cwd, 'state')});
  const startOptions = {cwd, shell: '/bin/bash', command: 'test command', sessionId: 'session-a', timeoutMs: null};
  const starts = Array.from({length: MAX_CONCURRENT_BACKGROUND_TASKS}, () => manager.start(startOptions));
  assert.ok((await Promise.all(starts)).every((result) => result.ok === false && result.mayHaveExecuted));
  const rejected = await manager.start(startOptions);
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /尚未确认结束.*等待实际退出/);
  assert.doesNotMatch(rejected.message, /请先停止/);
});
