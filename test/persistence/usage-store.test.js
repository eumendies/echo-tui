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
