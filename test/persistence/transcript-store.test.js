const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createAppendRecordsOperation,
  createBatchOperation,
  createSetChangeHistoryOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation
} = require('../../src/persistence/transcript-journal');
const {
  STORE_SCHEMA_VERSION,
  createTranscriptStore
} = require('../../src/persistence/transcript-store');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tui-store-'));
}

test('createTranscriptStore atomically creates a JSONL journal under the project partition', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  const reference = store.createSession(
    cwd,
    createAppendRecordsOperation([{role: 'user', text: 'hello'}]),
    '2026-07-01T00:00:00.000Z'
  );
  const filePath = store.getSessionFilePath(cwd, reference.sessionId);
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

  assert.equal(path.extname(filePath), '.jsonl');
  assert.equal(store.getProjectDir(cwd).startsWith(path.join(rootDir, 'projects')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(store.getProjectDir(cwd), 'project.json'), 'utf8')), store.getProjectMetadata(cwd));
  assert.deepEqual(lines, [
    {
      schemaVersion: STORE_SCHEMA_VERSION,
      op: 'session_start',
      sessionId: reference.sessionId,
      cwd,
      createdAt: '2026-07-01T00:00:00.000Z'
    },
    {
      schemaVersion: STORE_SCHEMA_VERSION,
      op: 'append_records',
      seq: 1,
      updatedAt: '2026-07-01T00:00:00.000Z',
      records: [{role: 'user', text: 'hello'}]
    }
  ]);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.tmp-')), []);
  assert.equal(fs.existsSync(path.join(cwd, '.echo_tui')), false);
});

test('createTranscriptStore appends operations without rewriting earlier journal lines', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  const reference = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'hello'}]), '2026-07-01T00:00:00.000Z');
  const filePath = store.getSessionFilePath(cwd, reference.sessionId);
  const originalJournal = fs.readFileSync(filePath, 'utf8');
  const nextReference = store.appendSession(
    cwd,
    reference,
    createBatchOperation([
      createAppendRecordsOperation([{role: 'assistant', text: 'world'}]),
      createSetCompactionOperation({summaryText: 'earlier context', activeStartIndex: 1, createdAt: '2026-07-01T00:00:01.000Z'}),
      createSetTodoStateOperation({updatedAt: '2026-07-01T00:00:01.000Z', items: [{id: 'todo_1', text: 'verify journal', status: 'open'}]})
    ]),
    '2026-07-01T00:00:01.000Z'
  );
  const journal = fs.readFileSync(filePath, 'utf8');
  const loaded = store.loadSession(cwd, reference.sessionId);

  assert.equal(journal.startsWith(originalJournal), true);
  assert.equal(journal.trim().split('\n').length, 3);
  assert.deepEqual(nextReference, {
    ...reference,
    sequence: 2,
    updatedAt: '2026-07-01T00:00:01.000Z'
  });
  assert.deepEqual(loaded, {
    session: {
      schemaVersion: STORE_SCHEMA_VERSION,
      sessionId: reference.sessionId,
      cwd,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z',
      records: [{role: 'user', text: 'hello'}, {role: 'assistant', text: 'world'}],
      compaction: {summaryText: 'earlier context', activeStartIndex: 1, createdAt: '2026-07-01T00:00:01.000Z'},
      todoState: {updatedAt: '2026-07-01T00:00:01.000Z', items: [{id: 'todo_1', text: 'verify journal', status: 'open'}]}
    },
    reference: nextReference
  });
});

test('createTranscriptStore replays change history and preserves caller-owned operation data', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  const history = [{
    id: 'checkpoint-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    cwd,
    transcriptStartIndex: 0,
    status: 'ready',
    files: []
  }];
  const reference = store.createSession(cwd, createBatchOperation([
    createAppendRecordsOperation([{role: 'user', text: 'hello'}]),
    createSetChangeHistoryOperation(history)
  ]), '2026-07-01T00:00:00.000Z');

  history[0].id = 'mutated';

  assert.deepEqual(store.loadSession(cwd, reference.sessionId).session.changeHistory, [{
    id: 'checkpoint-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    cwd,
    transcriptStartIndex: 0,
    status: 'ready',
    files: []
  }]);
});

test('createTranscriptStore tolerates a torn final write and rejects corrupt earlier journal data', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  const reference = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'saved'}]), '2026-07-01T00:00:00.000Z');
  const filePath = store.getSessionFilePath(cwd, reference.sessionId);

  fs.appendFileSync(filePath, '{"schemaVersion":1,"seq":2', 'utf8');
  const recovered = store.loadSession(cwd, reference.sessionId);
  const nextReference = store.appendSession(
    cwd,
    recovered.reference,
    createAppendRecordsOperation([{role: 'assistant', text: 'continued'}]),
    '2026-07-01T00:00:02.000Z'
  );

  assert.deepEqual(store.loadSession(cwd, reference.sessionId).session.records, [
    {role: 'user', text: 'saved'},
    {role: 'assistant', text: 'continued'}
  ]);
  assert.equal(nextReference.sequence, 2);
  assert.equal(fs.readFileSync(filePath, 'utf8').includes('{"schemaVersion":1,"seq":2{"'), false);

  fs.writeFileSync(filePath, `${fs.readFileSync(filePath, 'utf8').split('\n')[0]}\n{bad json\n${JSON.stringify({schemaVersion: 1, op: 'append_records', seq: 2, updatedAt: '2026-07-01T00:00:02.000Z', records: []})}\n`, 'utf8');
  assert.equal(store.loadSession(cwd, reference.sessionId), null);
});

test('createTranscriptStore repairs a valid final line without newline before continuing', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  const reference = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'saved'}]), '2026-07-01T00:00:00.000Z');
  const filePath = store.getSessionFilePath(cwd, reference.sessionId);

  fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf8').trimEnd(), 'utf8');
  const recovered = store.loadSession(cwd, reference.sessionId);
  store.appendSession(cwd, recovered.reference, createAppendRecordsOperation([{role: 'assistant', text: 'continued'}]), '2026-07-01T00:00:01.000Z');

  assert.deepEqual(store.loadSession(cwd, reference.sessionId).session.records, [
    {role: 'user', text: 'saved'},
    {role: 'assistant', text: 'continued'}
  ]);
});

test('createTranscriptStore lists valid JSONL sessions by updatedAt with bounded previews', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  const first = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'first'}]), '2026-07-01T00:00:00.000Z');
  const records = Array.from({length: 25}, (_value, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `record-${index} ${'x'.repeat(600)}`
  }));
  const second = store.createSession(cwd, createAppendRecordsOperation(records), '2026-07-01T00:00:01.000Z');

  store.appendSession(cwd, second, createSetTodoStateOperation({items: [], updatedAt: '2026-07-01T12:00:00.000Z'}), '2026-07-01T12:00:00.000Z');
  fs.writeFileSync(path.join(path.dirname(store.getSessionFilePath(cwd, first.sessionId)), 'broken.jsonl'), '{not-json', 'utf8');
  fs.writeFileSync(path.join(path.dirname(store.getSessionFilePath(cwd, first.sessionId)), 'legacy.json'), JSON.stringify({sessionId: 'legacy'}), 'utf8');

  const sessions = store.listSessions(cwd);

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].sessionId, second.sessionId);
  assert.equal(sessions[0].updatedAt, '2026-07-01T12:00:00.000Z');
  assert.equal(sessions[0].messageCount, 25);
  assert.equal(sessions[0].lastMessagePreview.startsWith('record-24 '), true);
  assert.equal(sessions[0].previewRecords.length, 20);
  assert.equal(sessions[0].previewRecords[0].text.startsWith('record-5 '), true);
  assert.equal(sessions[0].previewRecords[0].text.length, 500);
  assert.equal(sessions[1].sessionId, first.sessionId);
});
