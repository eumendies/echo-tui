const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BACKGROUND_UNSUPPORTED_MESSAGE,
  RUN_BASH_COMMAND_TOOL_NAME,
  createBashToolHandler
} = require('../../src/tools/bash-tool-handler');
const { createBackgroundTaskManager } = require('../../src/tools/background-bash');
const { createDefaultToolRegistry } = require('../../src/tools/tool-registry');
const { createReadFilesToolHandler, READ_FILES_TOOL_NAME } = require('../../src/tools/read-files');
const { createToolExecutor } = require('../../src/tools/tool-executor');
const { createToolRegistry } = require('../../src/tools/tool-registry');
const { classifyToolCallConcurrency } = require('../../src/tools/tool-concurrency-classifier');
const { classifyToolCallRisk } = require('../../src/tools/tool-risk-classifier');

const config = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake',
  tools: {
    bash: { timeoutMs: null, maxOutputBytes: 4096 },
    sandbox: { mode: 'off', network: false, extraWritablePaths: [] }
  }
};

function createWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bg-tool-'));
}

function createCall(argumentsText, toolName = RUN_BASH_COMMAND_TOOL_NAME) {
  return { callId: 'call_bg', toolName, argumentsText };
}

function createHarness() {
  const workDir = createWorkDir();
  const manager = createBackgroundTaskManager({ rootDir: path.join(workDir, 'state') });
  const executor = createToolExecutor(createToolRegistry([
    createBashToolHandler({ background: manager, cwd: workDir, sessionId: 'session-a' })
  ]));

  return { executor, manager, workDir };
}

function waitForTerminal(manager, taskId, timeoutMs = 10000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function poll() {
      const view = manager.getManaged(taskId);
      if (view && view.state !== 'running' && view.state !== 'stopping') {
        resolve(view);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`task ${taskId} did not settle`));
        return;
      }
      setTimeout(poll, 20);
    }
    poll();
  });
}

test('background start returns file references without command output', async () => {
  const harness = createHarness();
  const result = await harness.executor.execute(createCall(JSON.stringify({
    background: true,
    command: "printf 'hello-from-bg\\n'; sleep 0.2"
  })));

  assert.equal(result.ok, true);
  assert.equal(result.toolName, RUN_BASH_COMMAND_TOOL_NAME);
  assert.equal(result.details.kind, 'bash');
  assert.equal(result.details.background.sessionId, 'session-a');
  assert.equal(result.details.background.ownerInstanceId, harness.manager.ownerInstanceId);
  assert.ok(fs.existsSync(result.details.background.outputPath));
  assert.ok(fs.existsSync(result.details.background.statusPath));

  // 启动文本只含元信息与路径,不能出现在前台成功输出里才有的分段标记。
  // 工具文本只给查询所需的状态与路径;内部任务身份不进入模型可见结果。
  assert.equal(/task_id/u.test(result.text), false);
  assert.match(result.text, /^state: /m);
  assert.match(result.text, /read_files/u);
  assert.equal(result.text.includes('stdout:'), false);
  assert.equal(result.text.includes('stderr:'), false);
  assert.equal(result.text.includes('hello-from-bg'), false);

  const view = await waitForTerminal(harness.manager, result.details.background.taskId);
  assert.equal(view.state, 'exited');
  assert.equal(view.exitCode, 0);
});

test('background start result stays readable through the existing read_files tool', async () => {
  const harness = createHarness();
  const result = await harness.executor.execute(createCall(JSON.stringify({
    background: true,
    command: "printf 'ready\\n'; sleep 0.2"
  })));

  assert.equal(result.ok, true);
  await waitForTerminal(harness.manager, result.details.background.taskId);

  const readExecutor = createToolExecutor(createToolRegistry([
    createReadFilesToolHandler({ cwd: harness.workDir })
  ]));
  const read = await readExecutor.execute(createCall(JSON.stringify({
    files: [{ path: result.details.background.statusPath }, { path: result.details.background.outputPath }]
  }), READ_FILES_TOOL_NAME));

  assert.equal(read.ok, true);
  assert.match(read.text, /"taskId": "bash-1"/u);
  assert.match(read.text, /ready/u);
});

test('omitting background keeps the foreground behaviour unchanged', async () => {
  const harness = createHarness();
  const result = await harness.executor.execute(createCall(JSON.stringify({ command: 'printf hello' })));

  assert.equal(result.ok, true);
  assert.equal(result.text, 'hello');
  assert.equal(result.details.exitCode, 0);
  assert.equal(result.details.background, undefined);
});

test('non-boolean background is rejected before any process starts', async () => {
  const harness = createHarness();
  const result = await harness.executor.execute(createCall(JSON.stringify({ background: 'yes', command: 'printf hello' })));

  assert.equal(result.ok, false);
  assert.match(result.text, /background must be a boolean/u);
  assert.deepEqual(harness.manager.listManaged('session-a'), []);
});

test('background is rejected when the run has no manager capability', async () => {
  const workDir = createWorkDir();
  const executor = createToolExecutor(createToolRegistry([
    createBashToolHandler({ cwd: workDir })
  ]));
  const result = await executor.execute(createCall(JSON.stringify({ background: true, command: 'printf hello' })));

  assert.equal(result.ok, false);
  assert.equal(result.text, BACKGROUND_UNSUPPORTED_MESSAGE);
  assert.equal(result.details.background, undefined);
});

test('background start is classified as an exclusive call while foreground readonly stays parallel', () => {
  const background = createCall(JSON.stringify({ background: true, command: 'git status --short' }));
  const foregroundReadonly = createCall(JSON.stringify({ command: 'git status --short' }));
  const foregroundWrite = createCall(JSON.stringify({ command: 'npm test' }));

  assert.equal(classifyToolCallConcurrency(background), 'exclusive');
  assert.equal(classifyToolCallConcurrency(foregroundReadonly), 'parallel_read');
  assert.equal(classifyToolCallConcurrency(foregroundWrite), 'exclusive');
});

test('plan mode still rejects write-like commands that ask for background', () => {
  const call = createCall(JSON.stringify({ background: true, command: 'rm -rf build' }));
  const assessment = classifyToolCallRisk(call, 'plan');

  assert.equal(assessment.risk, 'rejected');
  assert.equal(assessment.reason, 'plan_mode');
});

test('a successful background start marks untracked writes without invalidating the checkpoint', async () => {
  const harness = createHarness();
  const invalidations = [];
  const untracked = [];
  const changeRecorder = {
    captureFileAfter: () => {},
    captureFileBefore: () => {},
    invalidate: (reason) => invalidations.push(reason),
    markUntracked: (reason) => untracked.push(reason)
  };

  const result = await harness.executor.execute(
    createCall(JSON.stringify({ background: true, command: 'node -e "console.log(1)"; sleep 0.1' })),
    { changeRecorder }
  );

  assert.equal(result.ok, true);
  assert.equal(invalidations.length, 0);
  assert.equal(untracked.length, 1);
  await waitForTerminal(harness.manager, result.details.background.taskId);
});

test('background requests without capability or a spawned process do not mark untracked writes', async () => {
  const untracked = [];
  const changeRecorder = {
    captureFileAfter() {},
    captureFileBefore() {},
    invalidate() { assert.fail('a failed start must not invalidate history'); },
    markUntracked(reason) { untracked.push(reason); }
  };
  const harness = createHarness();
  const withoutManager = createBashToolHandler({cwd: harness.workDir});
  const invalidShell = createBashToolHandler({background: harness.manager, cwd: harness.workDir, sessionId: 'session-a', shell: path.join(harness.workDir, 'missing-shell')});
  const args = {background: true, command: 'node -e "console.log(1)"'};
  const call = createCall(JSON.stringify(args));

  assert.equal((await withoutManager.execute(args, call, {changeRecorder})).ok, false);
  assert.equal((await invalidShell.execute(args, call, {changeRecorder})).ok, false);
  assert.deepEqual(untracked, []);
});

test('background support does not change the exposed tool name set', () => {
  const withoutManager = createDefaultToolRegistry(config, process.cwd());
  const withManager = createDefaultToolRegistry(config, process.cwd(), undefined, {
    backgroundTaskManager: createBackgroundTaskManager({ rootDir: path.join(createWorkDir(), 'state') }),
    sessionId: 'session-a'
  });

  assert.deepEqual(
    withManager.listDefinitions().map((definition) => definition.name),
    withoutManager.listDefinitions().map((definition) => definition.name)
  );
  assert.equal(withoutManager.listDefinitions().some((definition) => /background/u.test(definition.name)), false);
});
