const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {createSessionModelSettingsStore} = require('../../src/persistence/session-model-settings-store');
const {createTranscriptStore} = require('../../src/persistence/transcript-store');

function createHarness() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-session-model-settings-'));
  const transcriptStore = createTranscriptStore({rootDir});
  const store = createSessionModelSettingsStore(transcriptStore);
  return {rootDir, store, transcriptStore};
}

test('session model settings store distinguishes missing and invalid sidecars', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-settings';

  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'missing'});

  const filePath = store.getFilePath(cwd, 'session-1');
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, '{bad json', 'utf8');
  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'invalid'});

  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    sessionId: 'another-session',
    modelProfileId: 'fast',
    updatedAt: '2026-07-01T00:00:00.000Z'
  }), 'utf8');
  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'invalid'});

  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    sessionId: 'session-1',
    modelProfileId: 'fast',
    reasoningEffortOverride: 'minimal',
    updatedAt: '2026-07-01T00:00:00.000Z'
  }), 'utf8');
  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'invalid'});
});

test('session model settings store atomically round-trips current values including none', () => {
  const {store} = createHarness();
  const cwd = '/tmp/example/session-settings';
  const first = store.write(cwd, {
    sessionId: 'session-1',
    modelProfileId: 'fast'
  }, '2026-07-01T00:00:00.000Z');
  const second = store.write(cwd, {
    sessionId: 'session-1',
    modelProfileId: 'deep',
    reasoningEffortOverride: 'none'
  }, '2026-07-01T00:00:01.000Z');
  const filePath = store.getFilePath(cwd, 'session-1');

  assert.deepEqual(first, {
    schemaVersion: 1,
    sessionId: 'session-1',
    modelProfileId: 'fast',
    updatedAt: '2026-07-01T00:00:00.000Z'
  });
  assert.deepEqual(store.read(cwd, 'session-1'), {kind: 'found', settings: second});
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), second);
  assert.equal(fs.readFileSync(filePath, 'utf8').includes('fast'), false);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.tmp-')), []);
});

test('transcript store creates the first journal only with its first record', () => {
  const {transcriptStore} = createHarness();
  const cwd = '/tmp/example/reserved-session';
  const reference = transcriptStore.createSession(
    cwd,
    {op: 'append_records', records: [{role: 'user', text: 'hello'}]},
    '2026-07-01T00:00:00.000Z'
  );

  assert.equal(reference.createdAt, '2026-07-01T00:00:00.000Z');
  assert.equal(transcriptStore.loadSession(cwd, reference.sessionId).session.records[0].text, 'hello');
});

test('an orphan settings sidecar is ignored by transcript session enumeration', () => {
  const {store, transcriptStore} = createHarness();
  const cwd = '/tmp/example/orphan-settings';
  store.write(cwd, {sessionId: 'orphan', modelProfileId: 'fast'});

  assert.deepEqual(transcriptStore.listSessionSummaries(cwd), []);
});
