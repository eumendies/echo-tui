const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');

const {runUpdateAndRestart} = require('../../src/update/update-runner');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-update-runner-'));
const statePath = path.join(stateDir, 'update-state.json');

test.after(() => {
  fs.rmSync(stateDir, {recursive: true, force: true});
});

function createFakeSpawn(plan) {
  const calls = [];
  const spawnFn = (command, args, options) => {
    const step = plan[calls.length] || {};
    calls.push({args, command, options});
    const child = new EventEmitter();

    setImmediate(() => {
      if (step.error) {
        child.emit('error', step.error);
      } else {
        child.emit('close', step.code ?? 0);
      }
    });

    return child;
  };

  return {calls, spawnFn};
}

function createHarness(plan) {
  const {calls, spawnFn} = createFakeSpawn(plan);
  const output = [];

  return {
    calls,
    options: {
      latestVersion: '1.4.5',
      argv: ['/usr/bin/node', '/opt/echo/dist/bin/echo-tui.js'],
      cwd: '/tmp/project',
      env: {HOME: '/tmp/home'},
      execPath: '/usr/bin/node',
      platform: 'darwin',
      spawnFn,
      statePath,
      write: (text) => output.push(text)
    },
    output
  };
}

test('runUpdateAndRestart installs in the foreground then restarts the new version', async () => {
  const harness = createHarness([{code: 0}, {code: 0}]);
  const exitCode = await runUpdateAndRestart(harness.options);

  assert.equal(exitCode, 0);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[0].command, 'npm');
  assert.deepEqual(harness.calls[0].args, ['install', '-g', '@eumendies/echo-tui@latest']);
  assert.equal(harness.calls[0].options.stdio, 'inherit');
  assert.equal(harness.calls[0].options.shell, false);
  assert.equal(harness.calls[0].options.cwd, '/tmp/project');
  assert.equal(harness.calls[1].command, '/usr/bin/node');
  assert.deepEqual(harness.calls[1].args, ['/opt/echo/dist/bin/echo-tui.js']);
  assert.equal(Object.keys(harness.calls[1].options.env).filter((key) => key.startsWith('ECHO_TUI_')).length, 0);
  assert.equal(harness.calls[1].options.env.HOME, '/tmp/home');
  assert.equal(harness.calls[1].options.shell, false);
  assert.equal(typeof JSON.parse(fs.readFileSync(statePath, 'utf8')).restartGuardAt, 'number');

  const text = harness.output.join('');
  assert.match(text, /正在更新 @eumendies\/echo-tui 到 v1\.4\.5/);
  assert.match(text, /更新完成，正在重新启动 echo-tui/);
});

test('runUpdateAndRestart falls back to the current version when npm exits non-zero', async () => {
  const harness = createHarness([{code: 1}, {code: 3}]);
  const exitCode = await runUpdateAndRestart(harness.options);

  assert.equal(exitCode, 3);
  assert.equal(harness.calls.length, 2);

  const text = harness.output.join('');
  assert.match(text, /更新失败（退出码 1）/);
  assert.match(text, /npm install -g @eumendies\/echo-tui@latest/);
  assert.match(text, /正在以当前版本重新启动/);
});

test('runUpdateAndRestart treats npm spawn errors as install failures', async () => {
  const harness = createHarness([{error: new Error('spawn npm ENOENT')}, {code: 0}]);
  const exitCode = await runUpdateAndRestart(harness.options);

  assert.equal(exitCode, 0);
  const text = harness.output.join('');
  assert.match(text, /更新失败：spawn npm ENOENT/);
  assert.match(text, /正在以当前版本重新启动/);
});

test('runUpdateAndRestart reports a manual restart when respawning fails', async () => {
  const harness = createHarness([{code: 0}, {error: new Error('spawn ENOENT')}]);
  const exitCode = await runUpdateAndRestart(harness.options);

  assert.equal(exitCode, 1);
  assert.match(harness.output.join(''), /请手动重新运行：echo-tui/);
});

test('runUpdateAndRestart uses shell npm on Windows and reports a missing entry', async () => {
  const windows = createHarness([{code: 0}, {code: 0}]);
  await runUpdateAndRestart({...windows.options, platform: 'win32'});
  assert.equal(windows.calls[0].options.shell, true);
  assert.equal(windows.calls[1].options.shell, false);

  const missingEntry = createHarness([{code: 0}]);
  const exitCode = await runUpdateAndRestart({...missingEntry.options, argv: []});
  assert.equal(exitCode, 1);
  assert.equal(missingEntry.calls.length, 1);
  assert.match(missingEntry.output.join(''), /请手动重新运行：echo-tui/);
});
