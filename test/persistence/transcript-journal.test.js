const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAppendRecordsOperation,
  createBatchOperation,
  createSetChangeHistoryOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation,
  createTranscriptJournalEntry,
  createTranscriptJournalStart,
  createTruncateRecordsOperation,
  replayTranscriptJournal,
  serializeTranscriptJournalLine
} = require('../../src/persistence/transcript-journal');

function createJournalLines(operations) {
  return [
    serializeTranscriptJournalLine(createTranscriptJournalStart('session-1', '/tmp/project', '2026-07-01T00:00:00.000Z')),
    ...operations.map((operation, index) => serializeTranscriptJournalLine(createTranscriptJournalEntry(operation, index + 1, `2026-07-01T00:00:0${index + 1}.000Z`)))
  ];
}

test('replayTranscriptJournal replays records and keeps state updates independent', () => {
  const todoState = {
    updatedAt: '2026-07-01T00:00:02.000Z',
    items: [{id: 'todo_1', text: 'inspect journal', status: 'open'}]
  };
  const compaction = {
    summaryText: 'earlier context',
    activeStartIndex: 1,
    createdAt: '2026-07-01T00:00:03.000Z'
  };
  const changeHistory = [{
    id: 'checkpoint-1',
    createdAt: '2026-07-01T00:00:04.000Z',
    cwd: '/tmp/project',
    transcriptStartIndex: 1,
    status: 'ready',
    files: []
  }];
  const journal = createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'hello'}]),
    createSetTodoStateOperation(todoState),
    createSetCompactionOperation(compaction),
    createSetChangeHistoryOperation(changeHistory),
    createAppendRecordsOperation([{role: 'assistant', text: 'world'}])
  ]).join('\n');

  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, [
    {role: 'user', text: 'hello'},
    {role: 'assistant', text: 'world'}
  ]);
  assert.deepEqual(loaded.session.todoState, todoState);
  assert.deepEqual(loaded.session.compaction, compaction);
  assert.deepEqual(loaded.session.changeHistory, changeHistory);
  assert.equal(loaded.reference.sequence, 5);
});

test('replayTranscriptJournal incrementally replays valid custom subagent process records without migration', () => {
  const base = {role: 'subagent', agentName: 'security-reviewer', parentToolCallId: 'outer-1', runId: 'run-1'};
  const records = [
    {...base, text: 'inspect', event: {kind: 'start', task: 'inspect'}},
    {...base, text: 'grep({"pattern":"x"})', event: {kind: 'tool_call', toolCallId: 'inner-1', toolName: 'grep', argumentsText: '{"pattern":"x"}'}},
    {...base, text: 'x found', event: {kind: 'tool_result', toolCallId: 'inner-1', toolName: 'grep', ok: true, details: {kind: 'grep', truncated: false}}},
    {...base, text: 'report', event: {kind: 'assistant'}},
    {...base, text: '', event: {kind: 'completed', durationMs: 42}}
  ];
  const journal = createJournalLines(records.map((record) => createAppendRecordsOperation([record]))).join('\n');
  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, records);
  assert.equal(loaded.reference.sequence, records.length);
});

test('replayTranscriptJournal keeps concise subagent failure and provider-facing handoff in their separate records', () => {
  const base = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer-failed', runId: 'run-failed'};
  const errorText = 'Explorer failed：termination error';
  const handoffText = 'Subagent failure: Explorer failed：termination error\n\nStable output:\n    preserved finding';
  const processRecords = [
    {...base, text: 'inspect', event: {kind: 'start', task: 'inspect'}},
    {...base, text: 'preserved finding', event: {kind: 'assistant'}},
    {...base, text: errorText, event: {kind: 'failed', durationMs: 42}}
  ];
  const outerPair = [
    {role: 'tool_call', text: 'run_subagent', toolCallId: 'outer-failed', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"inspect"}'},
    {role: 'tool_result', text: handoffText, toolCallId: 'outer-failed', toolName: 'run_subagent', ok: false, details: {kind: 'generic'}}
  ];
  const journal = createJournalLines([
    ...processRecords.map((record) => createAppendRecordsOperation([record])),
    createAppendRecordsOperation(outerPair)
  ]).join('\n');

  const loaded = replayTranscriptJournal(journal);
  assert.deepEqual(loaded.session.records, [...processRecords, ...outerPair]);
  assert.equal(loaded.session.records[2].text, errorText);
  assert.doesNotMatch(loaded.session.records[2].text, /Subagent failure:/u);
  assert.equal(loaded.session.records[4].text, handoffText);
});

test('replayTranscriptJournal rejects malformed subagent identity and event payloads', () => {
  const validStart = {
    role: 'subagent',
    text: 'inspect',
    agentName: 'explorer',
    parentToolCallId: 'outer-1',
    runId: 'run-1',
    event: {kind: 'start', task: 'inspect'}
  };
  const malformed = {...validStart, runId: '', event: {kind: 'completed', durationMs: -1}};
  const journal = createJournalLines([
    createAppendRecordsOperation([validStart]),
    createAppendRecordsOperation([malformed]),
    createAppendRecordsOperation([{role: 'assistant', text: 'later'}])
  ]).join('\n');

  assert.equal(replayTranscriptJournal(journal), null);
});

test('replayTranscriptJournal applies batch operations atomically in journal order', () => {
  const journal = createJournalLines([
    createAppendRecordsOperation([
      {role: 'user', text: 'A'},
      {role: 'assistant', text: 'B'},
      {role: 'assistant', text: 'C'}
    ]),
    createBatchOperation([
      createTruncateRecordsOperation(1),
      createSetCompactionOperation(null),
      createAppendRecordsOperation([{role: 'assistant', text: 'D'}])
    ])
  ]).join('\n');

  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, [
    {role: 'user', text: 'A'},
    {role: 'assistant', text: 'D'}
  ]);
  assert.equal(loaded.session.compaction, undefined);
  assert.equal(loaded.reference.sequence, 2);
});

test('replayTranscriptJournal rejects a batch without applying its partial mutations', () => {
  const journal = createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'saved'}]),
    createBatchOperation([
      createAppendRecordsOperation([{role: 'assistant', text: 'must not leak'}]),
      createTruncateRecordsOperation(99)
    ]),
    createAppendRecordsOperation([{role: 'assistant', text: 'later'}])
  ]).join('\n');

  assert.equal(replayTranscriptJournal(journal), null);
});

test('replayTranscriptJournal ignores an incomplete final line', () => {
  const journal = `${createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'saved'}])
  ]).join('\n')}\n{"schemaVersion":1,"seq":2`;

  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, [{role: 'user', text: 'saved'}]);
  assert.equal(loaded.reference.sequence, 1);
  assert.equal(loaded.requiresRepair, true);
  assert.equal(loaded.repairedJournalText.endsWith('\n'), true);
});

test('replayTranscriptJournal ignores a structurally invalid final line', () => {
  const journal = `${createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'saved'}])
  ]).join('\n')}\n{"schemaVersion":1,"seq":2}`;

  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, [{role: 'user', text: 'saved'}]);
  assert.equal(loaded.reference.sequence, 1);
  assert.equal(loaded.requiresRepair, true);
});

test('replayTranscriptJournal rejects a corrupt middle line and non-contiguous sequences', () => {
  const lines = createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'saved'}]),
    createAppendRecordsOperation([{role: 'assistant', text: 'later'}])
  ]);

  assert.equal(replayTranscriptJournal([lines[0], '{bad json', lines[2]].join('\n')), null);
  assert.equal(replayTranscriptJournal([
    lines[0],
    lines[1],
    serializeTranscriptJournalLine(createTranscriptJournalEntry(createAppendRecordsOperation([{role: 'assistant', text: 'later'}]), 3, '2026-07-01T00:00:03.000Z'))
  ].join('\n')), null);
});
