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
