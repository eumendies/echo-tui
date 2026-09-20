const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {createUsageStore} = require('../../src/persistence/usage-store');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-usage-store-'));
}

function createStore(rootDir) {
  return createUsageStore({
    rootDir,
    cryptoImpl: {
      randomBytes() {
        return Buffer.from('abcdef', 'hex');
      }
    }
  });
}

test('usage store appends monthly events and aggregates daily totals', () => {
  const rootDir = createTempDir();
  const store = createStore(rootDir);

  const first = store.appendEvent({
    timestamp: '2026-06-29T10:00:00.000Z',
    cwdHash: 'cwd-a',
    providerType: 'openai',
    model: 'gpt-test',
    interactionMode: 'normal',
    inputTokens: 100,
    cacheReadInputTokens: 40,
    cacheCreationInputTokens: 10,
    outputTokens: 25,
    contextWindow: 1000
  });
  store.appendEvent({
    timestamp: '2026-06-29T12:00:00.000Z',
    cwdHash: 'cwd-a',
    providerType: 'openai-chat',
    model: 'chat-test',
    interactionMode: 'plan',
    inputTokens: 50,
    cacheReadInputTokens: 10,
    outputTokens: 5
  });
  store.appendEvent({
    timestamp: '2026-06-30T10:00:00.000Z',
    cwdHash: 'cwd-b',
    providerType: 'anthropic',
    model: 'claude-test',
    interactionMode: 'normal',
    inputTokens: 10,
    outputTokens: 3
  });

  assert.equal(first.schemaVersion, 1);
  assert.equal(first.localDay, '2026-06-29');
  assert.equal(first.uncachedInputTokens, 60);
  assert.equal(fs.existsSync(path.join(rootDir, '2026-06.jsonl')), true);
  assert.deepEqual(store.listDailyUsage(), [
    {
      localDay: '2026-06-29',
      inputTokens: 150,
      cacheReadInputTokens: 50,
      cacheCreationInputTokens: 10,
      uncachedInputTokens: 100,
      outputTokens: 30,
      totalTokens: 180,
      hitRate: 50 / 150,
      eventCount: 2
    },
    {
      localDay: '2026-06-30',
      inputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 10,
      outputTokens: 3,
      totalTokens: 13,
      hitRate: 0,
      eventCount: 1
    }
  ]);
  assert.deepEqual(store.listDailyUsage({cwdHash: 'cwd-a'}).map((day) => day.localDay), ['2026-06-29']);
});

test('usage store skips bad lines and supports date windowing', () => {
  const rootDir = createTempDir();
  const store = createStore(rootDir);

  store.appendEvent({
    timestamp: '2026-05-31T10:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'openai',
    model: 'a',
    interactionMode: 'normal',
    inputTokens: 10
  });
  store.appendEvent({
    timestamp: '2026-06-01T10:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'openai',
    model: 'a',
    interactionMode: 'normal',
    inputTokens: 20
  });
  store.appendEvent({
    timestamp: '2026-06-02T10:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'openai',
    model: 'a',
    interactionMode: 'normal',
    inputTokens: 30
  });

  fs.appendFileSync(path.join(rootDir, '2026-06.jsonl'), 'not json\n{"schemaVersion":1}\n', 'utf8');

  assert.deepEqual(store.listDailyUsage({fromDay: '2026-06-01', toDay: '2026-06-30'}).map((day) => day.inputTokens), [20, 30]);
  assert.deepEqual(store.listDailyUsage({limitDays: 2}).map((day) => day.localDay), ['2026-06-01', '2026-06-02']);
});

test('usage store normalizes missing fields and ignores empty events', () => {
  const rootDir = createTempDir();
  const store = createStore(rootDir);

  assert.equal(store.appendEvent({
    timestamp: '2026-06-01T10:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'openai',
    model: 'a',
    interactionMode: 'normal'
  }), null);

  store.appendEvent({
    timestamp: '2026-06-01T10:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'openai',
    model: 'a',
    interactionMode: 'normal',
    outputTokens: 7
  });

  assert.deepEqual(store.listDailyUsage(), [{
    localDay: '2026-06-01',
    inputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 7,
    totalTokens: 7,
    hitRate: 0,
    eventCount: 1
  }]);
});

test('usage store aggregates models by provider ID, falls back for legacy events, and supports day filtering', () => {
  const rootDir = createTempDir();
  const store = createStore(rootDir);

  store.appendEvent({
    timestamp: '2026-06-01T10:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'openai',
    providerId: 'primary-openai',
    model: 'shared-model',
    inputTokens: 100,
    cacheReadInputTokens: 40,
    outputTokens: 20
  });
  store.appendEvent({
    timestamp: '2026-06-02T10:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'openai',
    providerId: 'primary-openai',
    model: 'shared-model',
    inputTokens: 20,
    outputTokens: 10
  });
  store.appendEvent({
    timestamp: '2026-06-02T12:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'openai',
    providerId: 'backup-openai',
    model: 'shared-model',
    outputTokens: 50
  });
  store.appendEvent({
    timestamp: '2026-06-02T13:00:00.000Z',
    cwdHash: 'cwd',
    providerType: 'anthropic',
    model: 'legacy-model',
    outputTokens: 5
  });

  assert.deepEqual(store.listModelUsage({cwdHash: 'cwd'}), [
    {
      providerType: 'openai',
      providerId: 'primary-openai',
      model: 'shared-model',
      inputTokens: 120,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 80,
      outputTokens: 30,
      totalTokens: 150,
      hitRate: 40 / 120,
      eventCount: 2,
      share: 150 / 205
    },
    {
      providerType: 'openai',
      providerId: 'backup-openai',
      model: 'shared-model',
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 50,
      totalTokens: 50,
      hitRate: 0,
      eventCount: 1,
      share: 50 / 205
    },
    {
      providerType: 'anthropic',
      providerId: 'anthropic',
      model: 'legacy-model',
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 5,
      totalTokens: 5,
      hitRate: 0,
      eventCount: 1,
      share: 5 / 205
    }
  ]);
  assert.deepEqual(store.listDailyUsage({providerId: 'primary-openai', model: 'shared-model'}), [
    {
      localDay: '2026-06-01',
      inputTokens: 100,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 60,
      outputTokens: 20,
      totalTokens: 120,
      hitRate: 0.4,
      eventCount: 1
    },
    {
      localDay: '2026-06-02',
      inputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      hitRate: 0,
      eventCount: 1
    }
  ]);
  assert.deepEqual(store.listModelUsage({cwdHash: 'cwd', limitDays: 1}).map((entry) => ({
    providerId: entry.providerId,
    model: entry.model,
    totalTokens: entry.totalTokens
  })), [
    {providerId: 'backup-openai', model: 'shared-model', totalTokens: 50},
    {providerId: 'primary-openai', model: 'shared-model', totalTokens: 30},
    {providerId: 'anthropic', model: 'legacy-model', totalTokens: 5}
  ]);
  assert.deepEqual(store.listModelUsage({fromDay: '2026-06-02', toDay: '2026-06-02'}).map((entry) => entry.providerId), ['backup-openai', 'primary-openai', 'anthropic']);
});
