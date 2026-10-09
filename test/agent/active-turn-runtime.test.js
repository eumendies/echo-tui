const test = require('node:test');
const assert = require('node:assert/strict');
const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const {runProviderStep} = require('../../src/agent/loop-runtime/provider-step');
const setup = require('../../src/agent/agent-setup');
const {createToolRegistry, createDefaultToolRegistry} = require('../../src/tools/tool-registry');
const {AgentAbortError} = require('../../src/types/agent');
const {createCompactionNoticeRecord} = require('../../src/agent/context/context-compaction');
const {createToolCallTranscriptRecord, createToolResultTranscriptRecord} = require('../../src/tools/tool-transcript-record');
const {convertTranscriptToOpenAiInput, createOpenAiReasoningRecord} = require('../../src/agent/openai-responses/transcript-converter');
const {convertTranscriptToOpenAiChatMessages, createOpenAiChatReasoningRecord} = require('../../src/agent/openai-chat/transcript-converter');
const {convertTranscriptToAnthropicMessages, createAnthropicThinkingRecord} = require('../../src/agent/anthropic/transcript-converter');
const {createOpenAiAgent} = require('../../src/agent/openai-responses/agent');
const {createOpenAiChatAgent} = require('../../src/agent/openai-chat/agent');
const {createAnthropicAgent} = require('../../src/agent/anthropic/agent');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const {disabledObservation} = require('../../src/observation/observation');
const sandboxProvider = require('../../src/sandbox/provider');

const config = {agentType: 'fake', apiKey: 'test', model: 'fake', contextWindow: 128000,
  tools: {bash: {timeoutMs: 1000, maxOutputBytes: 1024}, sandbox: {mode: 'off', network: false, extraWritablePaths: []}}};
const snapshot = {getAppSettings: () => ({agentInstructionFileName: 'AGENTS.md', compactionThresholdRatio: 0.7, skillCatalogContextRatio: 0.02})};
const done = {draft: 'done', toolCalls: []};
const call = (id, name = 'exclusive') => ({callId: id, toolName: name, argumentsText: '{}'});
const result = (toolCall) => ({callId: toolCall.callId, toolName: toolCall.toolName, ok: true, text: 'actual', details: {kind: 'generic'}});
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return {promise, resolve};
}
function port() {
  let record = null;
  const listeners = new Set();
  return {
    claims: [], listeners,
    hasReady: () => record !== null,
    claim() { const claimed = record; record = null; if (claimed) this.claims.push(claimed); return claimed; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    ready(text = 'steer', interactionMode) {
      record = {role: 'user', text, ...(interactionMode ? {metadata: {interactionMode}} : {})};
      for (const listener of listeners) listener();
      return record;
    },
    remove() { record = null; }
  };
}
async function runtime(agent, run, handlers = [], overrides = {}) {
  const original = setup.prepareAgent;
  setup.prepareAgent = () => ({agent, config: {...config, ...overrides}, registry: createToolRegistry(handlers)});
  try { return await run(createAgentLoopRuntime('/tmp/echo_tui', {capture: () => snapshot})); }
  finally { setup.prepareAgent = original; }
}
function recorder(records = [{role: 'user', text: 'original'}]) {
  const pending = new Map();
  const events = [];
  const compactions = [];
  return {records, events, compactions, callbacks: {
    onUserMessage(record) { records.push(record); events.push('user'); },
    onAssistantSegment(text) { records.push({role: 'assistant', text}); events.push('segment'); },
    onReasoningUpdate(update) { if (update.kind === 'complete') { records.push({role: 'reasoning_summary', text: update.text}); events.push('reasoning'); } },
    onProviderRecords(batch) { records.push(...batch); events.push('private'); },
    onToolCall(toolCall) { assert.equal(pending.has(toolCall.callId), false); pending.set(toolCall.callId, toolCall); events.push(`call:${toolCall.callId}`); },
    onToolResult(toolResult) { assert.ok(pending.has(toolResult.callId)); records.push(createToolCallTranscriptRecord(pending.get(toolResult.callId)), createToolResultTranscriptRecord(toolResult)); pending.delete(toolResult.callId); events.push(`result:${toolResult.callId}`); },
    onCompacted(compaction) { compactions.push(compaction); records.push(createCompactionNoticeRecord(compaction)); events.push('compaction'); },
    onComplete() { assert.equal(pending.size, 0); events.push('complete'); }
  }};
}
function handler(name, execute) {
  return {definition: {name, description: name, parameters: {type: 'object'}}, execute};
}

test('steering waits for settlement, preserves cumulative body, isolates late callbacks and consumes one record', async () => {
  const input = port();
  const started = deferred();
  const settled = deferred();
  const app = recorder();
  const parent = new AbortController();
  const tokens = [];
  let oldCallbacks;
  let requests = 0;
  let preemptions = 0;
  const agent = {async runTurn(records, callbacks, options) {
    requests += 1;
    if (requests === 1) {
      oldCallbacks = callbacks;
      assert.notEqual(options.abortSignal, parent.signal);
      callbacks.onToken('par', 'par');
      callbacks.onToken('tial', 'partial');
      callbacks.onReasoningUpdate({kind: 'complete', text: 'local summary'});
      started.resolve(options.abortSignal);
      await settled.promise;
      throw new AgentAbortError();
    }
    oldCallbacks.onToken('late', 'late');
    oldCallbacks.onReasoningUpdate({kind: 'complete', text: 'late'});
    oldCallbacks.onProviderRetry({message: 'late'});
    assert.deepEqual(records.filter((r) => r.role === 'assistant'), [{role: 'assistant', text: 'partial'}]);
    assert.equal(records.some((r) => r.text === 'late'), false);
    assert.equal(records.filter((r) => r.text === 'steer').length, 1);
    assert.equal(app.records.some((r) => r.text === 'local summary'), true);
    assert.equal(records.some((r) => r.role === 'reasoning_summary'), false);
    return done;
  }};
  await runtime(agent, async (run) => {
    const promise = run({records: app.records, abortSignal: parent.signal, steeringInput: input}, {...app.callbacks,
      onToken: (delta) => tokens.push(delta), onRequestPreempted() { preemptions += 1; }});
    const signal = await started.promise;
    input.ready();
    assert.equal(signal.aborted, true);
    assert.equal(parent.signal.aborted, false);
    oldCallbacks.onToken('late', 'late');
    oldCallbacks.onReasoningUpdate({kind: 'draft', text: 'late draft'});
    oldCallbacks.onReasoningUpdate({kind: 'complete', text: 'late summary'});
    oldCallbacks.onProviderRetry({message: 'late retry'});
    await Promise.resolve();
    assert.equal(requests, 1);
    assert.deepEqual(app.events, ['reasoning']);
    settled.resolve();
    assert.equal(await promise, 'done');
  });
  assert.deepEqual(tokens, ['par', 'tial']);
  assert.equal(preemptions, 1);
  assert.equal(input.claims.length, 1);
  assert.equal(input.listeners.size, 0);
  assert.deepEqual(app.records, [{role: 'user', text: 'original'}, {role: 'reasoning_summary', text: 'local summary'},
    {role: 'assistant', text: 'partial'}, input.claims[0]]);
  assert.deepEqual(app.events, ['reasoning', 'segment', 'user', 'complete']);
});

test('provider step captures cumulative body without a token observer and freezes readable reasoning at preemption', async () => {
  const input = port();
  const updates = [];
  const retries = [];
  let oldCallbacks;
  const agent = {async runTurn(_records, callbacks) {
    oldCallbacks = callbacks;
    callbacks.onToken('par', 'par');
    callbacks.onToken('tial body', 'partial body');
    callbacks.onReasoningUpdate({kind: 'draft', text: 'readable'});
    callbacks.onReasoningUpdate({kind: 'draft', text: 'readable reasoning'});
    input.ready();
    callbacks.onToken(' late', 'partial body late');
    callbacks.onReasoningUpdate({kind: 'complete', text: 'late reasoning'});
    callbacks.onProviderRetry({message: 'late retry'});
    throw new AgentAbortError();
  }};
  const step = await runProviderStep(agent, [], {
    onReasoningUpdate: (update) => updates.push(update), onProviderRetry: (retry) => retries.push(retry)
  }, {}, input);
  assert.deepEqual(step, {result: null, draft: 'partial body', reasoningDraft: 'readable reasoning'});
  oldCallbacks.onToken('after settlement', 'after settlement');
  oldCallbacks.onReasoningUpdate({kind: 'draft', text: 'after settlement'});
  oldCallbacks.onProviderRetry({message: 'after settlement'});
  assert.deepEqual(updates, [{kind: 'draft', text: 'readable'}, {kind: 'draft', text: 'readable reasoning'}]);
  assert.deepEqual(retries, []);
  assert.equal(input.hasReady(), true);
  assert.equal(input.claims.length, 0);
  assert.equal(input.listeners.size, 0);
});

for (const completed of [false, true]) {
  test(`preempted readable reasoning is local and a completed summary is not duplicated: completed=${completed}`, async () => {
    const input = port();
    const app = recorder();
    let requests = 0;
    const agent = {async runTurn(records, callbacks) {
      if (++requests === 1) {
        callbacks.onReasoningUpdate({kind: 'draft', text: 'readable'});
        callbacks.onReasoningUpdate({kind: 'draft', text: 'readable reasoning'});
        if (completed) callbacks.onReasoningUpdate({kind: 'complete', text: 'readable reasoning'});
        callbacks.onToken('partial', 'partial');
        input.ready();
        throw new AgentAbortError();
      }
      assert.deepEqual(app.records, [{role: 'user', text: 'original'},
        {role: 'reasoning_summary', text: 'readable reasoning'}, {role: 'assistant', text: 'partial'}, input.claims[0]]);
      assert.equal(records.some((r) => r.role === 'reasoning_summary' || r.role === 'extension'), false);
      assert.deepEqual(records.filter((r) => r.role === 'assistant'), [{role: 'assistant', text: 'partial'}]);
      assert.equal(records.at(-1), input.claims[0]);
      return done;
    }};
    await runtime(agent, (run) => run({records: app.records, steeringInput: input}, app.callbacks));
    assert.equal(requests, 2);
    assert.deepEqual(app.events, ['reasoning', 'segment', 'user', 'complete']);
    assert.deepEqual(app.records.filter((r) => r.role === 'reasoning_summary'), [{role: 'reasoning_summary', text: 'readable reasoning'}]);
  });
}

for (const text of ['', ' \n ']) {
  test(`preempted empty body adds no assistant record: ${JSON.stringify(text)}`, async () => {
    const input = port();
    const app = recorder();
    let requests = 0;
    const agent = {async runTurn(records, callbacks) {
      if (++requests === 1) {
        callbacks.onToken(text, text);
        input.ready();
        throw new AgentAbortError();
      }
      assert.equal(records.some((r) => r.role === 'assistant'), false);
      return done;
    }};
    await runtime(agent, (run) => run({records: app.records, steeringInput: input}, app.callbacks));
    assert.equal(requests, 2);
    assert.deepEqual(app.records, [{role: 'user', text: 'original'}, input.claims[0]]);
    assert.deepEqual(app.events, ['user', 'complete']);
  });
}

test('successive preemptions preserve summary/body/user order and send each body before its guidance', async () => {
  const input = port();
  const app = recorder();
  const expectedLocal = [{role: 'user', text: 'original'}];
  const expectedProvider = [{role: 'user', text: 'original'}];
  let requests = 0;
  const agent = {async runTurn(records, callbacks) {
    assert.deepEqual(app.records, expectedLocal);
    assert.deepEqual(records.filter((r) => r.role === 'user' || r.role === 'assistant'), expectedProvider);
    assert.equal(records.some((r) => r.role === 'reasoning_summary'), false);
    if (++requests === 4) return done;
    callbacks.onReasoningUpdate({kind: 'draft', text: `reasoning ${requests}`});
    callbacks.onToken('body ', 'body ');
    callbacks.onToken(String(requests), `body ${requests}`);
    const guidance = input.ready(`guidance ${requests}`);
    expectedLocal.push({role: 'reasoning_summary', text: `reasoning ${requests}`}, {role: 'assistant', text: `body ${requests}`}, guidance);
    expectedProvider.push({role: 'assistant', text: `body ${requests}`}, guidance);
    throw new AgentAbortError();
  }};
  await runtime(agent, (run) => run({records: app.records, steeringInput: input}, app.callbacks));
  assert.equal(requests, 4);
  assert.deepEqual(input.claims.map((r) => r.text), ['guidance 1', 'guidance 2', 'guidance 3']);
  assert.deepEqual(app.events, ['reasoning', 'segment', 'user', 'reasoning', 'segment', 'user', 'reasoning', 'segment', 'user', 'complete']);
  assert.equal(input.listeners.size, 0);
});

for (const mode of ['removed', 'parent-cancel', 'real-error']) {
  test(`preempted request ${mode} preserves cancellation/error ownership`, async () => {
    const input = port();
    const parent = new AbortController();
    const started = deferred();
    const settled = deferred();
    let count = 0;
    const app = recorder();
    const agent = {async runTurn(records, callbacks) {
      if (++count > 1) {
        assert.equal(records.some((r) => r.text === 'steer'), false);
        assert.deepEqual(records.filter((r) => r.role === 'assistant'), [{role: 'assistant', text: 'partial'}]);
        return done;
      }
      callbacks.onToken('partial', 'partial');
      started.resolve();
      await settled.promise;
      throw mode === 'real-error' ? new Error('actual failure') : new AgentAbortError();
    }};
    await runtime(agent, async (run) => {
      const promise = run({records: app.records, steeringInput: input, abortSignal: parent.signal}, app.callbacks);
      await started.promise;
      input.ready();
      if (mode === 'removed') input.remove();
      if (mode === 'parent-cancel') parent.abort();
      settled.resolve();
      if (mode === 'removed') assert.equal(await promise, 'done');
      else await assert.rejects(promise, mode === 'real-error' ? /actual failure/ : AgentAbortError);
    });
    assert.equal(input.claims.length, 0);
    assert.equal(input.listeners.size, 0);
    assert.equal(count, mode === 'removed' ? 2 : 1);
    assert.deepEqual(app.events, mode === 'removed' ? ['segment', 'complete'] : []);
    assert.deepEqual(app.records.filter((r) => r.role === 'assistant'), mode === 'removed' ? [{role: 'assistant', text: 'partial'}] : []);
    if (mode === 'real-error') assert.equal(input.hasReady(), true);
  });
}

test('complete final returned after preemption commits full segment/private history before user', async () => {
  const input = port();
  const app = recorder();
  let count = 0;
  const privateRecord = {role: 'extension', text: '', extension: {kind: 'openai_chat_reasoning', reasoningContent: 'complete reasoning'}};
  const agent = {async runTurn(records, callbacks) {
    if (++count === 1) {
      callbacks.onToken('truncated', 'truncated');
      input.ready();
      callbacks.onToken(' late', 'truncated late');
      return {draft: 'complete final', providerRecords: [privateRecord], toolCalls: []};
    }
    assert.deepEqual(records.slice(-3), [privateRecord, {role: 'assistant', text: 'complete final'}, input.claims[0]]);
    return done;
  }};
  await runtime(agent, async (run) => assert.equal(await run({records: app.records, steeringInput: input}, app.callbacks), 'done'));
  assert.equal(count, 2);
  assert.deepEqual(app.records.filter((r) => r.role === 'assistant'), [{role: 'assistant', text: 'complete final'}]);
  assert.deepEqual(app.events, ['private', 'segment', 'user', 'complete']);
});

for (const initial of ['normal', 'plan']) {
  for (const toolPolicy of ['default', 'readonly']) {
    test(`${initial} steering updates runtime mode and usage while preserving ${toolPolicy} policy`, async (t) => {
      const selected = initial === 'normal' ? 'plan' : 'normal';
      const input = port();
      const app = recorder([{role: 'user', text: 'original', metadata: {interactionMode: initial}}]);
      const usage = [];
      const scopes = [];
      const sandboxModes = [];
      const starts = [];
      let requests = 0;
      let preparations = 0;
      let preparedOptions;
      const original = setup.prepareAgent;
      setup.prepareAgent = (options) => {
        preparations += 1;
        preparedOptions = options;
        return {config, registry: createToolRegistry([handler('apply_patch', async (_args, c) => {
          starts.push(c.callId);
          return result(c);
        })]), agent: {async runTurn(records) {
          sandboxModes.push(options.sandboxModeOverride);
          if (++requests === 1) {
            input.ready('new user instruction', selected);
            return {draft: 'complete original', toolCalls: [], usage: {inputTokens: 10, outputTokens: 1}};
          }
          assert.equal(records.some((r) => r.metadata?.interactionMode === selected), true);
          assert.match(records.find((r) => r.metadata?.modeTransition)?.text || '', selected === 'plan' ? /Plan mode is active/ : /Previous Plan Mode restrictions no longer apply/);
          if (requests === 2) return {draft: '', toolCalls: [call('mutation', 'apply_patch')], usage: {inputTokens: 11, outputTokens: 1}};
          return done;
        }} };
      };
      t.after(() => { setup.prepareAgent = original; });
      const run = createAgentLoopRuntime('/tmp/echo_tui', {capture: () => snapshot}, undefined,
        {...disabledObservation, providerUsage: (event) => scopes.push(event.scope.interactionMode)},
        {appendEvent(event) { usage.push(event); }});
      assert.equal(await run({records: app.records, interactionMode: initial, toolPolicy, steeringInput: input},
        {...app.callbacks, onToolApprovalRequest: () => ({kind: 'allow_once'})}), 'done');
      assert.equal(preparations, 1);
      assert.deepEqual(sandboxModes.slice(0, 2), [toolPolicy === 'default' && initial === 'plan' ? 'read-only' : undefined,
        toolPolicy === 'default' && selected === 'plan' ? 'read-only' : undefined]);
      assert.equal(preparedOptions.sandboxModeOverride, sandboxModes[1]);
      assert.deepEqual(usage.map((event) => event.interactionMode), [initial, selected]);
      assert.deepEqual(scopes.slice(0, 2), [initial, selected]);
      assert.equal(app.records.find((r) => r.role === 'tool_result').ok, selected === 'normal' && toolPolicy === 'default');
      assert.equal(starts.length, selected === 'normal' && toolPolicy === 'default' ? 1 : 0);
      assert.equal(input.claims[0].displayText, 'new user instruction');
      assert.equal(app.records.find((r) => r === input.claims[0]), input.claims[0]);
    });
  }
}

test('prepared but removed mode-changing steering does not change running mode or sandbox', async (t) => {
  const input = port();
  const app = recorder();
  const original = setup.prepareAgent;
  let requests = 0;
  let options;
  setup.prepareAgent = (prepared) => {
    options = prepared;
    return {config, registry: createToolRegistry(), agent: {async runTurn() {
      if (++requests === 1) {
        input.ready('plan guidance', 'plan');
        input.remove();
        throw new AgentAbortError();
      }
      assert.equal(options.sandboxModeOverride, undefined);
      return done;
    }}};
  };
  t.after(() => { setup.prepareAgent = original; });
  const run = createAgentLoopRuntime('/tmp/echo_tui', {capture: () => snapshot});
  assert.equal(await run({records: app.records, steeringInput: input}, app.callbacks), 'done');
  assert.equal(input.claims.length, 0);
  assert.deepEqual(app.events, ['complete']);
});

test('explicit sandbox override survives plan to normal steering', async (t) => {
  const input = port();
  const app = recorder();
  const original = setup.prepareAgent;
  let requests = 0;
  setup.prepareAgent = (options) => ({config, registry: createToolRegistry(), agent: {async runTurn() {
    assert.equal(options.sandboxModeOverride, 'read-only');
    if (++requests === 1) { input.ready('implement', 'normal'); return done; }
    return done;
  }}});
  t.after(() => { setup.prepareAgent = original; });
  const run = createAgentLoopRuntime('/tmp/echo_tui', {capture: () => snapshot});
  await run({records: app.records, interactionMode: 'plan', sandboxModeOverride: 'read-only', steeringInput: input}, app.callbacks);
  assert.equal(requests, 2);
});

test('future subagent starts with applied mode, not the parent initial mode', async (t) => {
  const input = port();
  const app = recorder();
  const original = setup.prepareAgent;
  let parentRequests = 0;
  let childRequests = 0;
  setup.prepareAgent = (options) => ({config,
    registry: createDefaultToolRegistry(config, options.cwd, undefined, {subagentPort: options.subagentPort, allowedToolNames: options.allowedToolNames}),
    agent: {async runTurn(records) {
      if (options.allowedToolNames) {
        childRequests += 1;
        if (childRequests === 1) return {draft: '', toolCalls: [call('child-write', 'apply_patch')]};
        assert.equal(records.find((r) => r.role === 'tool_result').ok, false);
        assert.match(records.find((r) => r.role === 'tool_result').text, /plan mode/i);
        return done;
      }
      if (++parentRequests === 1) { input.ready('inspect only', 'plan'); return done; }
      if (parentRequests === 2) return {draft: '', toolCalls: [{callId: 'child', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"inspect"}'}]};
      return done;
    }}
  });
  t.after(() => { setup.prepareAgent = original; });
  const run = createAgentLoopRuntime('/tmp/echo_tui', {capture: () => ({...snapshot, resolveLlmConfig: () => config})});
  await run({records: app.records, steeringInput: input}, {...app.callbacks, onToolApprovalRequest: () => ({kind: 'allow_once'}),
    onSubagentRecords: (records) => app.records.push(...records)});
  assert.equal(childRequests, 2);
});

test('plan sandbox classification follows the applied mode using frozen sandbox settings', async (t) => {
  const input = port();
  const app = recorder();
  const original = setup.prepareAgent;
  const originalReadonly = sandboxProvider.isReadonlyBashSandboxEffective;
  const originalNote = sandboxProvider.createSandboxRuntimeNote;
  sandboxProvider.isReadonlyBashSandboxEffective = (_config, _executionMode, options) => options.modeOverride === 'read-only';
  sandboxProvider.createSandboxRuntimeNote = (_config, _executionMode, options) => options.modeOverride === 'read-only' ? 'workspace is read-only' : 'workspace writable';
  let requests = 0;
  let starts = 0;
  setup.prepareAgent = () => ({config, registry: createToolRegistry([handler('run_bash_command', async (_args, c) => { starts += 1; return result(c); })]),
    agent: {async runTurn(records) {
      if (++requests === 1) { input.ready('inspect', 'plan'); return done; }
      assert.match(records[0].text, /workspace is read-only/);
      if (requests === 2) return {draft: '', toolCalls: [{callId: 'bash', toolName: 'run_bash_command', argumentsText: '{"command":"python -c \'print(1)\'"}'}]};
      return done;
    }}
  });
  t.after(() => { setup.prepareAgent = original; sandboxProvider.isReadonlyBashSandboxEffective = originalReadonly; sandboxProvider.createSandboxRuntimeNote = originalNote; });
  const run = createAgentLoopRuntime('/tmp/echo_tui', {capture: () => snapshot});
  await run({records: app.records, steeringInput: input}, app.callbacks);
  assert.equal(starts, 1);
});

test('final commit wins when input is still preparing; late ready remains unclaimed', async () => {
  const input = port();
  const app = recorder();
  await runtime({async runTurn() { return done; }}, (run) => run({records: app.records, steeringInput: input}, app.callbacks));
  input.ready('prepared later');
  assert.equal(input.hasReady(), true);
  assert.equal(input.claims.length, 0);
  assert.deepEqual(app.events, ['complete']);
});

for (const kind of ['single', 'parallel', 'subagent', 'before-tools']) {
  test(`${kind} boundary finishes started calls and skips remaining declared calls before user`, async () => {
    const input = port();
    const parent = new AbortController();
    const app = recorder();
    const starts = [];
    const toolCalls = kind === 'parallel' ? [call('a', 'read_files'), call('b', 'grep'), call('c'), call('d', 'glob')]
      : [call('a', kind === 'subagent' ? 'run_subagent' : 'exclusive'), call('b')];
    const gates = new Map(toolCalls.map((c) => [c.callId, deferred()]));
    const privateRecords = [
      createOpenAiReasoningRecord({type: 'reasoning', id: 'completed-reasoning', encrypted_content: 'complete encrypted reasoning', summary: []}),
      createOpenAiChatReasoningRecord('complete chat reasoning'),
      createAnthropicThinkingRecord({type: 'thinking', thinking: 'complete thinking', signature: 'complete-signature'})
    ];
    const started = deferred();
    const handlers = [...new Set(toolCalls.map((c) => c.toolName))].map((name) => handler(name, async (_args, c, options) => {
      starts.push(c.callId);
      assert.equal(options.abortSignal, parent.signal);
      if (kind !== 'parallel' || starts.length === 2) started.resolve();
      await gates.get(c.callId).promise;
      assert.equal(options.abortSignal.aborted, false);
      return result(c);
    }));
    let count = 0;
    const agent = {async runTurn(records) {
      if (++count === 1) { if (kind === 'before-tools') input.ready(); return {draft: 'complete segment', providerRecords: privateRecords, toolCalls}; }
      assert.deepEqual(records.filter((r) => r.role !== 'system'), app.records);
      const pairs = records.filter((r) => r.role === 'tool_call' || r.role === 'tool_result');
      assert.equal(pairs.length, toolCalls.length * 2);
      for (let i = 0; i < pairs.length; i += 2) assert.equal(pairs[i].toolCallId, pairs[i + 1].toolCallId);
      assert.equal(records.at(-1), input.claims[0]);
      const chat = convertTranscriptToOpenAiChatMessages(records);
      const chatCalls = chat.filter((m) => m.role === 'assistant').flatMap((m) => m.tool_calls || []).map((c) => c.id);
      assert.deepEqual(chatCalls, toolCalls.map((c) => c.callId));
      assert.deepEqual(chat.filter((m) => m.role === 'tool').map((m) => m.tool_call_id), chatCalls);
      assert.equal(chat.find((m) => m.role === 'assistant').reasoning_content, 'complete chat reasoning');
      const responses = convertTranscriptToOpenAiInput(records);
      assert.deepEqual(responses.filter((m) => m.type === 'function_call_output').map((m) => m.call_id), chatCalls);
      assert.equal(responses.find((m) => m.type === 'reasoning').id, 'completed-reasoning');
      const anthropic = convertTranscriptToAnthropicMessages(records);
      const blocks = anthropic.messages.flatMap((m) => Array.isArray(m.content) ? m.content : []);
      assert.deepEqual(blocks.filter((b) => b.type === 'tool_use').map((b) => b.id), chatCalls);
      assert.deepEqual(blocks.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id), chatCalls);
      assert.equal(blocks.find((b) => b.type === 'thinking').signature, 'complete-signature');
      return done;
    }};
    await runtime(agent, async (run) => {
      const promise = run({records: app.records, steeringInput: input, abortSignal: parent.signal}, {...app.callbacks, onToolApprovalRequest: () => ({kind: 'allow_once'})});
      if (kind !== 'before-tools') {
        await started.promise;
        input.ready();
        assert.equal(input.claims.length, 0);
        assert.equal(app.events.includes('user'), false);
        if (kind === 'parallel') { gates.get('b').resolve(); await Promise.resolve(); assert.equal(app.events.includes('result:b'), false); }
        gates.get('a').resolve();
      }
      assert.equal(await promise, 'done');
    }, handlers);
    const expectedStarted = kind === 'before-tools' ? [] : kind === 'parallel' ? ['a', 'b'] : ['a'];
    assert.deepEqual(starts, expectedStarted);
    assert.deepEqual(app.events.slice(0, 2), ['private', 'segment']);
    assert.equal(app.events.filter((event) => event === 'private').length, 1);
    assert.equal(app.events.filter((event) => event === 'segment').length, 1);
    const results = app.records.filter((r) => r.role === 'tool_result');
    for (const r of results) {
      assert.equal(r.ok, expectedStarted.includes(r.toolCallId));
      if (!r.ok) assert.match(r.text, /跳过且未执行/);
    }
    assert.equal(app.events.indexOf('user'), app.events.length - 2);
    assert.equal(app.events.filter((e) => e === 'complete').length, 1);
  });
}

for (const mode of [{executionMode: {kind: 'headless', approvalPolicy: 'deny'}}, {conversationKind: 'btw'}, {conversationKind: 'subagent'}]) {
  test(`non-primary interactive input disabled: ${JSON.stringify(mode)}`, async () => {
    const input = port();
    input.ready();
    await runtime({async runTurn(records) { assert.equal(records.some((r) => r.text === 'steer'), false); return done; }},
      (run) => run({records: [{role: 'user', text: 'original'}], steeringInput: input, ...mode}));
    assert.equal(input.hasReady(), true);
    assert.equal(input.claims.length, 0);
  });
}

test('compaction uses parent signal, retains input, aligns notice/user indices and rechecks budget', async () => {
  const input = port();
  const parent = new AbortController();
  const app = recorder(Array.from({length: 32}, (_, i) => ({role: i % 2 ? 'assistant' : 'user', text: `old-${i} `.repeat(40)})));
  const summaries = [];
  let normal = 0;
  const agent = {async runTurn(records, _callbacks, options) {
    if (options.isCompaction) {
      summaries.push(records);
      assert.equal(options.abortSignal, parent.signal);
      if (summaries.length === 1) {
        input.ready('new large material '.repeat(400));
        assert.equal(input.claims.length, 0);
        assert.equal(parent.signal.aborted, false);
      }
      return {draft: 'summary', toolCalls: []};
    }
    normal += 1;
    const compaction = app.compactions.at(-1);
    assert.deepEqual(records.slice(2), app.records.slice(compaction.activeStartIndex));
    assert.equal(records.some((r) => r.text === input.claims[0].text), true);
    return done;
  }};
  await runtime(agent, (run) => run({records: app.records, steeringInput: input, abortSignal: parent.signal}, app.callbacks), [], {contextWindow: 100});
  assert.equal(summaries.length, 2);
  assert.equal(normal, 1);
  assert.deepEqual(app.events, ['compaction', 'user', 'compaction', 'complete']);
});

const providers = [
  {name: 'responses', make: createOpenAiAgent, sdk: OpenAI, client: (create) => ({responses: {create}}),
    partial: [{type: 'response.output_item.done', output_index: 0, item: {type: 'reasoning', id: 'unfinished-reasoning', encrypted_content: 'unfinished-private', summary: [{type: 'summary_text', text: 'half reasoning'}]}}, {type: 'response.output_text.delta', delta: 'partial'}, {type: 'response.output_item.done', item: {type: 'function_call', call_id: 'unfinished', name: 'exclusive', arguments: '{}'}}],
    complete: [{type: 'response.output_text.delta', delta: 'done'}, {type: 'response.completed', response: {usage: {input_tokens: 10, output_tokens: 2}}}]},
  {name: 'chat', make: createOpenAiChatAgent, sdk: OpenAI, client: (create) => ({chat: {completions: {create}}}),
    partial: [{choices: [{delta: {content: 'partial', reasoning_content: 'half reasoning', tool_calls: [{index: 0, id: 'unfinished', function: {name: 'exclusive', arguments: '{'}}]}}]}],
    complete: [{choices: [{delta: {content: 'done'}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 2}}]},
  {name: 'anthropic', make: createAnthropicAgent, sdk: Anthropic, client: (create) => ({messages: {create}}),
    partial: [{type: 'content_block_start', index: 0, content_block: {type: 'thinking', thinking: '', signature: ''}}, {type: 'content_block_delta', index: 0, delta: {type: 'thinking_delta', thinking: 'half reasoning'}}, {type: 'content_block_delta', index: 0, delta: {type: 'signature_delta', signature: 'unfinished-signature'}}, {type: 'content_block_start', index: 1, content_block: {type: 'text', text: ''}}, {type: 'content_block_delta', index: 1, delta: {type: 'text_delta', text: 'partial'}}, {type: 'content_block_start', index: 2, content_block: {type: 'tool_use', id: 'unfinished', name: 'exclusive', input: {}}}, {type: 'content_block_delta', index: 2, delta: {type: 'input_json_delta', partial_json: '{'}}],
    complete: [{type: 'message_start', message: {usage: {input_tokens: 10, output_tokens: 0}}}, {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}}, {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'done'}}, {type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 2}}, {type: 'message_stop'}]}
];
for (const provider of providers) {
  test(`${provider.name} SDK stream steering preserves partial body, keeps reasoning local and sends no unfinished private/call history`, async () => {
    const input = port();
    const requests = [];
    const usage = [];
    const app = recorder();
    const providerConfig = {...config, agentType: provider.name === 'responses' ? 'openai' : provider.name === 'chat' ? 'openai-chat' : 'anthropic'};
    const agent = provider.make(providerConfig, createToolRegistry(), {createClient: () => provider.client(async (request, options) => {
      requests.push(request);
      return (async function* () {
        if (requests.length === 1) {
          for (const event of provider.partial) yield event;
          input.ready();
          assert.equal(options.signal.aborted, true);
          throw new provider.sdk.APIUserAbortError();
        }
        const messages = provider.name === 'responses' ? request.input : request.messages;
        assert.deepEqual(messages.filter((m) => m.role === 'assistant'), [{role: 'assistant', content: provider.name === 'anthropic' ? [{type: 'text', text: 'partial'}] : 'partial'}]);
        assert.doesNotMatch(JSON.stringify(request), /half reasoning|unfinished/);
        assert.match(JSON.stringify(request), /steer/);
        for (const event of provider.complete) yield event;
      })();
    })});
    const original = setup.prepareAgent;
    setup.prepareAgent = () => ({agent, config: providerConfig, registry: createToolRegistry()});
    try {
      const run = createAgentLoopRuntime('/tmp/echo_tui', {capture: () => snapshot}, undefined, undefined, {appendEvent: (event) => usage.push(event)});
      assert.equal(await run({records: app.records, steeringInput: input}, app.callbacks), 'done');
    } finally { setup.prepareAgent = original; }
    assert.equal(requests.length, 2);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].inputTokens, 10);
    assert.deepEqual(app.records, [{role: 'user', text: 'original'}, {role: 'reasoning_summary', text: 'half reasoning'},
      {role: 'assistant', text: 'partial'}, input.claims[0]]);
    assert.deepEqual(app.events, ['reasoning', 'segment', 'user', 'complete']);
  });

  for (const stage of ['create', 'stream', 'complete-tail']) {
    test(`${provider.name} ${stage} cancellation distinguishes actual failure from completed response`, async () => {
      for (const actualError of [false, true]) {
        const controller = new AbortController();
        const fail = () => { controller.abort(); throw actualError ? new Error('real SDK failure') : new provider.sdk.APIUserAbortError(); };
        const agent = provider.make({...config, agentType: provider.name === 'anthropic' ? 'anthropic' : 'openai'}, createToolRegistry(), {
          createClient: () => provider.client(async () => {
            if (stage === 'create') fail();
            return (async function* () {
              if (stage === 'complete-tail') for (const event of provider.complete) yield event;
              fail();
            })();
          })
        });
        const promise = agent.runTurn([{role: 'user', text: 'original'}], {}, {abortSignal: controller.signal});
        if (stage === 'complete-tail' && !actualError) assert.equal((await promise).draft, 'done');
        else await assert.rejects(promise, actualError ? /real SDK failure/ : AgentAbortError);
      }
    });
  }
}

for (const cancelParent of [false, true]) {
  test(`real run_subagent is isolated from steering; parent Esc cancellation=${cancelParent}`, async () => {
    const input = port();
    const parent = new AbortController();
    const started = deferred();
    const finish = deferred();
    const app = recorder();
    let parentSteps = 0;
    let childSteps = 0;
    let childSignal;
    const runSnapshot = {...snapshot, resolveLlmConfig: () => config};
    const original = setup.prepareAgent;
    setup.prepareAgent = (options) => ({
      config,
      registry: createDefaultToolRegistry(config, options.cwd, undefined, {allowedToolNames: options.allowedToolNames, subagentPort: options.subagentPort, skillRegistry: options.skillRegistry}),
      agent: {async runTurn(records, _callbacks, turnOptions) {
        if (options.allowedToolNames) {
          childSteps += 1;
          assert.equal(records.some((r) => r.text === 'steer'), false);
          childSignal = turnOptions.abortSignal;
          assert.equal(childSignal, parent.signal);
          started.resolve();
          await finish.promise;
          if (childSignal.aborted) throw new AgentAbortError();
          return {draft: 'child complete report', toolCalls: []};
        }
        parentSteps += 1;
        if (parentSteps === 1) return {draft: '', toolCalls: [{callId: 'outer', toolName: 'run_subagent', argumentsText: JSON.stringify({agent: 'explorer', task: 'inspect independently'})}, call('remaining')]};
        assert.equal(records.some((r) => r.text === 'steer'), true);
        assert.deepEqual(records.filter((r) => r.role !== 'system'), app.records.filter((r) => r.role !== 'subagent'));
        return done;
      }}
    });
    try {
      const run = createAgentLoopRuntime('/tmp/echo_tui', {capture: () => runSnapshot});
      const promise = run({records: app.records, steeringInput: input, abortSignal: parent.signal}, {...app.callbacks, onSubagentRecords(records) { app.records.push(...records); }});
      await started.promise;
      input.ready();
      assert.equal(childSignal.aborted, false);
      assert.equal(input.listeners.size, 0);
      assert.equal(input.claims.length, 0);
      if (cancelParent) parent.abort();
      finish.resolve();
      if (cancelParent) await assert.rejects(promise, AgentAbortError);
      else assert.equal(await promise, 'done');
    } finally { setup.prepareAgent = original; }
    assert.equal(childSteps, 1);
    assert.equal(parentSteps, cancelParent ? 1 : 2);
    assert.equal(input.claims.length, cancelParent ? 0 : 1);
    if (!cancelParent) assert.deepEqual(app.events.slice(-5), ['result:outer', 'call:remaining', 'result:remaining', 'user', 'complete']);
  });
}

test('Responses retry backoff is request-preempted without retrying original history', async () => {
  const input = port();
  const app = recorder();
  const waiting = deferred();
  let requests = 0;
  let retrySignal;
  const providerConfig = {...config, agentType: 'openai'};
  const agent = createOpenAiAgent(providerConfig, createToolRegistry(), {createClient: () => ({responses: {async create(request, options) {
    requests += 1;
    if (requests === 1) {
      retrySignal = options.signal;
      return (async function* () { throw new Error('An error occurred while processing your request. You can retry your request'); })();
    }
    assert.match(JSON.stringify(request), /steer/);
    return (async function* () { for (const event of providers[0].complete) yield event; })();
  }}})});
  await runtime(agent, async (run) => {
    const promise = run({records: app.records, steeringInput: input}, {...app.callbacks, onProviderRetry(retry) { app.records.push({role: 'local_notice', text: retry.message}); waiting.resolve(); }});
    await waiting.promise;
    input.ready();
    assert.equal(retrySignal.aborted, true);
    assert.equal(await promise, 'done');
  });
  assert.equal(requests, 2);
  assert.equal(app.records.filter((r) => r.role === 'local_notice').length, 1);
  assert.equal(input.listeners.size, 0);
});

test('ready before first request is consumed synchronously and successive guidance preserves runtime state', async () => {
  const input = port();
  input.ready('first');
  const app = recorder();
  let steps = 0;
  const session = {records: app.records, steeringInput: input, sessionId: 'same-session', todoState: {items: [{id: 'original-todo', text: 'keep this', status: 'open'}]}};
  const agent = {async runTurn(records, _callbacks, options) {
    steps += 1;
    assert.equal(options.sessionId, 'same-session');
    assert.match(records.at(-1).text, /original-todo/);
    if (steps === 1) { assert.equal(input.claims.length, 1); input.ready('second'); return {draft: 'complete first', toolCalls: []}; }
    assert.deepEqual(records.slice(0, -1).filter((r) => r.role === 'user').map((r) => r.text), ['original', 'first', 'second']);
    return done;
  }};
  await runtime(agent, (run) => run(session, app.callbacks));
  assert.deepEqual(input.claims.map((r) => r.text), ['first', 'second']);
  assert.deepEqual(app.events, ['user', 'segment', 'user', 'complete']);
});

test('final-boundary readiness from authoritative usage continues without finishing the turn', async () => {
  const input = port();
  const app = recorder();
  let requests = 0;
  let cleared = 0;
  const agent = {async runTurn(records) {
    if (++requests === 1) return {draft: 'full final', toolCalls: [], usageInputTokens: 10};
    assert.equal(records.at(-1), input.claims[0]);
    return done;
  }};
  await runtime(agent, (run) => run({records: app.records, steeringInput: input}, {...app.callbacks,
    onContextUsage() { input.ready(); }, onRequestPreempted() { cleared += 1; }
  }));
  assert.equal(cleared, 0);
  assert.equal(requests, 2);
  assert.deepEqual(app.events, ['segment', 'user', 'complete']);
});

test('Codex request cancellation does not hide a concurrent genuine SDK failure', async () => {
  const {createCodexAgent} = require('../../src/agent/codex/agent');
  for (const genuine of [false, true]) {
    const controller = new AbortController();
    const agent = createCodexAgent({...config, agentType: 'codex', codexOAuth: {authFilePath: '/unused'}}, createToolRegistry(), {
      resolveCodexOAuthCredential: async () => ({accessToken: 'fixture', accountId: 'fixture'}),
      createClient: () => ({responses: {async create() { controller.abort(); throw genuine ? new Error('real Codex failure') : new OpenAI.APIUserAbortError(); }}})
    });
    await assert.rejects(agent.runTurn([{role: 'user', text: 'original'}], {}, {abortSignal: controller.signal}), genuine ? /real Codex failure/ : AgentAbortError);
  }
});
