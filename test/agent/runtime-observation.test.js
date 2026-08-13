const assert = require('node:assert/strict');
const test = require('node:test');

const {createCompositeObservation, disabledObservation} = require('../../src/observation/observation');
const {createDebugObservation, createHookObservation, createObservation} = require('../../src/observation/observation-projector');

const PROVIDER = {
  agentType: 'anthropic',
  baseURL: 'https://example.com',
  contextWindow: 200000,
  model: 'claude'
};

function createScope(overrides = {}) {
  return {
    conversationKind: 'primary',
    interactionMode: 'normal',
    ...overrides
  };
}

function createProviderInput(overrides = {}) {
  return {
    activeRecordCount: 1,
    activeStartIndex: 0,
    agentInstructionsCount: 2,
    memoryPrompt: {
      sections: [],
      estimatedTokens: 0,
      userMemoryCount: 0,
      agentMemory: {catalogCount: 0, itemCount: 0, mode: 'full', estimatedTokens: 0}
    },
    provider: PROVIDER,
    providerRecords: [{role: 'system', text: 'system'}, {role: 'user', text: 'hello'}],
    skillCatalog: [],
    skillCatalogProjection: {budgetTokens: 100, mode: 'full', originalTokens: 0},
    skillCatalogTokens: 0,
    toolDefinitions: [{name: 'read_files', description: 'read', parameters: {type: 'object'}}],
    ...overrides
  };
}

function createDebugRecorder(enabled = true) {
  const events = [];
  return {
    events,
    context: {
      enabled,
      logPath: enabled ? '/tmp/debug.jsonl' : null,
      emit(event, payload) { events.push({event, payload}); },
      close() {}
    }
  };
}

function createHooks(events) {
  return {
    emit(event, payload) { events.push({event, payload}); },
    async flush() {},
    updateConfig() {}
  };
}

test('composite observation forwards flat events and isolates each consumer', () => {
  const received = [];
  const failing = {...disabledObservation, toolStarted() { throw new Error('observer failed'); }};
  const healthy = {...disabledObservation, toolStarted(input) { received.push(input); }};
  const observation = createCompositeObservation([failing, healthy]);
  const input = {scope: createScope(), call: {callId: 'call-1', toolName: 'read_files', argumentsText: '{}'}};

  assert.doesNotThrow(() => observation.toolStarted(input));
  assert.deepEqual(received, [input]);
});

test('subagent catalog diagnostics are expanded by debug observation and never reach hooks', () => {
  const debug = createDebugRecorder();
  const hookEvents = [];
  const observation = createObservation(debug.context, createHooks(hookEvents));
  const diagnostic = {
    code: 'missing_field',
    sourceKind: 'project',
    sourcePath: '/tmp/project/.echo/agents/reviewer.md',
    message: 'Missing required frontmatter field: tools.'
  };

  observation.subagentCatalogLoaded([diagnostic]);

  assert.deepEqual(debug.events, [{event: 'subagent_catalog_diagnostic', payload: diagnostic}]);
  assert.deepEqual(hookEvents, []);
});

test('disabled observation does not inspect diagnostic inputs', () => {
  const unreadable = new Proxy({}, {
    get() { throw new Error('input was inspected'); },
    ownKeys() { throw new Error('input was traversed'); }
  });

  assert.doesNotThrow(() => disabledObservation.providerRequestBuilt(unreadable));
  assert.doesNotThrow(() => disabledObservation.subagentCatalogLoaded(unreadable));
  assert.doesNotThrow(() => disabledObservation.userSubmitted(unreadable));
});

test('production observation skips all debug projection when debug is disabled', () => {
  const debug = createDebugRecorder(false);
  const hooks = createHooks([]);
  const unreadable = new Proxy({}, {
    get() { throw new Error('debug-only input was inspected'); },
    ownKeys() { throw new Error('debug-only input was traversed'); }
  });
  const observation = createObservation(debug.context, hooks);

  assert.doesNotThrow(() => observation.providerRequestBuilt(unreadable));
  assert.doesNotThrow(() => observation.userSubmitted(unreadable));
  assert.doesNotThrow(() => observation.toolApprovalReviewed(unreadable));
  assert.deepEqual(debug.events, []);
});

test('debug projector preserves provider and tool summaries with run scope', () => {
  const debug = createDebugRecorder();
  const observation = createDebugObservation(debug.context);
  const scope = createScope({conversationKind: 'btw'});
  const call = {callId: 'call-1', toolName: 'read_files', argumentsText: '{"path":"secret"}'};
  const result = {callId: 'call-1', toolName: 'read_files', ok: true, text: 'secret result', details: {kind: 'read_files', truncated: false}};

  observation.providerRequestBuilt({scope, request: createProviderInput()});
  observation.toolStarted({scope, call});
  observation.toolCompleted({scope, result});

  const request = debug.events[0];
  assert.equal(request.event, 'provider_request_built');
  assert.equal(request.payload.conversationKind, 'btw');
  assert.equal(request.payload.interactionMode, 'normal');
  assert.deepEqual(request.payload.recordRoles, ['system', 'user']);
  assert.equal(typeof request.payload.providerInputHash, 'string');
  assert.equal(typeof request.payload.toolSchemaHash, 'string');
  assert.deepEqual(request.payload.providerConfig, {
    agentType: 'anthropic', baseURL: 'https://example.com', contextWindow: 200000, model: 'claude'
  });
  assert.equal(debug.events[1].payload.argumentsText.preview, undefined);
  assert.equal(debug.events[2].payload.resultText.preview, undefined);
});

test('debug projector adds stable subagent correlation without task text', () => {
  const debug = createDebugRecorder();
  const observation = createDebugObservation(debug.context);
  const scope = createScope({
    conversationKind: 'subagent',
    subagent: {agentName: 'explorer', depth: 1, parentToolCallId: 'outer-1', runId: 'run-1'}
  });
  const call = {callId: 'inner-1', toolName: 'read_files', argumentsText: '{}'};
  const result = {callId: 'inner-1', toolName: 'read_files', ok: true, text: 'done', details: {kind: 'read_files', truncated: false}};

  observation.toolStarted({scope, call});
  observation.toolCompleted({scope, result});

  for (const event of debug.events) {
    assert.equal(event.payload.agentName, 'explorer');
    assert.equal(event.payload.parentToolCallId, 'outer-1');
    assert.equal(event.payload.runId, 'run-1');
    assert.equal(JSON.stringify(event.payload).includes('task'), false);
  }
});

test('hook projector maps flat runtime facts to existing lifecycle payloads', () => {
  const events = [];
  const observation = createHookObservation(createHooks(events));
  const scope = createScope({interactionMode: 'plan'});
  const call = {callId: 'call-1', toolName: 'apply_patch', argumentsText: 'patch'};
  const result = {callId: 'call-1', toolName: 'apply_patch', ok: false, text: 'denied', details: {kind: 'generic'}};

  observation.toolStarted({scope, call});
  observation.toolApprovalRequested({scope, call, approval: {previewTitle: 'patch'}});
  observation.toolApprovalResolved({scope, call, approval: {decision: {kind: 'deny'}, emitLifecycleEvent: true, required: true}});
  observation.toolCompleted({scope, result});

  assert.deepEqual(events.map((event) => event.event), [
    'tool_call_start', 'tool_approval_request', 'tool_approval_response', 'tool_call_end'
  ]);
  assert.equal(events.every((event) => event.payload.interactionMode === 'plan'), true);
  assert.equal(events.every((event) => event.payload.conversationKind === 'primary'), true);
  assert.equal(events.every((event) => Object.hasOwn(event.payload, 'agentName') === false), true);
  assert.equal(events[0].payload.argumentsText, 'patch');
  assert.equal(events[3].payload.ok, false);
});

test('composite observation keeps approval hook before debug and subagent payload shape', () => {
  const order = [];
  const debug = createDebugRecorder();
  debug.context.emit = (event, payload) => {
    debug.events.push({event, payload});
    if (event === 'tool_call_approval') order.push('debug');
  };
  const hookEvents = [];
  const hooks = createHooks(hookEvents);
  hooks.emit = (event, payload) => {
    hookEvents.push({event, payload});
    if (event === 'tool_approval_response') order.push('hook');
  };
  const observation = createObservation(debug.context, hooks);
  const scope = createScope({
    conversationKind: 'subagent',
    subagent: {agentName: 'worker', depth: 1, parentToolCallId: 'outer', runId: 'run'}
  });
  const call = {callId: 'inner', toolName: 'run_bash_command', argumentsText: '{}'};

  observation.toolStarted({scope, call});
  observation.toolApprovalResolved({scope, call, approval: {decision: {kind: 'deny'}, emitLifecycleEvent: true, required: true}});

  assert.deepEqual(order, ['hook', 'debug']);
  assert.equal(hookEvents.every((event) => event.payload.interactionMode === 'normal'), true);
  assert.equal(hookEvents.every((event) => event.payload.conversationKind === 'subagent'), true);
  assert.equal(hookEvents.every((event) => event.payload.agentName === 'worker'), true);
  assert.equal(hookEvents.every((event) => Object.hasOwn(event.payload, 'runId') === false), true);
  assert.equal(hookEvents.every((event) => Object.hasOwn(event.payload, 'parentToolCallId') === false), true);
});

test('runtime projector preserves app, turn, and reviewer events', () => {
  const debug = createDebugRecorder();
  const hookEvents = [];
  const output = [];
  const observation = createObservation(debug.context, createHooks(hookEvents), {write: (text) => output.push(text)});
  const turnScope = {interactionMode: 'plan', runtimeKind: 'tui'};
  const call = {callId: 'approval-1', toolName: 'apply_patch', argumentsText: 'private patch'};

  observation.appStarted({scope: {cwd: '/tmp/project', nodeVersion: 'v20.0.0', pid: 42}, terminalSize: {columns: 100, rows: 30}});
  observation.userSubmitted({attachmentCount: 2, displayText: 'display secret', interactionMode: 'plan', recordCount: 3, text: 'user secret'});
  observation.transcriptBatchRendered({records: [{role: 'user', text: 'secret'}]});
  observation.resizeRecovered({recordCount: 4, terminalSize: {columns: 90, rows: 20}});
  observation.configurationWatchFailed({error: new Error('watch failed')});
  observation.assistantTurnStarted({scope: turnScope, userText: 'user secret', recordCount: 4});
  observation.manualApprovalRequested({scope: turnScope, call, request: {previewTitle: 'Patch'}});
  observation.manualApprovalCompleted({scope: turnScope, call, decision: {kind: 'deny'}});
  observation.toolApprovalReviewed({actionCharacters: 12, actionProjection: 'summarized', call, hasClarifications: false, hasPriorExchange: true, latencyMs: 5, model: 'reviewer', promptCharacters: 30, result: 'no'});
  observation.toolApprovalUsageStoreFailed({call, error: new Error('usage secret'), model: 'reviewer'});
  observation.assistantTurnCompleted({scope: turnScope, finalText: 'final secret'});
  observation.appExiting({cwd: '/tmp/project', interactionMode: 'plan'});

  assert.deepEqual(debug.events.map((event) => event.event), [
    'app_start', 'user_submit', 'transcript_render_batch', 'resize_recovery', 'user_config_watch_error',
    'assistant_turn_start', 'tool_approval_review', 'tool_approval_usage_store_error', 'assistant_turn_end', 'app_exit'
  ]);
  assert.deepEqual(hookEvents.map((event) => event.event), [
    'assistant_turn_start', 'tool_approval_request', 'tool_approval_response', 'assistant_turn_end'
  ]);
  assert.deepEqual(output, ['[debug] logging to /tmp/debug.jsonl\n']);
  assert.equal(JSON.stringify(debug.events).includes('private patch'), false);
});

test('headless uses the same observation without synthesizing TUI debug events', () => {
  const debug = createDebugRecorder();
  const hookEvents = [];
  const observation = createObservation(debug.context, createHooks(hookEvents));
  const turnScope = {interactionMode: 'normal', runtimeKind: 'headless'};

  observation.assistantTurnStarted({scope: turnScope, userText: 'prompt', recordCount: 1});
  observation.providerUsage({scope: createScope(), usage: {inputTokens: 1, outputTokens: 2}});
  observation.assistantTurnCompleted({scope: turnScope, finalText: 'done'});

  assert.deepEqual(hookEvents.map((event) => event.event), ['assistant_turn_start', 'assistant_turn_end']);
  assert.deepEqual(debug.events.map((event) => event.event), ['provider_usage']);
});

test('agent runtime exposes only allowlisted provider facts to observation', async () => {
  const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
  const agentSetupModule = require('../../src/agent/agent-setup');
  const originalPrepareAgent = agentSetupModule.prepareAgent;
  const providerRequests = [];
  const observation = {...disabledObservation, providerRequestBuilt(input) { providerRequests.push(input); }};
  const snapshot = {
    getAppSettings() { return {agentInstructionFileName: 'AGENTS.md', compactionThresholdRatio: 0.8, skillCatalogContextRatio: 0.02}; }
  };

  agentSetupModule.prepareAgent = () => ({
    agent: {async runTurn() { return {draft: 'done', toolCalls: []}; }},
    config: {
      agentType: 'fake',
      apiKey: 'provider-secret',
      headers: {authorization: 'header-secret'},
      baseURL: 'https://example.com',
      model: 'fake',
      contextWindow: 128000
    },
    registry: {getHandler() {}, listDefinitions() { return []; }, listSkillCatalog() { return []; }}
  });

  try {
    const runAgent = createAgentLoopRuntime('/tmp/observer-failure', {capture: () => snapshot}, undefined, observation);
    assert.equal(await runAgent({records: [{role: 'user', text: 'hello'}], userConfigSnapshot: snapshot}), 'done');
    assert.deepEqual(providerRequests[0].scope, {conversationKind: 'primary', interactionMode: 'normal'});
    assert.deepEqual(providerRequests[0].request.provider, {
      agentType: 'fake', baseURL: 'https://example.com', contextWindow: 128000, model: 'fake'
    });
    assert.equal(JSON.stringify(providerRequests).includes('provider-secret'), false);
    assert.equal(JSON.stringify(providerRequests).includes('header-secret'), false);
  } finally {
    agentSetupModule.prepareAgent = originalPrepareAgent;
  }
});
