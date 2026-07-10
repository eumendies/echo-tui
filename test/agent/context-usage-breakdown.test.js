const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calibrateContextUsageSegments,
  estimateContextUsageSegments
} = require('../../src/agent/context/context-usage-breakdown');
const {PLAN_MODE_USER_PROMPT} = require('../../src/agent/agent-loop-runtime');
const { estimateTextTokens } = require('../../src/agent/context/token-estimator');

test('estimateTextTokens is shared by token estimator module', () => {
  assert.equal(estimateTextTokens('abcd'), 1);
  assert.equal(estimateTextTokens(''), 0);
  assert.ok(estimateTextTokens('你好世界') >= estimateTextTokens('abcd'));
});

test('calibrateContextUsageSegments makes segment tokens sum to provider total', () => {
  const calibrated = calibrateContextUsageSegments([
    {category: 'system', estimatedTokens: 1},
    {category: 'tools', estimatedTokens: 1},
    {category: 'messages', estimatedTokens: 1}
  ], 10);

  assert.equal(calibrated.reduce((sum, segment) => sum + segment.tokens, 0), 10);
  assert.deepEqual(calibrated.map((segment) => segment.tokens), [4, 3, 3]);
});

test('calibrateContextUsageSegments returns zeros for empty estimates', () => {
  const calibrated = calibrateContextUsageSegments([
    {category: 'system', estimatedTokens: 0},
    {category: 'tools', estimatedTokens: 0}
  ], 100);

  assert.deepEqual(calibrated.map((segment) => segment.tokens), [0, 0]);
});

test('estimateContextUsageSegments classifies provider-visible records', () => {
  const skillCatalogText = '可用 Skills:\n- code-review: Review code';
  const segments = estimateContextUsageSegments([
    {role: 'system', text: `system prompt\n\n${skillCatalogText}`},
    {role: 'user', text: 'user message'},
    {role: 'assistant', text: 'assistant message'},
    {role: 'tool_call', text: '', toolName: 'grep', argumentsText: '{"pattern":"x"}'},
    {role: 'tool_result', text: 'tool output'},
    {role: 'shell', text: '$ pwd', command: 'pwd', output: '/workspace', includeInContext: true},
    {role: 'shell', text: '$ env', command: 'env', output: 'SECRET=1', includeInContext: false},
    {role: 'reasoning_summary', text: 'visible local summary'},
    {role: 'openai_reasoning', text: '', item: {type: 'reasoning', encrypted_content: 'abc'}}
  ], [{name: 'grep', description: 'Search files', parameters: {type: 'object'}}], estimateTextTokens(skillCatalogText));
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));

  assert.ok(byCategory.system > 0);
  assert.ok(byCategory.skills > 0);
  assert.ok(byCategory.tools > 0);
  assert.ok(byCategory.messages > 0);
  assert.ok(byCategory.reasoning > 0);
  assert.equal(segments.length, 5);
});

test('estimateContextUsageSegments classifies plan mode transient instruction as message context', () => {
  const segments = estimateContextUsageSegments([
    {role: 'system', text: 'stable system prompt'},
    {role: 'user', text: PLAN_MODE_USER_PROMPT},
    {role: 'user', text: 'actual task'}
  ]);
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));

  assert.ok(byCategory.system > 0);
  assert.ok(byCategory.messages > byCategory.system);
  assert.equal(byCategory.tools, 0);
});

test('estimateContextUsageSegments counts Anthropic thinking as reasoning context', () => {
  const segments = estimateContextUsageSegments([
    {role: 'anthropic_thinking', text: '', block: {type: 'thinking', thinking: 'inspect', signature: 'sig'}}
  ]);
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));

  assert.ok(byCategory.reasoning > 0);
  assert.equal(byCategory.messages, 0);
});
