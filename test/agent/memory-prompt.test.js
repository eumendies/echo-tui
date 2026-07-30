const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AGENT_MEMORY_EXPANSION_MAX_TOKENS,
  AGENT_MEMORY_EXPANSION_RATIO,
  createAgentMemoryPromptProjection
} = require('../../src/agent/context/memory-prompt');

function catalog(name, content, options = {}) {
  return {
    catalog: {
      id: options.catalogId || 'catalog-id',
      name,
      description: options.description || `${name} rules`,
      enabled: true,
      scope: {kind: 'project', projectRoot: '/project'}
    },
    memories: [{
      id: options.itemId || 'item-id',
      content,
      enabled: true,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z'
    }]
  };
}

test('agent memory prompt projection omits an empty catalog set', () => {
  assert.deepEqual(createAgentMemoryPromptProjection([], 128_000), {
    mode: 'none',
    text: '',
    estimatedTokens: 0,
    catalogCount: 0,
    itemCount: 0
  });
});

test('agent memory prompt projection expands small effective memories without internal metadata', () => {
  const projection = createAgentMemoryPromptProjection([catalog('rendering', 'Use real cursors.', {catalogId: 'hidden-catalog', itemId: 'hidden-item'})], 128_000);

  assert.equal(projection.mode, 'expanded');
  assert.match(projection.text, /## Agent memories/);
  assert.match(projection.text, /### rendering/);
  assert.match(projection.text, /Use real cursors/);
  assert.doesNotMatch(projection.text, /hidden-catalog|hidden-item|projectRoot|2026-07-12|enabled/);
});

test('agent memory prompt projection expands at the ratio boundary and folds above it', () => {
  const entries = [catalog('rendering', 'Use real cursors.')];
  const expanded = createAgentMemoryPromptProjection(entries, 1_000_000);
  const boundaryWindow = Math.ceil(expanded.estimatedTokens / AGENT_MEMORY_EXPANSION_RATIO);

  assert.equal(createAgentMemoryPromptProjection(entries, boundaryWindow).mode, 'expanded');
  assert.equal(createAgentMemoryPromptProjection(entries, boundaryWindow - 1).mode, 'catalog');
});

test('agent memory prompt projection folds all catalogs beyond the absolute budget', () => {
  const entries = [
    catalog('small', 'Visible only in a small projection.'),
    catalog('large', 'x'.repeat(AGENT_MEMORY_EXPANSION_MAX_TOKENS * 5))
  ];
  const projection = createAgentMemoryPromptProjection(entries, 1_000_000);

  assert.equal(projection.mode, 'catalog');
  assert.match(projection.text, /small: small rules/);
  assert.match(projection.text, /large: large rules/);
  assert.match(projection.text, /agent-memory/);
  assert.doesNotMatch(projection.text, /read_memory/);
  assert.doesNotMatch(projection.text, /Visible only in a small projection|xxxxx/);
});
