const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const {createLinuxBubblewrapSandboxProvider} = require('../../src/sandbox/linux-bubblewrap');
const {resolveBashSandboxContext} = require('../../src/sandbox/provider');
const {runBashCommand} = require('../../src/tools/bash-command-runner');
const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');

// linux 且 bwrap 试运行成功只是前提;容器或受限环境会拒绝 user namespace,
// 用 trial 执行探测真实可用性,不可用就带原因 skip。
function canRunBubblewrap() {
  if (process.platform !== 'linux') {
    return false;
  }

  const bwrapPath = fs.existsSync('/usr/bin/bwrap') ? '/usr/bin/bwrap' : 'bwrap';
  const trial = spawnSync(bwrapPath, ['--ro-bind', '/', '/', '/bin/true'], {stdio: 'ignore', timeout: 5000});
  return trial.status === 0;
}

// 部分用例依赖终止子进程(abort/timeout);沙箱化 shell 会拒绝 kill,需要一并探测。
function canSignalChildProcesses() {
  const probe = spawnSync('/bin/bash', ['-c', 'sleep 2 & kill "$!"'], {stdio: 'ignore', timeout: 5000});
  return probe.status === 0;
}

const BWRAP_SKIP = canRunBubblewrap() ? false : 'requires Linux bubblewrap (missing or nested inside another sandbox)';
const SIGNAL_SKIP = canSignalChildProcesses() ? false : 'requires the ability to signal subprocesses (denied in this environment)';
const SKIP_OPTIONS = {skip: BWRAP_SKIP};
const ABORT_OPTIONS = {skip: BWRAP_SKIP || SIGNAL_SKIP};

// 纯函数用例统一走注入桩:不触发真实 bwrap 发现与试运行,任何平台都可执行。
const STUB_OPTIONS = {
  bwrapPath: '/usr/bin/bwrap',
  exists: () => true,
  mkdir: () => {},
  probe: () => true,
  realpath: (targetPath) => targetPath
};

function createWorkspace() {
  return fs.mkdtempSync(path.join(process.cwd(), 'echo-bwrap-test-'));
}

function removePath(targetPath) {
  fs.rmSync(targetPath, {force: true, recursive: true});
}

function createSandboxContext(mode, network, extraOptions = {}) {
  const provider = createLinuxBubblewrapSandboxProvider(extraOptions);

  return {policy: {mode, network, extraWritablePaths: []}, provider};
}

test('wrapCommand emits the readonly root before writable binds in order', () => {
  const provider = createLinuxBubblewrapSandboxProvider({
    ...STUB_OPTIONS,
    homedir: () => '/home/tester',
    tmpdir: () => '/var/tmp'
  });

  assert.deepEqual(provider.wrapCommand(
    {command: 'echo hi', shell: '/bin/bash', cwd: '/workspace'},
    {mode: 'workspace-write', network: false, extraWritablePaths: ['/data/build']}
  ), [
    '/usr/bin/bwrap',
    '--die-with-parent',
    '--unshare-net',
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--tmpfs', '/dev/shm',
    '--bind-try', '/var/tmp', '/var/tmp',
    '--bind', '/workspace', '/workspace',
    '--bind-try', '/home/tester/.echo/agent-memory', '/home/tester/.echo/agent-memory',
    '--bind-try', '/data/build', '/data/build',
    '/bin/bash', '-lc', 'echo hi'
  ]);
});

test('read-only policy drops workspace binds and forces network off', () => {
  const provider = createLinuxBubblewrapSandboxProvider({
    ...STUB_OPTIONS,
    homedir: () => '/home/tester',
    tmpdir: () => '/var/tmp'
  });

  assert.deepEqual(provider.wrapCommand(
    {command: 'ls', shell: '/bin/bash', cwd: '/workspace'},
    {mode: 'read-only', network: true, extraWritablePaths: ['/data/build']}
  ), [
    '/usr/bin/bwrap',
    '--die-with-parent',
    '--unshare-net',
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--tmpfs', '/dev/shm',
    '--bind-try', '/var/tmp', '/var/tmp',
    '/bin/bash', '-lc', 'ls'
  ]);
});

test('allowed network policy skips unshare-net and tmp tmpfs covers nested tmpdir', () => {
  const provider = createLinuxBubblewrapSandboxProvider({
    ...STUB_OPTIONS,
    homedir: () => '/home/tester',
    tmpdir: () => '/tmp/build-cache'
  });

  assert.deepEqual(provider.wrapCommand(
    {command: 'curl example.com', shell: '/bin/bash', cwd: '/workspace'},
    {mode: 'workspace-write', network: true, extraWritablePaths: []}
  ), [
    '/usr/bin/bwrap',
    '--die-with-parent',
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--tmpfs', '/dev/shm',
    '--bind', '/workspace', '/workspace',
    '--bind-try', '/home/tester/.echo/agent-memory', '/home/tester/.echo/agent-memory',
    '/bin/bash', '-lc', 'curl example.com'
  ]);
});

test('wrapCommand returns null for off policy and unavailable environments', () => {
  const provider = createLinuxBubblewrapSandboxProvider(STUB_OPTIONS);

  assert.equal(provider.wrapCommand(
    {command: 'ls', shell: '/bin/bash', cwd: '/workspace'},
    {mode: 'off', network: true, extraWritablePaths: []}
  ), null);

  const trialFailed = createLinuxBubblewrapSandboxProvider({...STUB_OPTIONS, probe: () => false});

  assert.equal(trialFailed.wrapCommand(
    {command: 'ls', shell: '/bin/bash', cwd: '/workspace'},
    {mode: 'workspace-write', network: true, extraWritablePaths: []}
  ), null);
});

test('binary discovery prefers /usr/bin/bwrap then scans PATH in order', () => {
  const pathProvider = createLinuxBubblewrapSandboxProvider({
    ...STUB_OPTIONS,
    bwrapPath: undefined,
    envPath: '/opt/tools/bin:/usr/local/bin',
    exists: (targetPath) => targetPath === '/usr/local/bin/bwrap'
  });

  assert.equal(pathProvider.isAvailable(), true);
  assert.equal(pathProvider.wrapCommand(
    {command: 'ls', shell: '/bin/bash', cwd: '/workspace'},
    {mode: 'workspace-write', network: true, extraWritablePaths: []}
  )?.[0], '/usr/local/bin/bwrap');

  const missingProvider = createLinuxBubblewrapSandboxProvider({
    ...STUB_OPTIONS,
    bwrapPath: undefined,
    envPath: '/opt/tools/bin',
    exists: () => false
  });

  assert.equal(missingProvider.isAvailable(), false);
});

test('describeUnavailable distinguishes missing binary and failed trial', () => {
  const missing = createLinuxBubblewrapSandboxProvider({bwrapPath: '/missing/bwrap', exists: () => false});

  assert.equal(missing.isAvailable(), false);
  assert.match(missing.describeUnavailable(), /未找到 bubblewrap/);

  const trialFailed = createLinuxBubblewrapSandboxProvider({...STUB_OPTIONS, probe: () => false});

  assert.equal(trialFailed.isAvailable(), false);
  assert.match(trialFailed.describeUnavailable(), /试运行失败/);
});

test('probe result is cached within the provider instance', () => {
  let probeCalls = 0;
  const provider = createLinuxBubblewrapSandboxProvider({
    ...STUB_OPTIONS,
    probe: () => {
      probeCalls += 1;
      return true;
    }
  });

  assert.equal(provider.isAvailable(), true);
  assert.equal(provider.isAvailable(), true);
  assert.notEqual(provider.wrapCommand(
    {command: 'ls', shell: '/bin/bash', cwd: '/workspace'},
    {mode: 'workspace-write', network: true, extraWritablePaths: []}
  ), null);
  assert.equal(probeCalls, 1);
});

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
  // /var/tmp 在沙箱可写集(工作区/TMPDIR//tmp)之外,且避免向真实 $HOME 写测试文件。
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
  // 连接宿主侧真实监听端口:--unshare-net 后沙箱内网络栈隔离,无法触达宿主 loopback。
  const server = net.createServer();

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;
  try {
    const result = await runBashCommand({
      command: `node -e "const s = require('net').createConnection(${port}, '127.0.0.1'); s.on('error', () => process.exit(5)); s.on('connect', () => process.exit(0));"`,
      cwd: workspace,
      sandbox: resolveBashSandboxContext({mode: 'workspace-write', network: false, extraWritablePaths: []})
    });

    assert.equal(result.exitCode === 0, false);
  } finally {
    server.close();
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
