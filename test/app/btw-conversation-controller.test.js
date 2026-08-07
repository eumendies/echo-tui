const assert = require('node:assert/strict');
const test = require('node:test');

const {BTW_BOUNDARY, BtwConversationController} = require('../../src/app/btw-conversation-controller');
const {createComposer, getText} = require('../../src/input/composer');
const {INPUT_EVENTS} = require('../../src/input/event-types');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createBaseRenderState() {
  return {
    composer: createComposer('main'),
    commandSurface: null,
    pending: null,
    working: null,
    theme: {},
    renderPreferences: {showReasoningSummary: true, slashSuggestionMaxVisible: 8},
    statusLine: {projectName: 'project', model: {kind: 'default', label: 'main-model'}, mode: 'idle'},
    width: 80
  };
}

function createHarness(runAgent) {
  const appended = [];
  const calls = {footer: 0, repaint: 0};
  const parentTurnState = {pending: {kind: 'streaming', text: 'main draft'}, responding: true};
  const parent = {
    records: [{role: 'user', text: 'main question'}],
    compaction: {summaryText: 'main summary', activeStartIndex: 0, createdAt: 'now'},
    todoState: {updatedAt: 'now', items: [{id: 'main', text: 'continue main', status: 'open'}]},
    sessionJournalPath: '/tmp/main.jsonl',
    modelProfileId: 'model-1',
    interactionMode: 'normal'
  };
  let currentUserConfigSnapshot = parent.userConfigSnapshot;
  const controller = new BtwConversationController({
    runAgent,
    captureUserConfigSnapshot: () => currentUserConfigSnapshot || parent.userConfigSnapshot,
    getParentSession: () => {
      const {userConfigSnapshot, ...serializable} = parent;
      return {
        ...structuredClone(serializable),
        ...(userConfigSnapshot ? {userConfigSnapshot} : {})
      };
    },
    getParentTurnState: () => structuredClone(parentTurnState),
    appendVisible: (records) => appended.push(...structuredClone(records)),
    renderFooter: () => { calls.footer += 1; },
    repaint: () => { calls.repaint += 1; }
  });
  return {
    appended,
    calls,
    controller,
    parent,
    parentTurnState,
    setUserConfigSnapshot(snapshot) {
      currentUserConfigSnapshot = snapshot;
    }
  };
}

test('BTW captures the latest UserConfigSnapshot for each side turn', async () => {
  const firstSnapshot = {
    revision: 7,
    getAppSettings() { return {}; },
    resolveLlmConfig() { return {}; },
    resolveLlmConfigForProfile() { return {}; }
  };
  const secondSnapshot = {
    ...firstSnapshot,
    revision: 8
  };
  const sessions = [];
  const {controller, parent, setUserConfigSnapshot} = createHarness(async (session, callbacks) => {
    sessions.push(session);
    callbacks.onComplete?.('done');
  });
  parent.userConfigSnapshot = firstSnapshot;
  setUserConfigSnapshot(firstSnapshot);

  controller.open('first');
  await flush();
  setUserConfigSnapshot(secondSnapshot);
  controller.handleEvent({type: INPUT_EVENTS.TEXT, value: 'second'});
  await controller.handleEvent({type: INPUT_EVENTS.SUBMIT});

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].userConfigSnapshot, firstSnapshot);
  assert.equal(sessions[1].userConfigSnapshot, secondSnapshot);
  assert.equal(sessions[1].userConfigSnapshot.resolveLlmConfig, secondSnapshot.resolveLlmConfig);
  controller.close();
});

test('BTW freezes parent context and uses a visible user boundary without parent todo or journal', async () => {
  const sessions = [];
  const {controller, parent, appended, calls} = createHarness(async (session, callbacks) => {
    sessions.push(structuredClone({...session, abortSignal: undefined}));
    callbacks.onModelResolved?.({model: 'side-model'});
    callbacks.onComplete?.('side answer');
  });

  controller.open('why?');
  parent.records.push({role: 'assistant', text: 'late main answer'});
  await flush();

  assert.equal(calls.repaint, 1);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].toolPolicy, 'readonly');
  assert.equal(sessions[0].conversationKind, 'btw');
  assert.equal(sessions[0].todoState, undefined);
  assert.equal(sessions[0].sessionJournalPath, undefined);
  assert.equal(sessions[0].records.some((record) => record.text === 'late main answer'), false);
  assert.match(sessions[0].records.at(-1).text, new RegExp(BTW_BOUNDARY.split('\n')[0]));
  assert.equal(appended[0].displayText, 'why?');
  assert.equal(controller.getRecords().at(-1).text, 'side answer');

  const renderState = controller.createRenderState(createBaseRenderState());
  assert.equal(renderState.statusLine.mode, 'btw');
  assert.match(renderState.statusLine.detail, /MAIN streaming/);
  assert.equal(renderState.composer === createBaseRenderState().composer, false);
  controller.close();
});

test('BTW keeps one follow-up without replacing an occupied pending slot', async () => {
  const runs = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const {controller} = createHarness(async (session, callbacks) => {
    runs.push({session, callbacks});
    if (runs.length === 1) await firstGate;
    callbacks.onComplete?.(`answer-${runs.length}`);
  });

  controller.open('first');
  await flush();
  controller.handleEvent({type: INPUT_EVENTS.TEXT, value: '/status'});
  controller.handleEvent({type: INPUT_EVENTS.SUBMIT});
  controller.handleEvent({type: INPUT_EVENTS.TEXT, value: 'keep this draft'});
  controller.handleEvent({type: INPUT_EVENTS.SUBMIT});
  const queuedState = controller.createRenderState(createBaseRenderState());

  assert.deepEqual(queuedState.pendingMessage, {preview: '/status'});
  assert.equal(getText(queuedState.composer), 'keep this draft');

  releaseFirst();
  await flush();
  await flush();

  assert.equal(runs.length, 2);
  assert.equal(runs[1].session.records.at(-1).displayText, '/status');
  assert.equal(controller.getRecords().filter((record) => record.role === 'user').length, 2);

  const staleCallbacks = runs[1].callbacks;
  controller.close();
  staleCallbacks.onToken?.('x', 'late token');
  staleCallbacks.onComplete?.('late answer');
  assert.equal(controller.isActive(), false);
  assert.deepEqual(controller.getRecords(), []);
});

test('BTW derives parent activity labels inside the side controller', () => {
  const {controller, parentTurnState} = createHarness(async () => {});

  assert.equal(controller.getParentActivity(), 'MAIN streaming');
  parentTurnState.pending = {kind: 'tool_call', toolName: 'grep', argumentsText: '{}'};
  assert.equal(controller.getParentActivity(), 'MAIN tool grep');
  parentTurnState.pending = {kind: 'reasoning_streaming', text: 'thinking'};
  assert.equal(controller.getParentActivity(), 'MAIN reasoning');
  parentTurnState.pending = {kind: 'thinking', elapsedMs: 0};
  assert.equal(controller.getParentActivity(), 'MAIN thinking');
  parentTurnState.pending = null;
  assert.equal(controller.getParentActivity(), 'MAIN working');
  parentTurnState.responding = false;
  assert.equal(controller.getParentActivity(), 'MAIN idle');
});

test('BTW close aborts the active side signal and ignores late callbacks', async () => {
  let capturedSignal;
  let capturedCallbacks;
  const never = new Promise(() => {});
  const {controller, appended} = createHarness((session, callbacks) => {
    capturedSignal = session.abortSignal;
    capturedCallbacks = callbacks;
    return never;
  });

  controller.open('long question');
  await flush();
  const appendedBeforeClose = appended.length;
  controller.close();

  assert.equal(capturedSignal.aborted, true);
  capturedCallbacks.onToken?.('x', 'late');
  capturedCallbacks.onComplete?.('late answer');
  assert.equal(appended.length, appendedBeforeClose);
  assert.equal(controller.isActive(), false);
});

test('BTW commits completed reasoning before entering assistant streaming', async () => {
  let stateAfterSummary;
  let stateAfterToken;
  const {controller} = createHarness(async (_session, callbacks) => {
    callbacks.onReasoningUpdate?.({kind: 'draft', text: 'thinking'});
    callbacks.onReasoningUpdate?.({kind: 'complete', text: 'thinking'});
    stateAfterSummary = controller.createRenderState(createBaseRenderState());
    callbacks.onToken?.('d', 'draft');
    stateAfterToken = controller.createRenderState(createBaseRenderState());
    callbacks.onComplete?.('draft');
  });

  controller.open('inspect');
  await flush();

  assert.equal(stateAfterSummary.pending, null);
  assert.deepEqual(stateAfterToken.pending, {kind: 'streaming', text: 'draft'});
  assert.deepEqual(controller.getRecords().map((record) => record.role), [
    'user',
    'reasoning_summary',
    'assistant'
  ]);
  controller.close();
});

test('BTW keeps tool pairs, todo, compaction, and provider-private records in side state only', async () => {
  const sessions = [];
  let runCount = 0;
  const {controller, parent} = createHarness(async (session, callbacks) => {
    sessions.push(structuredClone({...session, abortSignal: undefined}));
    runCount += 1;
    if (runCount === 1) {
      callbacks.onProviderRecords?.([{role: 'extension', text: '', extension: {kind: 'unknown', name: 'private', payload: {id: 1}}}]);
      callbacks.onReasoningUpdate?.({kind: 'complete', text: 'side reasoning'});
      callbacks.onToolCall?.({callId: 'read-1', toolName: 'read_files', argumentsText: '{"files":[]}'});
      callbacks.onToolResult?.({callId: 'read-1', toolName: 'read_files', ok: true, text: 'files: empty', details: {kind: 'read_files', truncated: false}});
      callbacks.onTodoStateChange?.({updatedAt: 'side', items: [{id: 'side', text: 'follow up', status: 'open'}]});
      callbacks.onCompacted?.({summaryText: 'side summary', activeStartIndex: 1, createdAt: 'side'});
    }
    callbacks.onComplete?.(`answer-${runCount}`);
  });

  controller.open('inspect');
  await flush();
  controller.handleEvent({type: INPUT_EVENTS.TEXT, value: 'next'});
  await controller.handleEvent({type: INPUT_EVENTS.SUBMIT});

  const records = controller.getRecords();
  const toolIndex = records.findIndex((record) => record.role === 'tool_call');
  assert.equal(records[toolIndex + 1].role, 'tool_result');
  assert.ok(records.some((record) => record.role === 'extension'));
  assert.ok(records.some((record) => record.role === 'reasoning_summary'));
  assert.ok(records.some((record) => record.role === 'compaction_notice'));
  assert.deepEqual(sessions[1].todoState.items.map((item) => item.id), ['side']);
  assert.equal(sessions[1].compaction.summaryText, 'side summary');
  assert.deepEqual(parent.todoState.items.map((item) => item.id), ['main']);
  assert.equal(parent.compaction.summaryText, 'main summary');
  controller.close();
});
