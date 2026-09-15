const test = require('node:test');
const assert = require('node:assert');

const {createSandboxRuntimeNote, isReadonlyBashSandboxEffective, resolveBashSandboxContext, resolveEffectiveSandbox, resolveSandboxProvider} = require('../../src/sandbox/provider');

const AVAILABLE_PROVIDER_OPTIONS = {
  exists: () => true,
  homedir: () => '/Users/tester',
  probe: () => true,
  realpath: (targetPath) => targetPath,
  tmpdir: () => '/private/tmp'
};
const AVAILABLE_LINUX_PROVIDER_OPTIONS = {
  bwrapPath: '/usr/bin/bwrap',
  exists: () => true,
  mkdir: () => {},
  probe: () => true,
  realpath: (targetPath) => targetPath,
  tmpdir: () => '/tmp'
};
const SANDBOX_CONFIG = {mode: 'workspace-write', network: true, extraWritablePaths: []};

test('resolveSandboxProvider resolves providers per platform', () => {
  assert.equal(resolveSandboxProvider('win32'), null);
  assert.equal(resolveSandboxProvider('darwin', AVAILABLE_PROVIDER_OPTIONS)?.name, 'macos-seatbelt');
  assert.equal(resolveSandboxProvider('linux')?.name, 'linux-bubblewrap');
});

test('resolveBashSandboxContext returns null for off mode and unsupported platforms', () => {
  assert.equal(resolveBashSandboxContext({...SANDBOX_CONFIG, mode: 'off'}, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS}), null);
  assert.equal(resolveBashSandboxContext(SANDBOX_CONFIG, undefined, {platform: 'win32'}), null);
});

test('linux platform resolves a bubblewrap sandbox context and runtime note', () => {
  const context = resolveBashSandboxContext(SANDBOX_CONFIG, undefined, {platform: 'linux', providerOptions: AVAILABLE_LINUX_PROVIDER_OPTIONS});

  assert.equal(context?.provider.name, 'linux-bubblewrap');
  assert.equal(context?.policy.mode, 'workspace-write');
  assert.equal(context?.policy.network, true);

  const note = createSandboxRuntimeNote(SANDBOX_CONFIG, undefined, {platform: 'linux', providerOptions: AVAILABLE_LINUX_PROVIDER_OPTIONS});

  assert.match(note, /filesystem writes are limited to the workspace/);
  assert.match(note, /network access is allowed/);
});

test('resolveBashSandboxContext exempts headless full-access runs', () => {
  const context = resolveBashSandboxContext(SANDBOX_CONFIG, {kind: 'headless', approvalPolicy: 'full-access'}, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS});

  assert.equal(context, null);
});

test('resolveBashSandboxContext keeps sandbox for headless deny runs and forces read-only network off', () => {
  const denyContext = resolveBashSandboxContext(SANDBOX_CONFIG, {kind: 'headless', approvalPolicy: 'deny'}, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS});
  const readOnlyContext = resolveBashSandboxContext({...SANDBOX_CONFIG, mode: 'read-only'}, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS});

  assert.equal(denyContext.policy.mode, 'workspace-write');
  assert.equal(denyContext.policy.network, true);
  assert.equal(readOnlyContext.policy.mode, 'read-only');
  assert.equal(readOnlyContext.policy.network, false);
});

test('run-level mode override tightens any enabled sandbox to read-only', () => {
  const context = resolveBashSandboxContext(SANDBOX_CONFIG, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS, modeOverride: 'read-only'});

  assert.equal(context?.policy.mode, 'read-only');
  assert.equal(context?.policy.network, false);

  const note = createSandboxRuntimeNote(SANDBOX_CONFIG, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS, modeOverride: 'read-only'});
  assert.match(note, /the workspace is read-only/);
  assert.match(note, /network access is denied/);
});

test('run-level mode override keeps explicit off and full-access exemptions', () => {
  const options = {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS, modeOverride: 'read-only'};

  assert.equal(resolveBashSandboxContext({...SANDBOX_CONFIG, mode: 'off'}, undefined, options), null);
  assert.equal(resolveBashSandboxContext(SANDBOX_CONFIG, {kind: 'headless', approvalPolicy: 'full-access'}, options), null);
});

test('isReadonlyBashSandboxEffective requires an available provider tightened to read-only', () => {
  const options = {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS};
  const readOnly = {...SANDBOX_CONFIG, mode: 'read-only'};

  // workspace-write 档即使可用也不构成只读边界,不得据此放行 bash。
  assert.equal(isReadonlyBashSandboxEffective(SANDBOX_CONFIG, undefined, options), false);
  assert.equal(isReadonlyBashSandboxEffective(readOnly, undefined, options), true);
  // 运行级收紧把 workspace-write 收紧为 read-only 后成立。
  assert.equal(isReadonlyBashSandboxEffective(SANDBOX_CONFIG, undefined, {...options, modeOverride: 'read-only'}), true);
  // 试运行失败、显式 off、headless full-access 都保持关闭。
  assert.equal(isReadonlyBashSandboxEffective(readOnly, undefined, {platform: 'darwin', providerOptions: {...AVAILABLE_PROVIDER_OPTIONS, probe: () => false}}), false);
  assert.equal(isReadonlyBashSandboxEffective({...SANDBOX_CONFIG, mode: 'off'}, undefined, options), false);
  assert.equal(isReadonlyBashSandboxEffective(readOnly, {kind: 'headless', approvalPolicy: 'full-access'}, options), false);
});

test('resolveEffectiveSandbox keeps the normalized policy visible without a platform provider', () => {
  const readOnly = resolveEffectiveSandbox({...SANDBOX_CONFIG, mode: 'read-only', network: true}, undefined, {platform: 'win32'});

  assert.equal(readOnly?.provider, null);
  assert.equal(readOnly?.available, false);
  assert.equal(readOnly?.policy.mode, 'read-only');
  // provider 缺失时策略仍然归一化,/status 展示层拿到的是生效状态而非配置原值。
  assert.equal(readOnly?.policy.network, false);
});

test('createSandboxRuntimeNote describes only effective sandbox boundaries', () => {
  const allowed = createSandboxRuntimeNote(SANDBOX_CONFIG, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS});
  const denied = createSandboxRuntimeNote({...SANDBOX_CONFIG, network: false}, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS});
  const readOnly = createSandboxRuntimeNote({...SANDBOX_CONFIG, mode: 'read-only'}, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS});

  assert.match(allowed, /network access is allowed/);
  assert.match(denied, /network access is denied/);
  assert.match(readOnly, /workspace is read-only/);
  assert.equal(createSandboxRuntimeNote({...SANDBOX_CONFIG, mode: 'off'}, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS}), null);
  assert.equal(createSandboxRuntimeNote(SANDBOX_CONFIG, {kind: 'headless', approvalPolicy: 'full-access'}, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS}), null);
});

test('createSandboxRuntimeNote stays silent when the sandbox tool is unavailable', () => {
  const note = createSandboxRuntimeNote(SANDBOX_CONFIG, undefined, {platform: 'darwin', providerOptions: {exists: () => false}});

  assert.equal(note, null);
});

test('createSandboxRuntimeNote stays silent when the bubblewrap trial fails', () => {
  const note = createSandboxRuntimeNote(SANDBOX_CONFIG, undefined, {platform: 'linux', providerOptions: {bwrapPath: '/usr/bin/bwrap', exists: () => true, probe: () => false}});

  assert.equal(note, null);
});

test('createSandboxRuntimeNote stays silent when the seatbelt trial fails', () => {
  const note = createSandboxRuntimeNote(SANDBOX_CONFIG, undefined, {platform: 'darwin', providerOptions: {...AVAILABLE_PROVIDER_OPTIONS, probe: () => false}});

  assert.equal(note, null);
});

test('createSandboxRuntimeNote lists configured extra writable paths only when present', () => {
  const withoutExtras = createSandboxRuntimeNote(SANDBOX_CONFIG, undefined, {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS});
  const withExtras = createSandboxRuntimeNote(
    {...SANDBOX_CONFIG, extraWritablePaths: ['/Users/tester/code', '/Users/tester/.cache/build']},
    undefined,
    {platform: 'darwin', providerOptions: AVAILABLE_PROVIDER_OPTIONS}
  );

  // 类别措辞没有实例对模型没有可操作性;必须列出具体路径,空列表则整段省略。
  assert.doesNotMatch(withoutExtras, /extra writable paths/);
  assert.match(withExtras, /and the configured extra writable paths: \/Users\/tester\/code, \/Users\/tester\/\.cache\/build/);
});
