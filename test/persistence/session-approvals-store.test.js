const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {createSessionApprovalsStore} = require('../../src/persistence/session-approvals-store');
const {createTranscriptStore} = require('../../src/persistence/transcript-store');

function createHarness() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-session-approvals-'));
  const transcriptStore = createTranscriptStore({rootDir});
  const store = createSessionApprovalsStore(transcriptStore);
  return {rootDir, store, transcriptStore};
}

const VALID_APPROVALS = {
  schemaVersion: 1,
  sessionId: 'session-1',
  updatedAt: '2026-11-16T00:00:00.000Z',
  allowAll: false,
  tools: [],
  bashCommands: []
};

function writeRaw(store, cwd, value) {
  const filePath = store.getFilePath(cwd, 'session-1');
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

test('session approvals store distinguishes missing and structurally invalid sidecars', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-approvals';

  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'missing'});

  writeRaw(store, cwd, '{bad json');
  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'invalid'});

  writeRaw(store, cwd, '[]');
  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'invalid'});

  // 这些字段无法被安全容忍：任一放宽都可能把无效数据解释成放行。
  for (const broken of [
    {...VALID_APPROVALS, schemaVersion: 2},
    {...VALID_APPROVALS, sessionId: 'another-session'},
    {...VALID_APPROVALS, allowAll: 'false'},
    {...VALID_APPROVALS, allowAll: undefined},
    {...VALID_APPROVALS, tools: 'apply_patch'},
    {...VALID_APPROVALS, bashCommands: null}
  ]) {
    writeRaw(store, cwd, broken);
    assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'invalid'}, `expected invalid for ${JSON.stringify(broken)}`);
  }
});

test('session approvals store drops dirty entries instead of invalidating the whole sidecar', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-approvals-dirty';

  // 单个脏条目只丢弃自己：减少授权是安全方向，没有必要让全部授权作废。
  writeRaw(store, cwd, {
    ...VALID_APPROVALS,
    tools: ['apply_patch', '', '  ', 42, null, 'apply_patch', 'edit_file'],
    bashCommands: ['', 'npm install', 'npm install']
  });

  assert.deepEqual(store.read(cwd, 'session-1'), {
    kind: 'found',
    approvals: {
      schemaVersion: 1,
      sessionId: 'session-1',
      updatedAt: '2026-11-16T00:00:00.000Z',
      allowAll: false,
      tools: ['apply_patch', 'edit_file'],
      bashCommands: ['npm install']
    }
  });
});

test('session approvals store treats updatedAt as diagnostic metadata only', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-approvals-updated-at';

  writeRaw(store, cwd, {...VALID_APPROVALS, updatedAt: ''});
  assert.equal(store.read(cwd, 'session-1').kind, 'found');

  const {updatedAt: _omitted, ...withoutUpdatedAt} = VALID_APPROVALS;
  writeRaw(store, cwd, withoutUpdatedAt);
  assert.deepEqual(store.read(cwd, 'session-1'), {
    kind: 'found',
    approvals: {...VALID_APPROVALS, updatedAt: ''}
  });
});

test('session approvals store atomically round-trips authorized tools and commands', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-approvals';
  const written = store.write(cwd, {
    sessionId: 'session-1',
    allowAll: true,
    tools: ['apply_patch', 'mcp__docs__search', 'apply_patch'],
    bashCommands: ['npm install', 'rm -rf dist']
  }, '2026-11-16T01:00:00.000Z');
  const filePath = store.getFilePath(cwd, 'session-1');

  assert.deepEqual(written, {
    schemaVersion: 1,
    sessionId: 'session-1',
    updatedAt: '2026-11-16T01:00:00.000Z',
    allowAll: true,
    tools: ['apply_patch', 'mcp__docs__search'],
    bashCommands: ['npm install', 'rm -rf dist']
  });
  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'found', approvals: written});
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), written);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.tmp-')), []);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('session approvals store removes the sidecar instead of writing an empty authorization', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-approvals-empty';
  const filePath = store.getFilePath(cwd, 'session-1');

  store.write(cwd, {sessionId: 'session-1', allowAll: false, tools: ['apply_patch'], bashCommands: []});
  assert.equal(fs.existsSync(filePath), true);

  assert.equal(store.write(cwd, {sessionId: 'session-1', allowAll: false, tools: [], bashCommands: []}), null);
  assert.equal(fs.existsSync(filePath), false);
  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'missing'});
});

test('session approvals store normalizes input without throwing on unreachable bad values', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-approvals-input';

  // 唯一调用方传的是 Set 展开，脏值不可达；这里只验证归一化，不把入参问题伪装成磁盘故障。
  assert.equal(store.write(cwd, {sessionId: '  ', allowAll: true, tools: [], bashCommands: []}), null);
  assert.equal(fs.existsSync(store.getFilePath(cwd, '  ')), false);

  assert.deepEqual(store.write(cwd, {
    sessionId: 'session-2',
    allowAll: false,
    tools: ['', '  ', null, 7, 'apply_patch', 'apply_patch'],
    bashCommands: [undefined, 'npm install']
  }), {
    schemaVersion: 1,
    sessionId: 'session-2',
    updatedAt: store.read(cwd, 'session-2').approvals.updatedAt,
    allowAll: false,
    tools: ['apply_patch'],
    bashCommands: ['npm install']
  });

  // 全部条目被过滤后等价于空授权，仍然删除而不落盘。
  assert.equal(store.write(cwd, {sessionId: 'session-2', allowAll: false, tools: [''], bashCommands: []}), null);
  assert.equal(fs.existsSync(store.getFilePath(cwd, 'session-2')), false);
});

test('session approvals store removes without touching sibling sessions and is idempotent', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-approvals-remove';

  store.write(cwd, {sessionId: 'session-1', allowAll: true, tools: [], bashCommands: []});
  store.write(cwd, {sessionId: 'session-2', allowAll: false, tools: ['edit_file'], bashCommands: []});

  store.remove(cwd, 'session-1');
  store.remove(cwd, 'missing-session');
  store.remove(cwd, 'session-1');

  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'missing'});
  assert.equal(store.read(cwd, 'session-2').kind, 'found');
});

test('an orphan approvals sidecar is ignored by transcript session enumeration', () => {
  const {store, transcriptStore} = createHarness();
  const cwd = '/tmp/example/orphan-approvals';

  store.write(cwd, {sessionId: 'orphan', allowAll: true, tools: [], bashCommands: []});

  assert.deepEqual(transcriptStore.listSessionSummaries(cwd), []);
});
