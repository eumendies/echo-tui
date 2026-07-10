const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createDebugContext,
  createEnabledDebugContext,
  hashValue,
  isDebugEnabled,
  redactProviderConfig,
  summarizeText
} = require('../../src/debug/debug-context');

test('createDebugContext is disabled unless debug environment is enabled', () => {
  const context = createDebugContext({env: {}, osImpl: {homedir: () => '/tmp/home'}});

  assert.equal(context.enabled, false);
  assert.equal(context.logPath, null);
});

test('isDebugEnabled accepts explicit truthy values only', () => {
  assert.equal(isDebugEnabled('1'), true);
  assert.equal(isDebugEnabled('true'), true);
  assert.equal(isDebugEnabled('yes'), true);
  assert.equal(isDebugEnabled('on'), true);
  assert.equal(isDebugEnabled('0'), false);
  assert.equal(isDebugEnabled('false'), false);
  assert.equal(isDebugEnabled(undefined), false);
});

test('createDebugContext uses explicit log path and writes JSONL events', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-debug-context-'));
  const logPath = path.join(tempDir, 'debug.jsonl');

  try {
    const context = createDebugContext({
      env: {
        ECHO_TUI_DEBUG: '1',
        ECHO_TUI_DEBUG_LOG: logPath
      },
      now: () => new Date('2026-06-29T00:00:00.000Z'),
      pid: 123
    });

    context.emit('app_start', {cwd: '/tmp/project'});
    context.emit('assistant_turn_end', {ok: true});

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines, [
      {
        timestamp: '2026-06-29T00:00:00.000Z',
        seq: 1,
        event: 'app_start',
        cwd: '/tmp/project'
      },
      {
        timestamp: '2026-06-29T00:00:00.000Z',
        seq: 2,
        event: 'assistant_turn_end',
        ok: true
      }
    ]);
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
});

test('createEnabledDebugContext isolates write failures and close stops writes', () => {
  const context = createEnabledDebugContext({
    logPath: '/unwritable/debug.jsonl',
    fsImpl: {
      mkdirSync() {
        throw new Error('denied');
      },
      appendFileSync() {
        throw new Error('denied');
      }
    },
    now: () => new Date('2026-06-29T00:00:00.000Z')
  });

  assert.doesNotThrow(() => context.emit('app_start'));
  context.close();
  assert.doesNotThrow(() => context.emit('after_close'));
});

test('summarizeText and hashValue produce stable bounded summaries', () => {
  const summary = summarizeText('abcdef', 3);

  assert.deepEqual(summary, {
    length: 6,
    hash: summary.hash,
    preview: 'abc',
    truncated: true
  });
  assert.equal(summary.hash.length, 16);
  assert.equal(hashValue({b: 2, a: 1}), hashValue({a: 1, b: 2}));
});

test('redactProviderConfig removes api key and headers', () => {
  const redacted = redactProviderConfig({
    agentType: 'anthropic',
    apiKey: 'secret',
    headers: {authorization: 'bearer secret'},
    baseURL: 'https://example.com',
    model: 'claude',
    contextWindow: 200000,
    reasoningEffort: 'medium'
  });

  assert.deepEqual(redacted, {
    agentType: 'anthropic',
    baseURL: 'https://example.com',
    contextWindow: 200000,
    model: 'claude',
    reasoningEffort: 'medium'
  });
});
