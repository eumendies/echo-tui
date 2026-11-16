const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {createTranscriptStore} = require('../../src/persistence/transcript-store');
const {createAppendRecordsOperation, serializeTranscriptJournalLine} = require('../../src/persistence/transcript-journal');

function createStoreAndCwd() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-workspace-journal-'));
  const cwd = path.join(rootDir, 'project');
  fs.mkdirSync(cwd, {recursive: true});
  return {cwd, store: createTranscriptStore({rootDir})};
}

const WORKSPACE_FACTS = {
  baseCommit: 'c'.repeat(40),
  execCwd: '/managed/ws-1/worktree/packages/app',
  mode: 'managed_worktree',
  owner: {projectCwd: '/repo', sessionId: 'session-1'},
  workspaceRoot: '/managed/ws-1/worktree'
};

const WORKSPACE_OUTCOME = {
  retained: true,
  workspaceRoot: '/managed/ws-1/worktree'
};

function createRecords() {
  return [
    {role: 'user', text: 'delegate'},
    {
      role: 'subagent',
      text: 'implement the change',
      agentName: 'worker',
      parentToolCallId: 'outer-1',
      runId: 'run-1',
      event: {kind: 'start', task: 'implement the change', parallelSize: 2, workspace: WORKSPACE_FACTS}
    },
    {
      role: 'subagent',
      text: '',
      agentName: 'worker',
      parentToolCallId: 'outer-1',
      runId: 'run-1',
      event: {kind: 'completed', durationMs: 900, workspace: WORKSPACE_OUTCOME}
    },
    {
      role: 'tool_result',
      text: '## Worker Workspace Handoff',
      toolCallId: 'outer-1',
      toolName: 'run_subagent',
      ok: true,
      details: {kind: 'generic', workspace: WORKSPACE_OUTCOME}
    }
  ];
}

test('subagent workspace facts and result locations survive a journal round-trip', () => {
  const {cwd, store} = createStoreAndCwd();
  const records = createRecords();
  const session = store.createSession(cwd, createAppendRecordsOperation(records));

  const loaded = store.loadSession(cwd, session.sessionId);
  assert.ok(loaded);
  assert.deepEqual(loaded.session.records, records);

  // 只读重放同样接受这些字段，恢复时不会把它们当成未知结构。
  const readOnly = store.loadSessionReadOnly(cwd, session.sessionId);
  assert.deepEqual(readOnly.session.records, records);
});

test('legacy subagent records without workspace fields still replay', () => {
  const {cwd, store} = createStoreAndCwd();
  const legacy = [
    {role: 'user', text: 'delegate'},
    {
      role: 'subagent',
      text: 'inspect',
      agentName: 'explorer',
      parentToolCallId: 'outer-legacy',
      runId: 'run-legacy',
      event: {kind: 'start', task: 'inspect'}
    },
    {
      role: 'subagent',
      text: '',
      agentName: 'explorer',
      parentToolCallId: 'outer-legacy',
      runId: 'run-legacy',
      event: {kind: 'completed', durationMs: 10}
    }
  ];
  const session = store.createSession(cwd, createAppendRecordsOperation(legacy));
  const loaded = store.loadSession(cwd, session.sessionId);
  assert.deepEqual(loaded.session.records, legacy);
  // 旧记录不得被补造成带工作区事实的形式。
  assert.equal('workspace' in loaded.session.records[1].event, false);
});

test('malformed workspace facts are rejected instead of being half-restored', () => {
  const {cwd, store} = createStoreAndCwd();
  const sessionPath = store.getSessionFilePath(cwd, 'broken-session');
  fs.mkdirSync(path.dirname(sessionPath), {recursive: true});

  const badRecord = {
    role: 'subagent',
    text: 'x',
    agentName: 'worker',
    parentToolCallId: 'outer-1',
    runId: 'run-1',
    // mode 是未知枚举，必须整条操作失败而不是恢复半结构工作区。
    event: {kind: 'start', task: 'x', workspace: {mode: 'unknown', owner: {projectCwd: '/repo'}}}
  };
  const startLine = {
    schemaVersion: 1,
    sessionId: 'broken-session',
    cwd,
    createdAt: '2026-01-01T00:00:00.000Z',
    kind: 'start',
    operations: [],
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  const appendLine = {
    kind: 'append_records',
    operationId: 'op-1',
    records: [badRecord],
    timestamp: '2026-01-01T00:00:01.000Z'
  };
  fs.writeFileSync(sessionPath, `${serializeTranscriptJournalLine(startLine)}\n${serializeTranscriptJournalLine(appendLine)}\n`, 'utf8');

  // journal 结构校验失败时整体拒绝，不返回带半结构工作区的记录。
  assert.equal(store.loadSession(cwd, 'broken-session'), null);
});

test('fork copies workspace ownership verbatim instead of rebinding it', () => {
  const {cwd, store} = createStoreAndCwd();
  const records = createRecords();
  const source = store.createSession(cwd, createAppendRecordsOperation(records));

  // fork 只复制历史引用；创建者 project/session 必须保持源运行身份。
  const forked = store.createSession(cwd, createAppendRecordsOperation(records));
  assert.notEqual(forked.sessionId, source.sessionId);
  const forkedRecords = store.loadSession(cwd, forked.sessionId).session.records;
  const sourceRecord = forkedRecords.find((record) => record.role === 'subagent' && record.event.kind === 'start');
  assert.deepEqual(sourceRecord.event.workspace.owner, {projectCwd: '/repo', sessionId: 'session-1'});
});
