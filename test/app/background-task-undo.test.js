const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const { AppContext } = require('../../src/app/state/app-context');
const { createHistoryCommandPorts } = require('../../src/app/command/history-command-ports');
const { UserConfigContext } = require('../../src/config/user-config-context');
const { createBackgroundTaskManager } = require('../../src/tools/background-bash');

// 与 manager 测试同源：实际探测 Node 的进程组信号能力，避免把受限沙箱的 EPERM 当成回归。
function canSignalChildProcesses() {
  const probe = spawnSync(process.execPath, ['-e', `
    const {spawn} = require('node:child_process');
    const child = spawn('/bin/bash', ['-c', 'sleep 2'], {detached: true, stdio: 'ignore'});
    try { process.kill(-child.pid, 'SIGTERM'); } catch { process.exit(1); }
    child.on('close', () => process.exit(0));
  `], {stdio: 'ignore', timeout: 5000});
  return probe.status === 0;
}
const SIGNAL_SKIP = canSignalChildProcesses() ? false : 'requires the ability to signal subprocesses (process-group probe denied)';

function createFakeTranscriptStore() {
  return {
    createSession(cwd) {
      return { sessionId: 'session-1', cwd, createdAt: '', updatedAt: '', sequence: 1 };
    },
    appendSession(_cwd, reference) {
      return { ...reference, sequence: reference.sequence + 1 };
    },
    getSessionFilePath(_cwd, sessionId) {
      return `/tmp/${sessionId}.jsonl`;
    },
    listSessionSummaries() {
      return [];
    },
    loadSession() {
      return null;
    },
    loadSessionReadOnly() {
      return null;
    }
  };
}

function createFakeSessionModelSettingsStore() {
  return {
    getFilePath(_cwd, sessionId) {
      return `/tmp/${sessionId}.settings.json`;
    },
    load() {
      return null;
    },
    save() {},
    remove() {}
  };
}

function createHarness(options = {}) {
  const rootDir = options.rootDir || fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bg-undo-'));
  // 任务 cwd 必须是真实目录,否则 spawn 会因为 ENOENT 直接失败。
  const workDir = options.cwd || path.join(rootDir, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  const settled = [];
  const manager = createBackgroundTaskManager({
    rootDir,
    onSettled(view) {
      settled.push(view);
    },
    onRuntimeError() {}
  });
  const app = new AppContext(
    { getSize() { return { columns: 80, rows: 24 }; } },
    createFakeTranscriptStore(),
    workDir,
    'v20.0.0',
    undefined,
    createFakeSessionModelSettingsStore(),
    new UserConfigContext(),
    manager
  );
  // 先写一条 user record,让当前会话拥有稳定身份供任务分区使用。
  app.transcriptContext.appendRecord({ role: 'user', text: 'hello' });
  const ports = createHistoryCommandPorts(app);
  const sessionId = app.transcriptContext.getCurrentSessionId();

  function startTask(command = 'sleep 0.6', overrides = {}) {
    return manager.start({
      command,
      cwd: workDir,
      sessionId,
      shell: '/bin/bash',
      timeoutMs: null,
      ...overrides
    });
  }

  async function waitSettled(taskId) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const view = manager.getManaged(taskId);
      if (view && view.state !== 'running' && view.state !== 'stopping') {
        return view;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`task ${taskId} did not settle`);
  }

  return { app, manager, ports, sessionId, settled, startTask, waitSettled, workDir };
}

test('an active write task blocks undo at both the summary and execute entries', async () => {
  const harness = createHarness();
  const started = await harness.startTask();
  assert.equal(started.ok, true);

  const summary = harness.ports.undo.getSummary();
  assert.equal(summary.status, 'invalid');
  assert.match(summary.reason, /后台命令.*稍后重试/u);

  const executed = await harness.ports.undo.execute();
  assert.equal(executed.ok, false);
  assert.equal(executed.reason, 'invalid');

  await harness.waitSettled(started.reference.taskId);
  // 任务收尾后恢复可用,而不是永久锁死。
  assert.notEqual(harness.ports.undo.getSummary().status, 'invalid');
});

test('a checkpoint begun during an active write task stays invalid after the task ends', async () => {
  const harness = createHarness();
  const started = await harness.startTask();
  assert.equal(started.ok, true);

  harness.app.beginChangeCheckpoint();
  harness.app.finalizeChangeCheckpoint();
  assert.equal(harness.app.changeHistoryContext.getSummary().status, 'invalid');

  await harness.waitSettled(started.reference.taskId);
  // 任务结束后不会回溯恢复已经失效的轮次。
  assert.equal(harness.app.changeHistoryContext.getSummary().status, 'invalid');
});

test('a new turn after the write task ends records normally again', async () => {
  const harness = createHarness();
  const started = await harness.startTask();
  assert.equal(started.ok, true);

  harness.app.beginChangeCheckpoint();
  harness.app.finalizeChangeCheckpoint();
  await harness.waitSettled(started.reference.taskId);

  harness.app.beginChangeCheckpoint();
  harness.app.finalizeChangeCheckpoint();
  assert.equal(harness.app.changeHistoryContext.getSummary().status, 'ready');

  // 回退到失效边界之前必须被阻断,历史失效边界保持有效。
  const undo = await harness.ports.undo.execute();
  assert.equal(undo.ok, true);
  assert.equal(harness.app.changeHistoryContext.getSummary().status, 'invalid');
});

test('tasks running inside an effective read-only sandbox do not hold write protection', async () => {
  const harness = createHarness();
  // 与执行链路同源:只有实际生效的只读沙箱才把写入排除在内核边界外。
  const sandbox = {
    policy: { mode: 'read-only', network: false, extraWritablePaths: [] },
    provider: {
      name: 'macos-seatbelt',
      isAvailable: () => true,
      describeUnavailable: () => '',
      wrapCommand: () => null
    }
  };
  const started = await harness.startTask('sleep 0.6', { sandbox });
  assert.equal(started.ok, true);

  assert.equal(harness.manager.hasActiveWriteTask(harness.sessionId), false);
  await harness.waitSettled(started.reference.taskId);
});

test('rewriting status.json cannot change in-memory facts or release protection', async () => {
  const harness = createHarness();
  const started = await harness.startTask();
  assert.equal(started.ok, true);

  // 模拟同 UID 子进程伪造终态:文件不可信,内存句柄才是权威。
  const forged = JSON.parse(fs.readFileSync(started.reference.statusPath, 'utf8'));
  fs.writeFileSync(started.reference.statusPath, JSON.stringify({ ...forged, state: 'exited', exit_code: 0, exitCode: 0 }), 'utf8');

  const view = harness.manager.getManaged(started.reference.taskId);
  assert.equal(view.state, 'running');
  assert.equal(harness.manager.hasActiveWriteTask(harness.sessionId), true);

  await harness.waitSettled(started.reference.taskId);
});

test('each task settles exactly once and emits a single notice', async () => {
  const harness = createHarness();
  const started = await harness.startTask('true');
  assert.equal(started.ok, true);

  await harness.waitSettled(started.reference.taskId);
  const countAfterFirstSettle = harness.settled.length;
  assert.equal(countAfterFirstSettle, 1);

  // 停止已结束任务不产生第二条终态或第二条通知。
  assert.equal(await harness.manager.stop(started.reference.taskId), false);
  assert.equal(harness.settled.length, 1);
});

test('session cleanup leaves other sessions untouched', {skip: SIGNAL_SKIP}, async () => {
  const harness = createHarness();
  const leaving = await harness.startTask('sleep 5');
  const keeping = await harness.startTask('sleep 5', { sessionId: 'session-other' });
  assert.equal(leaving.ok, true);
  assert.equal(keeping.ok, true);

  await harness.manager.stopSessionTasks(harness.sessionId);
  assert.equal((await harness.waitSettled(leaving.reference.taskId)).state, 'stopped');
  assert.equal(harness.manager.getManaged(keeping.reference.taskId).state, 'running');

  await harness.manager.shutdown();
});
