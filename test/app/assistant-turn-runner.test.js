const test = require('node:test');
const assert = require('node:assert/strict');

const {runAssistantTurn} = require('../../src/app/assistant-turn-runner');
const {AgentAbortError} = require('../../src/types/agent');
const {AppContext} = require('../../src/app/state/app-context');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');
const {UserQuestionContext} = require('../../src/app/state/user-question-context');
const {UserConfigContext} = require('../../src/config/user-config-context');

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
    listSessionSummaries() {
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
  const userConfigContext = options.userConfigContext || new UserConfigContext({
    readFile: options.appSettings
      ? () => JSON.stringify(createConfigRootFromAppSettings(options.appSettings))
      : undefined
  });
  const appContext = new AppContext(
    {getSize() { return {columns: 80, rows: 24}; }},
    options.transcriptStore || createFakeTranscriptStore(),
    '/tmp/echo_tui',
    'v20.0.0',
    undefined,
    options.sessionModelSettingsStore || createFakeSessionModelSettingsStore(),
    userConfigContext
  );
  const appended = [];
  const appendedProjections = [];
  const hookEvents = [];
  const debugEvents = [];

  return {
    appContext,
    appended,
    appendedProjections,
    debugEvents,
    hookEvents,
    input: {
      appContext,
      toolApproval: new ToolApprovalContext(() => {}),
      userQuestion: new UserQuestionContext(() => {}),
      userText: 'hello',
      userRequestText: 'hello',
      renderRecords(records) {
        appended.push(...records);
      },
      render(finalizeRecord) {
        if (!finalizeRecord) return;
        appended.push(finalizeRecord);
        appendedProjections.push(finalizeRecord.role === 'reasoning_summary' ? 'reasoning' : 'assistant');
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
      }
    }
  };
}

function createConfigRootFromAppSettings(settings) {
  return {
    compaction: {thresholdRatio: settings.compactionThresholdRatio},
    instructions: {fileName: settings.agentInstructionFileName},
    skills: {catalogContextRatio: settings.skillCatalogContextRatio},
    tools: {
      approval: {mode: settings.toolApprovalMode, ...(settings.toolApprovalModelProfileId ? {modelProfileId: settings.toolApprovalModelProfileId} : {})},
      fileEdit: {mode: settings.fileEditMode},
      readFiles: {autoCompressImages: settings.autoCompressImages}
    },
    ui: {
      defaultInteractionMode: settings.defaultInteractionMode,
      showReasoningSummary: settings.showReasoningSummary,
      slashSuggestionMaxVisible: settings.slashSuggestionMaxVisible
    }
  };
}

function createUserConfigSnapshot(revision = 1) {
  const config = {
    agentType: 'fake',
    apiKey: '',
    model: `fake-${revision}`,
    contextWindow: 128000,
    tools: {bash: {timeoutMs: null, maxOutputBytes: 65536}, autoCompressImages: true, fileEditMode: 'apply_patch'}
  };
  return {
    revision,
    getAppSettings() {
      return {
        agentInstructionFileName: 'AGENTS.md',
        autoCompressImages: true,
        compactionThresholdRatio: 0.8,
        defaultInteractionMode: 'normal',
        fileEditMode: 'apply_patch',
        skillCatalogContextRatio: 0.02,
        showReasoningSummary: true,
        slashSuggestionMaxVisible: 8,
        toolApprovalMode: 'auto',
        toolApprovalModelProfileId: 'reviewer'
      };
    },
    getLlmModelConfigInfo() {
      return {kind: 'profiles', selectedModelId: 'main', models: [{id: 'main', provider: 'fake', model: config.model}]};
    },
    resolveLlmConfig() { return config; },
    resolveLlmConfigForProfile() { return config; }
  };
}

test('runAssistantTurn keeps manual approval unchanged and does not call auto reviewer', async () => {
  const harness = createHarness({appSettings: {
    agentInstructionFileName: 'AGENTS.md', autoCompressImages: true, compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal', fileEditMode: 'apply_patch', skillCatalogContextRatio: 0.02,
    showReasoningSummary: true, slashSuggestionMaxVisible: 8, toolApprovalMode: 'manual'
  }});
  let reviews = 0;

  await runAssistantTurn({
    ...harness.input,
    toolApprovalReviewer: async () => { reviews += 1; return true; },
    async runAgent(_session, callbacks) {
      const pending = callbacks.onToolApprovalRequest({callId: 'patch-1', toolName: 'apply_patch', argumentsText: '*** patch'});
      assert.equal(harness.input.toolApproval.hasActiveRequest(), true);
      harness.input.toolApproval.handleEvent({type: 'submit'});
      assert.deepEqual(await pending, {kind: 'allow_once'});
      callbacks.onComplete('done');
    }
  });

  assert.equal(reviews, 0);
  assert.deepEqual(harness.hookEvents.map((event) => event.event), [
    'assistant_turn_start',
    'tool_approval_request',
    'tool_approval_response',
    'assistant_turn_end'
  ]);
  assert.equal(harness.hookEvents[1].payload.toolName, 'apply_patch');
  assert.equal(harness.hookEvents[2].payload.decision, 'allow_once');
});

test('runAssistantTurn auto approval allows once for file, bash, and MCP calls without opening modal', async () => {
  for (const call of [
    {callId: 'patch-1', toolName: 'apply_patch', argumentsText: '*** patch'},
    {callId: 'bash-1', toolName: 'run_bash_command', argumentsText: '{"command":"rm -rf tmp"}'},
    {callId: 'mcp-1', toolName: 'mcp__docs__write', argumentsText: '{"id":"1"}'}
  ]) {
    const harness = createHarness({appSettings: {
      agentInstructionFileName: 'AGENTS.md', autoCompressImages: true, compactionThresholdRatio: 0.8,
      defaultInteractionMode: 'normal', fileEditMode: 'apply_patch', skillCatalogContextRatio: 0.02,
      showReasoningSummary: true, slashSuggestionMaxVisible: 8, toolApprovalMode: 'auto', toolApprovalModelProfileId: 'reviewer'
    }});
    let reviews = 0;
    await runAssistantTurn({
      ...harness.input,
      toolApprovalReviewer: async (input) => { reviews += 1; assert.equal(input.call.toolName, call.toolName); return true; },
      async runAgent(_session, callbacks) {
        assert.deepEqual(await callbacks.onToolApprovalRequest(call), {kind: 'allow_once'});
        assert.equal(harness.input.toolApproval.hasActiveRequest(), false);
        callbacks.onComplete('done');
      }
    });
    assert.equal(reviews, 1);
    assert.deepEqual(harness.hookEvents.map((event) => event.event), [
      'assistant_turn_start',
      'assistant_turn_end'
    ]);
  }
});

test('runAssistantTurn gives the main agent and auto reviewer the exact same revision snapshot', async () => {
  const snapshot = createUserConfigSnapshot(42);
  const harness = createHarness({
    appSettings: snapshot.getAppSettings(),
    userConfigContext: {capture() { return snapshot; }}
  });
  let agentSnapshot;
  let reviewerSnapshot;

  await runAssistantTurn({
    ...harness.input,
    toolApprovalReviewer: async (input) => {
      reviewerSnapshot = input.userConfigSnapshot;
      return true;
    },
    async runAgent(session, callbacks) {
      agentSnapshot = session.userConfigSnapshot;
      assert.deepEqual(await callbacks.onToolApprovalRequest({
        callId: 'same-revision',
        toolName: 'apply_patch',
        argumentsText: 'patch'
      }), {kind: 'allow_once'});
      callbacks.onComplete('done');
    }
  });

  assert.equal(agentSnapshot, snapshot);
  assert.equal(reviewerSnapshot, snapshot);
  assert.equal(agentSnapshot.revision, 42);
});

test('runAssistantTurn forwards explicit raw user request to auto reviewer', async () => {
  const harness = createHarness({appSettings: {
    agentInstructionFileName: 'AGENTS.md', autoCompressImages: true, compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal', fileEditMode: 'apply_patch', skillCatalogContextRatio: 0.02,
    showReasoningSummary: true, slashSuggestionMaxVisible: 8, toolApprovalMode: 'auto', toolApprovalModelProfileId: 'reviewer'
  }});
  let reviewerInput;

  await runAssistantTurn({
    ...harness.input,
    userText: 'fix it\n<selected_files>private expanded content</selected_files>',
    userRequestText: 'fix @src/a.ts',
    toolApprovalReviewer: async (input) => { reviewerInput = input; return true; },
    async runAgent(_session, callbacks) {
      assert.deepEqual(await callbacks.onToolApprovalRequest({
        callId: 'patch', toolName: 'apply_patch', argumentsText: JSON.stringify({patch: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch'})
      }), {kind: 'allow_once'});
      callbacks.onComplete('done');
    }
  });

  assert.equal(reviewerInput.currentUserRequest, 'fix @src/a.ts');
  assert.match(reviewerInput.records[reviewerInput.turnUserRecordIndex].text, /private expanded content/);
});

test('runAssistantTurn auto no falls back to the existing manual surface and session cache bypasses review', async () => {
  const harness = createHarness({appSettings: {
    agentInstructionFileName: 'AGENTS.md', autoCompressImages: true, compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal', fileEditMode: 'apply_patch', skillCatalogContextRatio: 0.02,
    showReasoningSummary: true, slashSuggestionMaxVisible: 8, toolApprovalMode: 'auto', toolApprovalModelProfileId: 'reviewer'
  }});
  let reviews = 0;

  await runAssistantTurn({
    ...harness.input,
    toolApprovalReviewer: async () => { reviews += 1; return false; },
    async runAgent(_session, callbacks) {
      const firstPending = callbacks.onToolApprovalRequest({callId: 'mcp-1', toolName: 'mcp__docs__write', argumentsText: '{}'}, {preview: 'server docs'});
      await new Promise((resolve) => setImmediate(resolve));
      const surface = harness.input.toolApproval.getSurface();
      assert.equal(surface.title, 'PERMISSION');
      assert.equal(surface.message, 'server docs');
      harness.input.toolApproval.handleEvent({type: 'move_down'});
      harness.input.toolApproval.handleEvent({type: 'submit'});
      assert.deepEqual(await firstPending, {kind: 'allow_tool_for_session', toolName: 'mcp__docs__write'});

      assert.deepEqual(await callbacks.onToolApprovalRequest({callId: 'mcp-2', toolName: 'mcp__docs__write', argumentsText: '{}'}), {
        kind: 'allow_tool_for_session', toolName: 'mcp__docs__write'
      });
      callbacks.onComplete('done');
    }
  });

  assert.equal(reviews, 1);
  assert.deepEqual(harness.hookEvents.map((event) => event.event), [
    'assistant_turn_start',
    'tool_approval_request',
    'tool_approval_response',
    'assistant_turn_end'
  ]);
  assert.equal(harness.hookEvents[1].payload.toolName, 'mcp__docs__write');
  assert.equal(harness.hookEvents[1].payload.preview, 'server docs');
  assert.equal(harness.hookEvents[2].payload.decision, 'allow_tool_for_session');
});

test('runAssistantTurn propagates reviewer abort without opening a late manual surface', async () => {
  const harness = createHarness({appSettings: {
    agentInstructionFileName: 'AGENTS.md', autoCompressImages: true, compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal', fileEditMode: 'apply_patch', skillCatalogContextRatio: 0.02,
    showReasoningSummary: true, slashSuggestionMaxVisible: 8, toolApprovalMode: 'auto', toolApprovalModelProfileId: 'reviewer'
  }});

  await runAssistantTurn({
    ...harness.input,
    toolApprovalReviewer: async () => { throw new AgentAbortError(); },
    async runAgent(_session, callbacks) {
      await callbacks.onToolApprovalRequest({callId: 'patch-1', toolName: 'apply_patch', argumentsText: 'patch'});
    }
  });

  assert.equal(harness.input.toolApproval.hasActiveRequest(), false);
  assert.equal(harness.appended.some((record) => record.role === 'local_notice' && /中断/.test(record.text)), true);
  assert.deepEqual(harness.hookEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_cancelled'
  ]);
});

test('runAssistantTurn ignores a late auto no after the turn is interrupted', async () => {
  const harness = createHarness({appSettings: {
    agentInstructionFileName: 'AGENTS.md', autoCompressImages: true, compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal', fileEditMode: 'apply_patch', skillCatalogContextRatio: 0.02,
    showReasoningSummary: true, slashSuggestionMaxVisible: 8, toolApprovalMode: 'auto', toolApprovalModelProfileId: 'reviewer'
  }});
  let resolveReview;
  const reviewer = () => new Promise((resolve) => { resolveReview = resolve; });
  const running = runAssistantTurn({
    ...harness.input,
    toolApprovalReviewer: reviewer,
    async runAgent(_session, callbacks) {
      const decision = await callbacks.onToolApprovalRequest({callId: 'patch-1', toolName: 'apply_patch', argumentsText: 'patch'});
      assert.equal(decision.kind, 'deny');
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.appContext.interruptActiveAssistantTurn().interrupted, true);
  resolveReview(false);
  await running;
  assert.equal(harness.input.toolApproval.hasActiveRequest(), false);
  assert.deepEqual(harness.hookEvents.map((event) => event.event), ['assistant_turn_start']);
});

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

test('runAssistantTurn queues drafts for the app activity clock and redraws structural events immediately', async () => {
  const harness = createHarness();
  const renderedStates = [];
  let synchronousDrains = 0;
  await runAssistantTurn({
    ...harness.input,
    render(finalizeRecord) {
      harness.input.render(finalizeRecord);
      synchronousDrains += 1;
      renderedStates.push(harness.appContext.createRenderState());
    },
    async runAgent(_session, callbacks) {
      callbacks.onReasoningUpdate({kind: 'draft', text: 'thinking'});
      callbacks.onReasoningUpdate({kind: 'draft', text: 'thinking more'});

      assert.equal(renderedStates.length, 0);
      assert.deepEqual(harness.appContext.createRenderState().pending, {kind: 'reasoning_streaming', text: 'thinking more'});

      callbacks.onReasoningUpdate({kind: 'complete', text: 'thinking more'});
      assert.equal(harness.appContext.turnContext.getPending(), null);
      const drainsBeforeTokens = synchronousDrains;
      callbacks.onToken('a', 'a');
      callbacks.onToken('b', 'ab');
      assert.deepEqual(harness.appContext.turnContext.getPending(), {kind: 'streaming', text: 'ab'});
      assert.equal(synchronousDrains, drainsBeforeTokens + 1);

      const renderCountBeforeToolCall = renderedStates.length;
      callbacks.onToolCall({callId: 'call-1', toolName: 'grep', argumentsText: '{"pattern":"ab"}'});
      assert.equal(renderedStates.length, renderCountBeforeToolCall + 1);
      assert.equal(renderedStates.at(-1).pending.kind, 'tool_call');

      callbacks.onComplete('ab');
      return 'ab';
    }
  });

  assert.equal(harness.appContext.turnContext.hasTimedActivity(), false);
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'reasoning_summary', 'assistant']);
  assert.equal(harness.appended[2].text, 'ab');
});

test('runAssistantTurn persists subagent events, restores pending after permission, and rejects late callbacks', async () => {
  const harness = createHarness({appSettings: {
    agentInstructionFileName: 'AGENTS.md', autoCompressImages: true, compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal', fileEditMode: 'apply_patch', skillCatalogContextRatio: 0.02,
    showReasoningSummary: true, slashSuggestionMaxVisible: 8, toolApprovalMode: 'manual'
  }});
  let capturedCallbacks;
  const base = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer-1', runId: 'run-1'};

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      capturedCallbacks = callbacks;
      callbacks.onToolCall({callId: 'outer-1', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"inspect"}'});
      callbacks.onSubagentRecords([{...base, text: 'inspect', event: {kind: 'start', task: 'inspect'}}]);
      callbacks.onSubagentActivity({agentName: 'explorer', phase: 'reasoning', runId: 'run-1', task: 'inspect', draft: 'checking'});
      assert.equal(harness.appContext.createRenderState().pending.kind, 'subagent');
      assert.equal(harness.appContext.createRenderState().pending.draft, 'checking');

      const approval = callbacks.onToolApprovalRequest({
        callId: 'inner-bash', toolName: 'run_bash_command', argumentsText: '{"command":"node inspect.js"}'
      }, {
        preview: 'node inspect.js',
        origin: {kind: 'subagent', agentName: 'explorer', runId: 'run-1'}
      });
      assert.equal(harness.input.toolApproval.hasActiveRequest(), true);
      harness.input.toolApproval.handleEvent({type: 'escape'});
      assert.deepEqual(await approval, {kind: 'deny'});
      assert.equal(harness.appContext.createRenderState().pending.kind, 'subagent');

      callbacks.onSubagentRecords([
        {...base, text: 'grep', event: {kind: 'tool_call', toolCallId: 'inner-1', toolName: 'grep', argumentsText: '{}'}},
        {...base, text: 'match', event: {kind: 'tool_result', toolCallId: 'inner-1', toolName: 'grep', ok: true, details: {kind: 'grep', truncated: false}}}
      ]);
      callbacks.onSubagentRecords([{...base, text: 'report', event: {kind: 'assistant'}}]);
      callbacks.onSubagentRecords([{...base, text: '', event: {kind: 'completed', durationMs: 15}}]);
      callbacks.onToolResult({callId: 'outer-1', toolName: 'run_subagent', ok: true, text: 'report', details: {kind: 'generic'}});
      callbacks.onComplete('parent answer');
      return 'parent answer';
    }
  });

  assert.deepEqual(harness.appContext.transcriptContext.getRecords().map((record) => record.role), [
    'user', 'subagent', 'subagent', 'subagent', 'subagent', 'subagent', 'tool_call', 'tool_result', 'assistant'
  ]);
  assert.equal(harness.appContext.subagentRunContext.getPending(), null);
  assert.equal(harness.appContext.turnContext.responding, false);
  const recordCount = harness.appContext.transcriptContext.getRecords().length;
  capturedCallbacks.onSubagentRecords([{...base, text: 'late', event: {kind: 'assistant'}}]);
  capturedCallbacks.onSubagentActivity({agentName: 'explorer', phase: 'streaming', runId: 'run-1', task: 'late'});
  assert.deepEqual(await capturedCallbacks.onToolApprovalRequest({callId: 'late', toolName: 'run_bash_command', argumentsText: '{}'}, {
    origin: {kind: 'subagent', agentName: 'explorer', runId: 'run-1'}
  }), {kind: 'deny', message: 'Tool execution was interrupted.'});
  assert.equal(harness.appContext.transcriptContext.getRecords().length, recordCount);
  assert.equal(harness.appContext.subagentRunContext.getPending(), null);
});

test('runAssistantTurn bridges Worker questions with run identity and rejects late requests', async () => {
  const harness = createHarness();
  let capturedCallbacks;
  const metadata = {agentName: 'worker', depth: 1, parentToolCallId: 'outer-worker', runId: 'worker-run'};
  const base = {role: 'subagent', text: 'ask user', agentName: 'worker', parentToolCallId: 'outer-worker', runId: 'worker-run'};

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      capturedCallbacks = callbacks;
      callbacks.onSubagentRecords([{...base, event: {kind: 'start', task: 'ask user'}}]);
      callbacks.onSubagentActivity({agentName: 'worker', phase: 'waiting_question', runId: 'worker-run', task: 'ask user', toolName: 'ask_user_questions'});
      const pending = callbacks.onSubagentUserQuestionRequest(metadata, {
        callId: 'worker-question', toolName: 'ask_user_questions', argumentsText: '{}'
      }, {questions: [{question: 'Proceed?', options: [{label: 'Yes'}, {label: 'No'}]}]});
      assert.equal(harness.input.userQuestion.getSurface().title, 'QUESTION · WORKER');
      assert.equal(harness.appContext.subagentRunContext.getPending().phase, 'waiting_question');
      harness.input.userQuestion.handleEvent({type: 'submit'});
      const result = await pending;
      assert.equal(result.ok, true);
      assert.match(result.text, /"selected":"Yes"/u);
      callbacks.onSubagentActivity({agentName: 'worker', phase: 'thinking', runId: 'worker-run', task: 'ask user'});
      assert.equal(harness.appContext.subagentRunContext.getPending().phase, 'thinking');
      callbacks.onSubagentRecords([{...base, text: '', event: {kind: 'completed', durationMs: 10}}]);
      callbacks.onComplete('done');
    }
  });

  const late = await capturedCallbacks.onSubagentUserQuestionRequest(metadata, {
    callId: 'late-question', toolName: 'ask_user_questions', argumentsText: '{}'
  }, {questions: [{question: 'Late?', options: [{label: 'Yes'}]}]});
  assert.equal(late.ok, false);
  assert.equal(harness.input.userQuestion.getSurface(), null);
});

test('runAssistantTurn cancels an active Worker question when the parent turn is interrupted', async () => {
  const harness = createHarness();
  let questionResult;
  const running = runAssistantTurn({
    ...harness.input,
    async runAgent(session, callbacks) {
      const metadata = {agentName: 'worker', depth: 1, parentToolCallId: 'outer', runId: 'worker-cancel'};
      callbacks.onSubagentRecords([{
        role: 'subagent', text: 'ask', agentName: 'worker', parentToolCallId: 'outer', runId: 'worker-cancel',
        event: {kind: 'start', task: 'ask'}
      }]);
      questionResult = await callbacks.onSubagentUserQuestionRequest(metadata, {
        callId: 'question-cancel', toolName: 'ask_user_questions', argumentsText: '{}'
      }, {questions: [{question: 'Wait?', options: [{label: 'Yes'}]}]});
      if (session.abortSignal.aborted) {
        throw new AgentAbortError();
      }
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.input.userQuestion.hasActiveRequest(), true);
  assert.equal(harness.appContext.interruptActiveAssistantTurn().interrupted, true);
  await running;
  assert.equal(questionResult.ok, false);
  assert.match(questionResult.text, /interrupted/u);
  assert.equal(harness.input.userQuestion.hasActiveRequest(), false);
  assert.equal(harness.appContext.turnContext.responding, false);
});

test('runAssistantTurn leaves high-frequency subagent activity rendering to the timer', async () => {
  const harness = createHarness();
  let renderCount = 0;

  await runAssistantTurn({
    ...harness.input,
    render(finalizeRecord) {
      renderCount += 1;
      harness.input.render(finalizeRecord);
    },
    async runAgent(_session, callbacks) {
      callbacks.onSubagentRecords([{
        role: 'subagent', text: 'inspect', agentName: 'explorer', parentToolCallId: 'outer', runId: 'run-timer',
        event: {kind: 'start', task: 'inspect'}
      }]);
      const beforeActivity = renderCount;
      callbacks.onSubagentActivity({agentName: 'explorer', phase: 'streaming', runId: 'run-timer', task: 'inspect', draft: 'a'});
      callbacks.onSubagentActivity({agentName: 'explorer', phase: 'streaming', runId: 'run-timer', task: 'inspect', draft: 'ab'});
      callbacks.onSubagentActivity({agentName: 'explorer', phase: 'reasoning', runId: 'run-timer', task: 'inspect', draft: 'checking'});
      assert.equal(renderCount, beforeActivity);
      callbacks.onSubagentRecords([{
        role: 'subagent', text: '', agentName: 'explorer', parentToolCallId: 'outer', runId: 'run-timer',
        event: {kind: 'completed', durationMs: 10}
      }]);
      callbacks.onComplete('done');
    }
  });
});

test('runAssistantTurn clears subagent pending and releases response lock after parent cancellation', async () => {
  const harness = createHarness();
  let capturedCallbacks;
  const running = runAssistantTurn({
    ...harness.input,
    async runAgent(session, callbacks) {
      capturedCallbacks = callbacks;
      callbacks.onSubagentRecords([{
        role: 'subagent', text: 'inspect', agentName: 'explorer', parentToolCallId: 'outer', runId: 'run-cancel',
        event: {kind: 'start', task: 'inspect'}
      }]);
      callbacks.onSubagentActivity({agentName: 'explorer', phase: 'thinking', runId: 'run-cancel', task: 'inspect'});
      await new Promise((resolve, reject) => {
        session.abortSignal.addEventListener('abort', () => {
          callbacks.onSubagentRecords([{
            role: 'subagent', text: 'Explorer cancelled.', agentName: 'explorer', parentToolCallId: 'outer', runId: 'run-cancel',
            event: {kind: 'cancelled', durationMs: 12}
          }]);
          reject(new AgentAbortError());
        }, {once: true});
      });
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.appContext.createRenderState().pending.kind, 'subagent');
  assert.equal(harness.appContext.interruptActiveAssistantTurn().interrupted, true);
  await running;
  assert.equal(harness.appContext.subagentRunContext.getPending(), null);
  assert.equal(harness.appContext.turnContext.responding, false);
  assert.equal(harness.appContext.transcriptContext.getRecords().some((record) => record.role === 'subagent' && record.event.kind === 'cancelled'), true);
  const count = harness.appContext.transcriptContext.getRecords().length;
  capturedCallbacks.onSubagentActivity({agentName: 'explorer', phase: 'streaming', runId: 'run-cancel', task: 'late'});
  assert.equal(harness.appContext.transcriptContext.getRecords().length, count);
  assert.equal(harness.appContext.subagentRunContext.getPending(), null);
});

test('runAssistantTurn asks the renderer to flush reasoning when assistant text starts', async () => {
  const harness = createHarness();
  const pendingAtFlush = [];

  await runAssistantTurn({
    ...harness.input,
    render(finalizeRecord) {
      harness.input.render(finalizeRecord);
      pendingAtFlush.push(harness.appContext.turnContext.getPending());
    },
    async runAgent(_session, callbacks) {
      callbacks.onReasoningUpdate({kind: 'draft', text: 'short reasoning'});
      callbacks.onToken('a', 'answer');
      callbacks.onReasoningUpdate({kind: 'complete', text: 'short reasoning'});
      callbacks.onComplete('answer');
      return 'answer';
    }
  });

  assert.deepEqual(pendingAtFlush[0], {
    kind: 'streaming',
    text: 'answer',
    reasoningText: 'short reasoning'
  });
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'reasoning_summary', 'assistant']);
  assert.deepEqual(harness.appendedProjections.filter(Boolean), ['reasoning', 'assistant']);
});

test('runAssistantTurn sends completed streaming records to the renderer by content kind', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onToken('x', 'alpha\n\nbeta');
      callbacks.onComplete('alpha\n\nbeta');
      return 'alpha\n\nbeta';
    }
  });

  assert.equal(harness.appended.at(-1).text, 'alpha\n\nbeta');
  assert.equal(harness.appendedProjections.at(-1), 'assistant');
});

test('runAssistantTurn resets streaming progress between tool-call assistant segments', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onToken('x', 'first segment');
      callbacks.onAssistantSegment('first segment');
      callbacks.onToolCall({callId: 'call-1', toolName: 'grep', argumentsText: '{}'});
      callbacks.onToolResult({callId: 'call-1', toolName: 'grep', ok: true, text: 'done', details: {kind: 'grep', truncated: false}});
      callbacks.onToken('y', 'second segment');
      callbacks.onComplete('second segment');
      return 'second segment';
    }
  });

  assert.deepEqual(harness.appended.filter((record) => record.role === 'assistant').map((record) => record.text), [
    'first segment',
    'second segment'
  ]);
  assert.deepEqual(harness.appendedProjections.filter(Boolean), ['assistant', 'assistant']);
});

test('runAssistantTurn preserves final streamed text without an activity tick', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onToken('o', 'ok');
      callbacks.onComplete('ok');
      return 'ok';
    }
  });

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
    async runAgent(_session, callbacks) {
      callbacks.onReasoningUpdate({kind: 'draft', text: 'partial reasoning'});
      throw new Error('upstream failed');
    }
  });

  assert.deepEqual(harness.hookEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_error'
  ]);
  assert.equal(harness.hookEvents[1].payload.status, 'error');
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'reasoning_summary', 'error']);
  assert.deepEqual(harness.debugEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_error'
  ]);
  assert.equal(harness.debugEvents[1].payload.errorMessage, 'upstream failed');
  assert.match(harness.appended.at(-1).text, /upstream failed/);
  assert.equal(harness.appContext.turnContext.getPending(), null);
  assert.equal(harness.appContext.turnContext.responding, false);
});

test('runAssistantTurn commits completed reasoning without clearing an active assistant draft', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onReasoningUpdate({kind: 'draft', text: 'thinking'});
      callbacks.onToken('d', 'draft');
      assert.deepEqual(harness.appContext.turnContext.getPending(), {kind: 'streaming', text: 'draft', reasoningText: 'thinking'});

      callbacks.onReasoningUpdate({kind: 'complete', text: 'thinking'});
      assert.deepEqual(harness.appContext.turnContext.getPending(), {kind: 'streaming', text: 'draft'});
      callbacks.onComplete('draft');
      return 'draft';
    }
  });

  assert.deepEqual(harness.appended.map((record) => record.role), [
    'user',
    'reasoning_summary',
    'assistant'
  ]);
  assert.equal(harness.appended[1].text, 'thinking');
  assert.equal(harness.appended[2].text, 'draft');
});

test('runAssistantTurn preserves completed reasoning and partial assistant text when the later stream fails', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onReasoningUpdate({kind: 'complete', text: 'complete reasoning'});
      assert.ok(harness.appContext.turnContext.getWorking());
      callbacks.onToken('p', 'partial');
      throw new Error('upstream failed');
    }
  });

  assert.deepEqual(harness.appended.map((record) => record.role), [
    'user',
    'reasoning_summary',
    'assistant',
    'error'
  ]);
  assert.equal(harness.appended[1].text, 'complete reasoning');
  assert.equal(harness.appended[2].text, 'partial');
});

test('runAssistantTurn ignores late reasoning update callbacks after completion', async () => {
  const harness = createHarness();
  let capturedCallbacks;

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      capturedCallbacks = callbacks;
      callbacks.onReasoningUpdate({kind: 'draft', text: 'live reasoning'});
      assert.deepEqual(harness.appContext.turnContext.getPending(), {kind: 'reasoning_streaming', text: 'live reasoning'});
      callbacks.onComplete('done');
      return 'done';
    }
  });

  capturedCallbacks.onReasoningUpdate({kind: 'draft', text: 'late reasoning'});

  assert.equal(harness.appContext.turnContext.getPending(), null);
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'assistant']);
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
    render(finalizeRecord) {
      harness.input.render(finalizeRecord);
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
