const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, {timeout: 5000}, fn);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ComposerSubmissionController} = require('../../src/app/composer-submission-controller');
const {InputEventController} = require('../../src/app/input-event-controller');
const {ActiveInputResolver} = require('../../src/app/active-input-resolver');
const {runAssistantTurn} = require('../../src/app/assistant-turn-runner');
const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const setup = require('../../src/agent/agent-setup');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {createTodoToolHandlers} = require('../../src/tools/todo-tool-handler');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {AgentAbortError} = require('../../src/types/agent');
const {createHarness, createFakeTranscriptStore} = require('./assistant-turn-test-helpers');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return {promise, resolve};
}
const done = {draft: 'done', toolCalls: []};
const call = (id, toolName, args) => ({callId: id, toolName, argumentsText: JSON.stringify(args)});
function tempDir(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-steering-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  return cwd;
}
function controller(harness, overrides = {}) {
  const appContext = harness.appContext;
  appContext.setMcpBootstrapStatus('ready');
  return new ComposerSubmissionController({
    appContext,
    command: {hasActiveSession: () => false, matches: (text) => text.startsWith('/'), startFromText: () => ({kind: 'not_matched'})},
    reference: {prepareForSubmission: async () => ({ok: false, reason: 'cancelled'})},
    startAssistantTurn: async () => { throw new Error('unexpected new turn'); },
    submitShellCommand: async () => { throw new Error('unexpected shell'); },
    showReferenceError: () => { throw new Error('unexpected reference error'); },
    render() {},
    ...overrides
  });
}
function inputController(harness, submit, resolver = new ActiveInputResolver([])) {
  return new InputEventController({
    appContext: harness.appContext, resolver,
    submitComposer: () => submit.submitComposer(),
    interruptActiveTurn: () => harness.appContext.turnContext.interruptActiveAssistantTurn().interrupted,
    interruptActiveShellCommand: () => false,
    openFilePicker() {}, openSubagentView() {}, toggleAllowAllForSession() {}, exit() {}, render() {}
  });
}
function beginSteer(harness) {
  const app = harness.appContext;
  app.turnContext.beginUserTurn('original');
  const turn = app.turnContext.beginAssistantTurn(undefined, 'steer');
  return {turn, port: app.pendingMessageContext.createSteeringInputPort(turn.id)};
}
async function submitText(harness, submit, text) {
  harness.appContext.composerContext.setText(text);
  await submit.submitComposer();
}
function liveDraft(harness) {
  harness.appContext.composerContext.setText('后来草稿 👩‍💻');
  harness.appContext.composerContext.composer.cursor = 2;
  return structuredClone(harness.appContext.composerContext.composer);
}
async function withRuntime(t, harness, agent, work, handlers = []) {
  const original = setup.prepareAgent;
  const preparations = [];
  setup.prepareAgent = (options) => {
    preparations.push(options);
    const config = {agentType: 'fake', apiKey: '', model: 'test-fixture', contextWindow: 128000,
      tools: {bash: {timeoutMs: 1000, maxOutputBytes: 1024}, sandbox: {mode: 'off', network: false, extraWritablePaths: []}}};
    return {agent, registry: createToolRegistry(handlers), config};
  };
  t.after(() => { setup.prepareAgent = original; });
  const run = createAgentLoopRuntime(harness.appContext.getCurrentCwd(), {capture: () => harness.appContext.captureUserConfigSnapshot()});
  const sessions = [];
  const callbacks = [];
  const submit = controller(harness, {
    startAssistantTurn: (submission) => runAssistantTurn({...harness.input, ...submission,
      runAgent(session, cb) { sessions.push(session); callbacks.push(cb); return run(session, cb); }
    })
  });
  try { await work({submit, sessions, callbacks, preparations}); }
  finally { setup.prepareAgent = original; }
}

test('controller rejects failed steering preparation without abort, history duplication or live draft/cursor damage', async (t) => {
  const cwd = tempDir(t);
  const harness = createHarness();
  harness.appContext.getCurrentCwd = () => cwd;
  const {turn, port} = beginSteer(harness);
  t.after(() => harness.appContext.turnContext.stopSpinner());
  let notices = 0;
  port.subscribe(() => { notices += 1; });
  const submit = controller(harness);
  harness.appContext.composerContext.setText('read @missing.txt');
  const preparing = submit.submitComposer();
  assert.equal(harness.appContext.pendingMessageContext.getRenderState().status, 'preparing');
  const draft = liveDraft(harness);
  await submit.submitComposer();
  await preparing;
  assert.deepEqual(harness.appContext.composerContext.composer, draft);
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), ['read @missing.txt']);
  const card = harness.appContext.pendingMessageContext.getRenderState();
  assert.equal(card.status, 'failed');
  assert.match(card.error, /missing.txt/);
  assert.equal(port.hasReady(), false);
  assert.equal(notices, 0);
  assert.equal(turn.abortSignal.aborted, false);
  assert.deepEqual(harness.appContext.transcriptContext.getResidentRecords().map((r) => r.text), ['original']);
  inputController(harness, submit).handleEvent({type: 'escape'});
  assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
  assert.equal(turn.abortSignal.aborted, false);
  assert.deepEqual(harness.appContext.composerContext.composer, draft);
});

for (const source of ['notification', 'render']) {
  test(`successful steering preparation is not marked failed when ${source} throws`, async (t) => {
    const harness = createHarness();
    const {turn, port} = beginSteer(harness);
    t.after(() => harness.appContext.turnContext.stopSpinner());
    const error = new Error(`${source} failed`);
    if (source === 'notification') port.subscribe(() => { throw error; });
    const submit = controller(harness, {render() { if (source === 'render' && port.hasReady()) throw error; }});
    await assert.rejects(submitText(harness, submit, 'Do not delete obsolete.txt'), error);
    assert.equal(port.hasReady(), true);
    assert.equal(harness.appContext.pendingMessageContext.getRenderState().status, 'ready');
    assert.equal(harness.appContext.pendingMessageContext.getRenderState().error, undefined);
    assert.equal(turn.abortSignal.aborted, false);
    assert.equal(port.claim().text, 'Do not delete obsolete.txt');
    assert.equal(port.claim(), null);
  });
}

for (const kind of ['slash', 'skill', 'shell', 'shell-local', 'reference']) {
  test(`steer controller preserves pending route for ${kind}`, async () => {
    const harness = createHarness();
    const {port} = beginSteer(harness);
    if (kind.startsWith('shell')) harness.appContext.setInteractionMode(kind);
    if (kind === 'reference') harness.appContext.conversationReferenceContext.setPending({
      projectionMode: 'full', sourcePath: '/tmp/ref', sourceSessionId: 'old', title: 'ref', materialSegments: []
    });
    const text = kind === 'slash' ? '/config' : kind === 'skill' ? '/my-skill task' : 'ordinary text';
    await submitText(harness, controller(harness), text);
    assert.equal(harness.appContext.pendingMessageContext.getPending(), text);
    assert.deepEqual(harness.appContext.pendingMessageContext.getRenderState(), {preview: text});
    assert.equal(port.hasReady(), false);
    assert.deepEqual(harness.appContext.composerContext.getInputHistory(), [text]);
  });
}

for (const initial of ['normal', 'plan']) {
  test(`steering from ${initial} uses the mode selected at submission without idle dispatch`, async (t) => {
    const harness = createHarness();
    const app = harness.appContext;
    app.setInteractionMode(initial);
    const {turn, port} = beginSteer(harness);
    t.after(() => app.turnContext.stopSpinner());
    const selected = initial === 'normal' ? 'plan' : 'normal';
    app.setInteractionMode(selected);
    await submitText(harness, controller(harness), 'new instruction');
    assert.equal(port.hasReady(), true);
    assert.equal(port.claim().metadata.interactionMode, selected);
    assert.equal(app.turnContext.activeAssistantTurn.id, turn.id);
    assert.equal(Object.hasOwn(app.turnContext.activeAssistantTurn, 'interactionMode'), false);
  });
}

test('steering preparation and idle handoff preserve the submitted mode despite later selection', async (t) => {
  const cwd = tempDir(t);
  fs.writeFileSync(path.join(cwd, 'mode.txt'), 'material');
  const harness = createHarness();
  const app = harness.appContext;
  app.getCurrentCwd = () => cwd;
  const {turn} = beginSteer(harness);
  const submissions = [];
  const submit = controller(harness, {startAssistantTurn: async (s) => { submissions.push(s); }});
  app.setInteractionMode('plan');
  const preparing = submitText(harness, submit, 'inspect @mode.txt');
  app.setInteractionMode('normal');
  app.turnContext.finishAssistantTurn('done');
  app.turnContext.clearAssistantTurnIfCurrent(turn);
  app.pendingMessageContext.finishTurn(turn.id);
  await preparing;
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].metadata.interactionMode, 'plan');
  assert.equal(app.getInteractionMode(), 'normal');
});

test('runner uses prepared submission mode rather than a later composer selection', async () => {
  const harness = createHarness();
  harness.appContext.setInteractionMode('normal');
  await runAssistantTurn({...harness.input, metadata: {interactionMode: 'plan'}, async runAgent(session, callbacks) {
    assert.equal(session.interactionMode, 'plan');
    assert.match(session.records.at(-1).text, /Plan mode is active/);
    assert.equal(session.records.at(-1).metadata.interactionMode, 'plan');
    callbacks.onComplete('done');
    return 'done';
  }});
  assert.equal(harness.appContext.getInteractionMode(), 'normal');
});

test('pending ordinary input retains its submission mode even when the composer later selects shell', async (t) => {
  const harness = createHarness();
  const app = harness.appContext;
  app.beginUserTurn('original');
  const turn = app.turnContext.beginAssistantTurn(undefined, 'pending');
  t.after(() => app.turnContext.stopSpinner());
  const submissions = [];
  const submit = controller(harness, {startAssistantTurn: async (s) => { submissions.push(s); }});
  app.setInteractionMode('plan');
  await submitText(harness, submit, 'inspect only');
  app.setInteractionMode('shell');
  app.turnContext.finishAssistantTurn('done');
  app.turnContext.clearAssistantTurnIfCurrent(turn);
  await submit.dispatchPendingMessage();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].metadata.interactionMode, 'plan');
  assert.equal(submissions[0].userText, 'inspect only');
});

test('next ordinary turn restores mode from applied steering rather than the original turn', async () => {
  const harness = createHarness();
  const app = harness.appContext;
  app.beginUserTurn('original', {metadata: {interactionMode: 'normal'}});
  app.turnContext.finishAssistantTurn('done');
  app.transcriptContext.appendRecord({role: 'user', text: 'applied guidance', metadata: {interactionMode: 'plan'}});
  const next = app.beginUserTurn('implement', {metadata: {interactionMode: 'normal'}});
  assert.deepEqual(next.metadata.modeTransition, {from: 'plan', to: 'normal'});
  assert.match(next.text, /Previous Plan Mode restrictions no longer apply/);
});

test('ordinary missing-file submit retains unavailable diagnostic instead of adopting steer rejection', async (t) => {
  const harness = createHarness();
  harness.appContext.getCurrentCwd = () => tempDir(t);
  const submissions = [];
  await submitText(harness, controller(harness, {startAssistantTurn: async (s) => { submissions.push(s); }}), 'read @missing.txt');
  assert.equal(submissions.length, 1);
  assert.match(submissions[0].userText, /unavailable/);
  assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
});

test('prepared steering crossing final dispatches original file material once and preserves later draft', async (t) => {
  const cwd = tempDir(t);
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'ORIGINAL CONTENTS');
  const harness = createHarness();
  harness.appContext.getCurrentCwd = () => cwd;
  const {turn} = beginSteer(harness);
  const submissions = [];
  const submit = controller(harness, {startAssistantTurn: async (s) => { submissions.push(s); }});
  harness.appContext.composerContext.setText('read @note.txt');
  const preparing = submit.submitComposer();
  const draft = liveDraft(harness);
  harness.appContext.turnContext.finishAssistantTurn('original final');
  harness.appContext.turnContext.clearAssistantTurnIfCurrent(turn);
  harness.appContext.pendingMessageContext.finishTurn(turn.id);
  await preparing;
  assert.equal(submissions.length, 1);
  assert.match(submissions[0].userText, /ORIGINAL CONTENTS/);
  assert.equal(submissions[0].displayText, 'read @note.txt');
  assert.equal(submissions[0].metadata.interactionMode, 'normal');
  fs.rmSync(path.join(cwd, 'note.txt'));
  await submit.dispatchPendingMessage();
  assert.equal(submissions.length, 1);
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), ['read @note.txt']);
  assert.deepEqual(harness.appContext.composerContext.composer, draft);
});

test('ready material handed off after final never rereads deleted attachment', async (t) => {
  const cwd = tempDir(t);
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'PREPARED');
  const harness = createHarness();
  harness.appContext.getCurrentCwd = () => cwd;
  const {turn} = beginSteer(harness);
  const submissions = [];
  const submit = controller(harness, {startAssistantTurn: async (s) => { submissions.push(s); }});
  await submitText(harness, submit, 'read @note.txt');
  assert.equal(submissions.length, 0);
  fs.rmSync(path.join(cwd, 'note.txt'));
  harness.appContext.turnContext.finishAssistantTurn('final');
  harness.appContext.turnContext.clearAssistantTurnIfCurrent(turn);
  harness.appContext.pendingMessageContext.finishTurn(turn.id);
  await Promise.all([submit.dispatchPendingMessage(), submit.dispatchPendingMessage()]);
  assert.equal(submissions.length, 1);
  assert.match(submissions[0].userText, /PREPARED/);
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), ['read @note.txt']);
});

test('final response lock release does not dispatch before old runner identity is cleared', async () => {
  const harness = createHarness();
  const {turn} = beginSteer(harness);
  const submissions = [];
  const submit = controller(harness, {startAssistantTurn: async (s) => {submissions.push(s);}});
  await submitText(harness, submit, 'ready');
  harness.appContext.turnContext.finishAssistantTurn('final');
  await submit.dispatchPendingMessage();
  assert.equal(submissions.length, 0);
  assert.equal(harness.appContext.pendingMessageContext.getPending(), 'ready');
  harness.appContext.turnContext.clearAssistantTurnIfCurrent(turn);
  harness.appContext.pendingMessageContext.finishTurn(turn.id);
  await submit.dispatchPendingMessage();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].userText, 'ready');
});

test('real controller, runner and loop apply submission modes in one turn and journal', async (t) => {
  const store = createFakeTranscriptStore();
  const harness = createHarness({transcriptStore: store, appSettings: {activeTurnMessagePolicy: 'steer', toolApprovalMode: 'manual'}});
  const started = [deferred(), deferred()];
  const settled = [deferred(), deferred()];
  let requests = 0;
  const agent = {async runTurn(records, _callbacks, options) {
    const index = requests++;
    if (index < 2) {
      if (index === 1) {
        assert.equal(records.at(-1).metadata.interactionMode, 'plan');
        assert.match(records.at(-1).text, /Plan mode is active/);
      }
      started[index].resolve(options.abortSignal);
      await settled[index].promise;
      throw new AgentAbortError();
    }
    assert.equal(records.at(-1).metadata.interactionMode, 'normal');
    assert.match(records.at(-1).text, /Previous Plan Mode restrictions no longer apply/);
    return done;
  }};
  await withRuntime(t, harness, agent, async ({submit, sessions, preparations}) => {
    const running = submitText(harness, submit, 'original');
    const firstSignal = await started[0].promise;
    const turnId = harness.appContext.turnContext.activeAssistantTurn.id;
    harness.appContext.setInteractionMode('plan');
    await submitText(harness, submit, 'inspect only');
    assert.equal(firstSignal.aborted, true);
    harness.appContext.setInteractionMode('normal');
    settled[0].resolve();
    const secondSignal = await started[1].promise;
    await submitText(harness, submit, 'implement now');
    assert.equal(secondSignal.aborted, true);
    assert.equal(harness.appContext.turnContext.activeAssistantTurn.id, turnId);
    settled[1].resolve();
    await running;
    assert.equal(sessions.length, 1);
    assert.equal(preparations.length, 1);
    assert.equal(harness.appContext.changeHistoryContext.history.length, 1);
    const records = harness.appContext.transcriptContext.getResidentRecords();
    const users = records.filter((record) => record.role === 'user');
    assert.deepEqual(users.map((record) => record.metadata.interactionMode), ['normal', 'plan', 'normal']);
    assert.deepEqual(users.map((record) => record.displayText ?? record.text), ['original', 'inspect only', 'implement now']);
    assert.deepEqual(store.loadSession().session.records, records);
    const next = harness.appContext.beginUserTurn('same mode');
    assert.equal(next.metadata.modeTransition, undefined);
  });
});

test('real controller + runner + loop keeps continuous steering in one session/config/checkpoint and ordered journal', async (t) => {
  const store = createFakeTranscriptStore();
  const harness = createHarness({transcriptStore: store, appSettings: {activeTurnMessagePolicy: 'steer', toolApprovalMode: 'manual'}});
  const first = deferred();
  const firstSettled = deferred();
  const second = deferred();
  const secondSettled = deferred();
  let requests = 0;
  let oldCallbacks;
  let checkpoint;
  let activeTurn;
  const observedHistories = [];
  const agent = {async runTurn(records, cb, options) {
    observedHistories.push(structuredClone(records));
    requests += 1;
    assert.equal(harness.appContext.turnContext.responding, true);
    if (requests === 1) {
      checkpoint = harness.appContext.changeHistoryContext.current;
      activeTurn = harness.appContext.turnContext.activeAssistantTurn;
      return {draft: 'complete segment', toolCalls: [call('todo', 'create_todos', {items: ['keep task']}), call('bash', 'run_bash_command', {command: 'rm example.txt'})]};
    }
    assert.equal(harness.appContext.changeHistoryContext.current, checkpoint);
    assert.equal(harness.appContext.turnContext.activeAssistantTurn, activeTurn);
    assert.equal(activeTurn.controller.signal.aborted, false);
    assert.equal(harness.appContext.transcriptContext.todoState.items[0].text, 'keep task');
    if (requests === 2) {
      oldCallbacks = cb;
      cb.onReasoningUpdate({kind: 'draft', text: 'local reasoning A'});
      cb.onToken('partial', 'retained segment A');
      first.resolve(options.abortSignal);
      await firstSettled.promise;
      throw new AgentAbortError();
    }
    if (requests === 3) {
      oldCallbacks.onToken('late', 'LATE MUST NOT PERSIST');
      oldCallbacks.onReasoningUpdate({kind: 'complete', text: 'LATE REASONING'});
      oldCallbacks.onProviderRetry({message: 'LATE RETRY'});
      assert.equal(harness.appContext.turnContext.streamingDraft, '');
      assert.deepEqual(harness.appContext.transcriptContext.getResidentRecords().slice(-3), [
        {role: 'reasoning_summary', text: 'local reasoning A'},
        {role: 'assistant', text: 'retained segment A'},
        {role: 'user', text: 'steer A', metadata: {interactionMode: 'normal'}}
      ]);
      assert.deepEqual(store.loadSession().session.records, harness.appContext.transcriptContext.getResidentRecords());
      cb.onReasoningUpdate({kind: 'draft', text: 'local reasoning B'});
      cb.onToken('partial', 'retained segment B');
      second.resolve(options.abortSignal);
      await secondSettled.promise;
      throw new AgentAbortError();
    }
    return done;
  }};
  const bash = {definition: {name: 'run_bash_command', description: 'fake bash', parameters: {type: 'object'}},
    async execute(_args, c) { return {callId: c.callId, toolName: c.toolName, ok: true, text: 'actual result', details: {kind: 'generic'}}; }};
  await withRuntime(t, harness, agent, async ({submit, sessions, preparations}) => {
    harness.appContext.composerContext.setText('original task');
    const running = submit.submitComposer();
    // 人工审批仍经真实 resolver；会话授权在后续请求保持不变。
    const deadline = Date.now() + 2000;
    while (!harness.input.toolApproval.hasActiveRequest()) {
      assert.ok(Date.now() < deadline, 'manual approval should be requested');
      await new Promise((r) => setImmediate(r));
    }
    harness.input.toolApproval.handleEvent({type: 'submit'});
    const requestSignal = await first.promise;
    const sessionId = harness.appContext.transcriptContext.currentSessionId;
    await submitText(harness, submit, 'steer A');
    assert.equal(requestSignal.aborted, true);
    assert.equal(activeTurn.controller.signal.aborted, false);
    assert.equal(requests, 2);
    assert.equal(harness.appContext.turnContext.streamingDraft, 'retained segment A');
    assert.equal(harness.appContext.turnContext.reasoningDraft, 'local reasoning A');
    assert.equal(store.loadSession().session.records.some((r) => r.text === 'retained segment A' || r.text === 'local reasoning A'), false);
    assert.equal(harness.appContext.transcriptContext.getResidentRecords().some((r) => r.text === 'steer A'), false);
    oldCallbacks.onToken('late', 'LATE BEFORE SETTLE');
    oldCallbacks.onReasoningUpdate({kind: 'draft', text: 'LATE REASONING BEFORE SETTLE'});
    assert.equal(harness.appContext.turnContext.streamingDraft, 'retained segment A');
    assert.equal(harness.appContext.turnContext.reasoningDraft, 'local reasoning A');
    const draft = liveDraft(harness);
    await submit.submitComposer();
    assert.deepEqual(harness.appContext.composerContext.composer, draft);
    firstSettled.resolve();
    const secondSignal = await second.promise;
    assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
    await submitText(harness, submit, 'steer B');
    const lastDraft = liveDraft(harness);
    assert.equal(secondSignal.aborted, true);
    assert.equal(harness.appContext.turnContext.streamingDraft, 'retained segment B');
    assert.equal(store.loadSession().session.records.some((r) => r.text === 'retained segment B' || r.text === 'steer B'), false);
    secondSettled.resolve();
    await running;
    assert.equal(sessions.length, 1);
    assert.equal(preparations.length, 1);
    assert.equal(sessions[0].sessionId, sessionId);
    assert.equal(sessions[0].userConfigSnapshot, preparations[0].configSnapshot);
    assert.equal(sessions[0].interactionMode, 'normal');
    assert.deepEqual(harness.appContext.composerContext.composer, lastDraft);
    assert.deepEqual(harness.appContext.composerContext.getInputHistory(), ['original task', 'steer A', 'steer B']);
    assert.equal(harness.appContext.turnContext.responding, false);
    assert.equal(harness.appContext.changeHistoryContext.history.length, 1);
    assert.equal(harness.appContext.changeHistoryContext.last.id, checkpoint.id);
    const records = harness.appContext.transcriptContext.getResidentRecords();
    assert.deepEqual(records.map((r) => r.role), ['user', 'assistant', 'tool_call', 'tool_result', 'tool_call', 'tool_result', 'reasoning_summary', 'assistant', 'user', 'reasoning_summary', 'assistant', 'user', 'assistant']);
    assert.deepEqual(records.filter((r) => r.role === 'user').map((r) => r.text), ['original task', 'steer A', 'steer B']);
    assert.deepEqual(records.filter((r) => r.role === 'assistant'), [
      {role: 'assistant', text: 'complete segment'},
      {role: 'assistant', text: 'retained segment A'},
      {role: 'assistant', text: 'retained segment B'},
      {role: 'assistant', text: 'done'}
    ]);
    assert.deepEqual(records.filter((r) => r.role === 'reasoning_summary').map((r) => r.text), ['local reasoning A', 'local reasoning B']);
    assert.equal(records.some((r) => /LATE/.test(r.text)), false);
    assert.equal(observedHistories.some((history) => history.some((r) => r.role === 'reasoning_summary' || /local reasoning/.test(r.text))), false);
    const history = observedHistories.at(-1).filter((r) => r.role !== 'system' && !r.text.startsWith('# Echo Runtime Context'));
    assert.deepEqual(history, records.slice(0, -1).filter((r) => r.role !== 'reasoning_summary'));
    assert.deepEqual(store.loadSession().session.records, records);
    assert.equal(harness.hookEvents.filter((e) => e.event === 'assistant_turn_start').length, 1);
    assert.equal(harness.hookEvents.filter((e) => e.event === 'assistant_turn_end').length, 1);
    assert.equal(harness.hookEvents.filter((e) => e.event === 'tool_approval_request').length, 1);
    assert.ok(harness.appContext.loadTranscriptSession(sessionId));
    assert.deepEqual(harness.appContext.transcriptContext.getResidentRecords(), records);
    await submit.dispatchPendingMessage();
    assert.equal(sessions.length, 1);
    assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
  }, [...createTodoToolHandlers(), bash]);
});

for (const outcome of ['abort', 'complete']) {
  test(`real preemption then remove input and immediately Esc preserves frozen drafts once before SDK ${outcome} settles`, async (t) => {
    const store = createFakeTranscriptStore();
    const harness = createHarness({transcriptStore: store, appSettings: {activeTurnMessagePolicy: 'steer'}});
    const started = deferred();
    const settle = deferred();
    let requests = 0;
    let providerCallbacks;
    const agent = {async runTurn(_records, cb, options) {
      requests += 1;
      providerCallbacks = cb;
      cb.onReasoningUpdate({kind: 'draft', text: 'frozen local reasoning'});
      cb.onToken('body', 'frozen body');
      started.resolve(options.abortSignal);
      await settle.promise;
      cb.onToken('late', 'LATE BODY');
      cb.onReasoningUpdate({kind: 'complete', text: 'LATE REASONING'});
      if (outcome === 'abort') throw new AgentAbortError();
      return {draft: 'LATE COMPLETE BODY', toolCalls: [call('late-tool', 'create_todos', {items: ['LATE TASK']})],
        providerRecords: [{role: 'extension', text: '', extension: {kind: 'openai_chat_reasoning', reasoningContent: 'LATE PRIVATE REASONING'}}]};
    }};
    await withRuntime(t, harness, agent, async ({submit, sessions}) => {
      const running = submitText(harness, submit, 'original');
      const signal = await started.promise;
      const sessionId = harness.appContext.transcriptContext.currentSessionId;
      await submitText(harness, submit, 'removed steer');
      assert.equal(signal.aborted, true);
      assert.equal(harness.appContext.turnContext.streamingDraft, 'frozen body');
      assert.deepEqual(store.loadSession().session.records.map((r) => r.role), ['user']);
      const input = inputController(harness, submit);
      input.handleEvent({type: 'escape'});
      assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
      assert.equal(sessions[0].abortSignal.aborted, false);
      assert.equal(harness.appContext.turnContext.streamingDraft, 'frozen body');
      input.handleEvent({type: 'escape'});
      assert.equal(sessions[0].abortSignal.aborted, true);
      const cancelledRecords = structuredClone(harness.appContext.transcriptContext.getResidentRecords());
      assert.deepEqual(cancelledRecords.map((r) => r.role), ['user', 'reasoning_summary', 'assistant', 'local_notice']);
      assert.deepEqual(cancelledRecords[1], {role: 'reasoning_summary', text: 'frozen local reasoning'});
      assert.deepEqual(cancelledRecords[2], {role: 'assistant', text: 'frozen body'});
      assert.deepEqual(store.loadSession().session.records, cancelledRecords);
      providerCallbacks.onToken('late', 'LATE BEFORE SETTLE');
      providerCallbacks.onReasoningUpdate({kind: 'draft', text: 'LATE BEFORE SETTLE REASONING'});
      input.handleEvent({type: 'escape'});
      assert.deepEqual(harness.appContext.transcriptContext.getResidentRecords(), cancelledRecords);
      settle.resolve();
      await running;
      assert.equal(requests, 1);
      assert.equal(sessions.length, 1);
      assert.deepEqual(harness.appContext.transcriptContext.getResidentRecords(), cancelledRecords);
      assert.deepEqual(store.loadSession().session.records, cancelledRecords);
      assert.equal(harness.appContext.turnContext.getPending(), null);
      assert.equal(harness.appContext.turnContext.responding, false);
      assert.equal(harness.appContext.turnContext.activeAssistantTurn, null);
      assert.deepEqual(harness.appContext.transcriptContext.todoState.items, []);
      assert.ok(harness.appContext.loadTranscriptSession(sessionId));
      assert.deepEqual(harness.appContext.transcriptContext.getResidentRecords(), cancelledRecords);
      await submit.dispatchPendingMessage();
      assert.equal(requests, 1);
    }, createTodoToolHandlers());
  });
}

for (const withTool of [false, true]) {
  test(`complete SDK response wins over preempted draft without duplicate body${withTool ? ' and pairs skipped tools' : ''}`, async (t) => {
    const store = createFakeTranscriptStore();
    const harness = createHarness({transcriptStore: store, appSettings: {activeTurnMessagePolicy: 'steer'}});
    const started = deferred();
    const settle = deferred();
    const observedHistories = [];
    const agent = {async runTurn(records, cb, options) {
      observedHistories.push(structuredClone(records));
      if (observedHistories.length === 1) {
        cb.onReasoningUpdate({kind: 'draft', text: 'local reasoning'});
        cb.onToken('prefix', 'body prefix');
        started.resolve(options.abortSignal);
        await settle.promise;
        cb.onToken('late', 'LATE BODY');
        return {draft: 'body prefix plus complete tail',
          toolCalls: withTool ? [call('skipped', 'create_todos', {items: ['must not execute']})] : []};
      }
      assert.deepEqual(harness.appContext.transcriptContext.getResidentRecords().filter((r) => r.role === 'assistant'), [
        {role: 'assistant', text: 'body prefix plus complete tail'}
      ]);
      assert.deepEqual(store.loadSession().session.records, harness.appContext.transcriptContext.getResidentRecords());
      return done;
    }};
    await withRuntime(t, harness, agent, async ({submit}) => {
      const running = submitText(harness, submit, 'original');
      const signal = await started.promise;
      const sessionId = harness.appContext.transcriptContext.currentSessionId;
      await submitText(harness, submit, 'steer');
      assert.equal(signal.aborted, true);
      assert.equal(harness.appContext.turnContext.streamingDraft, 'body prefix');
      assert.deepEqual(store.loadSession().session.records.map((r) => r.role), ['user']);
      settle.resolve();
      await running;
      const records = harness.appContext.transcriptContext.getResidentRecords();
      assert.deepEqual(records.filter((r) => r.role === 'assistant'), [
        {role: 'assistant', text: 'body prefix plus complete tail'},
        {role: 'assistant', text: 'done'}
      ]);
      assert.deepEqual(records.filter((r) => r.role === 'reasoning_summary'), [{role: 'reasoning_summary', text: 'local reasoning'}]);
      assert.equal(records.some((r) => /LATE/.test(r.text)), false);
      assert.equal(records.findIndex((r) => r.text === 'body prefix plus complete tail') < records.findIndex((r) => r.text === 'steer'), true);
      const pairs = records.filter((r) => r.role === 'tool_call' || r.role === 'tool_result');
      assert.deepEqual(pairs.map((r) => [r.role, r.toolCallId]), withTool ? [['tool_call', 'skipped'], ['tool_result', 'skipped']] : []);
      if (withTool) assert.equal(pairs[1].ok, false);
      assert.deepEqual(harness.appContext.transcriptContext.todoState.items, []);
      const providerHistory = observedHistories[1].filter((r) => r.role !== 'system');
      assert.deepEqual(providerHistory, records.slice(0, -1).filter((r) => r.role !== 'reasoning_summary'));
      assert.deepEqual(store.loadSession().session.records, records);
      assert.ok(harness.appContext.loadTranscriptSession(sessionId));
      assert.deepEqual(harness.appContext.transcriptContext.getResidentRecords(), records);
      assert.equal(harness.hookEvents.filter((e) => e.event === 'assistant_turn_end').length, 1);
    }, createTodoToolHandlers());
  });
}

for (const applied of [false, true]) {
  test(`real input Esc ${applied ? 'after apply cancels whole turn' : 'after preemption removes message and continues original task'}`, async (t) => {
    const harness = createHarness({appSettings: {activeTurnMessagePolicy: 'steer'}});
    const first = deferred();
    const settle = deferred();
    const continued = deferred();
    const end = deferred();
    let requests = 0;
    let parentSignal;
    const agent = {async runTurn(records, _cb, options) {
      requests += 1;
      if (requests === 1) { first.resolve(options.abortSignal); await settle.promise; throw new AgentAbortError(); }
      assert.equal(records.some((r) => r.text === 'steer'), applied);
      continued.resolve();
      await end.promise;
      if (options.abortSignal.aborted) throw new AgentAbortError();
      return done;
    }};
    await withRuntime(t, harness, agent, async ({submit, sessions}) => {
      harness.appContext.composerContext.setText('original');
      const running = submit.submitComposer();
      const signal = await first.promise;
      parentSignal = sessions[0].abortSignal;
      await submitText(harness, submit, 'steer');
      assert.equal(signal.aborted, true);
      let modal = true;
      const resolver = new ActiveInputResolver([{id: 'approval', isActive: () => modal,
        handleEvent() { modal = false; return true; }}]);
      const input = inputController(harness, submit, resolver);
      input.handleEvent({type: 'escape'});
      assert.equal(harness.appContext.pendingMessageContext.getPending(), 'steer');
      assert.equal(parentSignal.aborted, false);
      if (!applied) {
        input.handleEvent({type: 'escape'});
        assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
        assert.equal(parentSignal.aborted, false);
      }
      settle.resolve();
      await continued.promise;
      if (applied) {
        assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
        input.handleEvent({type: 'escape'});
        assert.equal(parentSignal.aborted, true);
      }
      end.resolve();
      await running;
      const records = harness.appContext.transcriptContext.getResidentRecords();
      assert.equal(records.some((r) => r.text === 'steer'), applied);
      assert.equal(records.some((r) => r.role === 'local_notice'), applied);
      assert.equal(records.some((r) => r.role === 'error'), false);
      assert.equal(sessions.length, 1);
      assert.equal(requests, 2);
    });
  });
}

for (const action of ['clear', 'resume']) {
  test(`${action} isolates late file preparation without resurrecting transient steering`, async (t) => {
    const cwd = tempDir(t);
    fs.writeFileSync(path.join(cwd, 'note.txt'), 'contents');
    const harness = createHarness();
    harness.appContext.getCurrentCwd = () => cwd;
    beginSteer(harness);
    const submit = controller(harness);
    harness.appContext.composerContext.setText('read @note.txt');
    const preparing = submit.submitComposer();
    if (action === 'clear') harness.appContext.clearTranscriptRecords();
    else assert.ok(harness.appContext.loadTranscriptSession(harness.appContext.transcriptContext.currentSessionId));
    const draft = liveDraft(harness);
    await preparing;
    assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
    assert.deepEqual(harness.appContext.composerContext.composer, draft);
    assert.equal(harness.appContext.transcriptContext.getResidentRecords().some((r) => r.text.includes('contents')), false);
  });
}

for (const source of ['save', 'watcher']) {
  test(`${source} policy changes affect next real turn only`, async (t) => {
    const cwd = tempDir(t);
    const configPath = path.join(cwd, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ui: {activeTurnMessagePolicy: 'pending'}}));
    let watch;
    const config = new UserConfigContext({configPath, watchConfig(cb) { watch = cb; return {close() {}}; }});
    config.startWatching();
    t.after(() => config.close());
    const harness = createHarness({userConfigContext: config});
    const started = deferred();
    const finish = deferred();
    let requests = 0;
    const agent = {async runTurn() { if (++requests === 1) { started.resolve(); await finish.promise; } return done; }};
    await withRuntime(t, harness, agent, async ({submit, sessions}) => {
      harness.appContext.composerContext.setText('first');
      const running = submit.submitComposer();
      await started.promise;
      const firstSnapshot = sessions[0].userConfigSnapshot;
      assert.equal(harness.appContext.turnContext.activeAssistantTurn.messagePolicy, 'pending');
      assert.equal(sessions[0].steeringInput, undefined);
      if (source === 'save') {
        config.saveAppSettingsDraft({...config.capture().getAppSettingsDraft(), activeTurnMessagePolicy: 'steer'});
      } else {
        fs.writeFileSync(configPath, JSON.stringify({ui: {activeTurnMessagePolicy: 'steer'}}));
        watch();
      }
      assert.equal(firstSnapshot.getAppSettings().activeTurnMessagePolicy, 'pending');
      assert.equal(harness.appContext.turnContext.activeAssistantTurn.messagePolicy, 'pending');
      await submitText(harness, submit, 'queued');
      assert.deepEqual(harness.appContext.pendingMessageContext.getRenderState(), {preview: 'queued'});
      finish.resolve();
      await running;
      assert.equal(sessions.length, 2);
      assert.ok(sessions[1].steeringInput);
      assert.equal(sessions[1].userConfigSnapshot.getAppSettings().activeTurnMessagePolicy, 'steer');
      assert.notEqual(sessions[1].userConfigSnapshot, firstSnapshot);
      assert.deepEqual(harness.appContext.composerContext.getInputHistory(), ['first', 'queued']);
    });
  });
}
