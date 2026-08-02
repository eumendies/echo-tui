const test = require('node:test');
const assert = require('node:assert/strict');

const {runAssistantTurn} = require('../../src/app/assistant-turn-runner');
const {AgentAbortError} = require('../../src/types/agent');
const {AppContext} = require('../../src/app/state/app-context');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');
const {UserQuestionContext} = require('../../src/app/state/user-question-context');

function createFakeTranscriptStore() {
  let currentSession = null;
  let currentReference = null;

  return {
    createSession(cwd, operation) {
      currentSession = {
        schemaVersion: 1,
        sessionId: 'session-1',
        cwd,
        createdAt: '2026-06-29T00:00:00.000Z',
        updatedAt: '2026-06-29T00:00:00.000Z',
        records: []
      };
      applyOperation(currentSession, operation);
      currentReference = {
        sessionId: currentSession.sessionId,
        cwd,
        createdAt: currentSession.createdAt,
        updatedAt: currentSession.updatedAt,
        sequence: 1
      };
      return {...currentReference};
    },
    appendSession(cwd, reference, operation) {
      if (!currentSession || reference.sessionId !== currentSession.sessionId) {
        throw new Error('missing session');
      }

      applyOperation(currentSession, operation);
      currentReference = {
        ...currentReference,
        cwd,
        updatedAt: '2026-06-29T00:00:00.000Z',
        sequence: currentReference.sequence + 1
      };
      currentSession.updatedAt = currentReference.updatedAt;
      return {...currentReference};
    },
    listSessions() {
      return [];
    },
    loadSession() {
      return currentSession ? {session: structuredClone(currentSession), reference: {...currentReference}} : null;
    },
    loadSessionReadOnly() {
      return currentSession ? {session: structuredClone(currentSession), reference: {...currentReference}} : null;
    },
    getSessionFilePath(_cwd, sessionId) {
      return `/tmp/${sessionId}.jsonl`;
    }
  };
}

function createFakeSessionModelSettingsStore() {
  let current = null;

  return {
    getFilePath(_cwd, sessionId) {
      return `/tmp/${sessionId}.settings.json`;
    },
    read(_cwd, sessionId) {
      return current?.sessionId === sessionId ? {kind: 'found', settings: structuredClone(current)} : {kind: 'missing'};
    },
    write(_cwd, input, updatedAt = '2026-06-29T00:00:00.000Z') {
      current = {
        schemaVersion: 1,
        sessionId: input.sessionId,
        modelProfileId: input.modelProfileId,
        ...(input.reasoningEffortOverride !== undefined ? {reasoningEffortOverride: input.reasoningEffortOverride} : {}),
        updatedAt
      };
      return structuredClone(current);
    }
  };
}

function applyOperation(session, operation) {
  if (operation.op === 'batch') {
    for (const item of operation.operations) {
      applyOperation(session, item);
    }
    return;
  }

  if (operation.op === 'append_records') {
    session.records.push(...operation.records.map((record) => ({...record})));
  } else if (operation.op === 'truncate_records') {
    session.records.length = operation.recordCount;
  } else if (operation.op === 'set_change_history') {
    session.changeHistory = structuredClone(operation.changeHistory);
  } else if (operation.op === 'set_compaction') {
    if (operation.compaction) {
      session.compaction = {...operation.compaction};
    } else {
      delete session.compaction;
    }
  } else if (operation.op === 'set_todo_state') {
    session.todoState = structuredClone(operation.todoState);
  }
}

function createHarness(options = {}) {
  const appContext = new AppContext(
    {getSize() { return {columns: 80, rows: 24}; }},
    options.transcriptStore || createFakeTranscriptStore(),
    '/tmp/echo_tui',
    'v20.0.0',
    undefined,
    undefined,
    options.sessionModelSettingsStore || createFakeSessionModelSettingsStore()
  );
  const appended = [];
  const hookEvents = [];
  const debugEvents = [];

  return {
    appContext,
    appended,
    debugEvents,
    hookEvents,
    input: {
      appContext,
      toolApproval: new ToolApprovalContext(() => {}),
      userQuestion: new UserQuestionContext(() => {}),
      userText: 'hello',
      appendRecord(record) {
        appended.push(record);
      },
      appendRecords(records) {
        appended.push(...records);
      },
      hooks: {
        emit(event, payload) {
          hookEvents.push({event, payload});
        },
        async flush() {}
      },
      debug: {
        enabled: true,
        logPath: '/tmp/debug.jsonl',
        emit(event, payload) {
          debugEvents.push({event, payload});
        },
        close() {}
      },
      renderFooter() {}
    }
  };
}

test('runAssistantTurn continues with its in-memory selection when initial session settings persistence fails', async () => {
  const harness = createHarness({
    sessionModelSettingsStore: {
      getFilePath() { return '/tmp/session-1.settings.json'; },
      read() { return {kind: 'missing'}; },
      write() { throw new Error('settings write failed sk-secret'); }
    }
  });
  let agentCalls = 0;

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      agentCalls += 1;
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.equal(agentCalls, 1);
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'assistant']);
  assert.equal(harness.appContext.transcriptContext.getCurrentSessionId(), 'session-1');
  assert.deepEqual(harness.hookEvents.map((event) => event.event), ['assistant_turn_start', 'assistant_turn_end']);
  assert.equal(harness.appContext.createRenderState().statusLine.model.error, undefined);
});

test('runAssistantTurn writes initial settings after journal creation without delaying provider startup', async () => {
  const events = [];
  const transcriptStore = createFakeTranscriptStore();
  const createSession = transcriptStore.createSession;
  transcriptStore.createSession = (...args) => {
    events.push('journal');
    return createSession(...args);
  };
  const settingsStore = createFakeSessionModelSettingsStore();
  const write = settingsStore.write;
  settingsStore.write = (...args) => {
    events.push('settings');
    return write(...args);
  };
  const harness = createHarness({transcriptStore, sessionModelSettingsStore: settingsStore});

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      events.push('provider');
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.deepEqual(events.slice(0, 3), ['journal', 'settings', 'provider']);
});

test('runAssistantTurn emits start and end hooks without adding hook records', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.deepEqual(harness.hookEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_end'
  ]);
  assert.deepEqual(harness.hookEvents.map((event) => event.payload.status), ['started', 'completed']);
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'assistant']);
  assert.deepEqual(harness.debugEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_end'
  ]);
  assert.equal(harness.debugEvents[0].payload.userText.length, 5);
  assert.equal(harness.appContext.turnContext.responding, false);
});

test('runAssistantTurn does not own live composer consumption', async () => {
  const harness = createHarness();
  harness.appContext.composerContext.setText('later draft');
  harness.appContext.composerContext.inputHistory.push('queued message');

  await runAssistantTurn({
    ...harness.input,
    userText: 'queued message',
    async runAgent(_session, callbacks) {
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.equal(harness.appContext.composerContext.getText(), 'later draft');
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), ['queued message']);
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'assistant']);
  assert.equal(harness.appended[0].text, 'queued message');
});

test('runAssistantTurn coalesces token renders on the activity clock and redraws structural events immediately', async () => {
  const harness = createHarness();
  const renderedStates = [];
  const renderFooter = () => {
    renderedStates.push(harness.appContext.createRenderState());
  };

  harness.appContext.turnContext.configureSpinnerTimer({onTick: renderFooter});

  await runAssistantTurn({
    ...harness.input,
    renderFooter,
    async runAgent(_session, callbacks) {
      callbacks.onToken('a', 'a');
      callbacks.onToken('b', 'ab');

      assert.equal(renderedStates.length, 0);
      await new Promise((resolve) => setTimeout(resolve, 130));
      assert.equal(renderedStates.at(-1).pending.text, 'ab');

      const renderCountBeforeToolCall = renderedStates.length;
      callbacks.onToolCall({callId: 'call-1', toolName: 'grep', argumentsText: '{"pattern":"ab"}'});
      assert.equal(renderedStates.length, renderCountBeforeToolCall + 1);
      assert.equal(renderedStates.at(-1).pending.kind, 'tool_call');

      callbacks.onComplete('ab');
      return 'ab';
    }
  });

  assert.equal(harness.appContext.turnContext.spinnerTimer, null);
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'assistant']);
  assert.equal(harness.appended[1].text, 'ab');
});

test('runAssistantTurn preserves final streamed text when completion precedes the first activity tick', async () => {
  const harness = createHarness();
  let activityTicks = 0;

  harness.appContext.turnContext.configureSpinnerTimer({
    onTick() {
      activityTicks += 1;
    }
  });

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onToken('o', 'ok');
      callbacks.onComplete('ok');
      return 'ok';
    }
  });

  assert.equal(activityTicks, 0);
  assert.equal(harness.appContext.turnContext.getPending(), null);
  assert.equal(harness.appended.at(-1).role, 'assistant');
  assert.equal(harness.appended.at(-1).text, 'ok');
});

test('runAssistantTurn stores plan transition prompt, display, metadata, and attachments without owning composer history', async () => {
  const harness = createHarness();
  harness.appContext.setInteractionMode('plan');
  const attachments = [{kind: 'image', mediaType: 'image/png', dataBase64: 'aGVsbG8=', sizeBytes: 5}];
  let capturedSession;

  await runAssistantTurn({
    ...harness.input,
    userText: 'expanded request',
    displayText: '@request.png',
    attachments,
    metadata: {
      skillInvocation: {
        skillName: 'example'
      }
    },
    async runAgent(session, callbacks) {
      capturedSession = session;
      callbacks.onComplete('done');
      return 'done';
    }
  });

  const userRecord = harness.appended[0];
  assert.equal(userRecord.role, 'user');
  assert.match(userRecord.text, /\[Interaction Mode Transition\]/);
  assert.match(userRecord.text, /from: normal/);
  assert.match(userRecord.text, /to: plan/);
  assert.match(userRecord.text, /\[User Request\]\nexpanded request$/);
  assert.equal(userRecord.displayText, '@request.png');
  assert.equal(userRecord.metadata.interactionMode, 'plan');
  assert.deepEqual(userRecord.metadata.modeTransition, {from: 'normal', to: 'plan'});
  assert.deepEqual(userRecord.metadata.skillInvocation, {skillName: 'example'});
  assert.deepEqual(userRecord.attachments, attachments);
  assert.equal(capturedSession.interactionMode, 'plan');
  assert.equal(capturedSession.records[0].text, userRecord.text);
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), []);
});

test('runAssistantTurn injects only effective mode transitions across turns', async () => {
  const harness = createHarness();

  harness.appContext.setInteractionMode('plan');
  await runAssistantTurn({
    ...harness.input,
    userText: 'plan first',
    async runAgent(_session, callbacks) {
      callbacks.onComplete('planned');
      return 'planned';
    }
  });

  await runAssistantTurn({
    ...harness.input,
    userText: 'plan second',
    async runAgent(_session, callbacks) {
      callbacks.onComplete('still planned');
      return 'still planned';
    }
  });

  harness.appContext.setInteractionMode('normal');
  await runAssistantTurn({
    ...harness.input,
    userText: 'implement now',
    async runAgent(_session, callbacks) {
      callbacks.onComplete('implemented');
      return 'implemented';
    }
  });

  const userRecords = harness.appContext.transcriptContext.records.filter((record) => record.role === 'user');
  assert.deepEqual(userRecords.map((record) => record.metadata?.modeTransition), [
    {from: 'normal', to: 'plan'},
    undefined,
    {from: 'plan', to: 'normal'}
  ]);
  assert.equal(userRecords[1].text, 'plan second');
  assert.match(userRecords[2].text, /Previous Plan Mode restrictions no longer apply/);
  assert.equal(userRecords[2].displayText, 'implement now');
});

test('runAssistantTurn persists provider records without visible assistant text', async () => {
  const harness = createHarness();
  const reasoningContentRecord = {
    role: 'extension',
    text: '',
    extension: {kind: 'openai_chat_reasoning', reasoningContent: 'hidden'}
  };

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onProviderRecords([reasoningContentRecord]);
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'extension', 'assistant']);
  assert.deepEqual(harness.appContext.transcriptContext.records.map((record) => record.role), ['user', 'extension', 'assistant']);
});

test('runAssistantTurn persists shared tool records with result metadata', async () => {
  const harness = createHarness();
  const attachments = [{
    kind: 'image',
    mediaType: 'image/png',
    dataBase64: 'aGVsbG8=',
    path: '/tmp/screenshot.png',
    sizeBytes: 5
  }];

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onToolCall({
        callId: 'call_search',
        toolName: 'web_search',
        argumentsText: '{"query":"Echo TUI"}'
      });
      callbacks.onToolResult({
        callId: 'call_search',
        toolName: 'web_search',
        ok: true,
        text: 'search result',
        details: {kind: 'web_search', timedOut: false, truncated: true},
        attachments
      });
      callbacks.onComplete('done');
      return 'done';
    }
  });

  const [toolCall, toolResult] = harness.appContext.transcriptContext.records.slice(1, 3);
  assert.deepEqual(harness.appContext.transcriptContext.records.map((record) => record.role), [
    'user',
    'tool_call',
    'tool_result',
    'assistant'
  ]);
  assert.equal(toolCall.text, 'web_search({"query":"Echo TUI"})');
  assert.equal(toolResult.details.timedOut, false);
  assert.equal(toolResult.details.truncated, true);
  assert.deepEqual(toolResult.attachments, attachments);
});

test('runAssistantTurn emits error hook while preserving error transcript behavior', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent() {
      throw new Error('upstream failed');
    }
  });

  assert.deepEqual(harness.hookEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_error'
  ]);
  assert.equal(harness.hookEvents[1].payload.status, 'error');
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'error']);
  assert.deepEqual(harness.debugEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_error'
  ]);
  assert.equal(harness.debugEvents[1].payload.errorMessage, 'upstream failed');
  assert.match(harness.appended.at(-1).text, /upstream failed/);
  assert.equal(harness.appContext.turnContext.responding, false);
});

test('runAssistantTurn passes model and effort overrides only to the current session across all outcomes', async () => {
  const harness = createHarness();
  const captured = [];
  harness.appContext.modelContext = {
    persistCurrentSessionSettings() {},
    getAgentSelection() { return null; },
    resolveAgentSelection({modelProfileIdOverride, reasoningEffortOverride}) {
      return modelProfileIdOverride === undefined
        ? null
        : {
            modelProfileId: modelProfileIdOverride,
            ...(reasoningEffortOverride !== undefined ? {reasoningEffortOverride} : {})
          };
    },
    refreshModelState() {
      return false;
    },
    getStatusLineModelState() {
      return {modelLabel: 'global-model', reasoningEffort: 'low'};
    },
    resolveSkillOverrideStatusLineModelState({modelProfileIdOverride, reasoningEffortOverride}) {
      return {
        modelLabel: modelProfileIdOverride || 'global-model',
        reasoningEffort: reasoningEffortOverride || 'low',
        skillOverride: true
      };
    }
  };

  async function run(modelProfileId, reasoningEffortOverride, outcome) {
    await runAssistantTurn({
      ...harness.input,
      userText: `${outcome}-${modelProfileId || 'current'}`,
      modelProfileIdOverride: modelProfileId,
      reasoningEffortOverride,
      async runAgent(session, callbacks) {
        captured.push([session.modelProfileId, session.reasoningEffortOverride]);

        if (outcome === 'error') {
          throw new Error('failed');
        }

        if (outcome === 'abort') {
          throw new AgentAbortError();
        }

        callbacks.onComplete('done');
        return 'done';
      }
    });
    assert.equal(harness.appContext.createRenderState().statusLine.model.label, 'global-model');
    assert.equal(harness.appContext.createRenderState().statusLine.model.effort, 'low');
    assert.equal(harness.appContext.createRenderState().statusLine.model.skillOverride, undefined);
  }

  await run('fixed-complete', 'high', 'complete');
  await run(undefined, undefined, 'complete');
  await run('fixed-error', 'none', 'error');
  await run(undefined, undefined, 'complete');
  await run('fixed-abort', 'xhigh', 'abort');
  await run(undefined, undefined, 'complete');

  assert.deepEqual(captured, [
    ['fixed-complete', 'high'], [undefined, undefined],
    ['fixed-error', 'none'], [undefined, undefined],
    ['fixed-abort', 'xhigh'], [undefined, undefined]
  ]);
});

test('runAssistantTurn emits a local model-switch notice and restores the global status model', async () => {
  const harness = createHarness();
  const renderedModels = [];
  harness.appContext.modelContext = {
    persistCurrentSessionSettings() {},
    getAgentSelection() { return null; },
    resolveAgentSelection({modelProfileIdOverride, reasoningEffortOverride}) {
      return {
        modelProfileId: modelProfileIdOverride,
        ...(reasoningEffortOverride !== undefined ? {reasoningEffortOverride} : {})
      };
    },
    refreshModelState() {
      return false;
    },
    getStatusLineModelState() {
      return {modelLabel: 'gpt-global'};
    },
    resolveSkillOverrideStatusLineModelState() {
      return {modelLabel: 'claude-sonnet-4-6', reasoningEffort: 'high', skillOverride: true};
    }
  };

  await runAssistantTurn({
    ...harness.input,
    modelProfileIdOverride: 'skill-model',
    reasoningEffortOverride: 'high',
    renderFooter() {
      renderedModels.push(harness.appContext.createRenderState().statusLine);
    },
    async runAgent(_session, callbacks) {
      callbacks.onThinking();
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.equal(renderedModels[0].model.label, 'claude-sonnet-4-6');
  assert.equal(renderedModels[0].model.effort, 'high');
  assert.equal(renderedModels[0].model.skillOverride, true);
  assert.equal(renderedModels.at(-1).model.label, 'gpt-global');
  assert.equal(renderedModels.at(-1).model.skillOverride, undefined);
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'local_notice', 'assistant']);
  assert.equal(harness.appended[1].text, '当前 skill 本轮使用 claude-sonnet-4-6，effort high。');
  assert.equal(harness.appContext.transcriptContext.records[1].role, 'local_notice');
});

test('runAssistantTurn appends a local notice for provider retry callbacks', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onProviderRetry({
        retryCount: 1,
        maxRetries: 7,
        delayMs: 1000,
        message: '模型响应临时失败，正在重试第 1/7 次。'
      });
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'local_notice', 'assistant']);
  assert.equal(harness.appended[1].text, '模型响应临时失败，正在重试第 1/7 次。');
  assert.equal(harness.appContext.transcriptContext.records[1].role, 'local_notice');
});

test('runAssistantTurn does not emit a model-switch notice when a stale override falls back', async () => {
  const harness = createHarness();
  harness.appContext.modelContext = {
    persistCurrentSessionSettings() {},
    getAgentSelection() { return null; },
    resolveAgentSelection() { return null; },
    refreshModelState() {
      return false;
    },
    getStatusLineModelState() {
      return {modelLabel: 'gpt-global'};
    },
    resolveSkillOverrideStatusLineModelState() {
      return {modelLabel: 'gpt-global'};
    }
  };

  await runAssistantTurn({
    ...harness.input,
    modelProfileIdOverride: 'deleted-profile',
    async runAgent(_session, callbacks) {
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'assistant']);
});

test('runAssistantTurn emits one notice for an effort-only override after stale model fallback', async () => {
  const harness = createHarness();
  harness.appContext.modelContext = {
    persistCurrentSessionSettings() {},
    getAgentSelection() { return null; },
    resolveAgentSelection() { return null; },
    refreshModelState() {
      return false;
    },
    getStatusLineModelState() {
      return {modelLabel: 'gpt-global', reasoningEffort: 'low'};
    },
    resolveSkillOverrideStatusLineModelState({reasoningEffortOverride}) {
      return {modelLabel: 'gpt-global', reasoningEffort: reasoningEffortOverride, skillOverride: true};
    }
  };

  await runAssistantTurn({
    ...harness.input,
    modelProfileIdOverride: 'deleted-profile',
    reasoningEffortOverride: 'none',
    async runAgent(_session, callbacks) {
      callbacks.onModelResolved({model: 'gpt-global', reasoningEffort: 'none'});
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'local_notice', 'assistant']);
  assert.equal(harness.appended[1].text, '当前 skill 本轮使用 gpt-global，effort none。');
  assert.equal(harness.appContext.createRenderState().statusLine.model.skillOverride, undefined);
});
