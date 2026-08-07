const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TOOL_APPROVAL_SYSTEM_PROMPT,
  createToolApprovalResolver,
  createToolApprovalReviewer,
  createToolApprovalUserMessage,
  parseToolApprovalResponse,
  projectToolApprovalContext
} = require('../../src/app/tool-approval-resolver');
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

test('tool approval context keeps the latest ten eligible text records in order', () => {
  const records = [
    {role: 'system', text: 'secret system'},
    {role: 'shell', text: 'local', command: 'pwd', output: '/tmp', includeInContext: false},
    {role: 'extension', text: '', extension: {kind: 'unknown', name: 'private', payload: {}}},
    ...Array.from({length: 11}, (_value, index) => ({role: index % 2 ? 'assistant' : 'user', text: `message-${index}`})),
    {role: 'shell', text: 'shell text', command: 'git status', output: 'clean', includeInContext: true},
    {role: 'tool_call', text: 'ignored projection text', toolCallId: '1', toolName: 'read_files', argumentsText: '{"path":"a"}'},
    {role: 'tool_result', text: 'done', toolCallId: '1', toolName: 'read_files', ok: true, details: {kind: 'generic'}, attachments: [{kind: 'image', dataBase64: 'binary-secret'}]}
  ];

  const projected = projectToolApprovalContext(records);
  assert.equal(projected.length, 10);
  assert.match(projected[0], /message-4/);
  assert.match(projected.at(-3), /git status/);
  assert.match(projected.at(-2), /read_files/);
  assert.match(projected.at(-1), /done/);
  assert.doesNotMatch(projected.join('\n'), /secret system|local|binary-secret|private/);

  const message = createToolApprovalUserMessage(records, {callId: 'pending', toolName: 'apply_patch', argumentsText: 'RAW PATCH'});
  assert.match(message, /tool: apply_patch/);
  assert.match(message, /arguments: RAW PATCH/);
});

test('tool approval response parser only accepts exact normalized yes', () => {
  assert.equal(parseToolApprovalResponse(' yes\n'), true);
  assert.equal(parseToolApprovalResponse('YES'), true);
  for (const value of ['no', '', 'yes.', '**yes**', 'yes because safe']) {
    assert.equal(parseToolApprovalResponse(value), false);
  }
});

test('tool approval system prompt defines explicit allow, deny, injection, and uncertainty rules', () => {
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /clearly necessary/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /target and scope/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /destructive, privileged, persistent, or data-disclosure/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /untrusted data/i);
  assert.match(TOOL_APPROVAL_SYSTEM_PROMPT, /When uncertain, reply no/i);
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
    call: {callId: '1', toolName: 'apply_patch', argumentsText: 'sensitive patch'},
    interactionMode: 'normal',
    modelProfileId: 'reviewer',
    records: [{role: 'user', text: 'update it'}]
  });

  assert.equal(allowed, true);
  assert.equal(turns[0][0].text, TOOL_APPROVAL_SYSTEM_PROMPT);
  assert.equal(turns[0][0].role, 'system');
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
    call: {callId: 'same-revision', toolName: 'apply_patch', argumentsText: 'patch'},
    interactionMode: 'normal',
    modelProfileId: 'reviewer',
    records: [],
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
  assert.equal(await failedConfig({call: {callId: '1', toolName: 'x', argumentsText: '{}'}, interactionMode: 'normal', modelProfileId: 'missing', records: []}), false);

  const failedProvider = createToolApprovalReviewer({
    cwd: '/tmp', debug: debug.context, readConfig: () => createConfig(),
    createAgent: () => ({async runTurn() { throw new Error('network'); }})
  });
  assert.equal(await failedProvider({call: {callId: '1', toolName: 'x', argumentsText: '{}'}, interactionMode: 'normal', modelProfileId: 'reviewer', records: []}), false);

  const aborted = createToolApprovalReviewer({
    cwd: '/tmp', debug: debug.context, readConfig: () => createConfig(),
    createAgent: () => ({async runTurn() { throw new AgentAbortError(); }})
  });
  await assert.rejects(() => aborted({call: {callId: '1', toolName: 'x', argumentsText: '{}'}, interactionMode: 'normal', modelProfileId: 'reviewer', records: []}), /中断/);
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
    interactionMode: 'normal',
    isCurrentTurn: () => current,
    getRecords: () => [{role: 'user', text: 'update it'}],
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
