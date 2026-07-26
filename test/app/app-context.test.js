const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const composerOps = require('../../src/input/composer');
const { AppContext } = require('../../src/app/state/app-context');
const { ComposerContext } = require('../../src/app/state/composer-context');
const { ToolApprovalContext } = require('../../src/app/state/tool-approval-context');
const { UserQuestionContext } = require('../../src/app/state/user-question-context');
const { ModelContext } = require('../../src/app/state/model-context');
const { RenderContext } = require('../../src/app/state/render-context');
const { SlashSuggestionContext } = require('../../src/app/state/slash-suggestion-context');
const { TranscriptContext } = require('../../src/app/state/transcript-context');
const { TurnContext } = require('../../src/app/state/turn-context');
const { INPUT_EVENTS } = require('../../src/input/event-types');
const { DEFAULT_TUI_THEME, createTuiTheme } = require('../../src/config/theme-config');

function createContext(overrides = {}) {
  const terminal = overrides.terminal || {
      getSize() {
        return { columns: 80, rows: 24 };
      }
    };

  return new AppContext(
    terminal,
    overrides.transcriptStore || createFakeTranscriptStore(),
    overrides.cwd || '/tmp/echo_tui',
    overrides.nodeVersion || 'v20.0.0',
    overrides.theme,
    overrides.appSettings
  );
}

function createFakeTranscriptStore(initialSessions = []) {
  const sessionsByCwd = new Map();
  const saveCalls = [];
  const operations = [];
  let nextSessionIndex = 1;

  for (const session of initialSessions) {
    const cwd = session.cwd || '/tmp/echo_tui';
    const sessions = sessionsByCwd.get(cwd) || [];
    sessions.push({
      session: cloneSession({...session, cwd}),
      reference: {
        sessionId: session.sessionId,
        cwd,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        sequence: 0
      }
    });
    sessionsByCwd.set(cwd, sessions);
    nextSessionIndex = Math.max(nextSessionIndex, extractSessionIndex(session.sessionId) + 1);
  }

  function getSessions(cwd) {
    if (!sessionsByCwd.has(cwd)) {
      sessionsByCwd.set(cwd, []);
    }

    return sessionsByCwd.get(cwd);
  }

  function createSession(cwd, operation) {
    const timestamp = `2026-05-19T00:00:0${nextSessionIndex}.000Z`;
    const session = {
      schemaVersion: 1,
      sessionId: `session-${nextSessionIndex}`,
      cwd,
      createdAt: timestamp,
      updatedAt: timestamp,
      records: []
    };
    const reference = {
      sessionId: session.sessionId,
      cwd,
      createdAt: timestamp,
      updatedAt: timestamp,
      sequence: 1
    };

    nextSessionIndex += 1;
    applyOperation(session, operation);
    getSessions(cwd).push({session, reference});
    operations.push(structuredClone(operation));
    saveCalls.push(cloneSession(session));
    return {...reference};
  }

  function appendSession(cwd, reference, operation) {
    const entry = getSessions(cwd).find((candidate) => candidate.reference.sessionId === reference.sessionId);

    if (!entry) {
      throw new Error('missing session');
    }

    applyOperation(entry.session, operation);
    operations.push(structuredClone(operation));
    entry.reference = {
      ...entry.reference,
      updatedAt: new Date().toISOString(),
      sequence: entry.reference.sequence + 1
    };
    entry.session.updatedAt = entry.reference.updatedAt;
    saveCalls.push(cloneSession(entry.session));
    return {...entry.reference};
  }

  function listSessions(cwd) {
    return getSessions(cwd)
      .map(({session}) => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        cwd: session.cwd,
        messageCount: session.records.length,
        lastMessagePreview: session.records.length > 0 ? session.records.at(-1).text : '空会话',
        previewRecords: createPreviewRecords(session.records)
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  function loadSession(cwd, sessionId) {
    const entry = getSessions(cwd).find((candidate) => candidate.reference.sessionId === sessionId);
    return entry ? {session: cloneSession(entry.session), reference: {...entry.reference}} : null;
  }

  return {
    createSession,
    appendSession,
    listSessions,
    loadSession,
    operations,
    saveCalls
  };
}

function cloneSession(session) {
  return {
    ...session,
    ...(session.changeHistory ? {changeHistory: structuredClone(session.changeHistory)} : {}),
    ...(session.compaction ? {compaction: {...session.compaction}} : {}),
    ...(session.todoState ? {todoState: structuredClone(session.todoState)} : {}),
    records: (session.records || []).map((record) => ({ ...record }))
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

function createPreviewRecords(records) {
  return (records || [])
    .map((record) => ({ role: record.role, text: String(record.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((record) => record.text.length > 0)
    .slice(-5);
}

function withTemporaryModelConfig(config, callback) {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-model-context-'));
  const configPath = path.join(homeDir, '.echo', 'config.json');

  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  os.homedir = () => homeDir;

  try {
    return callback({
      configPath,
      readConfig() {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    });
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
}

function extractSessionIndex(sessionId) {
  const matched = String(sessionId || '').match(/session-(\d+)$/);
  return matched ? Number(matched[1]) : 0;
}

test('AppContext creates isolated runtime state per app instance', () => {
  const firstContext = createContext();
  const secondContext = createContext();

  assert.equal(firstContext.composerContext instanceof ComposerContext, true);
  assert.equal(firstContext.transcriptContext instanceof TranscriptContext, true);
  assert.equal(firstContext.modelContext instanceof ModelContext, true);
  assert.equal(firstContext.turnContext instanceof TurnContext, true);
  assert.equal(firstContext.renderContext instanceof RenderContext, true);
  assert.equal(firstContext.slashSuggestionContext instanceof SlashSuggestionContext, true);
  assert.equal(Object.hasOwn(firstContext, 'composer'), false);
  assert.equal(Object.hasOwn(firstContext, 'transcriptRecords'), false);
  assert.equal(Object.hasOwn(firstContext, 'currentSessionId'), false);
  assert.equal(Object.hasOwn(firstContext, 'previousColumns'), false);
  assert.equal(Object.hasOwn(firstContext, 'responding'), false);
  assert.equal(Object.hasOwn(firstContext, 'pending'), false);
  assert.equal(Object.hasOwn(firstContext, 'inputHistory'), false);
  assert.equal(Object.hasOwn(firstContext, 'historyIndex'), false);

  firstContext.beginUserTurn('hello');
  firstContext.turnContext.enterSpinnerState('thinking');

  assert.deepEqual(firstContext.transcriptContext.records, [{ role: 'user', text: 'hello', metadata: {} }]);
  assert.deepEqual(firstContext.composerContext.inputHistory, ['hello']);
  assert.equal(firstContext.turnContext.responding, true);
  const firstPending = firstContext.turnContext.getPending();
  assert.equal(firstPending.kind, 'thinking');
  assert.equal(typeof firstPending.elapsedMs, 'number');

  assert.deepEqual(secondContext.transcriptContext.records, []);
  assert.deepEqual(secondContext.composerContext.inputHistory, []);
  assert.equal(secondContext.turnContext.responding, false);
  assert.equal(secondContext.turnContext.getPending(), null);
  assert.equal(composerOps.getText(secondContext.composerContext.composer), '');
});

test('AppContext undo restores transcript records and compaction state', () => {
  const transcriptStore = createFakeTranscriptStore();
  const context = createContext({transcriptStore});
  const compaction = {summaryText: 'old summary', activeStartIndex: 1, createdAt: '2026-05-19T00:00:00.000Z'};

  context.transcriptContext.appendRecord({role: 'user', text: 'before'});
  context.transcriptContext.setCompaction(compaction);
  context.beginChangeCheckpoint();
  context.transcriptContext.appendRecord({role: 'user', text: 'change'});
  context.transcriptContext.appendRecord({role: 'reasoning_summary', text: 'thinking'});
  context.transcriptContext.appendRecord({role: 'tool_call', text: '', toolCallId: 'call-1', toolName: 'apply_patch', argumentsText: '{}'});
  context.transcriptContext.appendRecord({role: 'tool_result', text: 'ok', toolCallId: 'call-1', toolName: 'apply_patch', ok: true});
  context.transcriptContext.appendRecord({role: 'assistant', text: 'done'});
  context.finalizeChangeCheckpoint();

  const result = context.executeUndo();

  assert.equal(result.ok, true);
  assert.deepEqual(context.transcriptContext.records, [{role: 'user', text: 'before'}]);
  assert.deepEqual(context.transcriptContext.compaction, compaction);
  assert.equal(transcriptStore.saveCalls.at(-1).records.length, 1);
  assert.deepEqual(transcriptStore.saveCalls.at(-1).compaction, compaction);
  assert.deepEqual(transcriptStore.operations.at(-1).operations.map((operation) => operation.op), [
    'truncate_records',
    'set_compaction',
    'set_change_history'
  ]);
});

test('AppContext appends compaction notice and state in one journal batch', () => {
  const transcriptStore = createFakeTranscriptStore();
  const context = createContext({transcriptStore});
  const compaction = {summaryText: 'summary', activeStartIndex: 1, createdAt: '2026-05-19T00:00:00.000Z'};

  context.transcriptContext.appendRecord({role: 'user', text: 'before'});
  context.transcriptContext.applyCompaction(compaction);

  const operation = transcriptStore.operations.at(-1);
  assert.equal(operation.op, 'batch');
  assert.deepEqual(operation.operations.map((item) => item.op), ['append_records', 'set_compaction']);
  assert.deepEqual(operation.operations[0].records, [{
    role: 'compaction_notice',
    text: '已将较早的 1 条历史压缩为摘要'
  }]);
  assert.deepEqual(operation.operations[1].compaction, compaction);
});

test('AppContext does not retain records whose journal append fails', () => {
  const transcriptStore = createFakeTranscriptStore();
  const context = createContext({transcriptStore});
  const appendSession = transcriptStore.appendSession;

  context.transcriptContext.appendRecord({role: 'user', text: 'saved'});
  transcriptStore.appendSession = () => {
    throw new Error('append failed');
  };

  assert.throws(() => context.transcriptContext.appendRecord({role: 'assistant', text: 'not saved'}), /append failed/);
  assert.deepEqual(context.transcriptContext.records, [{role: 'user', text: 'saved'}]);

  transcriptStore.appendSession = appendSession;
  context.transcriptContext.appendRecord({role: 'assistant', text: 'continued'});
  assert.deepEqual(transcriptStore.saveCalls.at(-1).records, [
    {role: 'user', text: 'saved'},
    {role: 'assistant', text: 'continued'}
  ]);
});

test('AppContext keeps the undo checkpoint when journal truncation fails', () => {
  const transcriptStore = createFakeTranscriptStore();
  const context = createContext({transcriptStore});
  const appendSession = transcriptStore.appendSession;

  context.transcriptContext.appendRecord({role: 'user', text: 'before'});
  context.beginChangeCheckpoint();
  context.transcriptContext.appendRecord({role: 'user', text: 'change'});
  context.finalizeChangeCheckpoint();
  transcriptStore.appendSession = (_cwd, _reference, operation) => {
    if (operation.op === 'batch' && operation.operations.some((item) => item.op === 'truncate_records')) {
      throw new Error('truncate failed');
    }

    return appendSession(_cwd, _reference, operation);
  };

  const result = context.executeUndo();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'restore_failed');
  assert.equal(context.changeHistoryContext.getSummary().status, 'ready');
  assert.deepEqual(context.transcriptContext.records, [
    {role: 'user', text: 'before'},
    {role: 'user', text: 'change'}
  ]);
});

test('AppContext undo can remove interrupted turn records without appending a success notice', () => {
  const context = createContext();

  context.beginChangeCheckpoint();
  context.transcriptContext.appendRecord({role: 'user', text: 'change'});
  context.transcriptContext.appendRecord({role: 'assistant', text: 'partial'});
  context.transcriptContext.appendRecord({role: 'local_notice', text: '已中断模型回答'});
  context.finalizeChangeCheckpoint();

  const result = context.executeUndo();

  assert.equal(result.ok, true);
  assert.deepEqual(context.transcriptContext.records, []);
});

test('AppContext undo can step through multiple ready checkpoints', () => {
  const context = createContext();

  context.beginChangeCheckpoint();
  context.transcriptContext.appendRecord({role: 'user', text: 'first'});
  context.transcriptContext.appendRecord({role: 'assistant', text: 'first done'});
  context.finalizeChangeCheckpoint();

  context.beginChangeCheckpoint();
  context.transcriptContext.appendRecord({role: 'user', text: 'second'});
  context.transcriptContext.appendRecord({role: 'assistant', text: 'second done'});
  context.finalizeChangeCheckpoint();

  let result = context.executeUndo();

  assert.equal(result.ok, true);
  assert.deepEqual(context.transcriptContext.records, [
    {role: 'user', text: 'first'},
    {role: 'assistant', text: 'first done'}
  ]);

  result = context.executeUndo();

  assert.equal(result.ok, true);
  assert.deepEqual(context.transcriptContext.records, []);
  assert.deepEqual(context.changeHistoryContext.getSummary(), {status: 'none'});
});

test('AppContext invalid change checkpoint blocks older history', () => {
  const context = createContext();

  context.beginChangeCheckpoint();
  context.transcriptContext.appendRecord({role: 'user', text: 'first'});
  context.transcriptContext.appendRecord({role: 'assistant', text: 'first done'});
  context.finalizeChangeCheckpoint();

  context.beginChangeCheckpoint();
  context.transcriptContext.appendRecord({role: 'user', text: 'second'});
  context.changeHistoryContext.invalidate('写入型 bash 不可追踪');
  context.finalizeChangeCheckpoint();

  const result = context.executeUndo();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid');
  assert.deepEqual(context.changeHistoryContext.getSummary(), {status: 'invalid', reason: '写入型 bash 不可追踪'});
  assert.deepEqual(context.transcriptContext.records, [
    {role: 'user', text: 'first'},
    {role: 'assistant', text: 'first done'},
    {role: 'user', text: 'second'}
  ]);
});

test('AppContext owns slash suggestion state and exposes it through render state', () => {
  let activeCommandSession = false;
  const context = createContext();

  context.configureSlashSuggestions([
    { name: 'help', description: '查看帮助' },
    { name: 'model', description: '切换模型' }
  ], () => activeCommandSession);

  composerOps.setText(context.composerContext.composer, '/');
  assert.deepEqual(context.createRenderState().slashSuggestions, {
    selectedIndex: 0,
    options: [
      { label: '/help', description: '查看帮助' },
      { label: '/model', description: '切换模型' }
    ]
  });

  assert.equal(context.handleSlashSuggestionEvent({ type: INPUT_EVENTS.MOVE_UP }), true);
  assert.equal(context.createRenderState().slashSuggestions.selectedIndex, 1);

  assert.equal(context.handleSlashSuggestionEvent({ type: INPUT_EVENTS.ESCAPE }), false);
  assert.equal(context.createRenderState().slashSuggestions.selectedIndex, 1);
  composerOps.setText(context.composerContext.composer, '');
  assert.equal(context.createRenderState().slashSuggestions, null);
  composerOps.setText(context.composerContext.composer, '/');
  assert.deepEqual(context.createRenderState().slashSuggestions, {
    selectedIndex: 0,
    options: [
      { label: '/help', description: '查看帮助' },
      { label: '/model', description: '切换模型' }
    ]
  });

  assert.equal(context.handleSlashSuggestionEvent({ type: INPUT_EVENTS.MOVE_UP }), true);

  assert.equal(context.handleSlashSuggestionEvent({ type: INPUT_EVENTS.TAB }), true);
  assert.equal(composerOps.getText(context.composerContext.composer), '/model ');

  activeCommandSession = true;
  assert.equal(context.createRenderState().slashSuggestions, null);
});

test('AppContext completes selected slash suggestion before submit', () => {
  const context = createContext();

  context.configureSlashSuggestions([
    { name: 'help', description: '查看帮助' },
    { name: 'model', description: '切换模型' }
  ], () => false);

  composerOps.setText(context.composerContext.composer, '/');
  assert.equal(context.handleSlashSuggestionEvent({ type: INPUT_EVENTS.MOVE_UP }), true);

  assert.equal(context.handleSlashSuggestionEvent({ type: INPUT_EVENTS.SUBMIT }), false);
  assert.equal(composerOps.getText(context.composerContext.composer), '/model');
});

test('AppContext status line includes explicit reasoning effort', () => {
  const context = createContext();
  context.modelContext = {
    getStatusLineModelState() {
      return {modelLabel: 'gpt-deep', reasoningEffort: 'high'};
    }
  };

  assert.equal(context.createRenderState().statusLine.model.label, 'gpt-deep');
  assert.equal(context.createRenderState().statusLine.model.effort, 'high');
});

test('AppContext status line omits effort when profile has no explicit effort', () => {
  const context = createContext();
  context.modelContext = {
    getStatusLineModelState() {
      return {modelLabel: 'gpt-fast'};
    }
  };

  assert.equal(context.createRenderState().statusLine.model.label, 'gpt-fast');
  assert.equal(context.createRenderState().statusLine.model.effort, undefined);
});

test('AppContext uses a fixed skill model only for the active assistant turn', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'sk-test-key'}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'},
        {id: 'skill-deep', provider: 'openai', model: 'claude-sonnet-4-6', reasoning: {effort: 'high'}}
      ]
    }
  };

  withTemporaryModelConfig(config, () => {
    const context = createContext();
    const turn = context.beginAssistantTurn('skill-deep');
    const activeStatus = context.createRenderState().statusLine;

    assert.equal(activeStatus.model.label, 'claude-sonnet-4-6');
    assert.equal(activeStatus.model.effort, 'high');
    assert.equal(activeStatus.model.skillOverride, true);

    context.turnContext.clearAssistantTurnIfCurrent(turn);

    const restoredStatus = context.createRenderState().statusLine;
    assert.equal(restoredStatus.model.label, 'gpt-fast');
    assert.equal(restoredStatus.model.effort, undefined);
    assert.equal(restoredStatus.model.skillOverride, undefined);
  });
});

test('AppContext falls back to the global status model for a missing skill profile', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'sk-test-key'}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'}
      ]
    }
  };

  withTemporaryModelConfig(config, () => {
    const context = createContext();
    const turn = context.beginAssistantTurn('deleted-profile');
    const status = context.createRenderState().statusLine;

    assert.equal(status.model.label, 'gpt-fast');
    assert.equal(status.model.skillOverride, undefined);

    context.turnContext.clearAssistantTurnIfCurrent(turn);
  });
});

test('AppContext applies skill effort independently from a fixed or stale model override', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'sk-test-key'}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast', reasoning: {effort: 'low'}},
        {id: 'deep', provider: 'openai', model: 'gpt-deep', reasoning: {effort: 'high'}}
      ]
    }
  };

  withTemporaryModelConfig(config, () => {
    const context = createContext();
    const fixedTurn = context.beginAssistantTurn('deep', 'minimal');
    const fixedStatus = context.createRenderState().statusLine;

    assert.equal(fixedStatus.model.label, 'gpt-deep');
    assert.equal(fixedStatus.model.effort, 'minimal');
    assert.equal(fixedStatus.model.skillOverride, true);
    context.turnContext.clearAssistantTurnIfCurrent(fixedTurn);

    const staleTurn = context.beginAssistantTurn('deleted-profile', 'none');
    const staleStatus = context.createRenderState().statusLine;

    assert.equal(staleStatus.model.label, 'gpt-fast');
    assert.equal(staleStatus.model.effort, 'none');
    assert.equal(staleStatus.model.skillOverride, true);
    context.turnContext.clearAssistantTurnIfCurrent(staleTurn);

    assert.equal(context.createRenderState().statusLine.model.effort, 'low');
    assert.equal(context.createRenderState().statusLine.model.skillOverride, undefined);
  });
});

test('AppContext status line reads cached model state without rereading user config', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'sk-test-key'}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'},
        {id: 'deep', provider: 'openai', model: 'gpt-deep'}
      ]
    }
  };

  withTemporaryModelConfig(config, ({configPath}) => {
    const context = createContext();

    assert.equal(context.createRenderState().statusLine.model.label, 'gpt-fast');

    fs.writeFileSync(configPath, JSON.stringify({
      llm: {
        ...config.llm,
        selectedModel: 'deep'
      }
    }), 'utf8');

    assert.equal(context.createRenderState().statusLine.model.label, 'gpt-fast');
    assert.equal(context.createRenderState().statusLine.model.label, 'gpt-fast');

    context.modelContext.createModelCommandInfo();

    assert.equal(context.createRenderState().statusLine.model.label, 'gpt-deep');
  });
});

test('AppContext skips status-line model cache reads while command surface is open', () => {
  const context = createContext();
  let readCount = 0;
  context.modelContext = {
    getStatusLineModelState() {
      readCount += 1;
      return {modelLabel: 'cached-model'};
    }
  };

  assert.equal(context.createRenderState({commandSurface: {kind: 'info'}}).statusLine, undefined);
  assert.equal(readCount, 0);
  assert.equal(context.createRenderState().statusLine.model.label, 'cached-model');
  assert.equal(readCount, 1);
});

test('AppContext projects tool approval allow-all state into status line', () => {
  const context = createContext();
  const toolApproval = new ToolApprovalContext(() => {});

  assert.equal(context.createRenderState({ toolApproval }).statusLine.allowAllTools, undefined);
  assert.equal(toolApproval.toggleAllowAllForSession(), true);
  assert.equal(context.createRenderState({ toolApproval }).statusLine.allowAllTools, true);
  assert.equal(toolApproval.toggleAllowAllForSession(), false);
  assert.equal(context.createRenderState({ toolApproval }).statusLine.allowAllTools, undefined);
});

test('AppContext snapshots app settings into render state and agent sessions', () => {
  const context = createContext({
    appSettings: {
      compactionThresholdRatio: 0.65,
      showReasoningSummary: false,
      slashSuggestionMaxVisible: 3
    }
  });

  assert.deepEqual(context.createRenderState().renderPreferences, {
    showReasoningSummary: false,
    slashSuggestionMaxVisible: 3
  });
  assert.equal(context.getAgentSession().compactionThresholdRatio, 0.65);
});

test('AppContext refreshes external app settings and classifies redraw impact', () => {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-app-settings-'));
  os.homedir = () => homeDir;

  try {
    fs.mkdirSync(path.join(homeDir, '.echo'), {recursive: true});
    fs.writeFileSync(path.join(homeDir, '.echo', 'config.json'), JSON.stringify({
      compaction: {thresholdRatio: 0.65},
      ui: {showReasoningSummary: false, slashSuggestionMaxVisible: 4}
    }));
    const context = createContext();
    const result = context.refreshAppSettingsFromConfig();

    assert.deepEqual(result, {
      reasoningVisibilityChanged: true,
      slashSuggestionLimitChanged: true
    });
    assert.equal(context.getAgentSession().compactionThresholdRatio, 0.65);
    assert.deepEqual(context.createRenderState().renderPreferences, {
      showReasoningSummary: false,
      slashSuggestionMaxVisible: 4
    });
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
});

test('AppContext status line shows plan mode without exit hint', () => {
  const context = createContext();

  assert.equal(context.getInteractionMode(), 'normal');
  context.setInteractionMode('plan');

  const renderState = context.createRenderState();

  assert.equal(renderState.statusLine.mode, 'plan');
  assert.equal(renderState.statusLine.keyHint, undefined);
  assert.equal(context.getAgentSession().interactionMode, 'plan');
});

test('AppContext keeps plan status line mode while assistant output streams', () => {
  const context = createContext();

  context.setInteractionMode('plan');
  context.turnContext.setStreamingPending('draft');

  const renderState = context.createRenderState();

  assert.equal(renderState.statusLine.mode, 'plan');
  assert.deepEqual(renderState.pending, { kind: 'streaming', text: 'draft' });
});

test('AppContext keeps plan status line mode while waiting for first assistant token', () => {
  const context = createContext();

  context.setInteractionMode('plan');
  context.beginUserTurn('plan');
  context.beginAssistantTurn();
  context.turnContext.enterSpinnerState('thinking');

  const renderState = context.createRenderState();

  assert.equal(renderState.statusLine.mode, 'plan');
  assert.equal(renderState.statusLine.keyHint, 'Esc 中断');
  assert.equal(renderState.statusLine.activity.kind, 'thinking');
  assert.equal(renderState.pending.kind, 'thinking');
});

test('AppContext status line shows Esc interrupt throughout an active assistant turn', () => {
  const context = createContext();

  context.beginUserTurn('work');
  context.beginAssistantTurn();

  assert.equal(context.createRenderState().statusLine.keyHint, 'Esc 中断');

  context.turnContext.enterSpinnerState('thinking');
  assert.equal(context.createRenderState().statusLine.keyHint, 'Esc 中断');

  context.turnContext.setStreamingPending('draft');
  assert.equal(context.createRenderState().statusLine.keyHint, 'Esc 中断');

  context.turnContext.setToolCallPending({id: 'call-1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}'});
  assert.equal(context.createRenderState().statusLine.keyHint, 'Esc 中断');

  context.turnContext.finishAssistantTurn('done');
  assert.equal(context.createRenderState().statusLine.keyHint, undefined);
});

test('AppContext does not advertise Esc interrupt for manual compaction without an active assistant turn', () => {
  const context = createContext();

  context.turnContext.beginManualCompaction();
  context.turnContext.enterSpinnerState('working');

  assert.equal(context.createRenderState().statusLine.keyHint, undefined);
});

test('AppContext status line shows Esc interrupt while a shell command is running', () => {
  const context = createContext();

  context.setInteractionMode('shell');
  context.turnContext.beginShellCommand('npm test');

  assert.equal(context.createRenderState().statusLine.keyHint, 'Esc 中断');
});

test('AppContext cycles through four interaction modes', () => {
  const context = createContext();

  assert.equal(context.cycleInteractionMode(), 'plan');
  assert.equal(context.createRenderState().statusLine.mode, 'plan');
  assert.equal(context.cycleInteractionMode(), 'shell');
  assert.equal(context.createRenderState().statusLine.mode, 'shell');
  assert.equal(context.getAgentSession().interactionMode, 'shell');
  assert.equal(context.cycleInteractionMode(), 'shell-local');
  assert.equal(context.createRenderState().statusLine.mode, 'shell-local');
  assert.equal(context.getAgentSession().interactionMode, 'shell-local');
  assert.equal(context.cycleInteractionMode(), 'normal');
  assert.equal(context.createRenderState().statusLine.mode, 'idle');
});

test('AppContext injects only effective model-visible mode transitions and ignores shell commands', () => {
  const context = createContext();

  context.setInteractionMode('plan');
  context.setInteractionMode('shell');
  context.setInteractionMode('normal');
  const unchanged = context.beginUserTurn('normal request');
  context.turnContext.finishAssistantTurn('done');

  assert.equal(unchanged.text, 'normal request');
  assert.equal(unchanged.metadata?.modeTransition, undefined);

  context.setInteractionMode('plan');
  const enteringPlan = context.beginUserTurn('inspect only');
  context.turnContext.finishAssistantTurn('planned');

  assert.deepEqual(enteringPlan.metadata?.modeTransition, {from: 'normal', to: 'plan'});

  context.setInteractionMode('shell');
  context.turnContext.beginShellCommand('pwd');
  context.turnContext.finishShellCommand({
    command: 'pwd',
    durationMs: 1,
    exitCode: 0,
    output: '/tmp/echo_tui\n',
    stderr: '',
    stdout: '/tmp/echo_tui\n',
    timedOut: false,
    truncated: false
  }, true);
  context.setInteractionMode('normal');
  const leavingPlan = context.beginUserTurn('implement now');

  assert.deepEqual(leavingPlan.metadata?.modeTransition, {from: 'plan', to: 'normal'});
  assert.match(leavingPlan.text, /Previous Plan Mode restrictions no longer apply/);
});

test('TurnContext persists shell offloading marker before the bounded terminal tail', () => {
  const context = createContext();
  const offloadFilePath = '/tmp/echo-tool-results/full.txt';

  context.turnContext.beginShellCommand('printf output');
  const record = context.turnContext.finishShellCommand({
    command: 'printf output',
    durationMs: 2,
    exitCode: 0,
    offloadFilePath,
    output: 'tail output',
    stderr: '',
    stdout: 'tail output',
    timedOut: false,
    truncated: true
  }, true);

  assert.equal(record.output, `[tool result truncated: ${offloadFilePath}]\n\ntail output`);
  assert.match(record.text, /^\$ printf output\n\n\[tool result truncated: \/tmp\/echo-tool-results\/full\.txt\]\n\ntail output$/);
  assert.doesNotMatch(record.text, /\[output truncated\]/);
});

test('AppContext preserves display text and composer history for mode transition messages', () => {
  const context = createContext();
  context.setInteractionMode('plan');

  const record = context.beginUserTurn('expanded image request', {
    displayText: '@image.png'
  });

  assert.match(record.text, /\[User Request\]\nexpanded image request$/);
  assert.equal(record.displayText, '@image.png');
  assert.deepEqual(context.composerContext.getInputHistory(), ['@image.png']);
});

test('AppContext rebuilds model-visible mode after resume and clear', () => {
  const transcriptStore = createFakeTranscriptStore([{
    sessionId: 'plan-session',
    cwd: '/tmp/echo_tui',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    records: [
      {role: 'user', text: 'plan request', metadata: {interactionMode: 'plan'}},
      {role: 'assistant', text: 'plan response'}
    ]
  }]);
  const context = createContext({transcriptStore});

  assert.ok(context.loadTranscriptSession('plan-session'));
  context.setInteractionMode('normal');
  const afterResume = context.beginUserTurn('implement after resume');
  context.turnContext.finishAssistantTurn('done');

  assert.deepEqual(afterResume.metadata?.modeTransition, {from: 'plan', to: 'normal'});

  context.setInteractionMode('plan');
  context.clearTranscriptRecords();
  const afterClear = context.beginUserTurn('new plan context');

  assert.deepEqual(afterClear.metadata?.modeTransition, {from: 'normal', to: 'plan'});
});

test('AppContext rebuilds model-visible mode after undo truncates a transition', () => {
  const transcriptStore = createFakeTranscriptStore([{
    sessionId: 'undo-mode-session',
    cwd: '/tmp/echo_tui',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    records: [
      {role: 'user', text: 'normal request', metadata: {interactionMode: 'normal'}},
      {role: 'assistant', text: 'normal response'},
      {role: 'user', text: 'plan request', metadata: {interactionMode: 'plan', modeTransition: {from: 'normal', to: 'plan'}}},
      {role: 'assistant', text: 'plan response'}
    ],
    changeHistory: [{
      id: 'mode-checkpoint',
      createdAt: '2026-05-19T00:00:01.000Z',
      cwd: '/tmp/echo_tui',
      transcriptStartIndex: 2,
      status: 'ready',
      files: []
    }]
  }]);
  const context = createContext({transcriptStore});

  assert.ok(context.loadTranscriptSession('undo-mode-session'));
  context.setInteractionMode('plan');
  assert.equal(context.executeUndo().ok, true);
  const afterUndo = context.beginUserTurn('plan again');

  assert.deepEqual(afterUndo.metadata?.modeTransition, {from: 'normal', to: 'plan'});
});

test('AppContext stores transient context usage in render state without persistence', () => {
  const transcriptStore = createFakeTranscriptStore();
  const context = createContext({ transcriptStore });

  assert.equal(context.createRenderState().statusLine.contextUsage, undefined);

  context.setContextUsage({ usedTokens: 1200, contextWindow: 128000, source: 'provider' });

  assert.deepEqual(context.createRenderState().statusLine.contextUsage, {
    usedTokens: 1200,
    contextWindow: 128000,
    source: 'provider'
  });

  context.transcriptContext.appendRecord({ role: 'user', text: 'hello' });
  assert.equal(transcriptStore.saveCalls[0].contextUsage, undefined);
  assert.equal(transcriptStore.saveCalls[0].records[0].contextUsage, undefined);

  context.clearContextUsage();
  assert.equal(context.createRenderState().statusLine.contextUsage, undefined);
});

test('AppContext clears context usage when transcript is cleared or resumed', () => {
  const transcriptStore = createFakeTranscriptStore([
    {
      sessionId: 'session-1',
      cwd: '/tmp/echo_tui',
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
      records: [{ role: 'user', text: 'resume me' }]
    }
  ]);
  const context = createContext({ transcriptStore });

  context.setContextUsage({ usedTokens: 1200, contextWindow: 128000, source: 'provider' });
  context.clearTranscriptRecords();
  context.clearContextUsage();
  assert.equal(context.createRenderState().statusLine.contextUsage, undefined);

  context.setContextUsage({ usedTokens: 2400, contextWindow: 128000, source: 'provider' });
  assert.ok(context.loadTranscriptSession('session-1'));
  context.clearContextUsage();
  assert.equal(context.createRenderState().statusLine.contextUsage, undefined);
});

test('AppContext persists, resumes, clears, and snapshots todo state', () => {
  const transcriptStore = createFakeTranscriptStore([
    {
      sessionId: 'session-1',
      cwd: '/tmp/echo_tui',
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
      records: [{ role: 'user', text: 'resume me' }],
      todoState: {
        updatedAt: '2026-05-19T00:00:01.000Z',
        items: [{id: 'todo_1', text: 'resume todo', status: 'open'}]
      }
    }
  ]);
  const context = createContext({ transcriptStore });

  assert.ok(context.loadTranscriptSession('session-1'));
  assert.deepEqual(context.getAgentSession().todoState, {
    updatedAt: '2026-05-19T00:00:01.000Z',
    items: [{id: 'todo_1', text: 'resume todo', status: 'open'}]
  });

  context.transcriptContext.updateTodoState({
    updatedAt: '2026-05-19T00:00:02.000Z',
    items: [{id: 'todo_2', text: 'new todo', status: 'open'}]
  });

  assert.deepEqual(transcriptStore.saveCalls.at(-1).todoState, {
    updatedAt: '2026-05-19T00:00:02.000Z',
    items: [{id: 'todo_2', text: 'new todo', status: 'open'}]
  });

  const snapshot = context.getAgentSession().todoState;
  snapshot.items[0].text = 'mutated outside';
  assert.equal(context.getAgentSession().todoState.items[0].text, 'new todo');

  context.clearTranscriptRecords();

  assert.deepEqual(context.getAgentSession().todoState, {items: [], updatedAt: ''});
});

test('AppContext includes TUI theme in render state', () => {
  const customTheme = createTuiTheme({
    footer: {
      colors: {
        accentStrong: [1, 2, 3]
      }
    }
  });
  const defaultContext = createContext();
  const customContext = createContext({theme: customTheme});

  assert.deepEqual(defaultContext.createRenderState().theme, DEFAULT_TUI_THEME);
  assert.deepEqual(customContext.createRenderState().theme, customTheme);
});

test('AppContext updates runtime TUI theme for future render state', () => {
  const context = createContext();
  const nextTheme = createTuiTheme({
    footer: {
      colors: {
        accentStrong: [9, 8, 7]
      }
    }
  });

  context.setTheme(nextTheme);

  assert.deepEqual(context.theme, nextTheme);
  assert.deepEqual(context.renderContext.theme, nextTheme);
  assert.deepEqual(context.createRenderState().theme, nextTheme);
});

test('ModelContext reads model info from the default config path', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'default',
      providers: {
        default: { preset: 'openai-responses-api', apiKey: 'sk-test-key' }
      },
      models: [
        { id: 'default', provider: 'default', model: 'gpt-from-model-context' }
      ]
    }
  }, () => {
    const context = new ModelContext();

    assert.deepEqual(context.createModelCommandInfo(), {
      models: [
        { id: 'default', model: 'gpt-from-model-context', provider: 'default' }
      ],
      selectedIndex: 0
    });
  });
});

test('ModelContext reads selectable model profiles and current selection', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'deep',
      providers: {
        default: { preset: 'openai-responses-api', apiKey: 'sk-test-key' }
      },
      models: [
        { id: 'fast', provider: 'default', model: 'gpt-fast' },
        { id: 'deep', provider: 'default', model: 'gpt-deep' }
      ]
    }
  }, () => {
    const context = new ModelContext();

    assert.deepEqual(context.createModelCommandInfo(), {
      models: [
        { id: 'fast', model: 'gpt-fast', provider: 'default' },
        { id: 'deep', model: 'gpt-deep', provider: 'default' }
      ],
      selectedIndex: 1
    });
  });
});

test('ModelContext reads provider-backed model profiles and current selection', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'deep',
      providers: {
        example: { preset: 'openai-responses-api', apiKey: 'example-api-key', baseURL: 'https://provider.example/v1' },
        openai: { preset: 'openai-responses-api', apiKey: 'openai-api-key' }
      },
      models: [
        { id: 'fast', provider: 'example', model: 'example-fast' },
        { id: 'deep', provider: 'openai', model: 'gpt-4.1', reasoning: { effort: 'high' } }
      ]
    }
  }, () => {
    const context = new ModelContext();

    assert.deepEqual(context.createModelCommandInfo(), {
      models: [
        { id: 'fast', model: 'example-fast', provider: 'example' },
        { id: 'deep', model: 'gpt-4.1', provider: 'openai', reasoningEffort: 'high' }
      ],
      selectedIndex: 1
    });

    assert.deepEqual(context.createEffortCommandInfo(), {
      currentModelLabel: 'gpt-4.1',
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      selectedIndex: 4
    });
  });
});

test('ModelContext defaults /effort selection to medium when profile has no effort', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        default: { preset: 'openai-responses-api', apiKey: 'sk-test-key' }
      },
      models: [
        { id: 'fast', provider: 'default', model: 'gpt-fast' }
      ]
    }
  }, () => {
    const context = new ModelContext();

    assert.deepEqual(context.createEffortCommandInfo(), {
      currentModelLabel: 'gpt-fast',
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      selectedIndex: 3
    });
  });
});

test('ModelContext persists selectedModel atomically and preserves unknown config fields', () => {
  const config = {
    unrelated: true,
    llm: {
      selectedModel: 'fast',
      custom: { keep: true },
      providers: {
        default: { preset: 'openai-responses-api', apiKey: 'sk-test-key' }
      },
      models: [
        { id: 'fast', provider: 'default', model: 'gpt-fast' },
        { id: 'deep', provider: 'default', model: 'gpt-deep' }
      ]
    }
  };

  withTemporaryModelConfig(config, ({configPath, readConfig}) => {
    const context = new ModelContext();

    assert.deepEqual(context.selectModel('deep'), {ok: true});
    assert.deepEqual(readConfig(), {
      unrelated: true,
      llm: {
        selectedModel: 'deep',
        custom: { keep: true },
        providers: {
          default: { preset: 'openai-responses-api', apiKey: 'sk-test-key' }
        },
        models: [
          { id: 'fast', provider: 'default', model: 'gpt-fast' },
          { id: 'deep', provider: 'default', model: 'gpt-deep' }
        ]
      }
    });
    assert.deepEqual(fs.readdirSync(path.dirname(configPath)).filter((name) => name.includes('.tmp-')), []);
  });
});

test('ModelContext refreshes cached status-line label after model selection succeeds', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        default: { preset: 'openai-responses-api', apiKey: 'sk-test-key' }
      },
      models: [
        { id: 'fast', provider: 'default', model: 'gpt-fast' },
        { id: 'deep', provider: 'default', model: 'gpt-deep', reasoning: {effort: 'high'} }
      ]
    }
  }, () => {
    const appContext = createContext();

    assert.equal(appContext.createRenderState().statusLine.model.label, 'gpt-fast');
    assert.equal(appContext.createRenderState().statusLine.model.effort, undefined);

    assert.deepEqual(appContext.modelContext.selectModel('deep'), {ok: true});

    assert.equal(appContext.createRenderState().statusLine.model.label, 'gpt-deep');
    assert.equal(appContext.createRenderState().statusLine.model.effort, 'high');
  });
});

test('AppContext refreshes externally changed model state and clears stale context usage', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        default: {preset: 'openai-responses-api', apiKey: 'sk-test-key'}
      },
      models: [
        {id: 'fast', provider: 'default', model: 'gpt-fast'},
        {id: 'deep', provider: 'default', model: 'gpt-deep', reasoning: {effort: 'high'}}
      ]
    }
  };

  withTemporaryModelConfig(config, ({configPath}) => {
    const context = createContext();
    context.setContextUsage({usedTokens: 120, contextWindow: 1000, source: 'provider'});
    config.llm.selectedModel = 'deep';
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

    assert.equal(context.refreshModelStateFromConfig(), true);
    assert.equal(context.createRenderState().statusLine.model.label, 'gpt-deep');
    assert.equal(context.createRenderState().statusLine.model.effort, 'high');
    assert.equal(context.contextUsage, null);
    assert.equal(context.refreshModelStateFromConfig(), false);
  });
});

test('AppContext tunes model and effort without changing composer draft or history', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'openai-api-key'}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'},
        {id: 'deep', provider: 'openai', model: 'gpt-deep', reasoning: {effort: 'high'}}
      ]
    }
  };

  withTemporaryModelConfig(config, ({readConfig}) => {
    const context = createContext();
    context.configureSlashSuggestions([{name: 'model', description: '切换模型'}], () => false);
    context.composerContext.setText('/mo');
    context.composerContext.inputHistory.push('older prompt');
    context.setContextUsage({usedTokens: 10, contextWindow: 100, source: 'provider'});
    const originalComposer = structuredClone(context.composerContext.composer);

    assert.equal(context.openModelTuning(), true);
    assert.equal(context.createRenderState().slashSuggestions, null);
    assert.deepEqual(context.composerContext.composer, originalComposer);

    assert.equal(context.handleModelTuningEvent({type: INPUT_EVENTS.MOVE_RIGHT}), true);
    assert.deepEqual(context.createRenderState().statusLine.model, {
      kind: 'tuning',
      label: 'gpt-deep',
      activeField: 'model',
      effort: 'high'
    });
    context.handleModelTuningEvent({type: INPUT_EVENTS.TAB});
    context.handleModelTuningEvent({type: INPUT_EVENTS.MOVE_RIGHT});
    context.handleModelTuningEvent({type: INPUT_EVENTS.TEXT, value: 'ignored'});
    assert.deepEqual(context.composerContext.composer, originalComposer);

    context.handleModelTuningEvent({type: INPUT_EVENTS.SUBMIT});

    assert.equal(context.modelTuningContext.isActive(), false);
    assert.equal(readConfig().llm.selectedModel, 'deep');
    assert.equal(readConfig().llm.models[1].reasoning.effort, 'xhigh');
    assert.deepEqual(context.composerContext.inputHistory, ['older prompt']);
    assert.deepEqual(context.composerContext.composer, originalComposer);
    assert.equal(context.getContextUsage(), null);
    assert.equal(context.createRenderState().statusLine.model.label, 'gpt-deep');
    assert.equal(context.createRenderState().statusLine.model.effort, 'xhigh');
    assert.ok(context.createRenderState().slashSuggestions);
  });
});

test('AppContext cancels model tuning with Esc or Ctrl+T without persisting changes', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'openai-api-key'}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'},
        {id: 'deep', provider: 'openai', model: 'gpt-deep'}
      ]
    }
  };

  withTemporaryModelConfig(config, ({readConfig}) => {
    const context = createContext();
    context.composerContext.setText('keep me');
    context.openModelTuning();
    context.handleModelTuningEvent({type: INPUT_EVENTS.MOVE_RIGHT});
    context.handleModelTuningEvent({type: INPUT_EVENTS.ESCAPE});
    assert.equal(context.modelTuningContext.isActive(), false);
    assert.deepEqual(readConfig(), config);
    assert.equal(context.composerContext.getText(), 'keep me');

    context.openModelTuning();
    context.handleModelTuningEvent({type: INPUT_EVENTS.TOGGLE_MODEL_TUNING});
    assert.equal(context.modelTuningContext.isActive(), false);
    assert.deepEqual(readConfig(), config);
  });
});

test('AppContext blocks model tuning during bootstrap, response, and shell modes', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'openai-api-key'}
      },
      models: [{id: 'fast', provider: 'openai', model: 'gpt-fast'}]
    }
  }, () => {
    const context = createContext();
    context.setMcpBootstrapStatus('initializing');
    assert.equal(context.openModelTuning(), false);

    context.setMcpBootstrapStatus('ready');
    context.setInteractionMode('shell');
    assert.equal(context.openModelTuning(), false);
    context.setInteractionMode('shell-local');
    assert.equal(context.openModelTuning(), false);

    context.setInteractionMode('plan');
    assert.equal(context.openModelTuning(), true);
    context.modelTuningContext.cancel();

    context.setInteractionMode('normal');
    context.beginUserTurn('responding');
    assert.equal(context.openModelTuning(), false);
  });
});

test('AppContext keeps model tuning active and renders a redacted save error', () => {
  const fakeApiKey = 'sk-tuning-secret';
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: fakeApiKey}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'},
        {id: 'deep', provider: 'openai', model: 'gpt-deep'}
      ]
    }
  }, () => {
    const originalWriteFileSync = fs.writeFileSync;
    const context = createContext();
    context.composerContext.setText('draft');
    context.openModelTuning();
    context.handleModelTuningEvent({type: INPUT_EVENTS.MOVE_RIGHT});
    fs.writeFileSync = () => {
      throw new Error(`cannot write ${fakeApiKey}`);
    };

    try {
      context.handleModelTuningEvent({type: INPUT_EVENTS.SUBMIT});
      const renderState = context.createRenderState();

      assert.equal(context.modelTuningContext.isActive(), true);
      assert.match(renderState.statusLine.model.error, /<redacted>/);
      assert.doesNotMatch(renderState.statusLine.model.error, new RegExp(fakeApiKey));
      assert.equal(context.composerContext.getText(), 'draft');
      assert.deepEqual(context.modelContext.getStatusLineModelState(), {modelLabel: 'gpt-fast'});
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
  });
});

test('AppContext pins the active turn model while the global selection changes', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        default: {preset: 'openai-responses-api', apiKey: 'sk-test-key'}
      },
      models: [
        {id: 'fast', provider: 'default', model: 'gpt-fast'},
        {id: 'deep', provider: 'default', model: 'gpt-deep'}
      ]
    }
  };

  withTemporaryModelConfig(config, ({configPath}) => {
    const context = createContext();
    const turn = context.beginAssistantTurn();
    config.llm.selectedModel = 'deep';
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

    assert.equal(context.refreshModelStateFromConfig(), true);
    assert.equal(context.createRenderState().statusLine.model.label, 'gpt-fast');

    assert.equal(context.turnContext.setActiveStatusLineModelState(turn, {modelLabel: 'runtime-model'}), true);
    assert.equal(context.createRenderState().statusLine.model.label, 'runtime-model');

    context.turnContext.clearAssistantTurnIfCurrent(turn);
    assert.equal(context.createRenderState().statusLine.model.label, 'gpt-deep');
  });
});

test('ModelContext persists selectedModel without rewriting provider-backed config', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        example: { preset: 'openai-responses-api', apiKey: 'example-api-key', baseURL: 'https://provider.example/v1' },
        openai: { preset: 'openai-responses-api', apiKey: 'openai-api-key' }
      },
      models: [
        { id: 'fast', provider: 'example', model: 'example-fast' },
        { id: 'deep', provider: 'openai', model: 'gpt-4.1' }
      ]
    }
  };

  withTemporaryModelConfig(config, ({readConfig}) => {
    const context = new ModelContext();

    assert.deepEqual(context.selectModel('deep'), {ok: true});
    assert.deepEqual(readConfig(), {
      llm: {
        selectedModel: 'deep',
        providers: {
          example: { preset: 'openai-responses-api', apiKey: 'example-api-key', baseURL: 'https://provider.example/v1' },
          openai: { preset: 'openai-responses-api', apiKey: 'openai-api-key' }
        },
        models: [
          { id: 'fast', provider: 'example', model: 'example-fast' },
          { id: 'deep', provider: 'openai', model: 'gpt-4.1' }
        ]
      }
    });
  });
});

test('ModelContext persists selected profile effort and preserves reasoning fields', () => {
  const config = {
    llm: {
      selectedModel: 'deep',
      providers: {
        openai: { preset: 'openai-responses-api', apiKey: 'openai-api-key' }
      },
      models: [
        { id: 'fast', provider: 'openai', model: 'gpt-fast' },
        { id: 'deep', provider: 'openai', model: 'gpt-deep', reasoning: { summary: 'auto', effort: 'low' } }
      ]
    }
  };

  withTemporaryModelConfig(config, ({readConfig}) => {
    const context = new ModelContext();

    assert.deepEqual(context.selectEffort('high'), {ok: true});
    assert.deepEqual(readConfig().llm.models, [
      { id: 'fast', provider: 'openai', model: 'gpt-fast' },
      { id: 'deep', provider: 'openai', model: 'gpt-deep', reasoning: { summary: 'auto', effort: 'high' } }
    ]);
  });
});

test('ModelContext refreshes cached status-line effort after effort selection succeeds', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'deep',
      providers: {
        openai: { preset: 'openai-responses-api', apiKey: 'openai-api-key' }
      },
      models: [
        { id: 'deep', provider: 'openai', model: 'gpt-deep', reasoning: {effort: 'low'} }
      ]
    }
  }, () => {
    const appContext = createContext();

    assert.equal(appContext.createRenderState().statusLine.model.effort, 'low');

    assert.deepEqual(appContext.modelContext.selectEffort('xhigh'), {ok: true});

    assert.equal(appContext.createRenderState().statusLine.model.label, 'gpt-deep');
    assert.equal(appContext.createRenderState().statusLine.model.effort, 'xhigh');
  });
});

test('ModelContext creates reasoning object when persisting effort on profile without reasoning', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: { preset: 'openai-responses-api', apiKey: 'openai-api-key' }
      },
      models: [
        { id: 'fast', provider: 'openai', model: 'gpt-fast' }
      ]
    }
  }, ({readConfig}) => {
    const context = new ModelContext();

    assert.deepEqual(context.selectEffort('minimal'), {ok: true});
    assert.deepEqual(readConfig().llm.models[0].reasoning, {effort: 'minimal'});
  });
});

test('ModelContext atomically selects a model and its effort while preserving unrelated config', () => {
  withTemporaryModelConfig({
    unrelated: {keep: true},
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'openai-api-key'}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'},
        {id: 'deep', provider: 'openai', model: 'gpt-deep', reasoning: {summary: 'auto', effort: 'low'}}
      ]
    }
  }, ({readConfig}) => {
    const context = new ModelContext();

    assert.deepEqual(context.selectModelAndEffort('deep', 'xhigh'), {ok: true, modelChanged: true});
    assert.deepEqual(readConfig(), {
      unrelated: {keep: true},
      llm: {
        selectedModel: 'deep',
        providers: {
          openai: {preset: 'openai-responses-api', apiKey: 'openai-api-key'}
        },
        models: [
          {id: 'fast', provider: 'openai', model: 'gpt-fast'},
          {id: 'deep', provider: 'openai', model: 'gpt-deep', reasoning: {summary: 'auto', effort: 'xhigh'}}
        ]
      }
    });
    assert.deepEqual(context.getStatusLineModelState(), {modelLabel: 'gpt-deep', reasoningEffort: 'xhigh'});
  });
});

test('ModelContext writes explicit effort for previously unconfigured profiles', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'deep',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'openai-api-key'}
      },
      models: [
        {id: 'deep', provider: 'openai', model: 'gpt-deep', reasoning: {summary: 'auto'}},
        {id: 'plain', provider: 'openai', model: 'gpt-plain'}
      ]
    }
  }, ({readConfig}) => {
    const context = new ModelContext();

    assert.deepEqual(context.selectModelAndEffort('deep', 'medium'), {ok: true, modelChanged: false});
    assert.deepEqual(readConfig().llm.models[0].reasoning, {summary: 'auto', effort: 'medium'});
    assert.deepEqual(context.selectModelAndEffort('plain', 'none'), {ok: true, modelChanged: true});
    assert.deepEqual(readConfig().llm.models[1].reasoning, {effort: 'none'});
  });
});

test('ModelContext rejects invalid combined selection without changing config or cache', () => {
  const config = {
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'openai-api-key'}
      },
      models: [{id: 'fast', provider: 'openai', model: 'gpt-fast'}]
    }
  };

  withTemporaryModelConfig(config, ({readConfig}) => {
    const context = new ModelContext();
    const result = context.selectModelAndEffort('missing', 'high');

    assert.equal(result.ok, false);
    assert.match(result.error, /不存在的模型/);
    assert.deepEqual(readConfig(), config);
    assert.deepEqual(context.getStatusLineModelState(), {modelLabel: 'gpt-fast'});
  });
});

test('ModelContext keeps combined selection cache unchanged and redacts write failures', () => {
  const fakeApiKey = 'sk-combined-secret';
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: fakeApiKey}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'},
        {id: 'deep', provider: 'openai', model: 'gpt-deep'}
      ]
    }
  }, () => {
    const originalWriteFileSync = fs.writeFileSync;
    const context = new ModelContext();
    fs.writeFileSync = () => {
      throw new Error(`cannot write ${fakeApiKey}`);
    };

    try {
      const result = context.selectModelAndEffort('deep', 'high');

      assert.equal(result.ok, false);
      assert.match(result.error, /<redacted>/);
      assert.doesNotMatch(result.error, new RegExp(fakeApiKey));
      assert.deepEqual(context.getStatusLineModelState(), {modelLabel: 'gpt-fast'});
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
  });
});

test('ModelContext keeps openai-chat usable after persisting effort', () => {
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'chat',
      providers: {
        chat: { preset: 'openai-chat-compatible-api', apiKey: 'chat-api-key' }
      },
      models: [
        { id: 'chat', provider: 'chat', model: 'gpt-chat' }
      ]
    }
  }, ({readConfig}) => {
    const context = new ModelContext();

    assert.deepEqual(context.selectEffort('high'), {ok: true});
    assert.deepEqual(readConfig().llm.models[0].reasoning, {effort: 'high'});
    assert.deepEqual(context.createModelCommandInfo(), {
      models: [
        { id: 'chat', model: 'gpt-chat', provider: 'chat', reasoningEffort: 'high' }
      ],
      selectedIndex: 0
    });
    assert.deepEqual(context.createEffortCommandInfo(), {
      currentModelLabel: 'gpt-chat',
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      selectedIndex: 4
    });
  });
});

test('ModelContext rejects config without model profiles when selecting a model', () => {
  withTemporaryModelConfig({
    llm: {
      providers: {
        default: { preset: 'openai-responses-api', apiKey: 'sk-test-key' }
      }
    }
  }, ({readConfig}) => {
    const context = new ModelContext();

    const result = context.selectModel('deep');

    assert.equal(result.ok, false);
    assert.match(result.error, /缺少 models/);
    assert.deepEqual(readConfig(), {
      llm: {
        providers: {
          default: { preset: 'openai-responses-api', apiKey: 'sk-test-key' }
        }
      }
    });
  });
});

test('ModelContext keeps cached status-line state when model selection write fails', () => {
  const fakeApiKey = 'sk-test-secret';
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        default: { preset: 'openai-responses-api', apiKey: fakeApiKey }
      },
      models: [
        { id: 'fast', provider: 'default', model: 'gpt-fast' },
        { id: 'deep', provider: 'default', model: 'gpt-deep' }
      ]
    }
  }, () => {
    const originalWriteFileSync = fs.writeFileSync;
    const appContext = createContext();

    assert.equal(appContext.createRenderState().statusLine.model.label, 'gpt-fast');
    fs.writeFileSync = () => {
      throw new Error(`cannot write ${fakeApiKey}`);
    };

    try {
      const result = appContext.modelContext.selectModel('deep');

      assert.equal(result.ok, false);
      assert.ok(result.error.includes('<redacted>'));
      assert.equal(appContext.createRenderState().statusLine.model.label, 'gpt-fast');
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
  });
});

test('ModelContext redacts write errors when model selection cannot be saved', () => {
  const fakeApiKey = 'sk-test-secret';
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        default: { preset: 'openai-responses-api', apiKey: fakeApiKey }
      },
      models: [
        { id: 'fast', provider: 'default', model: 'gpt-fast' },
        { id: 'deep', provider: 'default', model: 'gpt-deep' }
      ]
    }
  }, () => {
    const originalWriteFileSync = fs.writeFileSync;
    const context = new ModelContext();

    fs.writeFileSync = () => {
      throw new Error(`cannot write ${fakeApiKey}`);
    };

    try {
      const result = context.selectModel('deep');

      assert.equal(result.ok, false);
      assert.ok(result.error.includes('<redacted>'));
      assert.ok(!result.error.includes(fakeApiKey));
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
  });
});

test('ModelContext exposes safe config errors through its cached model info path', () => {
  const fakeApiKey = 'sk-test-secret';
  withTemporaryModelConfig({
    llm: {
      selectedModel: 'fast',
      providers: {
        default: { preset: 'openai-responses-api', apiKey: fakeApiKey }
      },
      models: [
        { id: 'fast', provider: 'missing-provider', model: 'gpt-fast' }
      ]
    }
  }, () => {
    const context = new ModelContext();
    const result = context.createModelCommandInfo();

    assert.match(result.error, /不存在的 provider/);
    assert.ok(!result.error.includes(fakeApiKey));
  });
});

test('AppContext persists, clears, and reloads transcript sessions through one instance boundary', () => {
  const transcriptStore = createFakeTranscriptStore();
  const context = createContext({ transcriptStore });

  context.beginUserTurn('persist me');
  context.turnContext.finishAssistantTurn('persisted reply');

  assert.equal(transcriptStore.saveCalls.length, 2);
  const sessionId = transcriptStore.saveCalls.at(-1).sessionId;
  assert.equal(context.transcriptContext.currentSessionId, sessionId);
  assert.deepEqual(context.transcriptContext.records, [
    { role: 'user', text: 'persist me', metadata: {} },
    { role: 'assistant', text: 'persisted reply' }
  ]);

  context.clearTranscriptRecords();
  assert.equal(context.transcriptContext.currentSessionId, null);
  assert.deepEqual(context.transcriptContext.records, []);

  const loadedSession = context.loadTranscriptSession(sessionId);
  assert.equal(loadedSession.sessionId, sessionId);
  assert.equal(context.transcriptContext.currentSessionId, sessionId);
  assert.deepEqual(context.transcriptContext.records, [
    { role: 'user', text: 'persist me', metadata: {} },
    { role: 'assistant', text: 'persisted reply' }
  ]);
});

test('AppContext restores persisted change history for diff and undo', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-diff-context-'));
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'after\n', 'utf8');
  const transcriptStore = createFakeTranscriptStore([{
    sessionId: 'session-with-history',
    cwd,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    records: [{role: 'user', text: 'resume'}],
    changeHistory: [{
        id: 'checkpoint-1',
        createdAt: '2026-05-19T00:00:01.000Z',
        cwd,
        transcriptStartIndex: 0,
        status: 'ready',
        files: [{
          path: target,
          snapshot: {exists: true, content: 'before\n'},
          state: 'updated'
        }]
      }]
  }]);
  const context = createContext({cwd, transcriptStore});

  assert.ok(context.loadTranscriptSession('session-with-history'));
  assert.equal(context.changeHistoryContext.getSummary().status, 'ready');

  const diff = context.createDiffSourceResult();
  assert.equal(diff.status, 'ready');
  assert.equal(diff.source.kind, 'history');
  assert.equal(diff.files[0].path, 'file.txt');

  const undo = context.executeUndo();
  assert.equal(undo.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');

  fs.rmSync(cwd, {recursive: true, force: true});
});

test('AppContext exposes semantic subcontexts for resume sessions and composer state', () => {
  const transcriptStore = createFakeTranscriptStore([
    {
      sessionId: 'saved-session',
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
      records: [{ role: 'assistant', text: 'latest reply' }]
    }
  ]);
  const context = createContext({ transcriptStore });

  composerOps.setText(context.composerContext.composer, 'draft question');
  context.composerContext.inputHistory.push('previous input');
  context.turnContext.responding = true;

  assert.equal(context.composerContext.getText(), 'draft question');
  assert.deepEqual(context.composerContext.getInputHistory(), ['previous input']);
  assert.equal(context.turnContext.isResponding(), true);
  assert.equal(context.transcriptContext.listResumeSessions()[0].sessionId, 'saved-session');
});

test('AppContext browseHistory only enters history mode from an empty idle composer', () => {
  const context = createContext();

  context.composerContext.inputHistory.push('first', 'second');
  assert.equal(context.composerContext.browseHistory(1), false);

  composerOps.setText(context.composerContext.composer, 'draft');
  assert.equal(context.composerContext.browseHistory(-1), false);

  context.composerContext.reset();
  assert.equal(context.composerContext.browseHistory(-1), true);
  assert.equal(composerOps.getText(context.composerContext.composer), 'second');
  assert.equal(context.composerContext.historyIndex, 1);

  assert.equal(context.composerContext.browseHistory(-1), true);
  assert.equal(composerOps.getText(context.composerContext.composer), 'first');
  assert.equal(context.composerContext.historyIndex, 0);

  context.turnContext.responding = true;
  assert.equal(context.composerContext.browseHistory(-1), false);
  context.turnContext.responding = false;

  assert.equal(context.composerContext.browseHistory(1), true);
  assert.equal(composerOps.getText(context.composerContext.composer), 'second');
  assert.equal(context.composerContext.historyIndex, 1);

  assert.equal(context.composerContext.browseHistory(1), true);
  assert.equal(composerOps.getText(context.composerContext.composer), '');
  assert.equal(context.composerContext.historyIndex, null);
});

test('AppContext failAssistantTurn clears pending state and redacts local error records', () => {
  const context = createContext();

  context.beginUserTurn('fail please');
  context.turnContext.setStreamingPending('partial');

  const errorRecord = context.turnContext.failAssistantTurn(new Error('upstream failed Bearer secret-value sk-test-secret'));

  assert.equal(context.turnContext.responding, false);
  assert.equal(context.turnContext.getPending(), null);
  assert.deepEqual(errorRecord, {
    role: 'error',
    text: '模型响应失败：upstream failed Bearer <redacted> <redacted>'
  });
  assert.deepEqual(context.transcriptContext.records, [
    { role: 'user', text: 'fail please', metadata: {} },
    errorRecord
  ]);
});

test('AppContext owns assistant turn identity, abort signal, and pending draft interruption', () => {
  const context = createContext();

  context.beginUserTurn('stop please');
  const firstTurn = context.beginAssistantTurn();
  context.turnContext.setStreamingPending('partial');

  assert.equal(context.turnContext.isCurrentAssistantTurn(firstTurn), true);

  const result = context.interruptActiveAssistantTurn();

  assert.equal(result.interrupted, true);
  assert.equal(firstTurn.abortSignal.aborted, true);
  assert.equal(context.turnContext.responding, false);
  assert.deepEqual(result.partialRecord, { role: 'assistant', text: 'partial' });
  assert.deepEqual(result.noticeRecord, { role: 'local_notice', text: '已中断模型回答' });
  assert.equal(context.turnContext.isCurrentAssistantTurn(firstTurn), false);
});

test('AppContext interrupts active assistant turn while thinking', () => {
  const context = createContext();

  context.beginUserTurn('think');
  const turn = context.beginAssistantTurn();
  context.turnContext.enterSpinnerState('thinking');

  const result = context.interruptActiveAssistantTurn();

  assert.equal(result.interrupted, true);
  assert.equal(turn.abortSignal.aborted, true);
  assert.equal(context.turnContext.responding, false);
  assert.equal(context.turnContext.getPending(), null);
  assert.equal(context.turnContext.getWorking(), null);
  assert.equal(result.partialRecord, undefined);
  assert.deepEqual(result.noticeRecord, { role: 'local_notice', text: '已中断模型回答' });
});

test('AppContext interrupts active assistant turn while tool call is pending without orphan tool record', () => {
  const context = createContext();
  const toolCall = {
    callId: 'call-tool',
    toolName: 'grep',
    argumentsText: '{"pattern":"hello"}'
  };

  context.beginUserTurn('use tool');
  const turn = context.beginAssistantTurn();
  context.turnContext.setToolCallPending(toolCall);

  const result = context.interruptActiveAssistantTurn();

  assert.equal(result.interrupted, true);
  assert.equal(turn.abortSignal.aborted, true);
  assert.equal(context.turnContext.responding, false);
  assert.equal(context.turnContext.getPending(), null);
  assert.equal(result.partialRecord, undefined);
  assert.deepEqual(result.noticeRecord, { role: 'local_notice', text: '已中断模型回答' });
  assert.deepEqual(context.transcriptContext.records, [
    { role: 'user', text: 'use tool', metadata: {} },
    { role: 'local_notice', text: '已中断模型回答' }
  ]);
});

test('AppContext interrupts active assistant turn while waiting for provider with no pending preview', () => {
  const context = createContext();

  context.beginUserTurn('wait');
  const turn = context.beginAssistantTurn();

  const result = context.interruptActiveAssistantTurn();

  assert.equal(result.interrupted, true);
  assert.equal(turn.abortSignal.aborted, true);
  assert.equal(context.turnContext.responding, false);
  assert.equal(context.turnContext.getPending(), null);
  assert.equal(result.partialRecord, undefined);
  assert.deepEqual(result.noticeRecord, { role: 'local_notice', text: '已中断模型回答' });
});

test('UserQuestionContext Esc closes surface without interrupting assistant turn, then second Esc can interrupt', async () => {
  const context = createContext();
  const userQuestion = new UserQuestionContext(() => {});
  const call = {
    callId: 'call_questions',
    toolName: 'ask_user_questions',
    argumentsText: '{}'
  };

  context.beginUserTurn('need clarification');
  const turn = context.beginAssistantTurn();
  const pending = userQuestion.request(call, {
    questions: [
      { question: 'Pick?', options: [{ label: 'A' }] }
    ]
  });

  assert.equal(userQuestion.handleEvent({ type: INPUT_EVENTS.ESCAPE }), true);
  const cancelled = await pending;

  assert.equal(cancelled.ok, false);
  assert.deepEqual(JSON.parse(cancelled.text), { cancelled: true, reason: 'User cancelled ask_user_questions' });
  assert.equal(userQuestion.hasActiveRequest(), false);
  assert.equal(turn.abortSignal.aborted, false);
  assert.equal(context.turnContext.responding, true);
  assert.equal(context.turnContext.isCurrentAssistantTurn(turn), true);

  const interrupted = context.interruptActiveAssistantTurn();

  assert.equal(interrupted.interrupted, true);
  assert.equal(turn.abortSignal.aborted, true);
  assert.equal(context.turnContext.responding, false);
  assert.deepEqual(interrupted.noticeRecord, { role: 'local_notice', text: '已中断模型回答' });
});

test('UserQuestionContext supports multi-select answers and submits them from the final tab', async () => {
  let userQuestion;
  const surfaces = [];
  userQuestion = new UserQuestionContext(() => surfaces.push(userQuestion.getSurface()));
  const call = {
    callId: 'call_questions',
    toolName: 'ask_user_questions',
    argumentsText: '{}'
  };
  const pending = userQuestion.request(call, {
    questions: [
      {
        question: 'Pick many?',
        multiSelect: true,
        options: [
          {label: 'A'},
          {label: 'B'},
          {label: 'C'}
        ]
      },
      {
        question: 'Pick one?',
        options: [
          {label: 'Yes'},
          {label: 'No'}
        ]
      }
    ]
  });
  let resolved = false;
  pending.then(() => {
    resolved = true;
  });

  assert.equal(userQuestion.getSurface().selectionMode, 'multiple');
  assert.equal(userQuestion.getSurface().optionsTitle, '答案（多选）');
  assert.equal(userQuestion.getSurface().focusedIndex, 0);
  assert.deepEqual(userQuestion.getSurface().options.map((option) => option.checked), [false, false, false, false]);

  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.SUBMIT}), true);
  await Promise.resolve();

  assert.equal(resolved, false);
  assert.equal(userQuestion.hasActiveRequest(), true);

  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.TEXT, value: ' '}), true);
  assert.deepEqual(userQuestion.getSurface().options.map((option) => option.checked), [true, false, false, false]);

  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_DOWN}), true);
  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.TEXT, value: ' '}), true);
  assert.deepEqual(userQuestion.getSurface().options.map((option) => option.checked), [true, true, false, false]);
  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.TEXT, value: ' '}), true);
  assert.deepEqual(userQuestion.getSurface().options.map((option) => option.checked), [true, false, false, false]);

  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_DOWN}), true);
  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.TEXT, value: ' '}), true);
  assert.deepEqual(userQuestion.getSurface().options.map((option) => option.checked), [true, false, true, false]);

  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_DOWN}), true);
  assert.equal(userQuestion.getSurface().focusedIndex, 3);
  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.TEXT, value: 'custom'}), true);
  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.TEXT, value: ' '}), true);
  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.TEXT, value: 'answer'}), true);
  assert.equal(userQuestion.getSurface().options.at(-1).checked, true);
  assert.equal(userQuestion.getSurface().options.at(-1).inlineInput.text, 'custom answer');

  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.SUBMIT}), true);
  assert.equal(userQuestion.getSurface().title, 'Question 2/2');
  assert.equal(userQuestion.getSurface().selectionMode, undefined);
  assert.equal(userQuestion.getSurface().optionsTitle, '答案（单选）');
  assert.equal(userQuestion.getSurface().focusedIndex, 0);
  assert.equal(userQuestion.getSurface().options.at(-1).inlineInput.text, '');

  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_DOWN}), true);
  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.SUBMIT}), true);
  assert.equal(userQuestion.getSurface().title, '提交答案');
  assert.match(userQuestion.getSurface().message, /Pick many\?/);
  assert.match(userQuestion.getSurface().message, /A, C, Other：custom answer/);
  assert.match(userQuestion.getSurface().message, /Pick one\?/);
  assert.match(userQuestion.getSurface().message, /No/);
  assert.equal(resolved, false);

  assert.equal(userQuestion.handleEvent({type: INPUT_EVENTS.SUBMIT}), true);
  const result = await pending;

  assert.equal(resolved, true);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.text), {
    answers: [
      {index: 0, multiSelect: true, selectedOptions: ['A', 'C', 'Other'], customText: 'custom answer'},
      {index: 1, selected: 'No'}
    ]
  });
  assert.equal(userQuestion.hasActiveRequest(), false);
  assert.ok(surfaces.some((surface) => surface && surface.selectionMode === 'multiple'));
});

test('UserQuestionContext preserves question drafts across tabs and keeps Other arrow editing local', () => {
  const userQuestion = new UserQuestionContext(() => {});
  const call = {
    callId: 'call_questions_tabs',
    toolName: 'ask_user_questions',
    argumentsText: '{}'
  };

  userQuestion.request(call, {
    questions: [
      {question: 'First?', options: [{label: 'A'}, {label: 'B'}]},
      {question: 'Second?', options: [{label: 'Yes'}, {label: 'No'}]}
    ]
  });

  userQuestion.handleEvent({type: INPUT_EVENTS.SUBMIT});
  assert.equal(userQuestion.getSurface().title, 'Question 2/2');

  userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_LEFT});
  assert.equal(userQuestion.getSurface().title, 'Question 1/2');
  assert.deepEqual(userQuestion.getSurface().options.map((option) => option.selected), [true, false, false]);

  userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  assert.equal(userQuestion.getSurface().focusedIndex, 1);
  assert.deepEqual(userQuestion.getSurface().options.map((option) => option.selected), [true, false, false]);

  userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  assert.equal(userQuestion.getSurface().focusedIndex, 2);
  userQuestion.handleEvent({type: INPUT_EVENTS.TEXT, value: 'abc'});
  userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_LEFT});
  assert.equal(userQuestion.getSurface().title, 'Question 1/2');
  assert.equal(userQuestion.getSurface().options.at(-1).inlineInput.cursor, 2);

  userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_UP});
  userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_RIGHT});
  assert.equal(userQuestion.getSurface().title, 'Question 2/2');
});

test('UserQuestionContext blocks incomplete submission and reports missing question tabs', () => {
  const userQuestion = new UserQuestionContext(() => {});
  const call = {
    callId: 'call_questions_validation',
    toolName: 'ask_user_questions',
    argumentsText: '{}'
  };

  userQuestion.request(call, {
    questions: [
      {question: 'First?', options: [{label: 'A'}]},
      {question: 'Second?', options: [{label: 'B'}]}
    ]
  });

  userQuestion.handleEvent({type: INPUT_EVENTS.MOVE_LEFT});
  assert.equal(userQuestion.getSurface().title, '提交答案');
  assert.match(userQuestion.getSurface().message, /未选择/);
  assert.deepEqual(userQuestion.getSurface().tabs.map((tab) => tab.status), ['missing', 'missing', 'blocked']);

  userQuestion.handleEvent({type: INPUT_EVENTS.SUBMIT});
  assert.match(userQuestion.getSurface().message, /请先回答：Q1、Q2/);
  assert.equal(userQuestion.hasActiveRequest(), true);
});

test('ToolApprovalContext Esc denies request without interrupting assistant turn, then next Esc can interrupt', async () => {
  const context = createContext();
  const toolApproval = new ToolApprovalContext(() => {});
  const call = {
    callId: 'call_tool',
    toolName: 'grep',
    argumentsText: '{"pattern":"hello"}'
  };

  context.beginUserTurn('use tool');
  const turn = context.beginAssistantTurn();
  const pending = toolApproval.request(call, { preview: 'grep hello' });

  assert.equal(toolApproval.handleEvent({ type: INPUT_EVENTS.ESCAPE }), true);
  const decision = await pending;

  assert.deepEqual(decision, { kind: 'deny' });
  assert.equal(toolApproval.hasActiveRequest(), false);
  assert.equal(turn.abortSignal.aborted, false);
  assert.equal(context.turnContext.responding, true);

  const interrupted = context.interruptActiveAssistantTurn();

  assert.equal(interrupted.interrupted, true);
  assert.equal(turn.abortSignal.aborted, true);
});

test('ToolApprovalContext toggles allow-all session state and returns cached decisions', async () => {
  let updateCount = 0;
  const toolApproval = new ToolApprovalContext(() => {
    updateCount += 1;
  });
  const call = {
    callId: 'call_tool',
    toolName: 'grep',
    argumentsText: '{"pattern":"hello"}'
  };

  assert.equal(toolApproval.isAllowAllForSession(), false);
  assert.equal(toolApproval.toggleAllowAllForSession(), true);
  assert.equal(toolApproval.isAllowAllForSession(), true);
  assert.equal(updateCount, 1);

  const decision = toolApproval.request(call);

  assert.deepEqual(decision, {kind: 'allow_all_for_session'});
  assert.equal(typeof decision.then, 'undefined');
  assert.equal(toolApproval.hasActiveRequest(), false);
  assert.equal(toolApproval.toggleAllowAllForSession(), false);
  assert.equal(toolApproval.isAllowAllForSession(), false);
  assert.equal(updateCount, 2);
});

test('ToolApprovalContext returns synchronous cached tool and command decisions', async () => {
  const toolApproval = new ToolApprovalContext(() => {});
  const toolCall = {
    callId: 'call_patch',
    toolName: 'apply_patch',
    argumentsText: '{"patch":"invalid"}'
  };
  const toolPending = toolApproval.request(toolCall);

  assert.equal(typeof toolPending.then, 'function');
  toolApproval.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  toolApproval.handleEvent({type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(await toolPending, {kind: 'allow_tool_for_session', toolName: 'apply_patch'});

  const cachedToolDecision = toolApproval.request({...toolCall, callId: 'call_patch_cached'});
  assert.deepEqual(cachedToolDecision, {kind: 'allow_tool_for_session', toolName: 'apply_patch'});
  assert.equal(typeof cachedToolDecision.then, 'undefined');
  assert.equal(toolApproval.hasActiveRequest(), false);

  const commandApproval = new ToolApprovalContext(() => {});
  const commandCall = {
    callId: 'call_bash',
    toolName: 'run_bash_command',
    argumentsText: '{"command":"rm --help"}'
  };
  const commandPending = commandApproval.request(commandCall);

  assert.equal(typeof commandPending.then, 'function');
  commandApproval.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  commandApproval.handleEvent({type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(await commandPending, {
    kind: 'allow_command_for_session',
    toolName: 'run_bash_command',
    command: 'rm --help'
  });

  const cachedCommandDecision = commandApproval.request({...commandCall, callId: 'call_bash_cached'});
  assert.deepEqual(cachedCommandDecision, {
    kind: 'allow_command_for_session',
    toolName: 'run_bash_command',
    command: 'rm --help'
  });
  assert.equal(typeof cachedCommandDecision.then, 'undefined');
  assert.equal(commandApproval.hasActiveRequest(), false);
});

test('AppContext keeps stale assistant turn cleanup from clearing a newer turn', () => {
  const context = createContext();

  context.beginUserTurn('first');
  const firstTurn = context.beginAssistantTurn();
  const secondTurn = context.beginAssistantTurn();

  context.turnContext.clearAssistantTurnIfCurrent(firstTurn);

  assert.equal(context.turnContext.isCurrentAssistantTurn(firstTurn), false);
  assert.equal(context.turnContext.isCurrentAssistantTurn(secondTurn), true);
});
