const assert = require('node:assert/strict');
const {test} = require('node:test');

const {
  SubagentFailureHandoffAccumulator,
  buildSubagentFailureHandoff
} = require('../../src/agent/subagent/failure-handoff');

const BASE = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer-1', runId: 'run-1'};

function record(text, event) {
  return {...BASE, text, event};
}

function toolCall(toolCallId, toolName, args = {}) {
  return record(`${toolName}(${JSON.stringify(args)})`, {
    kind: 'tool_call', toolCallId, toolName, argumentsText: JSON.stringify(args)
  });
}

function toolResult(toolCallId, toolName, text, ok = true, details = {kind: 'generic'}, attachments) {
  return record(text, {
    kind: 'tool_result', toolCallId, toolName, ok, details,
    ...(attachments ? {attachments} : {})
  });
}

function build(records, incompleteAssistantDraft) {
  return buildSubagentFailureHandoff({
    errorText: 'Explorer failed: termination error',
    snapshot: {records, ...(incompleteAssistantDraft ? {incompleteAssistantDraft} : {})}
  });
}

test('handoff accumulator preserves stable order and clears drafts at stable segment boundaries', () => {
  const accumulator = new SubagentFailureHandoffAccumulator();
  const start = record('inspect', {kind: 'start', task: 'inspect'});
  const assistant = record('stable finding', {kind: 'assistant'});

  accumulator.record([start]);
  accumulator.updateAssistantDraft('old transient draft');
  accumulator.record([assistant]);
  accumulator.completeAssistantSegment();
  assert.deepEqual(accumulator.snapshot(), {records: [start, assistant]});

  accumulator.updateAssistantDraft('stale next draft');
  accumulator.beginAssistantSegment();
  assert.deepEqual(accumulator.snapshot(), {records: [start, assistant]});

  accumulator.updateAssistantDraft('current partial answer');
  const snapshot = accumulator.snapshot();
  assert.deepEqual(snapshot.records, [start, assistant]);
  assert.equal(snapshot.incompleteAssistantDraft, 'current partial answer');
  assert.notEqual(snapshot.records, accumulator.snapshot().records);
});

test('handoff pairs failed results as stable and leaves only missing results uncertain', () => {
  const records = [
    toolCall('read-1', 'read_files', {files: [{path: 'src/a.ts'}]}),
    toolResult('read-1', 'read_files', 'read failed', false, {kind: 'read_files', truncated: false}),
    toolCall('bash-1', 'run_bash_command', {command: 'printf changed > result.txt'})
  ];
  const handoff = build(records);
  assert.match(handoff, /Completed tools: 0 succeeded, 1 failed/u);
  assert.match(handoff, /`read_files` — failed/u);
  assert.match(handoff, /`run_bash_command` — result status unknown/u);
  assert.match(handoff, /may have produced side effects/u);
});

test('handoff separates stable output, incomplete assistant draft, and no-progress failures', () => {
  const records = [
    record('inspect', {kind: 'start', task: 'inspect'}),
    record('Need inspect runtime boundaries.', {kind: 'reasoning_summary'}),
    record('Stable finding from the first segment.', {kind: 'assistant'})
  ];
  const handoff = build(records, 'A partial final answer that ended mid-sentence');

  assert.match(handoff, /Subagent failure: Explorer failed: termination error/u);
  assert.doesNotMatch(handoff, /Agent:|Run:|Status: failed/u);
  assert.match(handoff, /Stable output:/u);
  assert.match(handoff, /Stable finding from the first segment/u);
  assert.match(handoff, /Incomplete draft \(unverified\):/u);
  assert.match(handoff, /A partial final answer that ended mid-sentence/u);
  assert.doesNotMatch(handoff, /Last stable note|Need inspect runtime boundaries/u);
  assert.match(handoff, /Use this as partial progress, not as a final answer/u);

  const reasoningFallback = build([
    record('inspect', {kind: 'start', task: 'inspect'}),
    record('Only stable reasoning remains.', {kind: 'reasoning_summary'})
  ]);
  assert.match(reasoningFallback, /Last stable note:/u);
  assert.match(reasoningFallback, /Only stable reasoning remains/u);

  const empty = build([record('inspect', {kind: 'start', task: 'inspect'})]);
  assert.match(empty, /No recoverable progress was recorded/u);
  assert.doesNotMatch(empty, /Incomplete draft/u);
});

test('handoff stays bounded, reports omitted tools, and uses structured edit and attachment summaries', () => {
  const records = [];
  for (let index = 0; index < 10; index += 1) {
    records.push(toolCall(`read-${index}`, 'read_files', {files: [{path: `src/file-${index}.ts`}]}));
    records.push(toolResult(`read-${index}`, 'read_files', `result-${index}\n${'x'.repeat(3000)}`, true, {kind: 'read_files', truncated: true}));
  }
  records.push(toolCall('patch-1', 'apply_patch', {patch: 'SECRET FULL DIFF'}));
  records.push(toolResult('patch-1', 'apply_patch', 'SECRET FULL DIFF', true, {
    kind: 'apply_patch',
    display: {
      kind: 'apply_patch',
      files: [
        {path: 'src/runtime.ts', kind: 'updated', lines: []},
        ...Array.from({length: 9}, (_value, index) => ({path: `src/extra-${index}.ts`, kind: 'updated', lines: []}))
      ]
    }
  }, [
    {
      kind: 'image', path: 'result.png', mediaType: 'image/png', sizeBytes: 42,
      dataBase64: 'BASE64_SHOULD_NOT_APPEAR'
    },
    ...Array.from({length: 5}, (_value, index) => ({
      kind: 'image', path: `extra-${index}.png`, mediaType: 'image/png', sizeBytes: index + 1,
      dataBase64: `EXTRA_BASE64_${index}`
    }))
  ]));

  const handoff = build(records, 'draft '.repeat(5000));
  assert.ok(handoff.length <= 12000, `${handoff.length} > 12000`);
  assert.match(handoff, /earlier completed tool call\(s\) omitted/u);
  assert.match(handoff, /Files: updated src\/runtime\.ts/u);
  assert.match(handoff, /2 more file\(s\) omitted/u);
  assert.match(handoff, /result\.png \(image\/png, 42 bytes\)/u);
  assert.match(handoff, /2 more attachment\(s\) omitted/u);
  assert.doesNotMatch(handoff, /BASE64_SHOULD_NOT_APPEAR/u);
  assert.doesNotMatch(handoff, /SECRET FULL DIFF/u);
  assert.match(handoff, /section truncated|chars omitted|output truncated/u);
});

test('uncertain MCP calls receive conservative side-effect guidance', () => {
  const handoff = build([
    toolCall('mcp-1', 'mcp__docs__write', {document: 'doc-1', text: 'update'})
  ]);

  assert.match(handoff, /`mcp__docs__write` — result status unknown/u);
  assert.match(handoff, /Verify current state before repeating it/u);
  assert.doesNotMatch(handoff, /— failed/u);
});
