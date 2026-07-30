const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calibrateContextUsageSegments,
  estimateContextUsageSegments
} = require('../../src/agent/context/context-usage-breakdown');
const { estimateTextTokens } = require('../../src/agent/context/token-estimator');
const {createSkillCatalogPromptProjection, formatSkillCatalogPrompt} = require('../../src/skills/skill-catalog-prompt');

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
    {role: 'tool_call', text: '', toolCallId: 'grep-1', toolName: 'grep', argumentsText: '{"pattern":"x"}'},
    {role: 'tool_result', text: 'tool output', toolCallId: 'grep-1', toolName: 'grep', ok: true, details: {kind: 'grep', truncated: false}},
    {role: 'shell', text: '$ pwd', command: 'pwd', output: '/workspace', includeInContext: true},
    {role: 'shell', text: '$ env', command: 'env', output: 'SECRET=1', includeInContext: false},
    {role: 'reasoning_summary', text: 'visible local summary'},
    {role: 'extension', text: '', extension: {kind: 'openai_reasoning', item: {type: 'reasoning', encrypted_content: 'abc'}}}
  ], [{name: 'grep', description: 'Search files', parameters: {type: 'object'}}], estimateTextTokens(skillCatalogText));
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));

  assert.ok(byCategory.system > 0);
  assert.ok(byCategory.skills > 0);
  assert.ok(byCategory.tools > 0);
  assert.ok(byCategory.messages > 0);
  assert.ok(byCategory.reasoning > 0);
  assert.equal(segments.length, 6);
});

test('context usage uses the projected skill catalog tokens before calibration', () => {
  const catalog = [{
    name: 'large-skill',
    description: `BEGIN ${'routing '.repeat(200)} END`,
    sourceKind: 'project',
    sourcePath: '/tmp/large-skill/SKILL.md'
  }];
  const projection = createSkillCatalogPromptProjection(catalog, 2000, 0.1);
  const skillCatalogText = formatSkillCatalogPrompt(projection.catalog);
  const segments = estimateContextUsageSegments([
    {role: 'system', text: `system prompt\n\n${skillCatalogText}`}
  ], [], projection.estimatedTokens);
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));
  const calibrated = calibrateContextUsageSegments(segments, 500);

  assert.equal(projection.mode, 'truncated');
  assert.equal(byCategory.skills, projection.estimatedTokens);
  assert.ok(byCategory.skills <= projection.budgetTokens);
  assert.equal(calibrated.reduce((sum, segment) => sum + segment.tokens, 0), 500);
});

test('estimateContextUsageSegments separates user memory from the rest of the system prompt', () => {
  const memoryText = '## User-managed memories\n- 回复使用中文';
  const segments = estimateContextUsageSegments([
    {role: 'system', text: `system prompt\n\n${memoryText}`}
  ], [], 0, estimateTextTokens(memoryText));
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));

  assert.ok(byCategory.memory > 0);
  assert.ok(byCategory.system > 0);
  assert.equal(byCategory.skills, 0);
});

test('estimateContextUsageSegments includes the selected expanded agent memory prompt in memory tokens', () => {
  const memoryText = '## User-managed memories\n- 中文';
  const agentMemoryText = '## Agent memories\n### rendering\nterminal rules\n\n- catalog item content';
  const segments = estimateContextUsageSegments([
    {role: 'system', text: `system prompt\n\n${memoryText}\n\n${agentMemoryText}`},
    {role: 'tool_result', text: 'catalog item content', toolName: 'run_bash_command', toolCallId: 'call-1', ok: true, details: {kind: 'bash'}}
  ], [], 0, estimateTextTokens(`${memoryText}\n\n${agentMemoryText}`));
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));
  assert.ok(byCategory.memory > 0);
  assert.ok(byCategory.tools > 0);
});

test('estimateContextUsageSegments classifies persisted mode transition as message context', () => {
  const transitionText = '[Interaction Mode Transition]\nfrom: normal\nto: plan\n\n[Mode Instructions]\nPlan mode is active.\n\n[User Request]\nactual task';
  const segments = estimateContextUsageSegments([
    {role: 'system', text: 'stable system prompt'},
    {role: 'user', text: transitionText, metadata: {modeTransition: {from: 'normal', to: 'plan'}}}
  ]);
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));

  assert.ok(byCategory.system > 0);
  assert.ok(byCategory.messages > byCategory.system);
  assert.equal(byCategory.tools, 0);
});

test('estimateContextUsageSegments counts Anthropic thinking as reasoning context', () => {
  const segments = estimateContextUsageSegments([
    {role: 'extension', text: '', extension: {kind: 'anthropic_thinking', block: {type: 'thinking', thinking: 'inspect', signature: 'sig'}}}
  ]);
  const byCategory = Object.fromEntries(segments.map((segment) => [segment.category, segment.estimatedTokens]));

  assert.ok(byCategory.reasoning > 0);
  assert.equal(byCategory.messages, 0);
});
