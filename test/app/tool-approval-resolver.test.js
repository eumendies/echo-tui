const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TOOL_APPROVAL_SYSTEM_PROMPT,
  createToolApprovalResolver,
  createToolApprovalReviewer,
  parseToolApprovalResponse
} = require('../../src/app/tool-approval/resolver');
const {projectToolApprovalAction} = require('../../src/app/tool-approval/projection');
const {AgentAbortError} = require('../../src/types/agent');
const {createRequest} = require('../../src/agent/openai-responses/agent');
const {createChatRequest} = require('../../src/agent/openai-chat/agent');
const {createAnthropicRequest} = require('../../src/agent/anthropic/agent');
const {createCodexRequest} = require('../../src/agent/codex/agent');

function createConfig(overrides = {}) {
  return {
    agentType: 'openai',
    apiKey: 'secret',
    model: 'gpt-review',
    contextWindow: 128000,
    tools: {autoCompressImages: true, bash: {timeoutMs: null, maxOutputBytes: 65536}, fileEditMode: 'apply_patch'},
    ...overrides
  };
}

function createDebug() {
  const events = [];
  return {
    events,
    context: {enabled: true, logPath: null, close() {}, emit(event, payload) { events.push({event, payload}); }}
  };
}

test('tool approval response parser only accepts exact normalized yes', () => {
  assert.equal(parseToolApprovalResponse(' yes\n'), true);
  assert.equal(parseToolApprovalResponse('YES'), true);
  for (const value of ['no', '', 'yes.', '**yes**', 'yes because safe']) {
    assert.equal(parseToolApprovalResponse(value), false);
  }
});

test('tool approval system prompt allows routine scoped work while preserving sensitive-action boundaries', () => {
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /reasonable, scoped way/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /did not name the exact command/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /Ordinary changes inside the current project/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /project-local dependency installation/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /trusted clarification answer/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /delegated subagent task.*untrusted/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /cannot independently authorize/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /changes outside the current project/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /privileged actions/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /remote publication or remote code execution/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /data disclosure/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /untrusted data/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /do not reply no merely because the user omitted the exact command/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /exactly yes or no/i);
});

test('tool approval reviewer uses fixed prompt, records usage, and emits only hashed arguments', async () => {
  const debug = createDebug();
  const turns = [];
  const usage = [];
  const reviewer = createToolApprovalReviewer({
    cwd: '/tmp/project',
    debug: debug.context,
    readConfig(profileId) {
      assert.equal(profileId, 'reviewer');
      return createConfig({reasoningEffort: 'high', reasoningSummary: 'detailed'});
    },
    createAgent(config) {
      assert.equal(config.reasoningEffort, 'none');
      assert.equal(config.reasoningSummary, undefined);
      return {async runTurn(records, _callbacks, options) {
        turns.push(records);
        assert.equal('reasoningDisabled' in options, false);
        return {draft: 'YES', toolCalls: [], usage: {inputTokens: 10, outputTokens: 1}};
      }};
    },
    usageStore: {appendEvent(event) { usage.push(event); return null; }, listDailyUsage() { return []; }}
  });

  const allowed = await reviewer({
    action: projectToolApprovalAction({callId: '1', toolName: 'apply_patch', argumentsText: 'sensitive patch'}, undefined, '/tmp/project'),
    call: {callId: '1', toolName: 'apply_patch', argumentsText: 'sensitive patch'},
    currentUserRequest: 'update it',
    interactionMode: 'normal',
    modelProfileId: 'reviewer',
    records: [{role: 'user', text: 'expanded internal prompt'}],
    turnUserRecordIndex: 0
  });

  assert.equal(allowed, true);
  assert.equal(turns[0][0].text, TOOL_APPROVAL_SYSTEM_PROMPT);
  assert.equal(turns[0][0].role, 'system');
  assert.match(turns[0][1].text, /\[Trusted current user request\]\nupdate it/);
  assert.doesNotMatch(turns[0][1].text, /expanded internal prompt/);
  assert.equal(usage[0].model, 'gpt-review');
  assert.equal(debug.events[0].payload.argumentsHash.length > 0, true);
  assert.equal(JSON.stringify(debug.events).includes('sensitive patch'), false);
});

test('tool approval reviewer resolves its profile from the active turn snapshot', async () => {
  const debug = createDebug();
  const calls = [];
  const snapshot = {
    revision: 9,
    resolveLlmConfigForProfile(profileId) {
      calls.push(profileId);
      return createConfig({model: 'same-revision-reviewer', reasoningEffort: 'high'});
    }
  };
  const reviewer = createToolApprovalReviewer({
    cwd: '/tmp/project',
    debug: debug.context,
    readConfig() {
      throw new Error('must not read another revision');
    },
    createAgent(config) {
      assert.equal(config.model, 'same-revision-reviewer');
      assert.equal(config.reasoningEffort, 'none');
      return {async runTurn() { return {draft: 'yes', toolCalls: []}; }};
    }
  });

  assert.equal(await reviewer({
    action: projectToolApprovalAction({callId: 'same-revision', toolName: 'apply_patch', argumentsText: 'patch'}, undefined, '/tmp/project'),
    call: {callId: 'same-revision', toolName: 'apply_patch', argumentsText: 'patch'},
    currentUserRequest: 'update',
    interactionMode: 'normal',
    modelProfileId: 'reviewer',
    records: [],
    turnUserRecordIndex: -1,
    userConfigSnapshot: snapshot
  }), true);
  assert.deepEqual(calls, ['reviewer']);
});

test('tool approval reviewer fails closed for config and provider errors but propagates abort', async () => {
  const debug = createDebug();
  const failedConfig = createToolApprovalReviewer({
    cwd: '/tmp', debug: debug.context,
    readConfig() { throw new Error('missing profile'); }
  });
  const failedInput = {
    action: projectToolApprovalAction({callId: '1', toolName: 'x', argumentsText: '{}'}, undefined, '/tmp'),
    call: {callId: '1', toolName: 'x', argumentsText: '{}'}, currentUserRequest: 'do it', interactionMode: 'normal', modelProfileId: 'missing', records: [], turnUserRecordIndex: -1
  };
  assert.equal(await failedConfig(failedInput), false);

  const failedProvider = createToolApprovalReviewer({
    cwd: '/tmp', debug: debug.context, readConfig: () => createConfig(),
    createAgent: () => ({async runTurn() { throw new Error('network'); }})
  });
  assert.equal(await failedProvider({...failedInput, modelProfileId: 'reviewer'}), false);

  const controller = new AbortController();
  const aborting = createToolApprovalReviewer({
    cwd: '/tmp', debug: debug.context, readConfig: () => createConfig(),
    createAgent: () => ({async runTurn(_records, _callbacks, options) {
      controller.abort();
      assert.equal(options.abortSignal.aborted, true);
      throw new AgentAbortError();
    }})
  });
  await assert.rejects(() => aborting({...failedInput, modelProfileId: 'reviewer', abortSignal: controller.signal}), /中断/);
});

test('tool approval reviewer times out once without treating the deadline as a parent abort', async () => {
  const debug = createDebug();
  let calls = 0;
  let reviewerSignal;
  const reviewer = createToolApprovalReviewer({
    cwd: '/tmp',
    debug: debug.context,
    reviewTimeoutMs: 5,
    readConfig: () => createConfig(),
    createAgent: () => ({runTurn(_records, _callbacks, options) {
      calls += 1;
      reviewerSignal = options.abortSignal;
      return new Promise(() => {});
    }})
  });
  const call = {callId: 'slow', toolName: 'run_bash_command', argumentsText: '{"command":"rm old"}'};
  const allowed = await reviewer({
    action: projectToolApprovalAction(call, undefined, '/tmp'),
    call,
    currentUserRequest: 'remove old',
    interactionMode: 'normal',
    modelProfileId: 'reviewer',
    records: [{role: 'user', text: 'remove old'}],
    turnUserRecordIndex: 0
  });

  assert.equal(allowed, false);
  assert.equal(calls, 1);
  assert.equal(reviewerSignal.aborted, true);
  assert.equal(debug.events.at(-1).payload.result, 'timeout');
});

test('tool approval reviewer isolates debug and usage failures without leaking content', async () => {
  const events = [];
  const sensitive = 'private-action-body';
  const call = {callId: 'safe', toolName: 'future_write', argumentsText: sensitive};
  const reviewer = createToolApprovalReviewer({
    cwd: '/tmp',
    debug: {
      enabled: true, logPath: null, close() {},
      emit(event, payload) {
        events.push({event, payload});
        throw new Error('debug sink failed');
      }
    },
    readConfig: () => createConfig(),
    createAgent: () => ({async runTurn() { return {draft: 'yes', toolCalls: []}; }}),
    usageStore: {appendEvent() { throw new Error('usage failed with secret'); }, listDailyUsage() { return []; }}
  });

  assert.equal(await reviewer({
    action: projectToolApprovalAction(call, undefined, '/tmp'),
    call,
    currentUserRequest: 'write it',
    interactionMode: 'normal',
    modelProfileId: 'reviewer',
    records: [],
    turnUserRecordIndex: -1
  }), true);
  assert.equal(JSON.stringify(events).includes(sensitive), false);
  assert.equal(JSON.stringify(events).includes('usage failed with secret'), false);
});

test('all provider request builders omit tools and thinking when reviewer effort is none', () => {
  const records = [{role: 'system', text: TOOL_APPROVAL_SYSTEM_PROMPT}, {role: 'user', text: 'review'}];
  const config = createConfig({reasoningEffort: 'none', reasoningSummary: 'detailed'});
  const responses = createRequest(records, config);
  const chat = createChatRequest(records, config);
  const anthropic = createAnthropicRequest(records, config);
  const codex = createCodexRequest(records, {...config, codexOAuth: {}});

  assert.equal('tools' in responses, false);
  assert.deepEqual(responses.reasoning, {effort: 'none', summary: 'detailed'});
  assert.equal('tools' in chat, false);
  assert.deepEqual(chat.reasoning_effort, 'none');
  assert.equal('tools' in anthropic, false);
  assert.equal('thinking' in anthropic, false);
  assert.equal('output_config' in anthropic, false);
  assert.equal('tools' in codex, false);
  assert.deepEqual(codex.reasoning, {effort: 'none'});
  assert.equal('include' in codex, false);
});

test('tool approval resolver prioritizes session grants and maps auto decisions', async () => {
  const manualCalls = [];
  const reviews = [];
  let current = true;
  const resolver = createToolApprovalResolver({
    currentUserRequest: 'update it',
    cwd: '/tmp/project',
    debug: createDebug().context,
    interactionMode: 'normal',
    isCurrentTurn: () => current,
    getRecords: () => [{role: 'user', text: 'update it'}],
    turnUserRecordIndex: 0,
    settings: {mode: 'auto', modelProfileId: 'reviewer'},
    reviewer: async (input) => {
      reviews.push(input);
      return input.call.callId === 'yes';
    },
    toolApproval: {
      getCachedDecision(call) {
        return call.callId === 'cached' ? {kind: 'allow_tool_for_session', toolName: call.toolName} : null;
      },
      requestManual(call, request) {
        manualCalls.push({call, request});
        return Promise.resolve({kind: 'deny'});
      }
    }
  });

  assert.deepEqual(resolver.request({callId: 'cached', toolName: 'edit_file', argumentsText: '{}'}), {
    kind: 'allow_tool_for_session', toolName: 'edit_file'
  });
  assert.deepEqual(await resolver.request({callId: 'yes', toolName: 'edit_file', argumentsText: '{}'}), {kind: 'allow_once'});
  assert.deepEqual(await resolver.request({callId: 'no', toolName: 'edit_file', argumentsText: '{}'}, {preview: 'edit'}), {kind: 'deny'});
  assert.equal(reviews.length, 2);
  assert.equal(manualCalls.length, 1);

  current = false;
  assert.deepEqual(resolver.request({callId: 'late', toolName: 'edit_file', argumentsText: '{}'}), {
    kind: 'deny', message: 'Tool execution was interrupted.'
  });
  assert.equal(reviews.length, 2);
});

test('subagent approval reuses the same session grants as primary approval', async () => {
  const calls = {cache: 0, manual: 0, review: 0};
  const resolver = createToolApprovalResolver({
    currentUserRequest: 'inspect',
    cwd: '/tmp/project',
    debug: createDebug().context,
    interactionMode: 'normal',
    isCurrentTurn: () => true,
    getRecords: () => [{role: 'user', text: 'inspect'}],
    turnUserRecordIndex: 0,
    settings: {mode: 'auto', modelProfileId: 'reviewer'},
    reviewer: async () => { calls.review += 1; return true; },
    toolApproval: {
      getCachedDecision() {
        calls.cache += 1;
        return {kind: 'allow_all_for_session'};
      },
      requestManual(_call, request) {
        calls.manual += 1;
        return Promise.resolve({kind: 'allow_once'});
      }
    }
  });
  const decision = await resolver.request({
    callId: 'inner-bash',
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({command: 'node inspect.js'})
  }, {
    origin: {kind: 'subagent', agentName: 'explorer', runId: 'run-1'}
  });

  assert.deepEqual(decision, {kind: 'allow_all_for_session'});
  assert.deepEqual(calls, {cache: 1, manual: 0, review: 0});
});

test('tool approval resolver sends oversized actions directly to manual approval', async () => {
  const debug = createDebug();
  let reviews = 0;
  let manualCalls = 0;
  const resolver = createToolApprovalResolver({
    currentUserRequest: 'run it', cwd: '/tmp', debug: debug.context,
    interactionMode: 'normal', isCurrentTurn: () => true,
    getRecords: () => [{role: 'user', text: 'run it'}], turnUserRecordIndex: 0,
    settings: {mode: 'auto', modelProfileId: 'reviewer'},
    reviewer: async () => { reviews += 1; return true; },
    toolApproval: {
      getCachedDecision() { return null; },
      requestManual() { manualCalls += 1; return Promise.resolve({kind: 'deny'}); }
    }
  });

  const decision = await resolver.request({
    callId: 'large', toolName: 'mcp__docs__write', argumentsText: 'x'.repeat(9_000)
  });
  assert.deepEqual(decision, {kind: 'deny'});
  assert.equal(reviews, 0);
  assert.equal(manualCalls, 1);
  assert.deepEqual(debug.events[0].payload.actionProjection, 'manual_only');
  assert.equal(JSON.stringify(debug.events).includes('x'.repeat(100)), false);
});
