const test = require('node:test');
const assert = require('node:assert');

const {MACOS_SANDBOX_EXEC_PATH, buildSeatbeltProfile, createMacosSeatbeltSandboxProvider} = require('../../src/sandbox/macos-seatbelt');

test('buildSeatbeltProfile denies network when disabled', () => {
  const profile = buildSeatbeltProfile({mode: 'workspace-write', network: false, writablePaths: ['/private/tmp', '/Users/me/proj']});

  assert.match(profile, /\(deny network\*\)/);
  assert.doesNotMatch(profile, /\(allow network\*\)/);
  assert.match(profile, /\(allow file-read\*\)/);
  assert.match(profile, /\(allow file-write\*\n  \(subpath "\/private\/tmp"\)\n  \(subpath "\/Users\/me\/proj"\)\n  \(literal "\/dev\/null"\)/);
  assert.match(profile, /\(version 1\)/);
  assert.match(profile, /\(deny default\)/);
});

test('buildSeatbeltProfile allows network with system socket when enabled', () => {
  const profile = buildSeatbeltProfile({mode: 'workspace-write', network: true, writablePaths: ['/private/tmp']});

  assert.match(profile, /\(allow network\*\)/);
  assert.match(profile, /\(allow system-socket\)/);
  assert.doesNotMatch(profile, /\(deny network\*\)/);
});

test('buildSeatbeltProfile escapes seatbelt string metacharacters', () => {
  const profile = buildSeatbeltProfile({mode: 'workspace-write', network: false, writablePaths: ['/Users/me/my "quoted" \\dir']});

  assert.match(profile, /\(subpath "\/Users\/me\/my \\"quoted\\" \\\\dir"\)/);
});

test('seatbelt provider wraps shell command with sandbox-exec profile', () => {
  const provider = createMacosSeatbeltSandboxProvider({
    exists: () => true,
    homedir: () => '/Users/tester',
    realpath: (targetPath) => targetPath === '/tmp' ? '/private/tmp' : targetPath,
    tmpdir: () => '/tmp'
  });
  const argv = provider.wrapCommand(
    {command: 'echo hi', shell: '/bin/bash', cwd: '/Users/tester/proj'},
    {mode: 'workspace-write', network: false, extraWritablePaths: []}
  );

  assert.equal(argv[0], MACOS_SANDBOX_EXEC_PATH);
  assert.equal(argv[1], '-p');
  assert.equal(argv[3], '/bin/bash');
  assert.equal(argv[4], '-lc');
  assert.equal(argv[5], 'echo hi');
  assert.match(argv[2], /\(subpath "\/Users\/tester\/proj"\)/);
  // /tmp 被 symlink 归一化为 /private/tmp,agent-memory 目录挂在注入的 homedir 下。
  assert.match(argv[2], /\(subpath "\/private\/tmp"\)/);
  assert.match(argv[2], /\(subpath "\/Users\/tester\/.echo\/agent-memory"\)/);
});

test('seatbelt provider omits workspace roots in read-only mode', () => {
  const provider = createMacosSeatbeltSandboxProvider({
    exists: () => true,
    homedir: () => '/Users/tester',
    realpath: (targetPath) => targetPath,
    tmpdir: () => '/private/var/folders/T'
  });
  const argv = provider.wrapCommand(
    {command: 'ls', shell: '/bin/bash', cwd: '/Users/tester/proj'},
    {mode: 'read-only', network: true, extraWritablePaths: []}
  );

  assert.doesNotMatch(argv[2], /\(subpath "\/Users\/tester\/proj"\)/);
  assert.doesNotMatch(argv[2], /agent-memory/);
  assert.match(argv[2], /\(subpath "\/private\/var\/folders\/T"\)/);
  assert.match(argv[2], /\(deny network\*\)/);
});

test('seatbelt provider returns null when unavailable or mode is off', () => {
  const unavailableProvider = createMacosSeatbeltSandboxProvider({exists: () => false});
  const availableProvider = createMacosSeatbeltSandboxProvider({exists: () => true});

  assert.equal(unavailableProvider.isAvailable(), false);
  assert.equal(unavailableProvider.wrapCommand({command: 'ls', shell: '/bin/bash', cwd: '/tmp'}, {mode: 'workspace-write', network: false, extraWritablePaths: []}), null);
  assert.equal(availableProvider.wrapCommand({command: 'ls', shell: '/bin/bash', cwd: '/tmp'}, {mode: 'off', network: false, extraWritablePaths: []}), null);
});
