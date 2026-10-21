const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {AppContext} = require('../../src/app/state/app-context');
const {SubagentViewController} = require('../../src/app/subagent-view-controller');
const {createTranscriptCommandPort} = require('../../src/app/command/transcript-command-ports');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {createTranscriptStore} = require('../../src/persistence/transcript-store');
const {
  createAppendRecordsOperation,
  createBatchOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation
} = require('../../src/persistence/transcript-journal');
const {createEditFileToolHandler} = require('../../src/tools/edit-file-tool-handler');

const TIMESTAMP = '2026-07-01T00:00:00.000Z';

function compaction(activeStartIndex, summaryText = `summary at ${activeStartIndex}`) {
  return {activeStartIndex, summaryText, createdAt: TIMESTAMP};
}

function createHarness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-compacted-residency-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const cwd = path.join(directory, 'workspace');
  const rootDir = path.join(directory, 'store');
  const configPath = path.join(directory, 'config.json');
  fs.mkdirSync(cwd);
  fs.writeFileSync(configPath, '{}');
  const io = {journalReads: 0, readOnlyLoads: 0, appendAttempts: 0, failAppend: false, readFailure: null};
  // 保留真实文件系统与 store；只在既有 I/O 边界计数和注入可恢复故障。
  const fsImpl = {
    ...fs,
    readFileSync(filePath, ...args) {
      if (String(filePath).endsWith('.jsonl')) io.journalReads += 1;
      return fs.readFileSync(filePath, ...args);
    },
    appendFileSync(filePath, ...args) {
      io.appendAttempts += 1;
      if (io.failAppend) throw new Error('controlled journal append failure');
      return fs.appendFileSync(filePath, ...args);
    }
  };
  const store = createTranscriptStore({rootDir, fsImpl});
  const readOnly = store.loadSessionReadOnly;
  store.loadSessionReadOnly = (...args) => {
    io.readOnlyLoads += 1;
    if (io.readFailure === 'missing') return null;
    if (io.readFailure === 'throw') throw new Error('controlled full-history read failure');
    const loaded = readOnly(...args);
    if (io.readFailure === 'stale' && loaded) loaded.reference.sequence -= 1;
    return loaded;
  };
  const userConfigContext = new UserConfigContext({configPath});
  const createApp = (transcriptStore = store) => new AppContext(
    {getSize: () => ({columns: 100, rows: 30})},
    transcriptStore, cwd, process.version, undefined, undefined, userConfigContext
  );
  const app = createApp();
  const rendered = [];
  let recoveries = 0;
  const port = createTranscriptCommandPort({
    appContext: app,
    renderRecords: (records) => rendered.push(...records),
    renderResizeRecovery: () => { recoveries += 1; }
  });
  return {
    app, context: app.transcriptContext, store, cwd, rootDir, io, createApp, port, rendered,
    get recoveries() { return recoveries; }
  };
}

function journalText(harness, sessionId = harness.context.currentSessionId) {
  return fs.readFileSync(harness.store.getSessionFilePath(harness.cwd, sessionId), 'utf8');
}

function journalEntries(harness) {
  return journalText(harness).trim().split('\n').map((line) => JSON.parse(line));
}

function residentState(context) {
  return structuredClone({
    records: context.getResidentRecords(),
    baseRecordIndex: context.baseRecordIndex,
    total: context.getRecordCount(),
    session: context.currentSession,
    sessionId: context.currentSessionId,
    compaction: context.compaction,
    changeHistory: context.changeHistory,
    todoState: context.todoState,
    pendingChangeHistory: context.pendingChangeHistory,
    pendingTodoState: context.pendingTodoState
  });
}

function image(label) {
  return {
    kind: 'image', mediaType: 'image/png', path: `/images/${label}.png`,
    dataBase64: Buffer.from(`${label}:${'x'.repeat(4096)}`).toString('base64'), sizeBytes: 4096
  };
}

function richRecords() {
  return [
    {role: 'system', text: 'initial system'},
    {role: 'user', text: 'expanded first request', displayText: '@first.png', createdAt: TIMESTAMP,
      attachments: [image('cold')], metadata: {interactionMode: 'plan'}},
    {role: 'extension', text: '', extension: {kind: 'openai_reasoning',
      item: {type: 'reasoning', encrypted_content: 'private-cold', summary: [{type: 'summary_text', text: 'cold reasoning'}]}}},
    {role: 'assistant', text: 'first answer', createdAt: TIMESTAMP},
    {role: 'extension', text: '', extension: {kind: 'openai_chat_reasoning', reasoningContent: 'private-chat'}},
    {role: 'extension', text: '', extension: {kind: 'anthropic_thinking',
      block: {type: 'thinking', thinking: 'private-thinking', signature: 'signature'}}},
    {role: 'local_notice', text: 'cold local notice'},
    {role: 'user', text: 'active request', createdAt: TIMESTAMP, attachments: [image('active')],
      metadata: {interactionMode: 'normal', conversationReference: {
        projectionMode: 'full', sourcePath: '/source.jsonl', sourceSessionId: 'source', title: 'reference'
      }}},
    {role: 'extension', text: '', extension: {kind: 'unknown', name: 'future-provider',
      payload: {nested: {value: 'keep active'}}}},
    {role: 'tool_call', text: '', toolCallId: 'read-1', toolName: 'read_files', argumentsText: '{}'},
    {role: 'tool_result', text: 'image result', toolCallId: 'read-1', toolName: 'read_files', ok: true,
      attachments: [image('tool')], details: {kind: 'read_files', truncated: false}},
    {role: 'assistant', text: 'active answer', createdAt: TIMESTAMP}
  ];
}

function editFile(app, cwd, oldText, newText) {
  const args = {path: 'file.txt', old_string: oldText, new_string: newText};
  const result = createEditFileToolHandler({cwd}).execute(args,
    {callId: 'controlled-edit', toolName: 'edit_file', argumentsText: JSON.stringify(args)},
    {changeRecorder: app.changeHistoryContext.createRecorder()});
  assert.equal(result.ok, true, result.text);
}

test('repeated compaction keeps a fixed resident suffix, logical totals and the first title without daily journal replay', (t) => {
  const h = createHarness(t);
  const {context, io} = h;
  context.appendRecord({role: 'system', text: 'before the first user'});
  assert.equal(context.listSessionSummaries()[0].title, '未命名对话');
  context.appendRecord({role: 'user', text: 'expanded title', displayText: '  Original\n  first title  '});
  const resident = context.getResidentRecords();
  let logicalTotal = 2;

  for (let round = 0; round < 24; round += 1) {
    const batch = Array.from({length: 6}, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant', text: `${round}:${index}:${'x'.repeat(2048)}`
    }));
    context.appendRecords(batch);
    logicalTotal += batch.length;
    const boundary = logicalTotal - 2;
    const notice = context.applyCompaction(compaction(boundary));
    logicalTotal += 1;

    assert.strictEqual(context.getResidentRecords(), resident);
    assert.equal(context.baseRecordIndex, boundary);
    assert.equal(context.getRecordCount(), logicalTotal);
    assert.deepEqual(resident, [batch[4], batch[5], notice]);
    assert.ok(JSON.stringify(resident).length < 5000);
    const [summary] = context.listSessionSummaries();
    assert.equal(summary.messageCount, logicalTotal);
    assert.equal(summary.title, 'Original first title');
    context.persistCurrentSession();
  }

  assert.equal(logicalTotal, 170);
  assert.equal(resident.length, 3);
  assert.equal(io.readOnlyLoads, 0);
  assert.equal(io.journalReads, 0);
  assert.ok(journalText(h).length > 290000);
  const complete = context.getCompleteRecords();
  assert.equal(io.readOnlyLoads, 1);
  assert.equal(complete.length, logicalTotal);
  assert.equal(complete[1].displayText, '  Original\n  first title  ');
  assert.deepEqual(complete.slice(context.baseRecordIndex), resident);
  assert.strictEqual(context.getResidentRecords(), resident);
});

test('failed compaction leaves resident records, durable journal, installed state and every pending state unchanged', (t) => {
  const h = createHarness(t);
  const {context, io} = h;
  context.appendRecords(richRecords());
  context.applyCompaction(compaction(7));
  context.setChangeHistory([{id: 'pending-checkpoint', createdAt: TIMESTAMP, cwd: h.cwd,
    transcriptStartIndex: 12, status: 'ready', files: []}]);
  context.setTodoState({updatedAt: TIMESTAMP, items: [{id: 'todo_1', text: 'pending todo', status: 'open'}]});
  const before = residentState(context);
  const bytes = journalText(h);
  const resident = context.getResidentRecords();
  const pendingHistory = context.pendingChangeHistory;
  const pendingTodo = context.pendingTodoState;
  io.failAppend = true;

  assert.throws(() => context.applyCompaction(compaction(12)), /controlled journal append failure/);
  assert.deepEqual(residentState(context), before);
  assert.strictEqual(context.getResidentRecords(), resident);
  assert.strictEqual(context.pendingChangeHistory, pendingHistory);
  assert.strictEqual(context.pendingTodoState, pendingTodo);
  assert.equal(journalText(h), bytes);
  assert.equal(io.readOnlyLoads, 0);

  io.failAppend = false;
  const next = compaction(12);
  const notice = context.applyCompaction(next);
  assert.deepEqual(context.getResidentRecords(), [before.records.at(-1), notice]);
  assert.equal(context.getRecordCount(), before.total + 1);
  assert.deepEqual(context.compaction, next);
  assert.equal(context.currentSession.sequence, before.session.sequence + 1);
  assert.equal(context.pendingChangeHistory, undefined);
  assert.equal(context.pendingTodoState, undefined);
  const entry = journalEntries(h).at(-1);
  assert.equal(entry.op, 'batch');
  assert.deepEqual(entry.operations.map((operation) => operation.op), [
    'append_records', 'set_change_history', 'set_compaction', 'set_todo_state'
  ]);
  assert.deepEqual(entry.operations[0].records, [notice]);
  const complete = context.getCompleteRecords();
  assert.equal(complete.filter((record) => record.role === 'compaction_notice').length, 2);
  const saved = h.store.loadSessionReadOnly(h.cwd, context.currentSessionId).session;
  assert.deepEqual(saved.changeHistory, before.changeHistory);
  assert.deepEqual(saved.todoState, before.todoState);
  assert.deepEqual(saved.compaction, next);
});

test('failed normal append after compaction preserves offsets and pending state until a successful retry', (t) => {
  const h = createHarness(t);
  const {context, io} = h;
  context.appendRecords(richRecords());
  context.applyCompaction(compaction(7));
  context.setTodoState({updatedAt: TIMESTAMP, items: [{id: 'todo_1', text: 'retry', status: 'open'}]});
  const before = residentState(context);
  const bytes = journalText(h);
  const appended = {role: 'assistant', text: 'retry exactly once'};
  io.failAppend = true;
  assert.throws(() => context.appendRecord(appended), /controlled journal append failure/);
  assert.deepEqual(residentState(context), before);
  assert.equal(journalText(h), bytes);
  io.failAppend = false;
  context.appendRecord(appended);
  assert.equal(context.baseRecordIndex, 7);
  assert.equal(context.getRecordCount(), before.total + 1);
  assert.equal(context.getResidentRecords().length, before.records.length + 1);
  assert.strictEqual(context.getResidentRecords().at(-1), appended);
  assert.equal(context.pendingTodoState, undefined);
  assert.equal(io.journalReads, 0);
  assert.equal(io.readOnlyLoads, 0);
  assert.equal(context.getCompleteRecords().filter((record) => record.text === appended.text).length, 1);
});

test('loading an older full-record journal returns success and installs only its active suffix while preserving historical attachments and extensions', (t) => {
  const h = createHarness(t);
  const records = richRecords();
  const state = compaction(7);
  // 旧版本把完整记录与压缩状态写在 journal 中，但没有释放内存前缀。
  const reference = h.store.createSession(h.cwd, createBatchOperation([
    createAppendRecordsOperation(records), createSetCompactionOperation(state)
  ]));
  const loaded = h.app.loadTranscriptSession(reference.sessionId);
  assert.equal(loaded, true);
  assert.equal(h.context.baseRecordIndex, 7);
  assert.equal(h.context.getRecordCount(), records.length);
  assert.deepEqual(h.context.getResidentRecords(), records.slice(7));

  const resident = h.context.getResidentRecords();
  const complete = h.context.getCompleteRecords();
  assert.deepEqual(complete, records);
  assert.strictEqual(h.context.getResidentRecords(), resident);
  assert.equal(h.context.getResidentRecords().length, 5);
  complete[1].attachments[0].dataBase64 = 'mutated cold history';
  complete[8].extension.payload.nested.value = 'mutated complete snapshot';
  assert.deepEqual(h.context.getCompleteRecords(), records);
  assert.deepEqual(resident, records.slice(7));

  const reads = h.io.journalReads;
  const readOnlyLoads = h.io.readOnlyLoads;
  h.context.appendRecord({role: 'user', text: 'later title must not replace original'});
  const summary = h.context.listSessionSummaries()[0];
  assert.equal(summary.title, '@first.png');
  assert.equal(summary.messageCount, records.length + 1);
  assert.equal(h.io.journalReads, reads);
  assert.equal(h.io.readOnlyLoads, readOnlyLoads);
});

test('forking through the real command port copies complete history and remains independent after deleting the source', (t) => {
  const h = createHarness(t);
  h.context.appendRecords(richRecords());
  h.app.beginChangeCheckpoint();
  h.context.appendRecord({role: 'assistant', text: 'checkpoint reply'});
  h.app.finalizeChangeCheckpoint();
  h.context.updateTodoState({updatedAt: TIMESTAMP, items: [{id: 'todo_1', text: 'branch todo', status: 'open'}]});
  h.context.applyCompaction(compaction(7));
  const sourceId = h.context.currentSessionId;
  const before = h.store.loadSessionReadOnly(h.cwd, sourceId).session;
  const resident = h.context.getResidentRecords();
  const sourceBytes = journalText(h);
  const reads = h.io.readOnlyLoads;
  const fork = h.port.forkSession();
  assert.equal(fork.ok, true);
  assert.equal(fork.sourceSessionId, sourceId);
  assert.notEqual(fork.sessionId, sourceId);
  assert.equal(h.io.readOnlyLoads, reads + 1);
  assert.strictEqual(h.context.getResidentRecords(), resident);
  assert.equal(h.context.baseRecordIndex, 7);
  assert.equal(journalText(h, sourceId), sourceBytes);
  const forkSaved = h.store.loadSessionReadOnly(h.cwd, fork.sessionId).session;
  assert.deepEqual(forkSaved.records, before.records);
  assert.deepEqual(forkSaved.changeHistory, before.changeHistory);
  assert.deepEqual(forkSaved.todoState, before.todoState);
  assert.deepEqual(forkSaved.compaction, before.compaction);

  assert.deepEqual(h.port.deleteSession(sourceId), {ok: true, sessionId: sourceId});
  assert.equal(fs.existsSync(h.store.getSessionFilePath(h.cwd, sourceId)), false);
  const appended = {role: 'assistant', text: 'fork-only continuation'};
  h.port.append(appended);
  assert.deepEqual(h.rendered, [appended]);
  const resumed = h.createApp(createTranscriptStore({rootDir: h.rootDir}));
  const loaded = resumed.loadTranscriptSession(fork.sessionId);
  assert.equal(loaded, true);
  assert.deepEqual(resumed.transcriptContext.getResidentRecords(), [...before.records.slice(7), appended]);
  assert.deepEqual(resumed.transcriptContext.getCompleteRecords(), [...before.records, appended]);
  assert.equal(resumed.transcriptContext.getResidentRecords().length, before.records.length - 7 + 1);
  assert.deepEqual(resumed.changeHistoryContext.getHistory(), before.changeHistory);
});

test('clear through the real command port resets the resident offset, logical count and cached first title without deleting old history', (t) => {
  const h = createHarness(t);
  h.context.appendRecords(richRecords());
  h.context.applyCompaction(compaction(7));
  const oldId = h.context.currentSessionId;
  const oldBytes = journalText(h);
  const oldResident = h.context.getResidentRecords();
  h.app.setContextUsage({usedTokens: 42, contextWindow: 1000, source: 'provider'});
  h.port.clear();
  assert.strictEqual(h.context.getResidentRecords(), oldResident);
  assert.deepEqual(oldResident, []);
  assert.equal(h.context.baseRecordIndex, 0);
  assert.equal(h.context.getRecordCount(), 0);
  assert.equal(h.context.currentSessionId, null);
  assert.equal(h.context.currentSession, null);
  assert.equal(h.context.compaction, null);
  assert.deepEqual(h.context.changeHistory, []);
  assert.deepEqual(h.context.todoState, {items: [], updatedAt: ''});
  assert.equal(h.app.getContextUsage(), null);
  assert.equal(h.recoveries, 1);
  assert.strictEqual(h.context.getCompleteRecords(), oldResident);
  assert.equal(h.io.readOnlyLoads, 0);

  h.port.append({role: 'user', text: 'new first title'});
  assert.notEqual(h.context.currentSessionId, oldId);
  assert.equal(h.context.getRecordCount(), 1);
  const summary = h.context.listSessionSummaries().find((entry) => entry.sessionId === h.context.currentSessionId);
  assert.equal(summary.title, 'new first title');
  assert.equal(summary.messageCount, 1);
  assert.equal(journalText(h, oldId), oldBytes);
});

test('the real copy port includes cold user and assistant messages with original logical IDs and ordering', (t) => {
  const h = createHarness(t);
  const records = richRecords();
  h.context.appendRecords(records);
  const firstNotice = h.context.applyCompaction(compaction(7));
  const lateUser = {role: 'user', text: 'last question', createdAt: TIMESTAMP};
  const lateAssistant = {role: 'assistant', text: 'last answer', createdAt: TIMESTAMP};
  h.context.appendRecords([lateUser, lateAssistant]);
  h.context.applyCompaction(compaction(14));
  const resident = h.context.getResidentRecords();
  const before = residentState(h.context);
  const copies = h.port.listCopyableRecords();
  assert.deepEqual(copies, [
    {id: 'message-1', role: 'user', text: records[1].text, createdAt: TIMESTAMP},
    {id: 'message-3', role: 'assistant', text: records[3].text, createdAt: TIMESTAMP},
    {id: 'message-7', role: 'user', text: records[7].text, createdAt: TIMESTAMP},
    {id: 'message-11', role: 'assistant', text: records[11].text, createdAt: TIMESTAMP},
    {id: 'message-13', role: 'user', text: lateUser.text, createdAt: TIMESTAMP},
    {id: 'message-14', role: 'assistant', text: lateAssistant.text, createdAt: TIMESTAMP}
  ]);
  assert.equal(firstNotice.role, 'compaction_notice');
  assert.equal(h.io.readOnlyLoads, 1);
  assert.deepEqual(residentState(h.context), before);
  assert.strictEqual(h.context.getResidentRecords(), resident);
  assert.equal(resident.length, 2);
  copies[0].text = 'local copy mutation';
  assert.equal(h.port.listCopyableRecords()[0].text, records[1].text);
  assert.equal(h.context.getResidentRecords().length, 2);
});

test('a subagent historical view reads complete history through a closure and closing never rehydrates the main resident transcript', (t) => {
  const h = createHarness(t);
  const subagent = (runId, event, text = '') => ({
    role: 'subagent', text, runId, parentToolCallId: `parent-${runId}`, agentName: 'explorer', event
  });
  const historical = [
    subagent('old-run', {kind: 'start', task: 'cold investigation'}),
    subagent('old-run', {kind: 'assistant'}, 'cold subagent answer'),
    subagent('old-run', {kind: 'completed', durationMs: 12}),
    subagent('new-run', {kind: 'start', task: 'new investigation'}),
    subagent('new-run', {kind: 'completed', durationMs: 15})
  ];
  h.context.appendRecords([{role: 'user', text: 'delegate'}, ...historical]);
  h.context.applyCompaction(compaction(6));
  const resident = h.context.getResidentRecords();
  const before = residentState(h.context);
  const journal = journalText(h);
  const repaintedMainRecords = [];
  const controller = new SubagentViewController({
    getRecords: () => h.context.getCompleteRecords(),
    getActivity: (runId) => h.app.subagentRunContext.getActivity(runId),
    hasActiveRuns: () => h.app.subagentRunContext.hasTimedActivity(),
    repaint: () => repaintedMainRecords.push(h.context.getResidentRecords().slice())
  });
  controller.toggle();
  assert.equal(controller.getActiveRunId(), 'new-run');
  assert.deepEqual(controller.getViewRecords(), historical.slice(3));
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), true);
  assert.equal(controller.getActiveRunId(), 'old-run');
  assert.deepEqual(controller.getViewRecords(), historical.slice(0, 3));
  assert.match(controller.createRenderState(h.app.createRenderState()).statusLine.detail, /subagent 1\/2/);
  assert.equal(controller.hasTimedActivity(), false);
  const reads = h.io.readOnlyLoads;
  assert.equal(reads, 1);
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.ESCAPE}), true);
  assert.equal(controller.isActive(), false);
  assert.equal(controller.getActiveRunId(), null);
  assert.deepEqual(controller.getViewRecords(), []);
  const mainRenderState = h.app.createRenderState();
  assert.strictEqual(controller.createRenderState(mainRenderState), mainRenderState);
  assert.equal(h.io.readOnlyLoads, reads);
  assert.equal(repaintedMainRecords.length, 3);
  assert.ok(repaintedMainRecords.every((records) => records.length === 1 && records[0].role === 'compaction_notice'));
  assert.strictEqual(h.context.getResidentRecords(), resident);
  assert.deepEqual(residentState(h.context), before);
  assert.equal(journalText(h), journal);
});

test('real AppContext checkpoints use logical boundaries and resumed undo restores files and prior compaction suffixes across multiple boundaries', (t) => {
  const h = createHarness(t);
  const target = path.join(h.cwd, 'file.txt');
  fs.writeFileSync(target, 'before\n', {mode: 0o640});
  const original = Array.from({length: 4}, (_, index) => ({role: index % 2 ? 'assistant' : 'user', text: `before-${index}`}));
  h.context.appendRecords(original);
  const first = compaction(2, 'initial summary');
  const initialNotice = h.context.applyCompaction(first);
  h.app.beginChangeCheckpoint();
  assert.equal(h.app.changeHistoryContext.current.transcriptStartIndex, 5);
  assert.equal(h.context.getResidentRecords().length, 3);
  assert.deepEqual(h.app.changeHistoryContext.current.compactionBefore, first);
  editFile(h.app, h.cwd, 'before', 'after');
  h.context.appendRecords([{role: 'user', text: 'first edit'}, {role: 'assistant', text: 'first edited'}]);
  const second = compaction(7, 'first edit summary');
  const secondNotice = h.context.applyCompaction(second);
  h.app.finalizeChangeCheckpoint();

  h.app.beginChangeCheckpoint();
  assert.equal(h.app.changeHistoryContext.current.transcriptStartIndex, 8);
  assert.equal(h.context.getResidentRecords().length, 1);
  editFile(h.app, h.cwd, 'after', 'latest');
  h.context.appendRecords([{role: 'user', text: 'second edit'}, {role: 'assistant', text: 'second edited'}]);
  h.context.applyCompaction(compaction(10, 'second edit summary'));
  h.app.finalizeChangeCheckpoint();
  const sessionId = h.context.currentSessionId;
  const resumed = h.createApp();
  assert.equal(resumed.loadTranscriptSession(sessionId), true);
  assert.equal(resumed.transcriptContext.getResidentRecords().length, 1);
  const context = resumed.transcriptContext;
  assert.equal(context.baseRecordIndex, 10);
  assert.equal(context.getRecordCount(), 11);
  assert.equal(resumed.changeHistoryContext.getHistory().length, 2);
  resumed.setContextUsage({usedTokens: 100, contextWindow: 1000, source: 'provider'});
  let reads = h.io.readOnlyLoads;
  assert.equal(resumed.executeUndo().ok, true);
  assert.equal(h.io.readOnlyLoads, reads + 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'after\n');
  assert.equal(context.baseRecordIndex, 7);
  assert.equal(context.getRecordCount(), 8);
  assert.deepEqual(context.getResidentRecords(), [secondNotice]);
  assert.deepEqual(context.compaction, second);
  assert.equal(resumed.changeHistoryContext.getHistory().length, 1);
  assert.equal(resumed.getContextUsage(), null);

  reads = h.io.readOnlyLoads;
  assert.equal(resumed.executeUndo().ok, true);
  assert.equal(h.io.readOnlyLoads, reads + 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');
  assert.equal(fs.statSync(target).mode & 0o777, 0o640);
  assert.equal(context.baseRecordIndex, 2);
  assert.equal(context.getRecordCount(), 5);
  assert.deepEqual(context.getResidentRecords(), [...original.slice(2), initialNotice]);
  assert.deepEqual(context.compaction, first);
  assert.deepEqual(resumed.changeHistoryContext.getSummary(), {status: 'none'});
  assert.deepEqual(context.changeHistory, []);
  const operations = fs.readFileSync(h.store.getSessionFilePath(h.cwd, sessionId), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line)).slice(-2);
  assert.deepEqual(operations.map((entry) => entry.operations.map((operation) => operation.op)), [
    ['truncate_records', 'set_compaction', 'set_change_history'],
    ['truncate_records', 'set_compaction', 'set_change_history']
  ]);
  assert.deepEqual(operations.map((entry) => entry.operations[0].recordCount), [8, 5]);
  const saved = h.store.loadSessionReadOnly(h.cwd, sessionId).session;
  assert.deepEqual(saved.records, [...original, initialNotice]);
  assert.deepEqual(saved.compaction, first);
  assert.equal(saved.changeHistory, undefined);
  assert.equal(context.getResidentRecords().length, 3);
});

test('undo before the first compaction restores an uncompressed prefix and resets the base offset', (t) => {
  const h = createHarness(t);
  const prefix = [{role: 'user', text: 'keep question'}, {role: 'assistant', text: 'keep answer'}];
  h.context.appendRecords(prefix);
  h.app.beginChangeCheckpoint();
  h.context.appendRecord({role: 'user', text: 'remove question'});
  h.context.applyCompaction(compaction(3));
  h.app.finalizeChangeCheckpoint();
  assert.equal(h.context.getResidentRecords().length, 1);
  assert.equal(h.app.executeUndo().ok, true);
  assert.equal(h.io.readOnlyLoads, 1);
  assert.equal(h.context.baseRecordIndex, 0);
  assert.equal(h.context.getRecordCount(), 2);
  assert.equal(h.context.compaction, null);
  assert.deepEqual(h.context.getResidentRecords(), prefix);
  assert.strictEqual(h.context.getCompleteRecords(), h.context.getResidentRecords());
  h.port.append({role: 'user', text: 'continue after undo'});
  assert.equal(h.context.listSessionSummaries()[0].messageCount, 3);
  assert.equal(h.context.listSessionSummaries()[0].title, 'keep question');
  assert.equal(h.io.readOnlyLoads, 1);
});

test('ordinary undo after compaction truncates the resident suffix without reading history and retains the cold first title', (t) => {
  const h = createHarness(t);
  const target = path.join(h.cwd, 'file.txt');
  fs.writeFileSync(target, 'before\n');
  h.context.appendRecords([{role: 'user', text: 'original title'}, {role: 'assistant', text: 'old reply'}]);
  const state = compaction(2);
  const notice = h.context.applyCompaction(state);
  h.context.appendRecord({role: 'user', text: 'resident question'});
  const checkpointRecords = h.context.getResidentRecords().slice();
  h.app.beginChangeCheckpoint();
  editFile(h.app, h.cwd, 'before', 'after');
  h.context.appendRecords([{role: 'user', text: 'remove question'}, {role: 'assistant', text: 'remove answer'}]);
  h.app.finalizeChangeCheckpoint();
  const reads = h.io.journalReads;
  h.io.readFailure = 'throw';

  assert.equal(h.app.executeUndo().ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');
  assert.equal(h.io.readOnlyLoads, 0);
  assert.equal(h.io.journalReads, reads);
  assert.deepEqual(h.context.getResidentRecords(), checkpointRecords);
  assert.strictEqual(h.context.getResidentRecords()[0], notice);
  assert.equal(h.context.baseRecordIndex, 2);
  assert.equal(h.context.getRecordCount(), 4);
  assert.deepEqual(h.context.compaction, state);
  assert.deepEqual(h.context.changeHistory, []);
  assert.equal(h.context.listSessionSummaries()[0].title, 'original title');
  h.context.appendRecord({role: 'user', text: 'continuation must not replace title'});
  assert.equal(h.context.listSessionSummaries()[0].title, 'original title');
});

for (const compressed of [false, true]) {
  test(`ordinary undo removing the first user resets the cached title without a replay (compressed=${compressed})`, (t) => {
    const h = createHarness(t);
    h.context.appendRecord({role: 'system', text: 'before first user'});
    if (compressed) h.context.applyCompaction(compaction(1));
    const before = h.context.getResidentRecords().slice();
    const count = h.context.getRecordCount();
    h.app.beginChangeCheckpoint();
    h.context.appendRecords([{role: 'user', text: 'discard first title'}, {role: 'assistant', text: 'discard reply'}]);
    h.app.finalizeChangeCheckpoint();
    assert.equal(h.context.listSessionSummaries()[0].title, 'discard first title');
    h.io.readFailure = 'throw';
    assert.equal(h.app.executeUndo().ok, true);
    assert.equal(h.io.readOnlyLoads, 0);
    assert.equal(h.io.journalReads, 0);
    assert.deepEqual(h.context.getResidentRecords(), before);
    assert.equal(h.context.getRecordCount(), count);
    assert.equal(h.context.listSessionSummaries()[0].title, '未命名对话');
    h.context.appendRecord({role: 'user', text: 'new first title'});
    assert.equal(h.context.listSessionSummaries()[0].title, 'new first title');
    assert.equal(h.context.listSessionSummaries()[0].messageCount, count + 1);
  });
}

test('missing session restore returns false without changing installed records or metadata', (t) => {
  const h = createHarness(t);
  h.context.appendRecords(richRecords());
  h.context.applyCompaction(compaction(7));
  const before = residentState(h.context);
  assert.equal(h.app.loadTranscriptSession('missing-session'), false);
  assert.deepEqual(residentState(h.context), before);
});

for (const failure of ['missing', 'throw', 'stale']) {
  test(`undo full-history preflight ${failure} failure occurs before any controlled file restoration or deletion`, (t) => {
    const h = createHarness(t);
    const target = path.join(h.cwd, 'file.txt');
    const created = path.join(h.cwd, 'created.txt');
    fs.writeFileSync(target, 'before\n', {mode: 0o640});
    h.context.appendRecords([{role: 'user', text: 'keep'}, {role: 'assistant', text: 'kept'}]);
    h.app.beginChangeCheckpoint();
    editFile(h.app, h.cwd, 'before', 'after');
    const recorder = h.app.changeHistoryContext.createRecorder();
    recorder.captureFileBefore(created);
    fs.writeFileSync(created, 'created in this checkpoint\n');
    recorder.captureFileAfter(created);
    h.context.appendRecords([{role: 'user', text: 'edit'}, {role: 'assistant', text: 'edited'}]);
    h.context.applyCompaction(compaction(4));
    h.app.finalizeChangeCheckpoint();
    const history = h.app.changeHistoryContext.getHistory();
    assert.deepEqual(history[0].files.map((file) => file.state), ['updated', 'created']);
    const before = residentState(h.context);
    const bytes = journalText(h);
    // 同时检查 inode 与高精度时间戳，防止“先改写再回滚”伪装成未修改。
    const fileState = (filePath) => {
      const stat = fs.statSync(filePath, {bigint: true});
      return {text: fs.readFileSync(filePath, 'utf8'), mode: stat.mode, ino: stat.ino,
        mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs};
    };
    const targetBefore = fileState(target);
    const createdBefore = fileState(created);
    const attempts = h.io.appendAttempts;
    h.io.readFailure = failure;
    const result = h.app.executeUndo();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'restore_failed');
    // 三种失败统一降级为同一句可展示说明：预读失败不区分底层原因，也不得先改写文件。
    assert.equal(result.message, '无法读取当前会话的完整历史');
    assert.equal(h.io.readOnlyLoads, 1);
    assert.deepEqual(fileState(target), targetBefore);
    assert.deepEqual(fileState(created), createdBefore);
    assert.equal(h.io.appendAttempts, attempts);
    assert.equal(journalText(h), bytes);
    assert.deepEqual(residentState(h.context), before);
    assert.deepEqual(h.app.changeHistoryContext.getHistory(), history);
    assert.equal(h.app.changeHistoryContext.getSummary().status, 'ready');

    h.io.readFailure = null;
    assert.equal(h.app.executeUndo().ok, true);
    assert.equal(h.io.readOnlyLoads, 2);
    assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');
    assert.equal(fs.existsSync(created), false);
    assert.equal(h.context.baseRecordIndex, 0);
    assert.equal(h.context.getRecordCount(), 2);
  });
}

test('provider input transfers an independently owned deep snapshot of only the resident suffix', (t) => {
  const h = createHarness(t);
  const records = richRecords();
  h.context.appendRecords(records);
  h.context.applyCompaction(compaction(7));
  h.context.updateTodoState({updatedAt: TIMESTAMP, items: [{id: 'todo_1', text: 'app-owned todo', status: 'open'}]});
  const before = residentState(h.context);
  const bytes = journalText(h);
  const input = h.app.getAgentSession();
  const independent = h.app.getAgentSession();
  assert.equal(input.recordsOwnership, 'transfer');
  assert.equal(input.baseRecordIndex, 7);
  assert.equal(input.sessionId, h.context.currentSessionId);
  assert.equal(input.sessionJournalPath, h.context.getCurrentSessionJournalPath());
  assert.deepEqual(input.records, [...records.slice(7), h.context.getResidentRecords().at(-1)]);
  assert.notStrictEqual(input.records, h.context.getResidentRecords());
  assert.notStrictEqual(input.records[0].attachments, h.context.getResidentRecords()[0].attachments);
  assert.notStrictEqual(input.records[1].extension.payload, h.context.getResidentRecords()[1].extension.payload);
  assert.notStrictEqual(input.compaction, h.context.compaction);
  assert.notStrictEqual(input.todoState.items, h.context.todoState.items);

  input.records[0].attachments[0].dataBase64 = 'provider-owned image mutation';
  input.records[0].metadata.conversationReference.title = 'provider-owned reference mutation';
  input.records[1].extension.payload.nested.value = 'provider-owned extension mutation';
  input.records[3].attachments[0].dataBase64 = 'provider-owned tool image mutation';
  input.records[3].details.truncated = true;
  input.records.splice(0, 4);
  input.records.push({role: 'assistant', text: 'runtime-only record'});
  input.compaction.summaryText = 'runtime-only summary';
  input.todoState.items[0].text = 'runtime-only todo';
  assert.deepEqual(residentState(h.context), before);
  assert.deepEqual(independent.records, before.records);
  assert.deepEqual(independent.compaction, before.compaction);
  assert.deepEqual(independent.todoState, before.todoState);
  assert.deepEqual(h.app.getAgentSession().records, before.records);
  assert.equal(h.context.getResidentRecords().length, 6);
  assert.equal(h.context.getRecordCount(), 13);
  assert.equal(h.io.readOnlyLoads, 0);
  assert.equal(h.io.journalReads, 0);
  assert.equal(journalText(h), bytes);
});

test('applyCompaction rejects boundaries outside the resident range without touching state or journal', (t) => {
  const h = createHarness(t);
  h.context.appendRecords([{role: 'user', text: 'a'}, {role: 'assistant', text: 'b'}, {role: 'user', text: 'c'}]);
  const notice = h.context.applyCompaction(compaction(2));
  const before = residentState(h.context);
  const bytes = journalText(h);

  assert.throws(() => h.context.applyCompaction(compaction(1)), /压缩边界不在当前驻留记录区内/);
  assert.throws(() => h.context.applyCompaction(compaction(9)), /压缩边界不在当前驻留记录区内/);
  assert.deepEqual(residentState(h.context), before);
  assert.equal(journalText(h), bytes);
  assert.deepEqual(h.context.getResidentRecords().map((record) => record.text), ['c', notice.text]);
});

test('restoreToBoundary refuses a cross-boundary rollback without caller-provided complete history', (t) => {
  const h = createHarness(t);
  h.context.appendRecords([{role: 'user', text: 'cold question'}, {role: 'assistant', text: 'cold answer'}, {role: 'user', text: 'warm'}]);
  h.context.applyCompaction(compaction(2));
  const before = residentState(h.context);
  const bytes = journalText(h);

  assert.throws(() => h.context.restoreToBoundary(1, undefined), /需要调用方预读的完整历史/);
  assert.deepEqual(residentState(h.context), before);
  assert.equal(journalText(h), bytes);

  const complete = h.context.getCompleteRecords();
  assert.ok(complete);
  h.context.restoreToBoundary(1, undefined, undefined, complete);
  assert.equal(h.context.baseRecordIndex, 0);
  assert.equal(h.context.getRecordCount(), 1);
  assert.deepEqual(h.context.getResidentRecords(), [{role: 'user', text: 'cold question'}]);
});

test('forkSession reports failure and keeps the source session when complete history is unreadable', (t) => {
  const h = createHarness(t);
  h.context.appendRecords(richRecords());
  h.context.applyCompaction(compaction(7));
  const before = residentState(h.context);
  const summaries = h.store.listSessionSummaries(h.cwd).length;

  for (const failure of ['missing', 'throw', 'stale']) {
    h.io.readFailure = failure;
    assert.deepEqual(h.app.forkTranscriptSession(), {ok: false, reason: 'failed', error: '无法读取当前会话的完整历史'});
    assert.deepEqual(residentState(h.context), before);
    assert.equal(h.store.listSessionSummaries(h.cwd).length, summaries);
  }

  h.io.readFailure = null;
  assert.equal(h.app.forkTranscriptSession().ok, true);
  assert.equal(h.store.listSessionSummaries(h.cwd).length, summaries + 1);
});

test('display-only history reads degrade instead of throwing when complete history is unreadable', (t) => {
  const h = createHarness(t);
  // 驻留后缀刻意不含带 interactionMode 的 user record，逼出按需回读路径。
  h.context.appendRecords([
    {role: 'user', text: 'cold plan request', metadata: {interactionMode: 'plan'}},
    {role: 'assistant', text: 'cold plan answer'},
    {role: 'user', text: 'warm request'},
    {role: 'assistant', text: 'warm answer'}
  ]);
  h.context.applyCompaction(compaction(2));
  const subagentView = new SubagentViewController({
    getRecords: () => h.context.getCompleteRecords(),
    getActivity: () => null,
    hasActiveRuns: () => false,
    repaint: () => { throw new Error('repaint must not run while the view stays closed'); }
  });
  h.app.setInteractionMode('normal');

  for (const failure of ['missing', 'throw', 'stale']) {
    h.io.readFailure = failure;
    assert.equal(h.port.listCopyableRecords(), null);
    subagentView.toggle();
    assert.equal(subagentView.isActive(), false);
    // 驻留后缀里没有可用的 mode 记录时，回读失败必须回退 normal，而不是抛出到提交路径。
    assert.equal(h.app.beginUserTurn(`fallback ${failure}`).metadata?.modeTransition, undefined);
  }

  h.io.readFailure = null;
  assert.ok(h.port.listCopyableRecords().length > 0);
  assert.deepEqual(h.app.beginUserTurn('replayed request').metadata?.modeTransition, {from: 'plan', to: 'normal'});
});
