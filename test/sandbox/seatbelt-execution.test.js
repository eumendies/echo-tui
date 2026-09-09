const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const {createMacosSeatbeltSandboxProvider} = require('../../src/sandbox/macos-seatbelt');
const {resolveBashSandboxContext} = require('../../src/sandbox/provider');
const {runBashCommand} = require('../../src/tools/bash-command-runner');
const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');

// darwin 且 sandbox-exec 存在只是前提;嵌套在另一个沙箱内时内核会拒绝 sandbox_apply
// (例如 echo-tui agent 的沙箱化 shell),用 trial 执行探测真实可用性,不可用就地带原因 skip。
function canRunSandboxExec() {
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) {
    return false;
  }

  const trial = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/bin/true'], {stdio: 'ignore', timeout: 5000});
  return trial.status === 0;
}

// 部分用例依赖终止子进程(abort/timeout);沙箱化 shell 会拒绝 kill,需要一并探测。
function canSignalChildProcesses() {
  const probe = spawnSync('/bin/bash', ['-c', 'sleep 2 & kill "$!"'], {stdio: 'ignore', timeout: 5000});
  return probe.status === 0;
}

const SANDBOX_SKIP = canRunSandboxExec() ? false : 'requires macOS sandbox-exec (missing or nested inside another sandbox)';
const SIGNAL_SKIP = canSignalChildProcesses() ? false : 'requires the ability to signal subprocesses (denied in this environment)';
const SKIP_OPTIONS = {skip: SANDBOX_SKIP};
const ABORT_OPTIONS = {skip: SANDBOX_SKIP || SIGNAL_SKIP};

function createWorkspace() {
  return fs.mkdtempSync(path.join(process.cwd(), 'echo-sandbox-test-'));
}

function removePath(targetPath) {
  fs.rmSync(targetPath, {force: true, recursive: true});
}

function createSandboxContext(mode, network, extraOptions = {}) {
  const provider = createMacosSeatbeltSandboxProvider(extraOptions);

  return {policy: {mode, network, extraWritablePaths: []}, provider};
}

test('workspace-write sandbox allows writing inside the workspace', SKIP_OPTIONS, async () => {
  const workspace = createWorkspace();
  try {
    const result = await runBashCommand({
      command: `echo ok > "${path.join(workspace, 'inside.txt')}" && cat "${path.join(workspace, 'inside.txt')}"`,
      cwd: workspace,
      sandbox: resolveBashSandboxContext({mode: 'workspace-write', network: false, extraWritablePaths: []})
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /ok/);
  } finally {
    removePath(workspace);
  }
});

test('workspace-write sandbox denies writing outside the workspace', SKIP_OPTIONS, async () => {
  const workspace = createWorkspace();
  // /var/tmp 在沙箱可写集(工作区/TMPDIR//private/tmp)之外,且避免向真实 $HOME 写测试文件。
  const deniedPath = `/var/tmp/echo-tui-sandbox-denied-${process.pid}.txt`;
  try {
    const result = await runBashCommand({
      command: `echo blocked > "${deniedPath}"`,
      cwd: workspace,
      sandbox: resolveBashSandboxContext({mode: 'workspace-write', network: false, extraWritablePaths: []})
    });

    assert.equal(result.exitCode === 0, false);
    assert.equal(fs.existsSync(deniedPath), false);
  } finally {
    removePath(workspace);
    removePath(deniedPath);
  }
});

test('read-only sandbox denies workspace writes but allows temp writes', SKIP_OPTIONS, async () => {
  const workspace = createWorkspace();
  const tempFile = path.join(os.tmpdir(), `echo-tui-sandbox-temp-${process.pid}.txt`);
  try {
    const denied = await runBashCommand({
      command: `echo blocked > "${path.join(workspace, 'inside.txt')}"`,
      cwd: workspace,
      sandbox: resolveBashSandboxContext({mode: 'read-only', network: false, extraWritablePaths: []})
    });
    const allowed = await runBashCommand({
      command: `echo ok > "${tempFile}"`,
      cwd: workspace,
      sandbox: resolveBashSandboxContext({mode: 'read-only', network: false, extraWritablePaths: []})
    });

    assert.equal(denied.exitCode === 0, false);
    assert.equal(fs.existsSync(path.join(workspace, 'inside.txt')), false);
    assert.equal(allowed.exitCode, 0);
  } finally {
    removePath(workspace);
    removePath(tempFile);
  }
});

test('sandbox with network disabled denies socket connections', SKIP_OPTIONS, async () => {
  const workspace = createWorkspace();
  try {
    const result = await runBashCommand({
      command: `node -e "const s = require('net').createConnection(80, '127.0.0.1'); s.on('error', (error) => process.exit(error.code === 'ECONNREFUSED' ? 0 : 5)); s.on('connect', () => process.exit(0));"`,
      cwd: workspace,
      sandbox: resolveBashSandboxContext({mode: 'workspace-write', network: false, extraWritablePaths: []})
    });

    assert.equal(result.exitCode === 0, false);
  } finally {
    removePath(workspace);
  }
});

test('sandboxed commands keep timeout and abort semantics', ABORT_OPTIONS, async () => {
  const workspace = createWorkspace();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 150);
  try {
    const aborted = await runBashCommand({
      abortSignal: controller.signal,
      command: 'sleep 5',
      cwd: workspace,
      sandbox: resolveBashSandboxContext({mode: 'workspace-write', network: false, extraWritablePaths: []})
    });
    const timedOut = await runBashCommand({
      command: 'sleep 5',
      cwd: workspace,
      sandbox: resolveBashSandboxContext({mode: 'workspace-write', network: false, extraWritablePaths: []}),
      timeoutMs: 200
    });

    assert.equal(aborted.error, 'Command interrupted');
    assert.equal(timedOut.timedOut, true);
  } finally {
    clearTimeout(abortTimer);
    removePath(workspace);
  }
});

test('sandbox permits builtin agent memory writes under the injected home', SKIP_OPTIONS, async () => {
  const fakeHome = createWorkspace();
  const agentMemoryDir = path.join(fakeHome, '.echo', 'agent-memory');
  try {
    const result = await runBashCommand({
      command: `mkdir -p "${agentMemoryDir}" && echo catalogs > "${agentMemoryDir}/catalogs.json"`,
      cwd: fakeHome,
      sandbox: createSandboxContext('workspace-write', false, {homedir: () => fakeHome})
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.readFileSync(path.join(agentMemoryDir, 'catalogs.json'), 'utf8').includes('catalogs'), true);
  } finally {
    removePath(fakeHome);
  }
});

test('registry forces sandbox off for headless full-access runs', SKIP_OPTIONS, async () => {
  const workspace = createWorkspace();
  // 豁免后应可写;目标选 /var/tmp,既在沙箱可写集之外,又不污染真实 $HOME。
  const deniedPath = `/var/tmp/echo-tui-sandbox-full-access-${process.pid}.txt`;
  const config = {
    agentType: 'fake',
    apiKey: '',
    model: 'sandbox-test',
    tools: {
      autoCompressImages: true,
      bash: {timeoutMs: null, maxOutputBytes: 65536},
      fileEditMode: 'apply_patch',
      sandbox: {mode: 'workspace-write', network: false, extraWritablePaths: []}
    }
  };
  try {
    const sandboxedRegistry = createDefaultToolRegistry(config, workspace);
    const sandboxed = await sandboxedRegistry.getHandler('run_bash_command').execute(
      {command: `echo blocked > "${deniedPath}"`},
      {callId: 'call-1', toolName: 'run_bash_command', argumentsText: '{}'}
    );
    const exemptRegistry = createDefaultToolRegistry(config, workspace, undefined, {executionMode: {kind: 'headless', approvalPolicy: 'full-access'}});
    const exempt = await exemptRegistry.getHandler('run_bash_command').execute(
      {command: `echo allowed > "${deniedPath}"`},
      {callId: 'call-2', toolName: 'run_bash_command', argumentsText: '{}'}
    );

    assert.equal(sandboxed.ok, false);
    assert.equal(exempt.ok, true);
    assert.equal(fs.existsSync(deniedPath), true);
  } finally {
    removePath(workspace);
    removePath(deniedPath);
  }
});
