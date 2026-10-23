const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {createDefaultUserConfig} = require('../../src/config/user-setup-bootstrap');
const {isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');
const {canSignalChildProcesses} = require('../helpers/process-signals');

const runner = require.resolve('../helpers/code-mode-once');
const runtimeSkip = !isCodeRuntimeAvailable() && 'QuickJS/WASM 不可用；禁止弱隔离替代';
const signalSkip = runtimeSkip || (!canSignalChildProcesses() && '当前沙箱拒绝子进程信号，显式跳过信号清理测试');
const forbidden = [
  'run_bash_command', 'apply_patch', 'edit_file', 'mcp__private__read',
  'web_fetch', 'web_search', 'ask_user_questions', 'run_subagent', 'run_code'
];

function withHome(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-code-once-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  const configPath = path.join(home, '.echo', 'config.json');
  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'fixture.txt'), 'PRIVATE_FILE_BODY\nneedle\n');
  const config = {
    ...createDefaultUserConfig(),
    tools: {codeMode: {enabled: true}},
    mcp: {enabled: false}
  };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ECHO_TUI_DEBUG: '',
    NODE_OPTIONS: ''
  };
  try {
    return callback({root, home, cwd, env, config, configPath});
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function once(fixture, scenario, args = []) {
  return spawnSync(process.execPath, [runner, '--once', ...args, 'inspect'], {
    cwd: fixture.cwd,
    env: {...fixture.env, ECHO_TEST_CODE_ONCE: scenario},
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function assertCleanRun(child) {
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.doesNotMatch(child.stdout, /\u001b|PRIVATE_FILE_BODY/);
}

function assertNoSession(fixture) {
  const sessions = fs.readdirSync(path.join(fixture.home, '.echo'), {recursive: true});
  assert.ok(!sessions.some((name) => /(?:^|\/)sessions(?:\/|$)|\.jsonl$/.test(name)), sessions.join('\n'));
}

test('real non-TTY --once runs Code Mode repeatedly with deny/full-access and no session or stdin interaction', {skip: runtimeSkip}, () => {
  withHome((fixture) => {
    const before = fs.readFileSync(fixture.configPath, 'utf8');
    for (const args of [[], ['--full-access'], []]) {
      const child = once(fixture, 'success', args);
      assertCleanRun(child);
      const {outer} = JSON.parse(child.stdout);
      assert.equal(outer.status, 'succeeded');
      assert.deepEqual(outer.result, {denied: forbidden, lines: 2});
      assert.equal(outer.summary.completed, 1);
      assert.equal(outer.summary.attempted, 1);
      assertNoSession(fixture);
    }
    assert.equal(fs.readFileSync(fixture.configPath, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(fixture.cwd), ['fixture.txt']);
  });
});

test('real --once defaults to denying writes while --full-access does not expand the script whitelist', {skip: runtimeSkip}, () => {
  withHome((fixture) => {
    const denied = once(fixture, 'approval');
    assertCleanRun(denied);
    const deniedResult = JSON.parse(denied.stdout);
    assert.equal(deniedResult.writeAllowed, false);
    assert.equal(fs.existsSync(path.join(fixture.cwd, 'approved.txt')), false);
    const approved = once(fixture, 'approval', ['--full-access']);
    assertCleanRun(approved);
    const approvedResult = JSON.parse(approved.stdout);
    assert.equal(approvedResult.writeAllowed, true);
    assert.equal(fs.readFileSync(path.join(fixture.cwd, 'approved.txt'), 'utf8'), 'approved\n');
    assert.deepEqual(approvedResult.outer.result.denied, forbidden);
    assertNoSession(fixture);
  });
});

test('real --once script failure follows ordinary outer-result continuation and exits cleanly', {skip: runtimeSkip}, () => {
  withHome((fixture) => {
    const child = once(fixture, 'failure');
    assertCleanRun(child);
    const {outer} = JSON.parse(child.stdout);
    assert.equal(outer.status, 'failed');
    assert.equal(outer.result, null);
    assert.equal(outer.error.phase, 'runtime');
    assert.equal(outer.summary.attempted, 0);
    assertNoSession(fixture);
  });
});

test('real --once fake echo works with Code Mode disabled and no tool execution', () => {
  withHome((fixture) => {
    fixture.config.tools.codeMode.enabled = false;
    fs.writeFileSync(fixture.configPath, JSON.stringify(fixture.config));
    const child = once(fixture, 'echo');
    assertCleanRun(child);
    assert.equal(child.stdout, 'inspect\n');
    assertNoSession(fixture);
  });
});

test('real --once reports malformed config and provider failures with exit 1 and no partial stdout', () => {
  withHome((fixture) => {
    const failed = once(fixture, 'provider-error');
    assert.equal(failed.error, undefined);
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.match(failed.stderr, /Failed to run echo-tui once/);
    assert.doesNotMatch(failed.stderr, /sk-local-secret|\u001b/);
    fs.writeFileSync(fixture.configPath, '{invalid json');
    const invalid = once(fixture, 'success');
    assert.equal(invalid.error, undefined);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /Failed to run echo-tui once/);
    assertNoSession(fixture);
  });
});

test('real non-TTY --once SIGTERM drains an active internal tool without stdin or a session', {skip: signalSkip}, async () => {
  // fixture 本身两秒结束；即使信号权限在检测后改变，也不会启动无限寿命进程。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-code-signal-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  fs.mkdirSync(path.join(home, '.echo'), {recursive: true});
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'fixture.txt'), 'text');
  fs.writeFileSync(path.join(home, '.echo', 'config.json'), JSON.stringify({
    ...createDefaultUserConfig(), tools: {codeMode: {enabled: true}}, mcp: {enabled: false}
  }));
  try {
    const child = spawn(process.execPath, [runner, '--once', 'inspect'], {
      cwd,
      env: {...process.env, HOME: home, USERPROFILE: home, ECHO_TUI_DEBUG: '', NODE_OPTIONS: '', ECHO_TEST_CODE_ONCE: 'cancel'},
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let sent = false;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!sent && stderr.includes('INNER_TOOL_STARTED')) {
        sent = true;
        child.kill('SIGTERM');
      }
    });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({code, signal}));
    });
    assert.equal(sent, true);
    assert.deepEqual(exit, {code: 1, signal: null});
    assert.equal(stdout, '');
    assert.match(stderr, /Failed to run echo-tui once/);
    assert.doesNotMatch(stderr, /\u001b/);
    assertNoSession({home});
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
