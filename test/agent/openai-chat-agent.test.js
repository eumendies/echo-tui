const test = require('node:test');
const assert = require('node:assert/strict');

const { generateCompactionSummary } = require('../../src/agent/context/context-compaction');
const { LlmAgentError } = require('../../src/agent/agent-errors');
const { createChatRequest, createOpenAiChatAgent } = require('../../src/agent/openai-chat/agent');
const { createPromptCacheKey } = require('../../src/agent/prompt-cache');
const { convertTranscriptToOpenAiChatMessages } = require('../../src/agent/openai-chat/transcript-converter');
const { convertToolDefinitionsToOpenAiChatTools } = require('../../src/agent/openai-chat/tool-converter');
const { createBuiltInSystemPrompt } = require('../../src/agent/context/system-prompt');

const TEST_CWD = '/tmp/echo_tui';
const TEST_SYSTEM_PROMPT = createBuiltInSystemPrompt({ cwd: TEST_CWD });

const TEST_CONFIG = {
  agentType: 'openai-chat',
  apiKey: 'test-api-key',
  baseURL: 'https://example.invalid/v1',
  model: 'test-chat-model',
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

function createHarness(eventsOrFactory, registry = createEmptyToolRegistry(), llmConfig = TEST_CONFIG) {
  const requests = [];
  const requestOptions = [];
  const callbacks = [];
  const client = {
    chat: {
      completions: {
        async create(request, options) {
          requests.push(request);
          requestOptions.push(options);
          const events = typeof eventsOrFactory === 'function' ? eventsOrFactory(request) : eventsOrFactory;
          return streamFrom(events);
        }
      }
    }
  };
  const agent = createOpenAiChatAgent({
    createClient(config) {
      assert.deepEqual(config, llmConfig);
      return client;
    }
  });
  agent.initialize(llmConfig, registry);

  return {
    callbacks,
    requestOptions,
    requests,
    runTurn(records, callbacks, options) {
      return agent.runTurn(records, callbacks, options);
    }
  };
}

test('OpenAI Chat tool converter maps function tool definitions', () => {
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
  const [tool] = convertToolDefinitionsToOpenAiChatTools([
    { name: 'glob', description: 'Find files', parameters }
  ]);

  assert.equal(tool.type, 'function');
  assert.equal(tool.function.name, 'glob');
  assert.equal(tool.function.description, 'Find files');
  assert.equal(tool.function.parameters, parameters);
});

test('convertTranscriptToOpenAiChatMessages maps chat roles and filters local records', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      { role: 'system', text: '你是助手' },
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '你好，有什么可以帮你？' },
      { role: 'error', text: 'timeout' },
      { role: 'local_notice', text: '已中断' },
      { role: 'reasoning_summary', text: 'thinking' },
      { role: 'openai_reasoning', text: '', item: { type: 'reasoning' } },
      { role: 'openai_chat_reasoning', text: '', reasoningContent: 'hidden' },
      { role: 'user', text: '继续' }
    ]),
    [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，有什么可以帮你？' },
      { role: 'user', content: '继续' }
    ]
  );
});

test('convertTranscriptToOpenAiChatMessages replays chat reasoning content by default', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      { role: 'user', text: 'inspect' },
      { role: 'openai_chat_reasoning', text: '', reasoningContent: 'Need a tool.' },
      { role: 'tool_call', text: '', toolCallId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' },
      { role: 'tool_result', text: 'ok', toolCallId: 'call_1', toolName: 'run_bash_command', ok: true },
      { role: 'openai_chat_reasoning', text: '', reasoningContent: 'Now answer.' },
      { role: 'assistant', text: 'done' }
    ]),
    [
      { role: 'user', content: 'inspect' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'Need a tool.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'run_bash_command', arguments: '{"command":"pwd"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      { role: 'assistant', content: 'done', reasoning_content: 'Now answer.' }
    ]
  );
});

test('convertTranscriptToOpenAiChatMessages ignores malformed chat reasoning records', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      { role: 'openai_chat_reasoning', text: '' },
      { role: 'assistant', text: 'done' }
    ]),
    [
      { role: 'assistant', content: 'done' }
    ]
  );
});

test('convertTranscriptToOpenAiChatMessages maps shell records as user messages', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      {
        role: 'shell',
        text: '$ npm test\n\nfailed\n\n[exit 1]',
        command: 'npm test',
        exitCode: 1,
        includeInContext: true,
        output: 'failed\n',
        timedOut: false,
        truncated: true
      },
      {
        role: 'shell',
        text: '$ env [local]\n\nSECRET=1',
        command: 'env',
        exitCode: 0,
        includeInContext: false,
        output: 'SECRET=1\n',
        timedOut: false,
        truncated: false
      },
      { role: 'assistant', text: '我看一下失败原因。' }
    ]),
    [
      {
        role: 'user',
        content: 'The user ran a local bash command.\ncommand: npm test\nexit_code: 1\ntruncated: true\n\nterminal_output:\nfailed\n'
      },
      { role: 'assistant', content: '我看一下失败原因。' }
    ]
  );
});

test('convertTranscriptToOpenAiChatMessages groups tool calls on assistant messages', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      { role: 'user', text: 'inspect' },
      { role: 'assistant', text: 'I will inspect.' },
      { role: 'tool_call', text: '', toolCallId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' },
      { role: 'tool_result', text: 'exit_code: 0', toolCallId: 'call_1', toolName: 'run_bash_command', ok: true },
      { role: 'tool_call', text: '', toolCallId: 'call_2', toolName: 'glob', argumentsText: '{"pattern":"*.ts"}' },
      { role: 'tool_result', text: 'src/app.ts', toolCallId: 'call_2', toolName: 'glob', ok: true }
    ]),
    [
      { role: 'user', content: 'inspect' },
      {
        role: 'assistant',
        content: 'I will inspect.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'run_bash_command', arguments: '{"command":"pwd"}' } },
          { id: 'call_2', type: 'function', function: { name: 'glob', arguments: '{"pattern":"*.ts"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'exit_code: 0' },
      { role: 'tool', tool_call_id: 'call_2', content: 'src/app.ts' }
    ]
  );
});

test('convertTranscriptToOpenAiChatMessages keeps reasoning content on grouped tool calls', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      { role: 'user', text: 'review' },
      { role: 'openai_chat_reasoning', text: '', reasoningContent: 'Need git status and branch.' },
      { role: 'tool_call', text: '', toolCallId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"git status --short"}' },
      { role: 'tool_result', text: ' M file.ts', toolCallId: 'call_1', toolName: 'run_bash_command', ok: true },
      { role: 'tool_call', text: '', toolCallId: 'call_2', toolName: 'run_bash_command', argumentsText: '{"command":"git branch --show-current"}' },
      { role: 'tool_result', text: 'main', toolCallId: 'call_2', toolName: 'run_bash_command', ok: true }
    ]),
    [
      { role: 'user', content: 'review' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'Need git status and branch.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'run_bash_command', arguments: '{"command":"git status --short"}' } },
          { id: 'call_2', type: 'function', function: { name: 'run_bash_command', arguments: '{"command":"git branch --show-current"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_1', content: ' M file.ts' },
      { role: 'tool', tool_call_id: 'call_2', content: 'main' }
    ]
  );
});

test('convertTranscriptToOpenAiChatMessages maps image attachments from tool results', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      { role: 'assistant', text: 'I will read.' },
      { role: 'tool_call', text: '', toolCallId: 'call_img', toolName: 'read_files', argumentsText: '{"files":[{"path":"a.png"}]}' },
      { role: 'tool_call', text: '', toolCallId: 'call_text', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' },
      {
        role: 'tool_result',
        text: 'image_attached: true',
        toolCallId: 'call_img',
        toolName: 'read_files',
        ok: true,
        attachments: [
          { kind: 'image', mediaType: 'image/png', dataBase64: 'aW1nMQ==', path: 'a.png', sizeBytes: 4 },
          { kind: 'image', mediaType: 'image/jpeg', dataBase64: 'aW1nMg==', path: 'b.jpg', sizeBytes: 4 },
          { kind: 'image', mediaType: 'image/bmp', dataBase64: 'ignored', path: 'c.bmp', sizeBytes: 4 },
          { kind: 'image', mediaType: 'image/png', dataBase64: '', path: 'empty.png', sizeBytes: 0 }
        ]
      },
      { role: 'tool_result', text: 'pwd output', toolCallId: 'call_text', toolName: 'run_bash_command', ok: true },
      {
        role: 'tool_result',
        text: 'plain',
        toolCallId: 'call_plain',
        toolName: 'read_files',
        ok: true
      }
    ]),
    [
      {
        role: 'assistant',
        content: 'I will read.',
        tool_calls: [
          { id: 'call_img', type: 'function', function: { name: 'read_files', arguments: '{"files":[{"path":"a.png"}]}' } },
          { id: 'call_text', type: 'function', function: { name: 'run_bash_command', arguments: '{"command":"pwd"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_img', content: 'image_attached: true' },
      { role: 'tool', tool_call_id: 'call_text', content: 'pwd output' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Images attached from tool result read_files (call_img).' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1nMQ==' } },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aW1nMg==' } }
        ]
      }
    ]
  );
});

test('convertTranscriptToOpenAiChatMessages maps image attachments from user records', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      {
        role: 'user',
        text: '看 @image.png',
        attachments: [{ kind: 'image', mediaType: 'image/png', dataBase64: 'aW1n', path: 'image.png', sizeBytes: 3 }]
      }
    ]),
    [{
      role: 'user',
      content: [
        { type: 'text', text: '看 @image.png' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } }
      ]
    }]
  );
});

test('convertTranscriptToOpenAiChatMessages creates assistant tool message when draft is empty', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      { role: 'user', text: 'run' },
      { role: 'tool_call', text: '', toolCallId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' },
      { role: 'tool_result', text: 'ok', toolCallId: 'call_1', toolName: 'run_bash_command', ok: true }
    ]),
    [
      { role: 'user', content: 'run' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'run_bash_command', arguments: '{"command":"pwd"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' }
    ]
  );
});

test('convertTranscriptToOpenAiChatMessages skips incomplete tool metadata', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiChatMessages([
      { role: 'user', text: 'run' },
      { role: 'tool_call', text: 'missing metadata' },
      { role: 'tool_call', text: '', toolCallId: 'call_bad', toolName: 'glob', argumentsText: '{"pattern":"*.ts", "paths": ' },
      { role: 'tool_result', text: 'orphan', toolCallId: 'call_missing', toolName: 'run_bash_command', ok: true },
      { role: 'tool_result', text: 'bad args', toolCallId: 'call_bad', toolName: 'glob', ok: false },
      { role: 'assistant', text: 'next' }
    ]),
    [
      { role: 'user', content: 'run' },
      {
        role: 'user',
        content: 'On the last attempt the model called the tool glob, but the call arguments were invalid. The tool arguments were not a valid JSON object, so the tool was not executed. Raw arguments: {"pattern":"*.ts", "paths":\n\nError returned by the tool: bad args\nFix the arguments and call the tool again.'
      },
      { role: 'assistant', content: 'next' }
    ]
  );
});

test('createChatRequest sends messages and tools without Responses-only fields', () => {
  const records = [{ role: 'user', text: 'hello' }];

  assert.deepEqual(
    createChatRequest(records, TEST_CONFIG),
    {
      messages: [{ role: 'user', content: 'hello' }],
      model: 'test-chat-model',
      prompt_cache_key: createPromptCacheKey(records, TEST_CONFIG),
      stream: true,
      stream_options: {include_usage: true}
    }
  );

  const request = createChatRequest(records, TEST_CONFIG, createToolRegistry());

  assert.deepEqual(request, {
    messages: [{ role: 'user', content: 'hello' }],
    model: 'test-chat-model',
    parallel_tool_calls: false,
    prompt_cache_key: createPromptCacheKey(records, TEST_CONFIG, createToolRegistry().listDefinitions()),
    stream: true,
    stream_options: {include_usage: true},
    tools: [
      {
        type: 'function',
        function: {
          name: 'run_bash_command',
          description: 'Run bash',
          parameters: { type: 'object' }
        }
      }
    ]
  });
  assert.equal('input' in request, false);
  assert.equal('reasoning' in request, false);
  assert.equal('max_output_tokens' in request, false);
});

test('createChatRequest sends reasoning_effort when configured', () => {
  assert.deepEqual(
    createChatRequest([{ role: 'user', text: 'hello' }], { ...TEST_CONFIG, reasoningEffort: 'xhigh' }),
    {
      messages: [{ role: 'user', content: 'hello' }],
      model: 'test-chat-model',
      prompt_cache_key: createPromptCacheKey([{ role: 'user', text: 'hello' }], TEST_CONFIG),
      reasoning_effort: 'xhigh',
      stream: true,
      stream_options: {include_usage: true}
    }
  );

  const noneRequest = createChatRequest([{ role: 'user', text: 'hello' }], { ...TEST_CONFIG, reasoningEffort: 'none' });

  assert.equal('reasoning_effort' in noneRequest, false);
  assert.equal('reasoning' in noneRequest, false);
  assert.equal('input' in noneRequest, false);
  assert.equal('max_output_tokens' in noneRequest, false);
});

test('createOpenAiChatAgent streams text chunks and returns prompt usage', async () => {
  const harness = createHarness([
    { choices: [{ delta: { content: '你' } }] },
    { choices: [{ delta: { content: '好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 42, prompt_tokens_details: {cached_tokens: 20}, completion_tokens: 9 } }
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
      inputTokens: 42,
      cacheReadInputTokens: 20,
      outputTokens: 9
    },
    usageInputTokens: 42
  });
  assert.deepEqual(harness.requests, [{
    messages: [{ role: 'user', content: 'hello' }],
    model: 'test-chat-model',
    prompt_cache_key: createPromptCacheKey([{ role: 'user', text: 'hello' }], TEST_CONFIG),
    stream: true,
    stream_options: {include_usage: true}
  }]);
  assert.deepEqual(harness.callbacks, [
    ['token', '你', '你'],
    ['token', '好', '你好']
  ]);
});

test('createOpenAiChatAgent returns reasoning summary without mixing it into draft', async () => {
  const harness = createHarness([
    { choices: [{ delta: { reasoning_content: 'I should ' } }] },
    { choices: [{ delta: { reasoning_content: 'think.', content: 'Done.' }, finish_reason: 'stop' }] }
  ]);

  const result = await harness.runTurn([{ role: 'user', text: 'think' }], {
    onToken(delta, draft) {
      harness.callbacks.push(['token', delta, draft]);
    }
  });

  assert.deepEqual(result, {
    draft: 'Done.',
    providerRecords: [{
      role: 'openai_chat_reasoning',
      text: '',
      reasoningContent: 'I should think.'
    }],
    reasoningSummary: 'I should think.',
    toolCalls: [],
    usageInputTokens: undefined
  });
  assert.deepEqual(harness.callbacks, [['token', 'Done.', 'Done.']]);
});

test('createOpenAiChatAgent configures SDK client and passes abort signal', async () => {
  const clientOptions = [];
  const controller = new AbortController();
  class FakeOpenAI {
    constructor(options) {
      clientOptions.push(options);
      this.chat = {
        completions: {
          async create(_request, options) {
            assert.equal(options.signal, controller.signal);
            return streamFrom([{ choices: [{ finish_reason: 'stop' }] }]);
          }
        }
      };
    }
  }
  const agent = createOpenAiChatAgent({ OpenAIClient: FakeOpenAI });

  agent.initialize({ ...TEST_CONFIG, headers: { 'x-source': 'test-source' } }, createEmptyToolRegistry());
  await agent.runTurn([{ role: 'user', text: 'hello' }], {}, { abortSignal: controller.signal });

  assert.deepEqual(clientOptions[0], {
    apiKey: 'test-api-key',
    baseURL: 'https://example.invalid/v1',
    defaultHeaders: { 'x-source': 'test-source' },
    maxRetries: 3
  });
});

test('createOpenAiChatAgent aggregates streaming tool call chunks', async () => {
  const harness = createHarness([
    {
      choices: [{
        delta: {
          content: 'I will inspect.',
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'run_bash_command', arguments: '{"command"' } }
          ]
        }
      }]
    },
    {
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: ':"pwd"}' } }
          ]
        },
        finish_reason: 'tool_calls'
      }]
    }
  ], createToolRegistry());

  const result = await harness.runTurn([{ role: 'user', text: 'where am I?' }], {
    onToken(delta, draft) {
      harness.callbacks.push(['token', delta, draft]);
    }
  });

  assert.deepEqual(result, {
    draft: 'I will inspect.',
    toolCalls: [{ callId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' }],
    usageInputTokens: undefined
  });
  assert.deepEqual(harness.requests[0].tools, [
    {
      type: 'function',
      function: {
        name: 'run_bash_command',
        description: 'Run bash',
        parameters: { type: 'object' }
      }
    }
  ]);
  assert.equal(harness.requests[0].parallel_tool_calls, false);
  assert.deepEqual(harness.callbacks, [['token', 'I will inspect.', 'I will inspect.']]);
});

test('createOpenAiChatAgent preserves reasoning summary with tool calls', async () => {
  const harness = createHarness([
    { choices: [{ delta: { reasoning_content: 'Need a tool.' } }] },
    {
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'run_bash_command', arguments: '{"command":"pwd"}' } }
          ]
        },
        finish_reason: 'tool_calls'
      }]
    }
  ], createToolRegistry());

  const result = await harness.runTurn([{ role: 'user', text: 'inspect' }]);

  assert.deepEqual(result, {
    draft: '',
    providerRecords: [{
      role: 'openai_chat_reasoning',
      text: '',
      reasoningContent: 'Need a tool.'
    }],
    reasoningSummary: 'Need a tool.',
    toolCalls: [{ callId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' }],
    usageInputTokens: undefined
  });
});

test('createOpenAiChatAgent returns chat reasoning content record by default', async () => {
  const harness = createHarness([
    { choices: [{ delta: { reasoning_content: 'Need a tool.' } }] },
    {
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'run_bash_command', arguments: '{"command":"pwd"}' } }
          ]
        },
        finish_reason: 'tool_calls'
      }]
    }
  ], createToolRegistry());

  const result = await harness.runTurn([{ role: 'user', text: 'inspect' }]);

  assert.deepEqual(result.providerRecords, [{
    role: 'openai_chat_reasoning',
    text: '',
    reasoningContent: 'Need a tool.'
  }]);
  assert.equal(result.reasoningSummary, 'Need a tool.');
  assert.deepEqual(result.toolCalls, [{ callId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' }]);
});

test('createOpenAiChatAgent preserves streamed tool arguments for runtime validation', async () => {
  const harness = createHarness([
    {
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'glob', arguments: '{"pattern":"*.ts", "paths": ' } }
          ]
        },
        finish_reason: 'tool_calls'
      }]
    }
  ], createToolRegistry());

  const result = await harness.runTurn([{ role: 'user', text: 'inspect' }]);

  assert.equal(result.draft, '');
  assert.equal(result.toolCalls.length, 1);
  assert.deepEqual(result.toolCalls[0], {
    callId: 'call_1',
    toolName: 'glob',
    argumentsText: '{"pattern":"*.ts", "paths": '
  });
});

test('createOpenAiChatAgent rejects create errors, stream errors, service errors, and incomplete streams', async () => {
  const fakeAuthText = ['Bear', 'er secret-value'].join('');
  const createErrorAgent = createOpenAiChatAgent({
    createClient() {
      return {
        chat: {
          completions: {
            async create() {
              throw new Error(`create failed ${fakeAuthText}`);
            }
          }
        }
      };
    }
  });
  createErrorAgent.initialize(TEST_CONFIG, createEmptyToolRegistry());

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

  const incompleteHarness = createHarness([{ choices: [{ delta: { content: 'partial' } }] }]);
  await assert.rejects(
    () => incompleteHarness.runTurn([{ role: 'user', text: 'hello' }], {}),
    /模型响应流未完成/
  );
});

test('createOpenAiChatAgent treats abort as user interruption instead of service failure', async () => {
  const controller = new AbortController();
  const agent = createOpenAiChatAgent({
    createClient() {
      return {
        chat: {
          completions: {
            async create(_request, options) {
              assert.equal(options.signal, controller.signal);
              controller.abort();
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              throw error;
            }
          }
        }
      };
    }
  });

  agent.initialize(TEST_CONFIG, createEmptyToolRegistry());

  await assert.rejects(
    () => agent.runTurn([{ role: 'user', text: 'hello' }], {}, { abortSignal: controller.signal }),
    (error) => {
      assert.equal(error.name, 'AgentAbortError');
      assert.doesNotMatch(error.message, /无法启动模型响应/);
      return true;
    }
  );
});


test('Chat agent can generate compaction summaries without provider usage', async () => {
  const requests = [];
  const client = {
    chat: {
      completions: {
        async create(request) {
          requests.push(request);
          return streamFrom([
            { choices: [{ delta: { content: '## 背景与目标\n- 已检查项目。' }, finish_reason: 'stop' }] }
          ]);
        }
      }
    }
  };
  const agent = createOpenAiChatAgent({
    createClient() {
      return client;
    }
  });
  agent.initialize(TEST_CONFIG, createEmptyToolRegistry());

  const summary = await generateCompactionSummary({
    agent,
    compactedRecords: [
      { role: 'user', text: '请检查项目' },
      { role: 'assistant', text: '好的' }
    ],
    previousSummary: ''
  });

  assert.equal(summary, '## 背景与目标\n- 已检查项目。');
  assert.equal(requests[0].messages[0].role, 'system');
  assert.equal(requests[0].messages[1].role, 'user');
});
