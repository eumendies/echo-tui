const {AppContext} = require('../../src/app/state/app-context');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');
const {UserQuestionContext} = require('../../src/app/state/user-question-context');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {createObservation} = require('../../src/observation/observation-projector');

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
  } else if (operation.op === 'push_change_checkpoint') {
    session.changeHistory = [...(session.changeHistory || []), structuredClone(operation.checkpoint)];
  } else if (operation.op === 'pop_change_checkpoint') {
    (session.changeHistory || []).pop();
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
  const hooks = {
    emit(event, payload) {
      hookEvents.push({event, payload});
    },
    async flush() {}
  };
  const debug = {
    enabled: true,
    logPath: '/tmp/debug.jsonl',
    emit(event, payload) {
      debugEvents.push({event, payload});
    },
    close() {}
  };
  const observation = createObservation(debug, hooks);

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
      observation,
      observationScope: {interactionMode: 'normal', runtimeKind: 'tui'}
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
      activeTurnMessagePolicy: settings.activeTurnMessagePolicy,
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
    tools: {bash: {timeoutMs: null, maxOutputBytes: 65536}, autoCompressImages: true, fileEditMode: 'apply_patch', sandbox: {mode: 'off', network: false, extraWritablePaths: []}}
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
    resolveLlmConfigStrict() { return config; },
    resolveLlmConfigForProfile() { return config; }
  };
}

module.exports = {createHarness, createFakeTranscriptStore, createFakeSessionModelSettingsStore, createConfigRootFromAppSettings, createUserConfigSnapshot};
