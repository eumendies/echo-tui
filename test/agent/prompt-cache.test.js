const test = require('node:test');
const assert = require('node:assert/strict');

const { createPromptCacheKey } = require('../../src/agent/prompt-cache');

const TEST_CONFIG = {
  model: 'test-model'
};

test('createPromptCacheKey stays stable across dynamic user messages', () => {
  const first = createPromptCacheKey([
    { role: 'system', text: 'stable instructions' },
    { role: 'user', text: 'first task' }
  ], TEST_CONFIG);
  const second = createPromptCacheKey([
    { role: 'system', text: 'stable instructions' },
    { role: 'user', text: 'second task' }
  ], TEST_CONFIG);

  assert.equal(first, second);
  assert.match(first, /^echo-tui-[0-9a-f]{32}$/);
});

test('createPromptCacheKey changes when stable prompt or tools change', () => {
  const base = createPromptCacheKey([
    { role: 'system', text: 'stable instructions' },
    { role: 'user', text: 'task' }
  ], TEST_CONFIG);
  const changedPrompt = createPromptCacheKey([
    { role: 'system', text: 'different instructions' },
    { role: 'user', text: 'task' }
  ], TEST_CONFIG);
  const changedTools = createPromptCacheKey([
    { role: 'system', text: 'stable instructions' },
    { role: 'user', text: 'task' }
  ], TEST_CONFIG, [{ name: 'grep', description: 'Search text', parameters: { type: 'object' } }]);

  assert.notEqual(base, changedPrompt);
  assert.notEqual(base, changedTools);
});

test('createPromptCacheKey binds to the session identity when provided', () => {
  const records = [
    { role: 'system', text: 'stable instructions' },
    { role: 'user', text: 'task' }
  ];
  const reboundRecords = [
    { role: 'system', text: 'instructions changed by a memory update' },
    { role: 'user', text: 'task' }
  ];
  const sessionKey = createPromptCacheKey(records, TEST_CONFIG, [], 'session-abc');

  assert.equal(sessionKey, 'echo-tui-session-abc');
  // 会话级 key 不随 system prompt 重算漂移，仍由 token 前缀决定是否命中。
  assert.equal(createPromptCacheKey(reboundRecords, TEST_CONFIG, [], 'session-abc'), sessionKey);
  assert.notEqual(createPromptCacheKey(records, TEST_CONFIG, [], 'session-xyz'), sessionKey);
});
