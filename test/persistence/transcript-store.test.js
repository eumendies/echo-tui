const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  STORE_SCHEMA_VERSION,
  createTranscriptStore
} = require('../../src/persistence/transcript-store');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tui-store-'));
}

test('createTranscriptStore saves sessions under ~/.echo-style project partitions', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const session = store.createSession(cwd, [{ role: 'user', text: 'hello' }], '2026-05-19T10:00:00.000Z');

  const saved = store.saveSession(cwd, session);
  const projectDir = store.getProjectDir(cwd);
  const projectMetadata = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));

  assert.equal(projectDir.startsWith(path.join(rootDir, 'projects')), true);
  assert.deepEqual(projectMetadata, store.getProjectMetadata(cwd));
  assert.deepEqual(saved.records, [{ role: 'user', text: 'hello' }]);
  assert.equal(fs.existsSync(store.getSessionFilePath(cwd, session.sessionId)), true);
  assert.equal(fs.existsSync(path.join(cwd, '.echo_tui')), false);
});

test('createTranscriptStore loads saved sessions and keeps transcript-only schema', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const session = store.createSession(cwd, [
    { role: 'user', text: 'hello', createdAt: '2026-05-19T10:00:00.000Z' },
    { role: 'assistant', text: 'world', createdAt: '2026-05-19T10:00:01.000Z' }
  ], '2026-05-19T10:00:00.000Z');

  store.saveSession(cwd, session);
  const loaded = store.loadSession(cwd, session.sessionId);

  assert.deepEqual(loaded, {
    schemaVersion: STORE_SCHEMA_VERSION,
    sessionId: session.sessionId,
    cwd,
    createdAt: '2026-05-19T10:00:00.000Z',
    updatedAt: '2026-05-19T10:00:00.000Z',
    records: [
      { role: 'user', text: 'hello', createdAt: '2026-05-19T10:00:00.000Z' },
      { role: 'assistant', text: 'world', createdAt: '2026-05-19T10:00:01.000Z' }
    ],
    todoState: {items: [], updatedAt: ''}
  });
  assert.equal(JSON.stringify(loaded).includes('inputHistory'), false);
});

test('createTranscriptStore persists reasoning summary records', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const session = store.createSession(cwd, [
    { role: 'user', text: 'hello' },
    { role: 'reasoning_summary', text: 'I will inspect first.' },
    { role: 'assistant', text: 'world' }
  ], '2026-05-19T10:00:00.000Z');

  store.saveSession(cwd, session);
  const loaded = store.loadSession(cwd, session.sessionId);

  assert.deepEqual(loaded.records, [
    { role: 'user', text: 'hello' },
    { role: 'reasoning_summary', text: 'I will inspect first.' },
    { role: 'assistant', text: 'world' }
  ]);
});

test('createTranscriptStore persists and reloads compaction metadata while keeping full records', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const session = store.createSession(cwd, [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'world' }
  ], '2026-05-19T10:00:00.000Z');

  store.saveSession(cwd, {
    ...session,
    compaction: {
      summaryText: '结构化摘要',
      activeStartIndex: 1,
      createdAt: '2026-05-19T10:05:00.000Z'
    }
  });
  const loaded = store.loadSession(cwd, session.sessionId);

  assert.deepEqual(loaded.compaction, {
    summaryText: '结构化摘要',
    activeStartIndex: 1,
    createdAt: '2026-05-19T10:05:00.000Z'
  });
  // 完整 records 不因压缩被删除。
  assert.deepEqual(loaded.records, [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'world' }
  ]);
});

test('createTranscriptStore persists and reloads change history metadata', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const session = store.createSession(cwd, [{ role: 'user', text: 'hello' }], '2026-05-19T10:00:00.000Z');
  const changeHistory = [
    {
      id: 'checkpoint-1',
      createdAt: '2026-05-19T10:01:00.000Z',
      cwd,
      transcriptStartIndex: 0,
      status: 'ready',
      files: [{
        path: '/tmp/example/project/file.txt',
        snapshot: {exists: true, content: 'before\n', mode: 0o644},
        state: 'updated'
      }]
    },
    {
      id: 'invalid-1',
      createdAt: '2026-05-19T10:02:00.000Z',
      cwd,
      transcriptStartIndex: 1,
      status: 'invalid',
      invalidReason: '写入型 bash 不可追踪',
      files: []
    }
  ];

  store.saveSession(cwd, {
    ...session,
    changeHistory
  });
  const loaded = store.loadSession(cwd, session.sessionId);

  assert.deepEqual(loaded.changeHistory, changeHistory);
});

test('createTranscriptStore persists and clones todo state metadata', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const session = store.createSession(cwd, [{ role: 'user', text: 'hello' }], '2026-05-19T10:00:00.000Z');
  const todoState = {
    updatedAt: '2026-05-19T10:01:00.000Z',
    items: [
      {id: 'todo_1', text: 'first', status: 'open'},
      {id: 'todo_2', text: 'second', status: 'completed'}
    ]
  };

  const saved = store.saveSession(cwd, {
    ...session,
    todoState
  });

  todoState.items[0].text = 'mutated';
  saved.todoState.items[1].text = 'also mutated';

  const loaded = store.loadSession(cwd, session.sessionId);

  assert.deepEqual(loaded.todoState, {
    updatedAt: '2026-05-19T10:01:00.000Z',
    items: [
      {id: 'todo_1', text: 'first', status: 'open'},
      {id: 'todo_2', text: 'second', status: 'completed'}
    ]
  });
});

test('createTranscriptStore falls back to empty todo state for legacy or invalid todo data', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const session = store.createSession(cwd, [{ role: 'user', text: 'hello' }], '2026-05-19T10:00:00.000Z');

  store.saveSession(cwd, session);
  assert.deepEqual(store.loadSession(cwd, session.sessionId).todoState, {items: [], updatedAt: ''});

  const filePath = store.getSessionFilePath(cwd, session.sessionId);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  raw.todoState = {items: [{id: '', text: 'bad', status: 'open'}], updatedAt: 'bad'};
  fs.writeFileSync(filePath, JSON.stringify(raw), 'utf8');

  assert.deepEqual(store.loadSession(cwd, session.sessionId).todoState, {items: [], updatedAt: ''});
});

test('createTranscriptStore overwrites sessions atomically without leaving tmp files behind', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const session = store.createSession(cwd, [{ role: 'user', text: 'hello' }], '2026-05-19T10:00:00.000Z');

  store.saveSession(cwd, session);
  store.saveSession(cwd, {
    ...session,
    updatedAt: '2026-05-19T10:00:05.000Z',
    records: [...session.records, { role: 'assistant', text: 'world' }]
  });

  const sessionsDir = path.dirname(store.getSessionFilePath(cwd, session.sessionId));
  assert.deepEqual(fs.readdirSync(sessionsDir).filter((name) => name.includes('.tmp-')), []);

  const loaded = store.loadSession(cwd, session.sessionId);
  assert.deepEqual(loaded.records, [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'world' }
  ]);
});

test('createTranscriptStore lists sessions by updatedAt desc and skips invalid files', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const first = store.createSession(cwd, [{ role: 'user', text: 'first' }], '2026-05-19T10:00:00.000Z');
  const second = store.createSession(cwd, [
    { role: 'user', text: 'first question' },
    { role: 'tool_call', text: 'run search' },
    { role: 'tool_result', text: 'search result' },
    { role: 'assistant', text: 'second message' }
  ], '2026-05-19T10:00:01.000Z');

  store.saveSession(cwd, first);
  store.saveSession(cwd, {
    ...second,
    updatedAt: '2026-05-19T12:00:00.000Z'
  });

  const sessionsDir = path.dirname(store.getSessionFilePath(cwd, first.sessionId));
  fs.writeFileSync(path.join(sessionsDir, 'broken.json'), '{not-json');
  fs.writeFileSync(path.join(sessionsDir, 'wrong-schema.json'), JSON.stringify({
    schemaVersion: 999,
    cwd,
    sessionId: 'wrong',
    createdAt: '2026-05-19T10:00:00.000Z',
    updatedAt: '2026-05-19T10:00:00.000Z',
    records: []
  }));

  assert.deepEqual(store.listSessions(cwd).map((session) => ({
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    lastMessagePreview: session.lastMessagePreview,
    previewRecords: session.previewRecords
  })), [
    {
      sessionId: second.sessionId,
      updatedAt: '2026-05-19T12:00:00.000Z',
      messageCount: 4,
      lastMessagePreview: 'second message',
      previewRecords: [
        { role: 'user', text: 'first question' },
        { role: 'tool_call', text: 'run search' },
        { role: 'tool_result', text: 'search result' },
        { role: 'assistant', text: 'second message' }
      ]
    },
    {
      sessionId: first.sessionId,
      updatedAt: '2026-05-19T10:00:00.000Z',
      messageCount: 1,
      lastMessagePreview: 'first',
      previewRecords: [{ role: 'user', text: 'first' }]
    }
  ]);
});

test('createTranscriptStore derives bounded resume preview with more records and longer text', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const records = Array.from({length: 25}, (_value, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `record-${index} ` + 'x'.repeat(600)
  }));
  const session = store.createSession(cwd, records, '2026-05-19T10:00:00.000Z');

  store.saveSession(cwd, session);
  const [metadata] = store.listSessions(cwd);

  assert.equal(metadata.previewRecords.length, 20);
  assert.equal(metadata.previewRecords[0].text.startsWith('record-5 '), true);
  assert.equal(metadata.previewRecords.at(-1).text.startsWith('record-24 '), true);
  assert.equal(metadata.previewRecords[0].text.length, 500);
});

test('createTranscriptStore returns null when session file is missing or cwd mismatches', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({ rootDir });
  const cwd = '/tmp/example/project';
  const otherCwd = '/tmp/example/other';
  const session = store.createSession(cwd, [{ role: 'user', text: 'hello' }], '2026-05-19T10:00:00.000Z');

  store.saveSession(cwd, session);

  assert.equal(store.loadSession(cwd, 'missing'), null);
  assert.equal(store.loadSession(otherCwd, session.sessionId), null);
});
