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
