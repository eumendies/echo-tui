const assert = require('node:assert/strict');
const test = require('node:test');

const {BTW_BOUNDARY, BtwConversationController} = require('../../src/app/btw-conversation-controller');
const {createComposer, getText} = require('../../src/input/composer');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const agentSetup = require('../../src/agent/agent-setup');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {createToolRegistry} = require('../../src/tools/tool-registry');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function withProviderRuntime(agent, callback) {
  const original = agentSetup.prepareAgent;
  agentSetup.prepareAgent = () => ({
    agent,
    config: {
      agentType: 'fake', apiKey: '', model: 'fake', contextWindow: 20,
      tools: {bash: {timeoutMs: 1000, maxOutputBytes: 1024}, sandbox: {mode: 'off', network: false, extraWritablePaths: []}}
    },
    registry: createToolRegistry()
  });
  try {
    await callback(createAgentLoopRuntime('/tmp/echo-btw-test', new UserConfigContext()));
  } finally {
    agentSetup.prepareAgent = original;
  }
}

async function submit(controller, text) {
  controller.handleEvent({type: INPUT_EVENTS.TEXT, value: text});
  await controller.handleEvent({type: INPUT_EVENTS.SUBMIT});
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
  const calls = {render: 0, repaint: 0, pendingAtRecord: []};
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
    renderRecords: (records) => appended.push(...structuredClone(records)),
    render: (finalizeRecord) => {
      calls.render += 1;
      if (!finalizeRecord) return;
      calls.pendingAtRecord.push(structuredClone(controller.createRenderState(createBaseRenderState()).pending));
      appended.push(structuredClone(finalizeRecord));
    },
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
    getLlmModelConfigInfo() { return {kind: 'profiles', selectedModelId: 'fake', models: []}; },
    resolveLlmConfig() { return {}; },
    resolveLlmConfigStrict() { return {}; },
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
  parentTurnState.pending = {kind: 'tool_calls', calls: [
    {callId: 'one', toolName: 'grep', argumentsText: '{}'},
    {callId: 'two', toolName: 'glob', argumentsText: '{}'}
  ]};
  assert.equal(controller.getParentActivity(), 'MAIN tools · 2');
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

test('BTW finalizes a streamed segment before rendering its record and redraws tool state once', async () => {
  const {controller, calls} = createHarness(async (_session, callbacks) => {
    callbacks.onToken?.('x', 'segment');
    callbacks.onAssistantSegment?.('segment');
    callbacks.onToolCall?.({callId: 'call-1', toolName: 'grep', argumentsText: '{}'});
    callbacks.onToolResult?.({callId: 'call-1', toolName: 'grep', ok: true, text: 'done', details: {kind: 'grep', truncated: false}});
    callbacks.onComplete?.('final');
  });

  controller.open('stream');
  await flush();

  assert.deepEqual(calls.pendingAtRecord, [null, null]);
  assert.equal(calls.render, 5);
  assert.equal(controller.hasTimedActivity(), false);
  controller.close();
});

test('BTW keeps multiple pending tool calls isolated and pairs results by call id', async () => {
  const pendingSnapshots = [];
  let controller;
  const harness = createHarness(async (_session, callbacks) => {
    const first = {callId: 'call-1', toolName: 'grep', argumentsText: '{"pattern":"one"}'};
    const second = {callId: 'call-2', toolName: 'glob', argumentsText: '{"pattern":"two"}'};
    callbacks.onToolCall?.(first);
    callbacks.onToolCall?.(second);
    pendingSnapshots.push(controller.createRenderState(createBaseRenderState()).pending);
    callbacks.onToolResult?.({callId: 'call-1', toolName: 'grep', ok: true, text: 'one', details: {kind: 'generic'}});
    pendingSnapshots.push(controller.createRenderState(createBaseRenderState()).pending);
    callbacks.onToolResult?.({callId: 'call-2', toolName: 'glob', ok: false, text: 'two failed', details: {kind: 'generic'}});
    callbacks.onComplete?.('done');
  });
  controller = harness.controller;

  controller.open('inspect');
  await flush();

  assert.deepEqual(pendingSnapshots, [
    {
      kind: 'tool_calls',
      calls: [
        {callId: 'call-1', toolName: 'grep', argumentsText: '{"pattern":"one"}'},
        {callId: 'call-2', toolName: 'glob', argumentsText: '{"pattern":"two"}'}
      ]
    },
    {
      kind: 'tool_call',
      toolName: 'glob',
      argumentsText: '{"pattern":"two"}'
    }
  ]);
  assert.deepEqual(controller.getRecords().filter((record) => record.role === 'tool_call' || record.role === 'tool_result').map((record) => [record.role, record.toolCallId]), [
    ['tool_call', 'call-1'], ['tool_result', 'call-1'],
    ['tool_call', 'call-2'], ['tool_result', 'call-2']
  ]);
  controller.close();
});

test('BTW flushes retry and compaction notices through activity rendering', async () => {
  const {controller, calls} = createHarness(async (_session, callbacks) => {
    callbacks.onToken?.('x', 'segment');
    callbacks.onProviderRetry?.({retryCount: 1, maxRetries: 2, delayMs: 10, message: 'retry'});
    callbacks.onCompacted?.({summaryText: 'side summary', activeStartIndex: 1, createdAt: 'side'});
    callbacks.onComplete?.('segment');
  });

  controller.open('stream');
  await flush();

  assert.equal(calls.render, 5);
  controller.close();
});

test('BTW queues side activity for the shared app clock and discards late callbacks after close', async () => {
  let capturedCallbacks;
  const {controller, calls} = createHarness(async (_session, callbacks) => {
    capturedCallbacks = callbacks;
    callbacks.onToken?.('x', 'alpha\n\nbeta');
    await new Promise(() => {});
  });

  controller.open('stream');
  await flush();

  assert.equal(controller.hasTimedActivity(), true);
  assert.equal(calls.render, 1);
  assert.deepEqual(controller.createRenderState(createBaseRenderState()).pending, {
    kind: 'streaming',
    text: 'alpha\n\nbeta'
  });

  controller.close();
  capturedCallbacks.onToken?.('x', 'alpha\n\nbeta\n\ngamma');
  assert.equal(controller.hasTimedActivity(), false);
  assert.equal(calls.render, 1);
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

test('BTW freezes only the owned parent suffix at a nonzero offset and transfers independent turn inputs', async () => {
  const sessions = [];
  const {controller, parent} = createHarness(async (session, callbacks) => {
    sessions.push(session);
    assert.equal(session.baseRecordIndex, 800);
    assert.equal(session.recordsOwnership, 'transfer');
    assert.equal(session.compaction.activeStartIndex, 800);
    assert.equal(session.compaction.summaryText, 'frozen summary');
    assert.equal(session.records[0].attachments[0].dataBase64, 'AQ==');
    assert.equal(session.records[0].metadata.interactionMode, 'normal');
    session.records[0].attachments[0].dataBase64 = 'runtime mutation';
    session.records.at(-1).displayText = 'runtime mutation';
    session.records.push({role: 'assistant', text: 'runtime-only record'});
    callbacks.onComplete?.('side answer');
  });
  parent.baseRecordIndex = 800;
  parent.compaction = {summaryText: 'frozen summary', activeStartIndex: 800, createdAt: 'old'};
  parent.records[0].attachments = [{kind: 'image', mediaType: 'image/png', path: 'recent.png', dataBase64: 'AQ==', sizeBytes: 1}];
  parent.records[0].metadata = {interactionMode: 'normal'};
  controller.open();
  parent.records[0].attachments[0].dataBase64 = 'main mutation';
  parent.records[0].metadata.interactionMode = 'plan';
  parent.records.splice(0, 1, {role: 'assistant', text: 'later main suffix'});
  parent.baseRecordIndex = 900;
  parent.compaction.summaryText = 'later main summary';
  parent.compaction.activeStartIndex = 900;

  await submit(controller, 'first');
  await submit(controller, 'second');

  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0].records, sessions[1].records);
  assert.notEqual(sessions[1].records, controller.getRecords());
  assert.deepEqual(controller.getRecords().map((record) => record.displayText || record.text), ['first', 'side answer', 'second', 'side answer']);
  assert.equal(sessions[1].records.some((record) => record.text === 'runtime-only record'), true);
  assert.equal(sessions[1].records.filter((record) => record.text === 'runtime-only record').length, 1);
  assert.equal(parent.records[0].text, 'later main suffix');
  controller.close();
});

test('BTW releases the frozen base before its own prefix, keeps side display counts local, and labels later questions as follow-ups', async () => {
  const sessions = [];
  const {controller, parent} = createHarness(async (session, callbacks) => {
    sessions.push(structuredClone({...session, abortSignal: undefined}));
    if (sessions.length === 1) {
      callbacks.onCompacted?.({summaryText: 'base partial', activeStartIndex: 801, createdAt: 'one'});
      assert.deepEqual(controller.getRecords().map((record) => record.role), ['user', 'compaction_notice']);
      assert.equal(controller.getRecords().at(-1).text, '已将较早的主会话参考记录压缩为摘要');
      callbacks.onCompacted?.({summaryText: 'base released', activeStartIndex: 803, createdAt: 'two'});
      assert.deepEqual(controller.getRecords().map((record) => record.role), ['user', 'compaction_notice', 'compaction_notice']);
      callbacks.onCompacted?.({summaryText: 'side released', activeStartIndex: 806, createdAt: 'three'});
      assert.deepEqual(controller.getRecords().map((record) => record.role), ['compaction_notice']);
      assert.equal(controller.getRecords()[0].text, '已将较早的 3 条旁路历史压缩为摘要');
    }
    callbacks.onComplete?.('recent answer');
  });
  parent.records = Array.from({length: 3}, (_, index) => ({role: 'user', text: `main-${index}`}));
  parent.baseRecordIndex = 800;
  parent.compaction.activeStartIndex = 800;
  controller.open();
  await submit(controller, 'first');
  await submit(controller, 'next');

  assert.equal(sessions[1].baseRecordIndex, 806);
  assert.equal(sessions[1].compaction.activeStartIndex, 806);
  assert.deepEqual(sessions[1].records.map((record) => record.role), ['compaction_notice', 'assistant', 'user']);
  assert.equal(sessions[1].records.at(-1).text, '[BTW FOLLOW-UP]\n\nnext');
  assert.equal(controller.getRecords().length, 4);
  assert.equal(controller.getRecords().some((record) => record.text.startsWith('main-')), false);
  assert.equal(parent.records.length, 3);
  controller.close();
});

test('BTW and the real runtime align repeated compactions from a nonzero parent offset and the next turn never double slices', async () => {
  const sessions = [];
  const inputs = [];
  const acceptedStates = [];
  const summaries = [];
  const requests = [];
  let turns = 0;
  let controller;
  let adoptedState;
  const agent = {async runTurn(records, _callbacks, options) {
    if (options.isCompaction) {
      summaries.push(structuredClone(records));
      return {draft: `summary-${summaries.length}`, toolCalls: []};
    }
    turns += 1;
    requests.push(structuredClone(records));
    const session = sessions.at(-1);
    assert.equal(adoptedState.compaction.activeStartIndex, adoptedState.baseRecordIndex);
    const sideStart = Math.max(0, 840 - adoptedState.baseRecordIndex);
    const sideRecords = session.records.slice(sideStart);
    assert.equal(sideRecords.length, controller.getRecords().length);
    // 旁路提示使用自身计数；runtime 的不可发送 notice 仍采用完整逻辑边界，不影响事实坐标与模型投影。
    assert.deepEqual(sideRecords.filter((record) => record.role !== 'compaction_notice'),
      controller.getRecords().filter((record) => record.role !== 'compaction_notice'));
    for (const record of session.records.filter((record) => record.role !== 'compaction_notice' && record.role !== 'error')) {
      assert.ok(records.some((projected) => projected.role === record.role && projected.text === record.text && projected.toolCallId === record.toolCallId));
    }
    if (turns <= 2) {
      return {draft: `segment-${turns}`, toolCalls: Array.from({length: 25}, (_, index) => ({callId: `batch-${turns}-${index}`, toolName: 'missing_tool', argumentsText: '{}'})), usageInputTokens: 1000};
    }
    return {draft: `answer-${turns}`, toolCalls: []};
  }};

  await withProviderRuntime(agent, async (runAgent) => {
    const harness = createHarness(async (session, callbacks) => {
      sessions.push(session);
      const input = structuredClone({baseRecordIndex: session.baseRecordIndex, compaction: session.compaction});
      inputs.push(input);
      adoptedState = structuredClone(input);
      const transferredRecords = session.records;
      assert.equal(session.recordsOwnership, 'transfer');
      assert.notEqual(session.records, controller.getRecords());
      await runAgent(session, {
        ...callbacks,
        onCompacted(compaction) {
          callbacks.onCompacted(compaction);
          adoptedState = structuredClone({baseRecordIndex: compaction.activeStartIndex, compaction});
          acceptedStates.push({...structuredClone(adoptedState), sideRecords: structuredClone(controller.getRecords())});
        }
      });
      assert.equal(session.records, transferredRecords);
      assert.deepEqual({baseRecordIndex: session.baseRecordIndex, compaction: session.compaction}, input);
    });
    controller = harness.controller;
    harness.parent.baseRecordIndex = 800;
    harness.parent.compaction.activeStartIndex = 800;
    harness.parent.records = Array.from({length: 40}, (_, index) => ({role: index % 2 ? 'assistant' : 'user', text: `main-${index} `.repeat(20)}));
    controller.open();
    await submit(controller, 'first');

    assert.equal(summaries.length, 3);
    assert.equal(acceptedStates.length, 3);
    assert.ok(adoptedState.baseRecordIndex > 840);
    assert.equal(sessions[0].records.some((record) => record.text.startsWith('main-')), false);
    assert.equal(summaries[1].some((record) => record.text.startsWith('main-0 ')), false);
    assert.equal(summaries[2].some((record) => record.toolCallId === 'batch-1-0'), false);
    const previousState = structuredClone(adoptedState);
    const recent = structuredClone(controller.getRecords());
    await submit(controller, 'next');

    assert.equal(summaries.length, 4);
    assert.equal(acceptedStates.length, 4);
    assert.deepEqual(inputs[1], previousState);
    assert.ok(adoptedState.baseRecordIndex > previousState.baseRecordIndex);
    for (const state of acceptedStates) {
      assert.equal(state.sideRecords.at(-1).text, state.baseRecordIndex > 840
        ? `已将较早的 ${state.baseRecordIndex - 840} 条旁路历史压缩为摘要`
        : '已将较早的主会话参考记录压缩为摘要');
    }
    assert.deepEqual(sessions.map(({baseRecordIndex, compaction}) => ({baseRecordIndex, compaction})), inputs);
    assert.ok(requests.at(-1).some((record) => record.text === 'answer-3'));
    assert.ok(requests.at(-1).some((record) => record.text === '[BTW FOLLOW-UP]\n\nnext'));
    assert.ok(requests.at(-1).some((record) => record.toolCallId === 'batch-2-24'));
    assert.ok(recent.some((record) => record.text === 'answer-3'));
    assert.equal(controller.getRecords().at(-1).text, 'answer-4');
    assert.equal(harness.parent.baseRecordIndex, 800);
    assert.equal(harness.parent.records.length, 40);
    controller.close();
  });
});

for (const rejection of ['empty summary', 'summary error']) {
  test(`BTW retains its frozen suffix after ${rejection} and can continue on the next turn`, async () => {
    const sessions = [];
    const inputs = [];
    const acceptedStates = [];
    let summaries = 0;
    const agent = {async runTurn(_records, _callbacks, options) {
      if (options.isCompaction) {
        summaries += 1;
        if (summaries === 1) {
          if (rejection === 'summary error') throw new Error('summary failed');
          return {draft: '  ', toolCalls: []};
        }
        return {draft: 'accepted summary', toolCalls: []};
      }
      return {draft: 'continued', toolCalls: []};
    }};
    await withProviderRuntime(agent, async (runAgent) => {
      const {controller, parent} = createHarness(async (session, callbacks) => {
        sessions.push(session);
        const input = structuredClone({baseRecordIndex: session.baseRecordIndex, compaction: session.compaction});
        inputs.push(input);
        const transferredRecords = session.records;
        try {
          await runAgent(session, {
            ...callbacks,
            onCompacted(compaction) {
              callbacks.onCompacted(compaction);
              acceptedStates.push(structuredClone({baseRecordIndex: compaction.activeStartIndex, compaction, sideRecords: controller.getRecords()}));
            }
          });
        } finally {
          assert.equal(session.records, transferredRecords);
          assert.deepEqual({baseRecordIndex: session.baseRecordIndex, compaction: session.compaction}, input);
        }
      });
      parent.baseRecordIndex = 800;
      parent.compaction.activeStartIndex = 800;
      parent.records = Array.from({length: 30}, (_, index) => ({role: index % 2 ? 'assistant' : 'user', text: `frozen-${index} `.repeat(20)}));
      controller.open();
      await submit(controller, 'first');

      assert.equal(sessions[0].baseRecordIndex, 800);
      assert.equal(sessions[0].compaction.summaryText, 'main summary');
      assert.equal(sessions[0].records[0].text, parent.records[0].text);
      assert.equal(acceptedStates.length, 0);
      assert.equal(summaries, 1);
      assert.equal(controller.getRecords().some((record) => record.role === 'compaction_notice'), false);
      assert.equal(controller.getRecords().at(-1).role, rejection === 'summary error' ? 'error' : 'assistant');
      await submit(controller, 'next');

      assert.equal(summaries, 2);
      assert.equal(acceptedStates.length, 1);
      assert.ok(acceptedStates[0].baseRecordIndex > 800);
      assert.equal(acceptedStates[0].compaction.summaryText, 'accepted summary');
      assert.equal(acceptedStates[0].sideRecords.at(-1).role, 'compaction_notice');
      assert.deepEqual(inputs[1], inputs[0]);
      assert.deepEqual(sessions.map(({baseRecordIndex, compaction}) => ({baseRecordIndex, compaction})), inputs);
      assert.equal(controller.getRecords().at(-1).text, 'continued');
      assert.equal(sessions[1].records.at(-2).text, '[BTW FOLLOW-UP]\n\nnext');
      controller.close();
    });
  });
}

test('BTW ignores late compaction and private records after close and reopening at another offset', async () => {
  const runs = [];
  const {controller, parent, appended} = createHarness((session, callbacks) => {
    runs.push({session, callbacks});
    return new Promise(() => {});
  });
  parent.baseRecordIndex = 800;
  parent.compaction.activeStartIndex = 800;
  controller.open('old');
  controller.close();
  parent.baseRecordIndex = 900;
  parent.compaction.activeStartIndex = 900;
  controller.open('new');
  const count = appended.length;
  runs[0].callbacks.onCompacted?.({summaryText: 'late summary', activeStartIndex: 801, createdAt: 'late'});
  runs[0].callbacks.onProviderRecords?.([{role: 'local_notice', text: 'late record'}]);
  runs[0].callbacks.onComplete?.('late answer');
  assert.equal(appended.length, count);
  assert.equal(runs[1].session.baseRecordIndex, 900);
  assert.deepEqual(controller.getRecords().map((record) => record.displayText), ['new']);
  controller.close();
});
