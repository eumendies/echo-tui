const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createAppendRecordsOperation,
  createBatchOperation,
  createTruncateRecordsOperation,
  createSetChangeHistoryOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation
} = require('../../src/persistence/transcript-journal');
const {
  STORE_SCHEMA_VERSION,
  createTranscriptStore
} = require('../../src/persistence/transcript-store');
const {TranscriptContext} = require('../../src/app/state/transcript-context');
const {createOffloadedTextPreview, createToolResultStore} = require('../../src/tools/tool-result-offloading');

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

test('transcript journal round-trips edit_file display metadata without migrating apply_patch records', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/file-edit-project';
  const records = [
    {role: 'tool_call', text: '', toolCallId: 'edit-1', toolName: 'edit_file', argumentsText: '{"path":"a.txt"}'},
    {
      role: 'tool_result', text: 'Replaced 1 occurrence in a.txt.', toolCallId: 'edit-1', toolName: 'edit_file', ok: true,
      details: {kind: 'edit_file', display: {kind: 'edit_file', files: [{path: 'a.txt', kind: 'updated', lines: [{kind: 'added', text: 'new', postLine: 1}]}]}}
    },
    {
      role: 'tool_result', text: 'Applied patch.', toolCallId: 'patch-1', toolName: 'apply_patch', ok: true,
      details: {kind: 'apply_patch', display: {kind: 'apply_patch', files: [{path: 'old.txt', kind: 'updated', lines: [{kind: 'added', text: 'kept', postLine: 1}]}]}}
    }
  ];
  const reference = store.createSession(cwd, createAppendRecordsOperation(records), '2026-07-01T00:00:00.000Z');

  assert.deepEqual(store.loadSession(cwd, reference.sessionId).session.records, records);
});

test('transcript journal round-trips grep display metadata without rewriting result text', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/grep-project';
  const records = [
    {role: 'tool_call', text: '', toolCallId: 'grep-1', toolName: 'grep', argumentsText: '{"pattern":"needle"}'},
    {
      role: 'tool_result',
      text: 'src/a.ts:3:5: const needle = true;',
      toolCallId: 'grep-1',
      toolName: 'grep',
      ok: true,
      details: {
        kind: 'grep',
        exitCode: 0,
        truncated: false,
        display: {kind: 'grep', matches: [{path: 'src/a.ts', line: 3, column: 5, text: 'const needle = true;'}]}
      }
    }
  ];
  const reference = store.createSession(cwd, createAppendRecordsOperation(records), '2026-07-01T00:00:00.000Z');

  assert.deepEqual(store.loadSession(cwd, reference.sessionId).session.records, records);
});

test('transcript journal round-trips glob display metadata without rewriting result text', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/glob-project';
  const records = [
    {role: 'tool_call', text: '', toolCallId: 'glob-1', toolName: 'glob', argumentsText: '{"pattern":"**/*.ts"}'},
    {
      role: 'tool_result',
      text: 'src/a.ts\ntest/a.test.ts',
      toolCallId: 'glob-1',
      toolName: 'glob',
      ok: true,
      details: {
        kind: 'glob',
        exitCode: 0,
        truncated: false,
        display: {kind: 'glob', paths: ['src/a.ts', 'test/a.test.ts']}
      }
    }
  ];
  const reference = store.createSession(cwd, createAppendRecordsOperation(records), '2026-07-01T00:00:00.000Z');

  assert.deepEqual(store.loadSession(cwd, reference.sessionId).session.records, records);
});

test('transcript journal persists only bounded Bash, PDF, and shell offloading previews', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/offloading-project';
  const transcriptStore = createTranscriptStore({rootDir});
  const toolResultStore = createToolResultStore({cwd, rootDir});
  const completeText = `head-FULL_ARTIFACT_ONLY-${'x'.repeat(200)}-tail`;
  const preview = createOffloadedTextPreview({maxPreviewBytes: 40, strategy: 'tail', store: toolResultStore, text: completeText});
  const marker = preview.text.match(/\[tool result truncated: [^\]]+\]/)[0];
  const completePdfText = `--- pdf: doc.pdf\npages: 1\npages_with_text: 1\n\nextracted_text:\n\`\`\`\nPDF_ARTIFACT_ONLY_${'你'.repeat(100)}\n\`\`\``;
  const pdfPreview = createOffloadedTextPreview({maxPreviewBytes: 80, strategy: 'head', store: toolResultStore, text: completePdfText});
  const records = [
    {
      role: 'tool_result',
      text: preview.text,
      toolCallId: 'call-offload',
      toolName: 'run_bash_command',
      ok: true,
      details: {kind: 'bash', truncated: true}
    },
    {
      role: 'tool_result',
      text: pdfPreview.text,
      toolCallId: 'call-pdf-offload',
      toolName: 'read_files',
      ok: true,
      details: {kind: 'read_files', truncated: true}
    },
    {
      role: 'shell',
      text: `$ printf output\n\n${marker}\n\ntail`,
      command: 'printf output',
      exitCode: 0,
      includeInContext: true,
      output: `${marker}\n\ntail`,
      truncated: true
    }
  ];
  const reference = transcriptStore.createSession(cwd, createAppendRecordsOperation(records), '2026-07-01T00:00:00.000Z');
  const journal = fs.readFileSync(transcriptStore.getSessionFilePath(cwd, reference.sessionId), 'utf8');
  const loaded = transcriptStore.loadSession(cwd, reference.sessionId);

  assert.equal(journal.includes('FULL_ARTIFACT_ONLY'), false);
  assert.equal(journal.includes('PDF_ARTIFACT_ONLY'), false);
  assert.equal(fs.readFileSync(preview.offloadFilePath, 'utf8'), completeText);
  assert.equal(fs.readFileSync(pdfPreview.offloadFilePath, 'utf8'), completePdfText);
  assert.deepEqual(loaded.session.records, records);
});

test('transcript journal persists complete shell-local output beyond the shell context limit', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/shell-local-project';
  const transcriptStore = createTranscriptStore({rootDir});
  const output = `head-${'x'.repeat(70_000)}-tail`;
  const records = [{
    role: 'shell',
    text: `$ local-command [local]\n\n${output}`,
    command: 'local-command',
    exitCode: 0,
    includeInContext: false,
    output,
    truncated: false
  }];
  const reference = transcriptStore.createSession(cwd, createAppendRecordsOperation(records), '2026-07-01T00:00:00.000Z');
  const journal = fs.readFileSync(transcriptStore.getSessionFilePath(cwd, reference.sessionId), 'utf8');
  const loaded = transcriptStore.loadSession(cwd, reference.sessionId);

  assert.match(journal, /head-x+/);
  assert.match(journal, /-tail/);
  assert.deepEqual(loaded.session.records, records);
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

test('loadSessionReadOnly replays a torn tail without repairing the source journal', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/read-only-reference';
  const reference = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'saved'}]), '2026-07-01T00:00:00.000Z');
  const filePath = store.getSessionFilePath(cwd, reference.sessionId);
  fs.appendFileSync(filePath, '{"schemaVersion":1,"seq":2', 'utf8');
  const source = fs.readFileSync(filePath, 'utf8');

  const loaded = store.loadSessionReadOnly(cwd, reference.sessionId);

  assert.deepEqual(loaded.session.records, [{role: 'user', text: 'saved'}]);
  assert.equal(fs.readFileSync(filePath, 'utf8'), source);
});

test('createTranscriptStore preserves unknown transcript fields while validating required record identity', () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  const records = [
    {
      role: 'user',
      text: 'future user',
      futureRecordField: {enabled: true},
      metadata: {
        interactionMode: 'normal',
        futureMetadataField: 'preserved'
      }
    },
    {
      role: 'tool_result',
      text: 'done',
      toolCallId: 'call-1',
      toolName: 'future_tool',
      ok: true,
      details: {kind: 'generic', futureDetailField: 1}
    }
  ];
  const reference = store.createSession(cwd, createAppendRecordsOperation(records), '2026-07-01T00:00:00.000Z');

  assert.deepEqual(store.loadSession(cwd, reference.sessionId).session.records, records);

  store.appendSession(cwd, reference, createAppendRecordsOperation([{role: 'assistant', text: 'continued'}]), '2026-07-01T00:00:01.000Z');
  const filePath = store.getSessionFilePath(cwd, reference.sessionId);
  const lines = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
  const firstEntry = JSON.parse(lines[1]);
  firstEntry.records[1].toolCallId = '';
  lines[1] = JSON.stringify(firstEntry);
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

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

test('createTranscriptStore lists lightweight summaries and loads bounded previews on demand', async () => {
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

  const sessions = store.listSessionSummaries(cwd);
  const preview = await store.loadSessionPreview(cwd, second.sessionId);

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].sessionId, second.sessionId);
  assert.equal(sessions[0].updatedAt, '2026-07-01T12:00:00.000Z');
  assert.equal(sessions[0].messageCount, 25);
  assert.equal(sessions[0].title.startsWith('record-0 '), true);
  assert.equal('previewRecords' in sessions[0], false);
  assert.equal(preview.previewRecords.length, 20);
  assert.equal(preview.previewRecords[0].text.startsWith('record-5 '), true);
  assert.equal(preview.previewRecords[0].text.length, 500);
  assert.equal(sessions[1].sessionId, first.sessionId);
});

test('session summary title and on-demand preview come from replayed final records', async () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  let reference = store.createSession(cwd, createAppendRecordsOperation([
    {role: 'user', text: 'provider wrapper', displayText: 'Readable title'},
    {role: 'assistant', text: 'discarded answer'}
  ]), '2026-07-01T00:00:00.000Z');
  reference = store.appendSession(cwd, reference, createTruncateRecordsOperation(1));
  store.appendSession(cwd, reference, createAppendRecordsOperation([{role: 'assistant', text: 'final answer'}]));

  const [session] = store.listSessionSummaries(cwd);
  const preview = await store.loadSessionPreview(cwd, reference.sessionId);

  assert.equal(session.title, 'Readable title');
  assert.deepEqual(preview.previewRecords.map((record) => record.text), ['Readable title', 'final answer']);
  assert.equal(preview.previewRecords.some((record) => record.text.includes('discarded')), false);
});

test('createTranscriptStore hides provider-facing mode prompts from session summaries and previews', async () => {
  const rootDir = createTempRoot();
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/example/project';
  store.createSession(cwd, createAppendRecordsOperation([{
    role: 'user',
    text: '[Interaction Mode Transition]\n[Mode Instructions]\ninternal\n[User Request]\ninspect',
    displayText: 'inspect',
    metadata: {
      interactionMode: 'plan',
      modeTransition: {from: 'normal', to: 'plan'}
    }
  }]), '2026-07-01T00:00:00.000Z');

  const [session] = store.listSessionSummaries(cwd);
  const preview = await store.loadSessionPreview(cwd, session.sessionId);

  assert.equal(session.title, 'inspect');
  assert.deepEqual(preview.previewRecords, [{role: 'user', text: 'inspect'}]);
});

test('session index fast path sorts summaries without reading journal bodies', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/resume-index-fast';
  const store = createTranscriptStore({rootDir});
  const first = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'first'}]), '2026-07-01T00:00:00.000Z');
  const second = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'second'}]), '2026-07-02T00:00:00.000Z');

  assert.deepEqual(store.listSessionSummaries(cwd).map((session) => session.sessionId), [second.sessionId, first.sessionId]);
  const journalReads = [];
  const countingFs = Object.create(fs);
  countingFs.readFileSync = (filePath, encoding) => {
    if (String(filePath).endsWith('.jsonl')) journalReads.push(filePath);
    return fs.readFileSync(filePath, encoding);
  };
  const reopened = createTranscriptStore({rootDir, fsImpl: countingFs});
  const sessions = reopened.listSessionSummaries(cwd);

  assert.deepEqual(sessions.map((session) => session.messageCount), [1, 1]);
  assert.deepEqual(journalReads, []);
  assert.equal(fs.existsSync(reopened.getSessionIndexFilePath(cwd)), true);
});

test('session index rebuilds only stale journals and removes invalid or orphan entries', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/resume-index-reconcile';
  const store = createTranscriptStore({rootDir});
  const first = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'first'}]), '2026-07-01T00:00:00.000Z');
  const second = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'second'}]), '2026-07-02T00:00:00.000Z');
  store.listSessionSummaries(cwd);
  store.appendSession(cwd, first, createAppendRecordsOperation([{role: 'assistant', text: 'changed'}]), '2026-07-03T00:00:00.000Z');
  const sessionsDir = path.dirname(store.getSessionFilePath(cwd, first.sessionId));
  fs.writeFileSync(path.join(sessionsDir, 'broken.jsonl'), '{bad json', 'utf8');
  const persisted = JSON.parse(fs.readFileSync(store.getSessionIndexFilePath(cwd), 'utf8'));
  persisted.sessions.push({
    sessionId: 'orphan', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', cwd,
    messageCount: 1, title: 'orphan', fingerprint: {size: 1, mtimeMs: 1}
  });
  fs.writeFileSync(store.getSessionIndexFilePath(cwd), JSON.stringify(persisted), 'utf8');

  const journalReads = [];
  const countingFs = Object.create(fs);
  countingFs.readFileSync = (filePath, encoding) => {
    if (String(filePath).endsWith('.jsonl')) journalReads.push(path.basename(filePath));
    return fs.readFileSync(filePath, encoding);
  };
  const reopened = createTranscriptStore({rootDir, fsImpl: countingFs});
  const sessions = reopened.listSessionSummaries(cwd);
  const repaired = JSON.parse(fs.readFileSync(reopened.getSessionIndexFilePath(cwd), 'utf8'));

  assert.deepEqual(sessions.map((session) => session.sessionId), [first.sessionId, second.sessionId]);
  assert.deepEqual(journalReads.sort(), [`${first.sessionId}.jsonl`, 'broken.jsonl'].sort());
  assert.equal(sessions[0].messageCount, 2);
  assert.deepEqual(repaired.sessions.map((session) => session.sessionId), [first.sessionId, second.sessionId]);
  assert.deepEqual(fs.readdirSync(sessionsDir).filter((name) => name.includes('index.json.tmp-')), []);
});

test('session index recovers from invalid index and ignores legacy JSON sessions', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/resume-index-invalid';
  const store = createTranscriptStore({rootDir});
  const reference = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'saved'}]), '2026-07-01T00:00:00.000Z');
  const sessionsDir = path.dirname(store.getSessionFilePath(cwd, reference.sessionId));
  fs.writeFileSync(store.getSessionIndexFilePath(cwd), JSON.stringify({schemaVersion: 1, sessions: []}), 'utf8');
  fs.writeFileSync(path.join(sessionsDir, 'legacy.json'), JSON.stringify({sessionId: 'legacy'}), 'utf8');

  assert.deepEqual(store.listSessionSummaries(cwd).map((session) => session.sessionId), [reference.sessionId]);
  assert.equal(JSON.parse(fs.readFileSync(store.getSessionIndexFilePath(cwd), 'utf8')).schemaVersion, 1);
});

test('TranscriptContext maintains session index for append, state update, truncate, load, and fork', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/resume-index-context';
  const store = createTranscriptStore({rootDir});
  const context = new TranscriptContext(store, () => cwd);

  context.appendRecord({role: 'user', text: 'hello'});
  const sourceSessionId = context.currentSessionId;
  assert.equal(store.listSessionSummaries(cwd)[0].messageCount, 1);
  context.appendRecord({role: 'assistant', text: 'world'});
  assert.equal(store.listSessionSummaries(cwd)[0].messageCount, 2);
  context.updateTodoState({items: [], updatedAt: '2026-07-01T00:00:00.000Z'});
  assert.equal(store.listSessionSummaries(cwd)[0].messageCount, 2);
  context.restoreToBoundary(1, undefined);
  assert.equal(store.listSessionSummaries(cwd)[0].messageCount, 1);
  assert.ok(context.loadSession(sourceSessionId));
  const fork = context.forkSession();
  assert.equal(fork.ok, true);
  assert.deepEqual(store.listSessionSummaries(cwd).map((session) => session.messageCount), [1, 1]);
});

test('session index write failure does not roll back a persisted journal', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/resume-index-write-failure';
  const store = createTranscriptStore({rootDir});
  const context = new TranscriptContext({
    ...store,
    updateSessionIndex() {
      throw new Error('index unavailable');
    }
  }, () => cwd);

  context.appendRecord({role: 'user', text: 'persist me'});

  assert.deepEqual(store.loadSession(cwd, context.currentSessionId).session.records, [{role: 'user', text: 'persist me'}]);
  assert.deepEqual(store.listSessionSummaries(cwd).map((session) => session.messageCount), [1]);
});

test('loading a session does not unconditionally rewrite the complete session index', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/resume-load-no-index-write';
  const store = createTranscriptStore({rootDir});
  const reference = store.createSession(cwd, createAppendRecordsOperation([{role: 'user', text: 'saved'}]), '2026-07-01T00:00:00.000Z');
  let indexUpdates = 0;
  const context = new TranscriptContext({
    ...store,
    updateSessionIndex() {
      indexUpdates += 1;
    }
  }, () => cwd);

  assert.ok(context.loadSession(reference.sessionId));
  assert.equal(indexUpdates, 0);
});

test('session index removes its temporary file when atomic rename fails', () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/resume-index-rename-failure';
  const store = createTranscriptStore({rootDir});
  const records = [{role: 'user', text: 'saved'}];
  const reference = store.createSession(cwd, createAppendRecordsOperation(records), '2026-07-01T00:00:00.000Z');
  const failingFs = Object.create(fs);
  failingFs.renameSync = (oldPath, newPath) => {
    if (String(newPath).endsWith('index.json')) {
      throw new Error('rename failed');
    }
    return fs.renameSync(oldPath, newPath);
  };
  const failingStore = createTranscriptStore({rootDir, fsImpl: failingFs});

  assert.throws(() => failingStore.updateSessionIndex(cwd, reference, records), /rename failed/);
  assert.deepEqual(
    fs.readdirSync(path.dirname(store.getSessionFilePath(cwd, reference.sessionId))).filter((name) => name.includes('index.json.tmp-')),
    []
  );
});

test('loadSessionPreview asynchronously replays final records without repairing the journal', async () => {
  const rootDir = createTempRoot();
  const cwd = '/tmp/example/resume-preview';
  const store = createTranscriptStore({rootDir});
  let reference = store.createSession(cwd, createAppendRecordsOperation([
    {role: 'user', text: 'kept'},
    {role: 'assistant', text: 'discarded'}
  ]), '2026-07-01T00:00:00.000Z');
  reference = store.appendSession(cwd, reference, createTruncateRecordsOperation(1), '2026-07-01T00:00:01.000Z');
  store.appendSession(cwd, reference, createAppendRecordsOperation([{role: 'assistant', text: 'final'}]), '2026-07-01T00:00:02.000Z');
  const filePath = store.getSessionFilePath(cwd, reference.sessionId);
  fs.appendFileSync(filePath, '{"schemaVersion":1,"seq":4', 'utf8');
  const before = fs.readFileSync(filePath, 'utf8');

  const preview = await store.loadSessionPreview(cwd, reference.sessionId);

  assert.deepEqual(preview.previewRecords.map((record) => record.text), ['kept', 'final']);
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
});
