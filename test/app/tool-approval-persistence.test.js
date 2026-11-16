const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {AppContext} = require('../../src/app/state/app-context');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {createSessionApprovalsStore} = require('../../src/persistence/session-approvals-store');
const {createTranscriptStore} = require('../../src/persistence/transcript-store');

const TERMINAL = {getSize() { return {columns: 80, rows: 24}; }};
const CWD = '/tmp/echo_tui/approval-persistence';

function createHarness(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-approval-persistence-'));
  t.after(() => fs.rmSync(rootDir, {recursive: true, force: true}));
  const transcriptStore = createTranscriptStore({rootDir});
  const store = createSessionApprovalsStore(transcriptStore);
  const userConfigContext = new UserConfigContext();
  t.after(() => userConfigContext.close());
  const context = new AppContext(TERMINAL, transcriptStore, CWD, 'v20.0.0', undefined, undefined, userConfigContext, null);

  return {context, rootDir, store, transcriptStore, userConfigContext};
}

/** 用一条 user record 触发真实 journal 创建，返回已落盘的 session id。 */
function createSessionWithRecord(context) {
  context.transcriptContext.appendRecords([{role: 'user', text: 'hello'}]);
  const sessionId = context.transcriptContext.getCurrentSessionId();
  assert.equal(typeof sessionId, 'string');
  return sessionId;
}

function createToolApproval(context, store, options = {}) {
  const errors = [];
  const toolApproval = new ToolApprovalContext(() => {}, {
    getCwd: () => context.getCurrentCwd(),
    getSessionId: () => context.transcriptContext.getCurrentSessionId(),
    onPersistError: options.onPersistError || ((error, operation) => errors.push({error, operation})),
    store
  });
  context.attachToolApprovalContext(toolApproval);
  return {errors, toolApproval};
}

/** 通过会话级 allow 选项批准一次工具调用，复用真实 choice surface 的事件路径。 */
async function approveForSession(toolApproval, call) {
  const pending = toolApproval.request(call);

  assert.equal(typeof pending.then, 'function');
  toolApproval.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  toolApproval.handleEvent({type: INPUT_EVENTS.SUBMIT});
  return pending;
}

test('session approvals survive a new process for the same session', async (t) => {
  const {context, store} = createHarness(t);
  const sessionId = createSessionWithRecord(context);
  const {toolApproval} = createToolApproval(context, store);
  const call = {callId: 'call_patch', toolName: 'apply_patch', argumentsText: '{"patch":"invalid"}'};

  assert.deepEqual(await approveForSession(toolApproval, call), {kind: 'allow_tool_for_session', toolName: 'apply_patch'});
  assert.deepEqual(store.read(CWD, sessionId), {
    kind: 'found',
    approvals: {
      schemaVersion: 1,
      sessionId,
      updatedAt: store.read(CWD, sessionId).approvals.updatedAt,
      allowAll: false,
      tools: ['apply_patch'],
      bashCommands: []
    }
  });

  // 模拟重启：新的 ToolApprovalContext 在同一会话上没有内存授权，恢复后才命中缓存。
  const restarted = createToolApproval(context, store);
  assert.equal(restarted.toolApproval.getCachedDecision(call), null);
  restarted.toolApproval.restoreForSession();
  assert.deepEqual(restarted.toolApproval.getCachedDecision(call), {kind: 'allow_tool_for_session', toolName: 'apply_patch'});
});

test('bash command approvals persist their exact command text', async (t) => {
  const {context, store} = createHarness(t);
  const sessionId = createSessionWithRecord(context);
  const {toolApproval} = createToolApproval(context, store);
  const call = {callId: 'call_bash', toolName: 'run_bash_command', argumentsText: '{"command":"rm --help"}'};

  assert.deepEqual(await approveForSession(toolApproval, call), {
    kind: 'allow_command_for_session',
    toolName: 'run_bash_command',
    command: 'rm --help'
  });
  assert.deepEqual(store.read(CWD, sessionId).approvals.bashCommands, ['rm --help']);

  const restarted = createToolApproval(context, store);
  restarted.toolApproval.restoreForSession();
  assert.deepEqual(restarted.toolApproval.getCachedDecision(call), {
    kind: 'allow_command_for_session',
    toolName: 'run_bash_command',
    command: 'rm --help'
  });
});

test('disabling allow-all clears the persisted flag so a restart does not resurrect it', (t) => {
  const {context, store} = createHarness(t);
  const sessionId = createSessionWithRecord(context);
  const {toolApproval} = createToolApproval(context, store);

  assert.equal(toolApproval.toggleAllowAllForSession(), true);
  assert.equal(store.read(CWD, sessionId).approvals.allowAll, true);

  assert.equal(toolApproval.toggleAllowAllForSession(), false);
  assert.equal(store.read(CWD, sessionId).kind, 'missing');

  const restarted = createToolApproval(context, store);
  restarted.toolApproval.restoreForSession();
  assert.equal(restarted.toolApproval.isAllowAllForSession(), false);
});

test('a corrupt sidecar fails closed instead of granting approval', (t) => {
  const {context, store} = createHarness(t);
  const sessionId = createSessionWithRecord(context);
  const {toolApproval} = createToolApproval(context, store);
  const call = {callId: 'call_patch', toolName: 'apply_patch', argumentsText: '{"patch":"invalid"}'};

  toolApproval.toggleAllowAllForSession();
  fs.writeFileSync(store.getFilePath(CWD, sessionId), '{broken', 'utf8');

  toolApproval.restoreForSession();

  assert.equal(toolApproval.isAllowAllForSession(), false);
  assert.equal(toolApproval.getCachedDecision(call), null);
});

test('resuming a session restores its approvals through AppContext', async (t) => {
  const {context, store} = createHarness(t);
  const sessionId = createSessionWithRecord(context);
  const {toolApproval} = createToolApproval(context, store);
  const call = {callId: 'call_patch', toolName: 'apply_patch', argumentsText: '{"patch":"invalid"}'};

  await approveForSession(toolApproval, call);
  toolApproval.toggleAllowAllForSession();

  // 切到空白会话：/clear 语义，授权必须清空且不泄漏。
  context.clearTranscriptRecords();
  assert.equal(toolApproval.isAllowAllForSession(), false);
  assert.equal(toolApproval.getCachedDecision(call), null);

  assert.equal(context.loadTranscriptSession(sessionId), true);
  assert.equal(toolApproval.isAllowAllForSession(), true);
  assert.deepEqual(toolApproval.getCachedDecision(call), {kind: 'allow_all_for_session'});
});

test('forking a session carries the current approvals into the new branch', async (t) => {
  const {context, store} = createHarness(t);
  const sourceSessionId = createSessionWithRecord(context);
  const {toolApproval} = createToolApproval(context, store);
  const call = {callId: 'call_patch', toolName: 'apply_patch', argumentsText: '{"patch":"invalid"}'};

  await approveForSession(toolApproval, call);
  const result = context.forkTranscriptSession();

  assert.equal(result.ok, true);
  assert.notEqual(result.sessionId, sourceSessionId);
  assert.deepEqual(store.read(CWD, result.sessionId).approvals.tools, ['apply_patch']);
  assert.deepEqual(store.read(CWD, sourceSessionId).approvals.tools, ['apply_patch']);
});

test('deleting a session removes its approvals sidecar without touching the current one', async (t) => {
  const {context, store, transcriptStore} = createHarness(t);
  const currentSessionId = createSessionWithRecord(context);
  const {toolApproval} = createToolApproval(context, store);
  const call = {callId: 'call_patch', toolName: 'apply_patch', argumentsText: '{"patch":"invalid"}'};

  await approveForSession(toolApproval, call);
  const removable = transcriptStore.createSession(CWD, {
    op: 'append_records',
    records: [{role: 'user', text: 'other'}]
  });
  store.write(CWD, {sessionId: removable.sessionId, allowAll: true, tools: [], bashCommands: []});

  const result = context.deleteTranscriptSession(removable.sessionId);

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(store.getFilePath(CWD, removable.sessionId)), false);
  assert.deepEqual(store.read(CWD, currentSessionId).approvals.tools, ['apply_patch']);
});

test('persistence failures keep the in-memory approval for the current session', async (t) => {
  const {context, store} = createHarness(t);
  createSessionWithRecord(context);
  const failures = [];
  const toolApproval = new ToolApprovalContext(() => {}, {
    getCwd: () => context.getCurrentCwd(),
    getSessionId: () => context.transcriptContext.getCurrentSessionId(),
    onPersistError: (error, operation) => failures.push({error, operation}),
    store: {
      ...store,
      write() {
        throw new Error('disk full');
      }
    }
  });
  const call = {callId: 'call_patch', toolName: 'apply_patch', argumentsText: '{"patch":"invalid"}'};

  assert.deepEqual(await approveForSession(toolApproval, call), {kind: 'allow_tool_for_session', toolName: 'apply_patch'});
  assert.equal(failures.length, 1);
  assert.equal(failures[0].operation, 'write');
  assert.deepEqual(toolApproval.getCachedDecision(call), {kind: 'allow_tool_for_session', toolName: 'apply_patch'});
});

test('clearing the transcript does not attempt to persist an unbound session', (t) => {
  const {context, store} = createHarness(t);
  createSessionWithRecord(context);
  const writes = [];
  const toolApproval = new ToolApprovalContext(() => {}, {
    getCwd: () => context.getCurrentCwd(),
    getSessionId: () => context.transcriptContext.getCurrentSessionId(),
    store: {...store, write(cwd, input) { writes.push(input); return null; }}
  });
  context.attachToolApprovalContext(toolApproval);

  toolApproval.toggleAllowAllForSession();
  assert.equal(writes.length, 1);

  // /clear 先解绑 session 再清空授权：这里不应产生任何写入。
  context.clearTranscriptRecords();
  assert.equal(writes.length, 1);
  assert.equal(toolApproval.isAllowAllForSession(), false);
});
