const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {checkForUpdate, compareVersions, isValidVersion} = require('../../src/update/update-check');

const INSTALLED_ROOT = path.join('/tmp', 'node_modules', '@eumendies', 'echo-tui');
const CURRENT_VERSION = '1.2.5';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-update-check-'));
}

function createFetch(version, calls = []) {
  return async (url, init) => {
    calls.push({url, init});
    return {ok: true, json: async () => ({version})};
  };
}

function createStateFile(dir, state) {
  const statePath = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state));
  return statePath;
}

test('checkForUpdate skips source runs and npx caches without touching the network', async () => {
  const dir = createTempDir();
  const calls = [];

  try {
    const statePath = path.join(dir, 'update-state.json');
    const base = {configEnabled: true, currentVersion: CURRENT_VERSION, env: {}, fetchFn: createFetch('9.9.9', calls), statePath};

    assert.deepEqual(
      await checkForUpdate({...base, packageRoot: '/tmp/echo-tui'}),
      {status: 'none', reason: 'not-installed'}
    );
    assert.deepEqual(
      await checkForUpdate({...base, packageRoot: '/home/u/.npm/_npx/abc/node_modules/@eumendies/echo-tui'}),
      {status: 'none', reason: 'not-installed'}
    );
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate honors the config toggle before eligibility', async () => {
  const dir = createTempDir();
  const calls = [];

  try {
    const result = await checkForUpdate({
      configEnabled: false,
      currentVersion: CURRENT_VERSION,
      env: {},
      fetchFn: createFetch('9.9.9', calls),
      packageRoot: INSTALLED_ROOT,
      statePath: path.join(dir, 'update-state.json')
    });

    assert.deepEqual(result, {status: 'none', reason: 'config-disabled'});
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate stays silent within the post-update restart window', async () => {
  const dir = createTempDir();
  const calls = [];
  const restartGuardAt = 1_500_000;

  try {
    const statePath = createStateFile(dir, {lastCheckedAt: 1_000_000, latestVersion: '1.4.5', restartGuardAt});
    const base = {
      configEnabled: true,
      currentVersion: CURRENT_VERSION,
      env: {},
      fetchFn: createFetch('9.9.9', calls),
      packageRoot: INSTALLED_ROOT,
      statePath,
      ttlMs: 60 * 60 * 1000
    };

    assert.deepEqual(
      await checkForUpdate({...base, now: () => restartGuardAt + 1000}),
      {status: 'none', reason: 'post-update-restart'}
    );
    assert.equal(calls.length, 0);

    // 窗口外恢复常规检查语义（缓存仍新鲜，直接使用缓存结论）。
    assert.deepEqual(
      await checkForUpdate({...base, now: () => restartGuardAt + 10 * 60 * 1000}),
      {status: 'available', currentVersion: CURRENT_VERSION, latestVersion: '1.4.5'}
    );
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate reports available versions and caches the successful check', async () => {
  const dir = createTempDir();
  const calls = [];

  try {
    const statePath = path.join(dir, 'update-state.json');
    const result = await checkForUpdate({
      configEnabled: true,
      currentVersion: CURRENT_VERSION,
      env: {},
      fetchFn: createFetch('1.4.5', calls),
      now: () => 1000,
      packageRoot: INSTALLED_ROOT,
      statePath
    });

    assert.deepEqual(result, {status: 'available', currentVersion: CURRENT_VERSION, latestVersion: '1.4.5'});
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /registry\.npmjs\.org\/@eumendies%2Fecho-tui\/latest$/);
    assert.equal(calls[0].init.headers['user-agent'], `echo-tui/${CURRENT_VERSION}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), {lastCheckedAt: 1000, latestVersion: '1.4.5'});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate reuses the cached version within the TTL and refetches after it expires', async () => {
  const dir = createTempDir();
  const calls = [];

  try {
    const statePath = createStateFile(dir, {lastCheckedAt: 500, latestVersion: '1.4.5'});
    const base = {
      configEnabled: true,
      currentVersion: CURRENT_VERSION,
      env: {},
      fetchFn: createFetch('9.9.9', calls),
      packageRoot: INSTALLED_ROOT,
      statePath,
      ttlMs: 1000
    };

    assert.deepEqual(
      await checkForUpdate({...base, now: () => 1000}),
      {status: 'available', currentVersion: CURRENT_VERSION, latestVersion: '1.4.5'}
    );
    assert.equal(calls.length, 0);

    assert.deepEqual(
      await checkForUpdate({...base, now: () => 5000}),
      {status: 'available', currentVersion: CURRENT_VERSION, latestVersion: '9.9.9'}
    );
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate suppresses ignored versions and restores prompting for higher ones', async () => {
  const dir = createTempDir();
  const calls = [];

  try {
    const ignoredSame = createStateFile(dir, {lastCheckedAt: 500, latestVersion: '1.4.5', ignoredVersion: '1.4.5'});
    const ignoredLower = createStateFile(dir, {lastCheckedAt: 500, latestVersion: '1.4.5', ignoredVersion: '1.3.0'});
    const base = {
      configEnabled: true,
      currentVersion: CURRENT_VERSION,
      env: {},
      fetchFn: createFetch('9.9.9', calls),
      now: () => 1000,
      packageRoot: INSTALLED_ROOT,
      ttlMs: 10_000
    };

    assert.deepEqual(await checkForUpdate({...base, statePath: ignoredSame}), {status: 'none', reason: 'ignored'});
    assert.deepEqual(
      await checkForUpdate({...base, statePath: ignoredLower}),
      {status: 'available', currentVersion: CURRENT_VERSION, latestVersion: '1.4.5'}
    );
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate reports up-to-date for equal or lower latest versions', async () => {
  const dir = createTempDir();

  try {
    const base = {configEnabled: true, currentVersion: CURRENT_VERSION, env: {}, packageRoot: INSTALLED_ROOT};

    assert.deepEqual(
      await checkForUpdate({...base, fetchFn: createFetch('1.2.5'), statePath: path.join(dir, 'same.json')}),
      {status: 'none', reason: 'up-to-date'}
    );
    assert.deepEqual(
      await checkForUpdate({...base, fetchFn: createFetch('1.2.4'), statePath: path.join(dir, 'lower.json')}),
      {status: 'none', reason: 'up-to-date'}
    );
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate degrades silently on registry failures and never refreshes the cache', async () => {
  const dir = createTempDir();

  try {
    const statePath = path.join(dir, 'update-state.json');
    const base = {
      configEnabled: true,
      currentVersion: CURRENT_VERSION,
      env: {},
      now: () => 1000,
      packageRoot: INSTALLED_ROOT,
      statePath
    };

    const failingFetch = async () => {
      throw new Error('offline');
    };
    assert.deepEqual(await checkForUpdate({...base, fetchFn: failingFetch}), {status: 'none', reason: 'registry-error'});
    assert.equal(fs.existsSync(statePath), false);

    const invalidVersionFetch = async () => ({ok: true, json: async () => ({version: 'not-a-version'})});
    assert.deepEqual(await checkForUpdate({...base, fetchFn: invalidVersionFetch}), {status: 'none', reason: 'registry-error'});

    const notOkFetch = async () => ({ok: false, json: async () => ({})});
    assert.deepEqual(await checkForUpdate({...base, fetchFn: notOkFetch}), {status: 'none', reason: 'registry-error'});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate follows npm_config_registry and falls back to the official registry', async () => {
  const dir = createTempDir();
  const calls = [];

  try {
    const base = {
      configEnabled: true,
      currentVersion: CURRENT_VERSION,
      fetchFn: createFetch('1.4.5', calls),
      packageRoot: INSTALLED_ROOT
    };

    await checkForUpdate({...base, env: {npm_config_registry: 'https://mirror.example.com/npm/'}, statePath: path.join(dir, 'mirror.json')});
    assert.equal(calls[0].url, 'https://mirror.example.com/npm/@eumendies%2Fecho-tui/latest');

    await checkForUpdate({...base, env: {npm_config_registry: 'not a url'}, statePath: path.join(dir, 'fallback.json')});
    assert.equal(calls[1].url, 'https://registry.npmjs.org/@eumendies%2Fecho-tui/latest');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('checkForUpdate still reports updates when the state file cannot be written', async () => {
  const dir = createTempDir();

  try {
    const blockedParent = path.join(dir, 'blocked');
    fs.writeFileSync(blockedParent, 'file');

    const result = await checkForUpdate({
      configEnabled: true,
      currentVersion: CURRENT_VERSION,
      env: {},
      fetchFn: createFetch('1.4.5'),
      packageRoot: INSTALLED_ROOT,
      statePath: path.join(blockedParent, 'update-state.json')
    });

    assert.deepEqual(result, {status: 'available', currentVersion: CURRENT_VERSION, latestVersion: '1.4.5'});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('compareVersions orders core segments numerically', () => {
  assert.equal(compareVersions('1.2.5', '1.2.5'), 0);
  assert.equal(compareVersions('v1.2.5', '1.2.5'), 0);
  assert.ok(compareVersions('1.2.5', '1.2.4') > 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('2.0.0', '10.0.0') < 0);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1', '1.0.0'), 0);
});

test('compareVersions treats versions with the same numeric core as equal', () => {
  assert.equal(compareVersions('1.2.0-rc.1', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0-beta.10', '1.2.0-beta.2'), 0);
  assert.ok(compareVersions('1.3.0-rc.1', '1.2.0') > 0);
});

test('compareVersions tolerates suffixes and malformed segments', () => {
  assert.equal(compareVersions('1.2.5+build.7', '1.2.5'), 0);
  assert.equal(compareVersions('1.x.5', '1.0.5'), 0);
  assert.equal(compareVersions('', '0.0.0'), 0);
});

test('isValidVersion accepts published version shapes only', () => {
  assert.equal(isValidVersion('1.2.5'), true);
  assert.equal(isValidVersion('v1.2.5'), true);
  assert.equal(isValidVersion('1.2.5-beta.1'), true);
  assert.equal(isValidVersion('1.2.5+build.1'), true);
  assert.equal(isValidVersion('1.2'), false);
  assert.equal(isValidVersion('abc'), false);
  assert.equal(isValidVersion(''), false);
  assert.equal(isValidVersion(7), false);
  assert.equal(isValidVersion(null), false);
});
