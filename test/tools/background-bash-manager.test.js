const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_BACKGROUND_LOG_BYTES,
  MAX_CONCURRENT_BACKGROUND_TASKS,
  createBackgroundTaskManager,
  readBackgroundTaskStatus
} = require('../../src/tools/background-bash');

// 与 runner 同源的环境探测:真按 process.kill(-pid) 终止进程组,而不是依赖 shell 的 kill 内建。
function canSignalChildProcesses() {
  const probe = spawnSync(process.execPath, ['-e', `
    const {spawn} = require('node:child_process');
    const child = spawn('/bin/bash', ['-c', 'sleep 2'], {detached: true, stdio: 'ignore'});
    try { process.kill(-child.pid, 'SIGTERM'); } catch { process.exit(1); }
    child.on('close', () => process.exit(0));
  `], { stdio: 'ignore', timeout: 5000 });
  return probe.status === 0;
}

const SIGNAL_SKIP = canSignalChildProcesses() ? false : 'requires the ability to signal subprocesses';

function createHarness(options = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bg-'));
  const workDir = path.join(rootDir, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  const settled = new Map();
  const waiters = new Map();
  const runtimeErrors = [];
  const manager = createBackgroundTaskManager({
    rootDir,
    ...options,
    onSettled(view) {
      settled.set(view.reference.taskId, view);
      const resolve = waiters.get(view.reference.taskId);
      if (resolve) {
        waiters.delete(view.reference.taskId);
        resolve(view);
      }
    },
    onRuntimeError(message) {
      runtimeErrors.push(message);
    }
  });

  function waitSettled(taskId, timeoutMs = 10000) {
    const known = settled.get(taskId);
    if (known) {
      return Promise.resolve(known);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(taskId);
        reject(new Error(`后台任务 ${taskId} 未在期限内收尾`));
      }, timeoutMs);
      waiters.set(taskId, (view) => {
        clearTimeout(timer);
        resolve(view);
      });
    });
  }

  function start(command, overrides = {}) {
    return manager.start({
      command,
      cwd: workDir,
      sessionId: 'session-a',
      shell: '/bin/bash',
      timeoutMs: null,
      ...overrides
    });
  }

  function readLog(outputPath) {
    return fs.readFileSync(outputPath, 'utf8');
  }

  return { manager, rootDir, runtimeErrors, settled, start, waitSettled, workDir, readLog };
}

test('background task merges both streams and publishes a real terminal status', async () => {
  const harness = createHarness();
  const started = await harness.start("printf '你好\\n'; printf '错误\\n' 1>&2");

  assert.equal(started.ok, true);
  assert.ok(fs.existsSync(started.reference.outputPath));
  assert.ok(fs.existsSync(started.reference.statusPath));

  const view = await harness.waitSettled(started.reference.taskId);
  assert.equal(view.state, 'exited');
  assert.equal(view.exitCode, 0);
  assert.equal(view.reason, null);
  assert.equal(view.outputTruncated, false);
  assert.equal(view.finishedAt !== null, true);

  const log = harness.readLog(started.reference.outputPath);
  assert.match(log, /你好/);
  assert.match(log, /错误/);

  const status = readBackgroundTaskStatus(started.reference.statusPath);
  assert.equal(status.state, 'exited');
  assert.equal(status.exitCode, 0);
  assert.equal(status.version, 1);
  assert.equal(status.ownerInstanceId, harness.manager.ownerInstanceId);
  assert.equal(status.sessionId, 'session-a');
});

test('background log removes NUL, escapes replacement characters and splits over-long lines', async () => {
  const harness = createHarness();
  const started = await harness.start(
    "printf 'a\\000b\\n'; printf 'x\\377y\\n'; node -e \"process.stdout.write('z'.repeat(9000))\""
  );

  assert.equal(started.ok, true);
  await harness.waitSettled(started.reference.taskId);

  const log = harness.readLog(started.reference.outputPath);
  assert.match(log, /^ab$/m);
  assert.match(log, /x\\uFFFDy/);
  assert.equal(log.includes('\0'), false);
  assert.equal(log.includes('\uFFFD'), false);

  // 超长物理行必须在码点边界被切开,保证 read_files 可以按行分页。
  const longLineBytes = log
    .split('\n')
    .filter((line) => line.startsWith('zzz'))
    .map((line) => Buffer.byteLength(line, 'utf8'));
  assert.ok(longLineBytes.length >= 2);
  for (const bytes of longLineBytes) {
    assert.ok(bytes <= 4096, `line exceeded 4096 bytes: ${bytes}`);
  }
});

test('background task keeps non-zero exit as a failure state, not a startup failure', async () => {
  const harness = createHarness();
  const started = await harness.start('exit 3');

  assert.equal(started.ok, true);
  const view = await harness.waitSettled(started.reference.taskId);
  assert.equal(view.state, 'exited');
  assert.equal(view.exitCode, 3);
});

test('background task with no output still publishes a readable empty log', async () => {
  const harness = createHarness();
  const started = await harness.start('true');

  assert.equal(started.ok, true);

  const view = await harness.waitSettled(started.reference.taskId);
  assert.equal(view.state, 'exited');
  assert.equal(view.exitCode, 0);
  assert.equal(harness.readLog(started.reference.outputPath), '');
});

test('background start fails without leaving a task when the process cannot spawn', async () => {
  const harness = createHarness();
  const started = await harness.start('printf hello', { shell: '/nonexistent/echo-tui-shell' });

  assert.equal(started.ok, false);
  assert.match(started.message, /ENOENT|无法启动/u);
  // 启动结果不包含任务引用;已创建的文件按 failed 终态保留,不留下运行中进程。
  const tasks = harness.manager.listManaged('session-a');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].state, 'failed');
  assert.equal(tasks[0].reason, 'runtime_error');
});

test('status.json is always parseable while the task is still running', async () => {
  const harness = createHarness();
  const started = await harness.start('sleep 2');

  assert.equal(started.ok, true);

  for (let index = 0; index < 20; index += 1) {
    const status = readBackgroundTaskStatus(started.reference.statusPath);
    assert.notEqual(status, null);
    assert.equal(status.taskId, started.reference.taskId);
  }

  assert.equal(await harness.manager.stop(started.reference.taskId), true);
});

test('configured timeout stops a background task with the timeout reason', { skip: SIGNAL_SKIP }, async () => {
  const harness = createHarness();
  const started = await harness.start('sleep 5', { timeoutMs: 150 });

  assert.equal(started.ok, true);

  const view = await harness.waitSettled(started.reference.taskId);
  assert.equal(view.state, 'stopped');
  assert.equal(view.reason, 'timeout');
});

test('log cap stops the task and marks output as truncated', { skip: SIGNAL_SKIP }, async () => {
  const harness = createHarness();
  const started = await harness.start("node -e \"process.stdout.write('y'.repeat(9 * 1024 * 1024))\"");

  assert.equal(started.ok, true);

  const view = await harness.waitSettled(started.reference.taskId, 20000);
  assert.equal(view.state, 'stopped');
  assert.equal(view.reason, 'output_limit');
  assert.equal(view.outputTruncated, true);
  assert.ok(fs.statSync(started.reference.outputPath).size <= MAX_BACKGROUND_LOG_BYTES);
});

test('concurrent task cap rejects the extra start without touching running tasks', { skip: SIGNAL_SKIP }, async () => {
  const harness = createHarness();
  const started = [];

  for (let index = 0; index < MAX_CONCURRENT_BACKGROUND_TASKS; index += 1) {
    const result = await harness.start('sleep 5');
    assert.equal(result.ok, true);
    started.push(result);
  }

  const rejected = await harness.start('sleep 5');
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, new RegExp(String(MAX_CONCURRENT_BACKGROUND_TASKS), 'u'));
  assert.equal(harness.manager.listManaged('session-a').filter((task) => task.state !== 'exited').length, MAX_CONCURRENT_BACKGROUND_TASKS);

  await harness.manager.shutdown();
});

test('user stop settles once and later stop attempts are rejected', { skip: SIGNAL_SKIP }, async () => {
  const harness = createHarness();
  const started = await harness.start('sleep 5');

  assert.equal(started.ok, true);
  assert.equal(await harness.manager.stop(started.reference.taskId), true);

  const view = await harness.waitSettled(started.reference.taskId);
  assert.equal(view.state, 'stopped');
  assert.equal(view.reason, 'user_stop');
  assert.equal(await harness.manager.stop(started.reference.taskId), false);
  assert.equal(harness.settled.size, 1);
});

test('write protection follows running tasks per session', async () => {
  const harness = createHarness();
  assert.equal(harness.manager.hasActiveWriteTask('session-a'), false);

  const started = await harness.start('sleep 0.5');
  assert.equal(started.ok, true);
  assert.equal(harness.manager.hasActiveWriteTask('session-a'), true);
  assert.equal(harness.manager.hasActiveWriteTask('session-b'), false);

  await harness.waitSettled(started.reference.taskId);
  assert.equal(harness.manager.hasActiveWriteTask('session-a'), false);
});

test('read-only inspection commands do not hold write protection', async () => {
  const harness = createHarness();
  const readonly = await harness.start('pwd');
  const started = await harness.start('sleep 0.5');

  assert.equal(readonly.ok, true);
  assert.equal(started.ok, true);
  assert.equal(harness.manager.hasActiveWriteTask('session-a'), true);

  await harness.waitSettled(started.reference.taskId);
  assert.equal(harness.manager.hasActiveWriteTask('session-a'), false);
});

test('session cleanup stops only the leaving session tasks', { skip: SIGNAL_SKIP }, async () => {
  const harness = createHarness();
  const leaving = await harness.start('sleep 5', { sessionId: 'session-a' });
  const keeping = await harness.start('sleep 5', { sessionId: 'session-b' });

  assert.equal(leaving.ok, true);
  assert.equal(keeping.ok, true);

  await harness.manager.stopSessionTasks('session-a');

  const leavingView = await harness.waitSettled(leaving.reference.taskId);
  assert.equal(leavingView.state, 'stopped');
  assert.equal(leavingView.reason, 'session_cleanup');
  assert.equal(harness.manager.getManaged(keeping.reference.taskId).state, 'running');

  await harness.manager.shutdown();
});
