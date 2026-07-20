const test = require('node:test');
const assert = require('node:assert/strict');

const { generateCompactionSummary } = require('../../src/agent/context/context-compaction');
const { LlmAgentError } = require('../../src/agent/agent-errors');
const {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  createAnthropicAgent,
  createAnthropicRequest,
  readAnthropicStream
} = require('../../src/agent/anthropic/agent');
const { convertTranscriptToAnthropicMessages } = require('../../src/agent/anthropic/transcript-converter');
const { convertToolDefinitionsToAnthropicTools } = require('../../src/agent/anthropic/tool-converter');
const { createBuiltInSystemPrompt } = require('../../src/agent/context/system-prompt');
const { ANTHROPIC_THINKING_TRANSCRIPT_ROLE } = require('../../src/types/transcript');

const TEST_CWD = '/tmp/echo_tui';
const TEST_SYSTEM_PROMPT = createBuiltInSystemPrompt({ cwd: TEST_CWD });

const TEST_CONFIG = {
  agentType: 'anthropic',
  apiKey: 'test-api-key',
  baseURL: 'https://anthropic.example/v1',
  model: 'claude-test-model',
  tools: {
    bash: {
      timeoutMs: null,
      maxOutputBytes: 65536
    }
  }
};

async function* streamFrom(events) {
  for (const event of events) {
    if (event instanceof Error) {
      throw event;
    }

    yield event;
  }
}

function createEmptyToolRegistry() {
  return {
    isEmpty() {
      return true;
    },
    listDefinitions() {
      return [];
    },
    getHandler() {
      return undefined;
    }
  };
}

function createToolRegistry() {
  return {
    isEmpty() {
      return false;
    },
    listDefinitions() {
      return [
        {
          name: 'run_bash_command',
          description: 'Run bash',
          parameters: { type: 'object' }
        }
      ];
    },
    getHandler() {
      return undefined;
    }
  };
}

function createHarness(eventsOrFactory, registry = createEmptyToolRegistry()) {
  const requests = [];
  const requestOptions = [];
  const callbacks = [];
  const client = {
    messages: {
      async create(request, options) {
        requests.push(request);
        requestOptions.push(options);
        const events = typeof eventsOrFactory === 'function' ? eventsOrFactory(request) : eventsOrFactory;
        return streamFrom(events);
      }
    }
  };
  const agent = createAnthropicAgent(TEST_CONFIG, registry, {
    createClient(config) {
      assert.deepEqual(config, TEST_CONFIG);
      return client;
    }
  });
  return {
    callbacks,
    requestOptions,
    requests,
    runTurn(records, callbacks, options) {
      return agent.runTurn(records, callbacks, options);
    }
  };
}

function createAnthropicThinkingProviderRecord(block) {
  return {
    role: ANTHROPIC_THINKING_TRANSCRIPT_ROLE,
    text: '',
    block,
    provider: 'anthropic'
  };
}

test('Anthropic tool converter preserves semantic optional schema', () => {
  const parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      paths: {
        type: 'array',
        items: { type: 'string' }
      },
      safe_search: {
        type: 'string',
        enum: ['off', 'moderate', 'strict']
      }
    }
  };
  const [tool] = convertToolDefinitionsToAnthropicTools([
    { name: 'glob', description: 'Find files', parameters }
  ]);

  assert.deepEqual(tool, {
    name: 'glob',
    description: 'Find files',
    input_schema: parameters
  });
  assert.equal(tool.input_schema.required.includes('paths'), false);
  assert.equal(tool.input_schema.properties.paths.type, 'array');
  assert.equal(tool.input_schema.properties.safe_search.type, 'string');
});

test('convertTranscriptToAnthropicMessages maps records and filters local state', () => {
  assert.deepEqual(
    convertTranscriptToAnthropicMessages([
      { role: 'system', text: '系统一' },
      { role: 'user', text: 'inspect' },
      { role: 'assistant', text: 'I will inspect.' },
      { role: 'tool_call', text: '', toolCallId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' },
      { role: 'tool_result', text: 'exit_code: 0', toolCallId: 'call_1', toolName: 'run_bash_command', ok: true },
      { role: 'system', text: '系统二' },
      { role: 'error', text: 'timeout' },
      { role: 'local_notice', text: '已中断' },
      { role: 'reasoning_summary', text: 'thinking' },
      { role: 'openai_reasoning', text: '', item: { type: 'reasoning' } },
      { role: 'user', text: 'continue' }
    ]),
    {
      system: '系统一\n\n系统二',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'inspect' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect.' },
            { type: 'tool_use', id: 'call_1', name: 'run_bash_command', input: { command: 'pwd' } }
          ]
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'exit_code: 0' }] },
        { role: 'user', content: [{ type: 'text', text: 'continue' }] }
      ]
    }
  );
});

test('convertTranscriptToAnthropicMessages replays Anthropic thinking blocks before tool use', () => {
  assert.deepEqual(
    convertTranscriptToAnthropicMessages([
      {
        role: ANTHROPIC_THINKING_TRANSCRIPT_ROLE,
        text: '',
        block: { type: 'thinking', thinking: 'I should inspect.', signature: 'sig-1' },
        provider: 'anthropic'
      },
      { role: 'tool_call', text: '', toolCallId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' },
      { role: 'tool_result', text: 'exit_code: 0', toolCallId: 'call_1', toolName: 'run_bash_command', ok: true },
      {
        role: ANTHROPIC_THINKING_TRANSCRIPT_ROLE,
        text: '',
        block: { type: 'redacted_thinking', data: 'redacted-data' },
        provider: 'anthropic'
      },
      { role: 'tool_call', text: '', toolCallId: 'call_2', toolName: 'glob', argumentsText: '{"pattern":"*.ts"}' }
    ]),
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I should inspect.', signature: 'sig-1' },
            { type: 'tool_use', id: 'call_1', name: 'run_bash_command', input: { command: 'pwd' } }
          ]
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'exit_code: 0' }] },
        {
          role: 'assistant',
          content: [
            { type: 'redacted_thinking', data: 'redacted-data' },
            { type: 'tool_use', id: 'call_2', name: 'glob', input: { pattern: '*.ts' } }
          ]
        }
      ]
    }
  );
});

test('convertTranscriptToAnthropicMessages skips invalid Anthropic thinking records', () => {
  assert.deepEqual(
    convertTranscriptToAnthropicMessages([
      { role: ANTHROPIC_THINKING_TRANSCRIPT_ROLE, text: '', block: { type: 'thinking', thinking: 'missing signature' } },
      { role: ANTHROPIC_THINKING_TRANSCRIPT_ROLE, text: '', block: { type: 'redacted_thinking' } },
      { role: 'user', text: 'continue' }
    ]),
    {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'continue' }] }]
    }
  );
});

test('convertTranscriptToAnthropicMessages maps image attachments from tool results', () => {
  assert.deepEqual(
    convertTranscriptToAnthropicMessages([
      { role: 'assistant', text: 'I will read.' },
      { role: 'tool_call', text: '', toolCallId: 'call_img', toolName: 'read_files', argumentsText: '{"files":[{"path":"a.png"}]}' },
      {
        role: 'tool_result',
        text: 'image_attached: true',
        toolCallId: 'call_img',
        toolName: 'read_files',
        ok: true,
        attachments: [
          { kind: 'image', mediaType: 'image/png', dataBase64: 'aW1nMQ==', path: 'a.png', sizeBytes: 4 },
          { kind: 'image', mediaType: 'image/webp', dataBase64: 'aW1nMg==', path: 'b.webp', sizeBytes: 4 },
          { kind: 'image', mediaType: 'image/bmp', dataBase64: 'ignored', path: 'c.bmp', sizeBytes: 4 },
          { kind: 'image', mediaType: 'image/png', dataBase64: '', path: 'empty.png', sizeBytes: 0 }
        ]
      }
    ]),
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will read.' },
            { type: 'tool_use', id: 'call_img', name: 'read_files', input: { files: [{ path: 'a.png' }] } }
          ]
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_img',
            content: [
              { type: 'text', text: 'image_attached: true' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1nMQ==' } },
              { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'aW1nMg==' } }
            ]
          }]
        }
      ]
    }
  );
});

test('convertTranscriptToAnthropicMessages maps image attachments from user records', () => {
  assert.deepEqual(
    convertTranscriptToAnthropicMessages([
      {
        role: 'user',
        text: '看 @image.png',
        attachments: [{ kind: 'image', mediaType: 'image/png', dataBase64: 'aW1n', path: 'image.png', sizeBytes: 3 }]
      }
    ]),
    {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '看 @image.png' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1n' } }
        ]
      }]
    }
  );
});

test('convertTranscriptToAnthropicMessages maps shell records as user messages', () => {
  assert.deepEqual(
    convertTranscriptToAnthropicMessages([
      {
        role: 'shell',
        text: '$ sleep 1\n\n[timed out after 50ms]\n\n[exit null]',
        command: 'sleep 1',
        exitCode: null,
        includeInContext: true,
        output: '',
        timedOut: true,
        truncated: false
      },
      {
        role: 'shell',
        text: '$ cat secret [local]\n\nsecret',
        command: 'cat secret',
        exitCode: 0,
        includeInContext: false,
        output: 'secret\n',
        timedOut: false,
        truncated: false
      },
      { role: 'user', text: '为什么超时？' }
    ]),
    {
      messages: [
        {
          role: 'user',
          content: [{
            type: 'text',
            text: 'The user ran a local bash command.\ncommand: sleep 1\nexit_code: null\ntimed_out: true\n\nterminal_output:\n(empty)'
          }]
        },
        { role: 'user', content: [{ type: 'text', text: '为什么超时？' }] }
      ]
    }
  );
});

test('convertTranscriptToAnthropicMessages skips incomplete tool records and returns invalid argument feedback', () => {
  assert.deepEqual(
    convertTranscriptToAnthropicMessages([
      { role: 'user', text: 'run' },
      { role: 'tool_call', text: 'missing metadata' },
      { role: 'tool_call', text: '', toolCallId: 'call_bad', toolName: 'glob', argumentsText: '{"pattern":"*.ts", "paths": ' },
      { role: 'tool_result', text: 'orphan', toolCallId: 'call_missing', toolName: 'run_bash_command', ok: true },
      { role: 'tool_result', text: 'bad args', toolCallId: 'call_bad', toolName: 'glob', ok: false },
      { role: 'assistant', text: 'next' }
    ]),
    {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'run' }] },
        {
          role: 'user',
          content: [{
            type: 'text',
            text: 'On the last attempt the model called the tool glob, but the call arguments were invalid. The tool arguments were not a valid JSON object, so the tool was not executed. Raw arguments: {"pattern":"*.ts", "paths":\n\nError returned by the tool: bad args\nFix the arguments and call the tool again.'
          }]
        },
        { role: 'assistant', content: [{ type: 'text', text: 'next' }] }
      ]
    }
  );
});

test('createAnthropicRequest sends messages, max tokens, and tools without OpenAI-only fields', () => {
  assert.deepEqual(
    createAnthropicRequest([{ role: 'user', text: 'hello' }], TEST_CONFIG),
    {
      cache_control: {type: 'ephemeral'},
      max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      model: 'claude-test-model',
      stream: true
    }
  );

  const request = createAnthropicRequest([
    { role: 'system', text: 'system prompt' },
    { role: 'user', text: 'hello' }
  ], TEST_CONFIG, createToolRegistry());

  assert.deepEqual(request, {
    cache_control: {type: 'ephemeral'},
    max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    model: 'claude-test-model',
    stream: true,
    system: 'system prompt',
    tools: [
      {
        name: 'run_bash_command',
        description: 'Run bash',
        input_schema: { type: 'object' }
      }
    ]
  });
  assert.equal('input' in request, false);
  assert.equal('reasoning' in request, false);
  assert.equal('tool_calls' in request, false);
  assert.equal('max_output_tokens' in request, false);
});

test('createAnthropicRequest maps reasoning effort to adaptive thinking config', () => {
  const baseRequest = {
    cache_control: {type: 'ephemeral'},
    max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    model: 'claude-test-model',
    stream: true,
    thinking: { type: 'adaptive', display: 'summarized' }
  };

  for (const [reasoningEffort, effort] of [
    ['minimal', 'low'],
    ['low', 'medium'],
    ['medium', 'high'],
    ['high', 'xhigh'],
    ['xhigh', 'max']
  ]) {
    assert.deepEqual(
      createAnthropicRequest([{ role: 'user', text: 'hello' }], { ...TEST_CONFIG, reasoningEffort }),
      { ...baseRequest, output_config: { effort } }
    );
  }

  const noneRequest = createAnthropicRequest([{ role: 'user', text: 'hello' }], { ...TEST_CONFIG, reasoningEffort: 'none' });
  assert.equal('thinking' in noneRequest, false);
  assert.equal('output_config' in noneRequest, false);
});

test('createAnthropicAgent configures SDK client and passes abort signal', async () => {
  const clientOptions = [];
  const controller = new AbortController();
  class FakeAnthropic {
    constructor(options) {
      clientOptions.push(options);
      this.messages = {
        async create(_request, options) {
          assert.equal(options.signal, controller.signal);
          return streamFrom([
            { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
            { type: 'message_stop' }
          ]);
        }
      };
    }
  }
  const agent = createAnthropicAgent(
    { ...TEST_CONFIG, headers: { 'x-source': 'test-source' } },
    createEmptyToolRegistry(),
    { AnthropicClient: FakeAnthropic }
  );

  await agent.runTurn([{ role: 'user', text: 'hello' }], {}, { abortSignal: controller.signal });

  assert.deepEqual(clientOptions[0], {
    apiKey: 'test-api-key',
    baseURL: 'https://anthropic.example/v1',
    defaultHeaders: { 'x-source': 'test-source' },
    maxRetries: 3
  });
});

test('createAnthropicAgent streams text chunks and returns input token usage', async () => {
  const harness = createHarness([
    { type: 'message_start', message: { usage: { input_tokens: 40, output_tokens: 1 } } },
    { type: 'message_delta', usage: { input_tokens: 40, cache_creation_input_tokens: 100, cache_read_input_tokens: 200, output_tokens: 12 } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '你' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '好' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' }
  ]);

  const result = await harness.runTurn([{ role: 'user', text: 'hello' }], {
    onToken(delta, draft) {
      harness.callbacks.push(['token', delta, draft]);
    }
  });

  assert.deepEqual(result, {
    draft: '你好',
    toolCalls: [],
    usage: {
      inputTokens: 340,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 200,
      outputTokens: 12
    },
    usageInputTokens: 340
  });
  assert.deepEqual(harness.requests, [{
    cache_control: {type: 'ephemeral'},
    max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    model: 'claude-test-model',
    stream: true
  }]);
  assert.deepEqual(harness.callbacks, [
    ['token', '你', '你'],
    ['token', '好', '你好']
  ]);
});

test('createAnthropicAgent aggregates streaming tool_use chunks', async () => {
  const harness = createHarness([
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'I will inspect.' } },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'call_1', name: 'run_bash_command', input: {} }
    },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command"' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"pwd"}' } },
    { type: 'message_delta', usage: { input_tokens: 42, cache_read_input_tokens: 1000, output_tokens: 8 } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' }
  ], createToolRegistry());

  const result = await harness.runTurn([{ role: 'user', text: 'where am I?' }], {
    onToken(delta, draft) {
      harness.callbacks.push(['token', delta, draft]);
    }
  });

  assert.deepEqual(result, {
    draft: 'I will inspect.',
    toolCalls: [{ callId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' }],
    usage: {
      inputTokens: 1042,
      cacheReadInputTokens: 1000,
      outputTokens: 8
    },
    usageInputTokens: 1042
  });
  assert.deepEqual(harness.requests[0].tools, [
    {
      name: 'run_bash_command',
      description: 'Run bash',
      input_schema: { type: 'object' }
    }
  ]);
  assert.deepEqual(harness.callbacks, [['token', 'I will inspect.', 'I will inspect.']]);
});

test('createAnthropicAgent returns Anthropic thinking summary and provider records', async () => {
  const harness = createHarness([
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I will ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'inspect.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-1' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Done.' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' }
  ]);

  const result = await harness.runTurn([{ role: 'user', text: 'think' }]);

  assert.equal(result.draft, 'Done.');
  assert.equal(result.reasoningSummary, 'I will inspect.');
  assert.deepEqual(result.providerRecords, [createAnthropicThinkingProviderRecord({ type: 'thinking', thinking: 'I will inspect.', signature: 'sig-1' })]);
});

test('createAnthropicAgent preserves thinking records for tool continuation', async () => {
  const harness = createHarness([
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'Need a tool.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-tool' } },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'call_1', name: 'run_bash_command', input: {} }
    },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command":"pwd"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' }
  ], createToolRegistry());

  const result = await harness.runTurn([{ role: 'user', text: 'inspect' }]);

  assert.deepEqual(result.toolCalls, [{ callId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' }]);
  assert.equal(result.reasoningSummary, 'Need a tool.');
  assert.deepEqual(result.providerRecords, [createAnthropicThinkingProviderRecord({ type: 'thinking', thinking: 'Need a tool.', signature: 'sig-tool' })]);
});

test('createAnthropicAgent preserves redacted thinking without visible summary', async () => {
  const harness = createHarness([
    { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data: 'redacted-data' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' }
  ]);

  const result = await harness.runTurn([{ role: 'user', text: 'think' }]);

  assert.equal(result.reasoningSummary, undefined);
  assert.deepEqual(result.providerRecords, [createAnthropicThinkingProviderRecord({ type: 'redacted_thinking', data: 'redacted-data' })]);
});

test('createAnthropicAgent preserves partial tool input for runtime validation', async () => {
  const harness = createHarness([
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_1', name: 'glob', input: {} }
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"pattern":"*.ts", "paths": ' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' }
  ], createToolRegistry());

  const result = await harness.runTurn([{ role: 'user', text: 'inspect' }]);

  assert.equal(result.draft, '');
  assert.deepEqual(result.toolCalls, [{
    callId: 'call_1',
    toolName: 'glob',
    argumentsText: '{"pattern":"*.ts", "paths": '
  }]);
});

test('createAnthropicAgent rejects create errors, stream errors, service errors, and incomplete streams', async () => {
  const fakeAuthText = ['Bear', 'er secret-value'].join('');
  const createErrorAgent = createAnthropicAgent(TEST_CONFIG, createEmptyToolRegistry(), {
    createClient() {
      return {
        messages: {
          async create() {
            throw new Error(`create failed ${fakeAuthText}`);
          }
        }
      };
    }
  });
  await assert.rejects(
    () => createErrorAgent.runTurn([{ role: 'user', text: 'hello' }], {}),
    (error) => {
      assert.match(error.message, /无法启动模型响应/);
      assert.doesNotMatch(error.message, /secret-value/);
      return true;
    }
  );

  const fakeStreamKey = `sk-${'stream-secret'}`;
  const streamErrorHarness = createHarness([new Error(`stream failed ${fakeStreamKey}`)]);
  await assert.rejects(
    () => streamErrorHarness.runTurn([{ role: 'user', text: 'hello' }], {}),
    (error) => {
      assert.match(error.message, /模型响应流异常/);
      assert.doesNotMatch(error.message, new RegExp(fakeStreamKey));
      return true;
    }
  );

  const serviceKey = `sk-${'service-secret'}`;
  const serviceErrorHarness = createHarness([{ error: { message: `service unavailable ${serviceKey}` } }]);
  await assert.rejects(
    () => serviceErrorHarness.runTurn([{ role: 'user', text: 'hello' }], {}),
    (error) => {
      assert.equal(error instanceof LlmAgentError, true);
      assert.match(error.message, /模型服务响应失败/);
      assert.doesNotMatch(error.message, new RegExp(serviceKey));
      return true;
    }
  );

  const incompleteHarness = createHarness([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }]);
  await assert.rejects(
    () => incompleteHarness.runTurn([{ role: 'user', text: 'hello' }], {}),
    /模型响应流未完成/
  );

  const missingStopReasonHarness = createHarness([
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
    { type: 'message_stop' }
  ]);
  await assert.rejects(
    () => missingStopReasonHarness.runTurn([{ role: 'user', text: 'hello' }], {}),
    /模型响应流缺少停止原因/
  );

  const maxTokensHarness = createHarness([
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I will inspect.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-max' } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    { type: 'message_stop' }
  ]);
  await assert.rejects(
    () => maxTokensHarness.runTurn([{ role: 'user', text: 'hello' }], {}),
    /模型响应达到 max_tokens 限制/
  );
});

test('readAnthropicStream treats abort as user interruption instead of service failure', async () => {
  const controller = new AbortController();

  await assert.rejects(
    () => readAnthropicStream(streamFrom([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }]), {}, { abortSignal: controller.signal }),
    /模型响应流未完成/
  );

  controller.abort();

  await assert.rejects(
    () => readAnthropicStream(streamFrom([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }]), {}, { abortSignal: controller.signal }),
    (error) => {
      assert.equal(error.name, 'AgentAbortError');
      assert.doesNotMatch(error.message, /模型响应流异常/);
      return true;
    }
  );
});

test('Anthropic agent can generate compaction summaries without provider usage', async () => {
  const requests = [];
  const client = {
    messages: {
      async create(request) {
        requests.push(request);
        return streamFrom([
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '## 背景与目标\n- 已检查项目。' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
          { type: 'message_stop' }
        ]);
      }
    }
  };
  const agent = createAnthropicAgent(TEST_CONFIG, createEmptyToolRegistry(), {
    createClient() {
      return client;
    }
  });
  const summary = await generateCompactionSummary({
    agent,
    compactedRecords: [
      { role: 'user', text: '请检查项目' },
      { role: 'assistant', text: '好的' }
    ],
    previousSummary: ''
  });

  assert.equal(summary, '## 背景与目标\n- 已检查项目。');
  assert.equal(typeof requests[0].system, 'string');
  assert.equal(requests[0].messages[0].role, 'user');
});
