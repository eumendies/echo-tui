const test = require('node:test');
const assert = require('node:assert/strict');

const {createGoalEvidenceProjection} = require('../../src/app/goal/evaluation-projection');

test('goal evidence projection keeps visible roles in chronological order', () => {
  const projection = createGoalEvidenceProjection([
    {role: 'user', text: 'start'},
    {role: 'reasoning_summary', text: 'hidden thinking'},
    {role: 'tool_call', text: 'grep({"pattern":"x"})', toolCallId: 'c1', toolName: 'grep', argumentsText: '{"pattern":"x"}'},
    {role: 'tool_result', text: 'found 3 matches', toolCallId: 'c1', toolName: 'grep', ok: true, details: {kind: 'grep', truncated: false}},
    {role: 'assistant', text: 'done for now'},
    {role: 'local_notice', text: '目标评估：未达成 — still red'},
    {role: 'error', text: 'provider failed'},
    {role: 'subagent', text: 'sub process', agentName: 'x', parentToolCallId: 'p', runId: 'r', event: {kind: 'assistant'}}
  ]);

  assert.equal(projection.split('\n').length, 5);

  const lines = projection.split('\n');
  assert.equal(lines[0], '[user] start');
  assert.match(projection, /\[tool_result:grep\] found 3 matches/);
  assert.match(projection, /\[assistant\] done for now/);
  assert.match(projection, /\[local_notice\] 目标评估：未达成 — still red/);
  assert.match(projection, /\[error\] provider failed/);
  assert.equal(projection.includes('hidden thinking'), false);
  assert.equal(projection.includes('sub process'), false);
  assert.equal(projection.includes('[tool_call'), false);
  assert.ok(projection.indexOf('[user]') < projection.indexOf('[assistant]'));
});

test('goal evidence projection keeps only the most recent bounded records', () => {
  const records = Array.from({length: 80}, (_value, index) => ({role: 'assistant', text: `message ${index}`}));
  const projection = createGoalEvidenceProjection(records);

  assert.equal(projection.split('\n').length, 60);
  assert.match(projection, /^\[assistant\] message 20/);
  assert.match(projection, /message 79$/);
  assert.equal(projection.includes('message 19'), false);
});

test('goal evidence projection stops at the character budget while keeping the newest entry', () => {
  const bigEntry = (label) => ({
    role: 'tool_result',
    text: `${label} ${'x'.repeat(1900)}`,
    toolCallId: 'c1',
    toolName: 'run_bash_command',
    ok: true,
    details: {kind: 'bash'}
  });
  const records = Array.from({length: 10}, (_value, index) => bigEntry(`entry-${index}`));
  const projection = createGoalEvidenceProjection(records);

  assert.ok(projection.length <= 12000);
  const lineCount = projection.split('\n').length;
  assert.ok(lineCount >= 5 && lineCount <= 7);
  assert.match(projection, /entry-9/);
  assert.equal(projection.includes('entry-0'), false);
});

test('goal evidence projection truncates an oversized single record while keeping head and tail', () => {
  const text = `head-${'a'.repeat(2500)}-tail`;
  const projection = createGoalEvidenceProjection([{role: 'assistant', text}]);

  assert.equal(projection.split('\n').length, 1);
  assert.match(projection, /head-a/);
  assert.match(projection, /a-tail$/);
  assert.match(projection, /…\[truncated\]…/);
  assert.ok(projection.length <= '[assistant] '.length + 2000);
});

test('goal evidence projection skips empty text and returns empty string without evidence', () => {
  const projection = createGoalEvidenceProjection([
    {role: 'assistant', text: '   '},
    {role: 'user', text: ''}
  ]);

  assert.equal(projection, '');
});
