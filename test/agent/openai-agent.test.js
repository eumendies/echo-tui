const test = require('node:test');
const assert = require('node:assert/strict');

const { LlmAgentError, redactSensitiveText } = require('../../src/agent/agent-errors');
const { createOpenAiAgent, createRequest } = require('../../src/agent/openai-responses/agent');
const { createPromptCacheKey } = require('../../src/agent/prompt-cache');
const { convertToolDefinitionsToOpenAiTools, extractFunctionToolCall } = require('../../src/agent/openai-responses/tool-converter');
const { convertTranscriptToOpenAiInput } = require('../../src/agent/openai-responses/transcript-converter');
const { createBuiltInSystemPrompt } = require('../../src/agent/context/system-prompt');
const { createDefaultToolRegistry } = require('../../src/tools/tool-registry');

const TEST_CWD = '/tmp/echo_tui';
const TEST_SYSTEM_PROMPT = createBuiltInSystemPrompt({ cwd: TEST_CWD });

const TEST_CONFIG = {
  agentType: 'openai',
  apiKey: 'test-api-key',
  baseURL: 'https://example.invalid/v1',
  model: 'test-model',
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

function createHarness(eventsOrFactory) {
  const requests = [];
  const requestOptions = [];
  const callbacks = [];
  const client = {
    responses: {
      async create(request, options) {
        requests.push(request);
        requestOptions.push(options);
        const events = typeof eventsOrFactory === 'function' ? eventsOrFactory(request) : eventsOrFactory;
        return streamFrom(events);
      }
    }
  };
  const agent = createOpenAiAgent({
    createClient(config) {
      assert.deepEqual(config, TEST_CONFIG);
      return client;
    }
  });
  agent.initialize(TEST_CONFIG, createEmptyToolRegistry());
  async function runTurn(records, callbacks, options) {
    return agent.runTurn(records, callbacks, options);
  }

  return { callbacks, requestOptions, requests, runTurn };
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

test('createOpenAiAgent streams one provider turn and returns draft with no tool calls', async () => {
  const harness = createHarness([
    { type: 'response.created' },
    { type: 'response.output_text.delta', delta: '你' },
    { type: 'response.output_text.delta', delta: '好' },
    { type: 'response.completed', response: {usage: {input_tokens: 42, input_tokens_details: {cached_tokens: 30}, output_tokens: 12}} }
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
      cacheReadInputTokens: 30,
      outputTokens: 12
    },
    usageInputTokens: 42
  });
  assert.deepEqual(harness.requests, [{
    input: [{ role: 'user', content: 'hello' }],
    model: 'test-model',
    prompt_cache_key: createPromptCacheKey([{ role: 'user', text: 'hello' }], TEST_CONFIG),
    stream: true
  }]);
  assert.deepEqual(harness.callbacks, [
    ['token', '你', '你'],
    ['token', '好', '你好']
  ]);
});

test('createOpenAiAgent passes abort signal to SDK request options', async () => {
  const harness = createHarness([{ type: 'response.completed' }]);
  const controller = new AbortController();

  await harness.runTurn([{ role: 'user', text: 'hello' }], {}, { abortSignal: controller.signal });

  assert.equal(harness.requestOptions[0].signal, controller.signal);
});

test('createOpenAiAgent configures SDK retry count', async () => {
  const clientOptions = [];
  class FakeOpenAI {
    constructor(options) {
      clientOptions.push(options);
      this.responses = {
        async create() {
          return streamFrom([{ type: 'response.completed' }]);
        }
      };
    }
  }
  const agent = createOpenAiAgent({ OpenAIClient: FakeOpenAI });

  agent.initialize(TEST_CONFIG, createEmptyToolRegistry());
  await agent.runTurn([{ role: 'user', text: 'hello' }], {});

  assert.equal(clientOptions[0].maxRetries, 3);
});

test('createOpenAiAgent passes configured default headers to SDK client', async () => {
  const clientOptions = [];
  class FakeOpenAI {
    constructor(options) {
      clientOptions.push(options);
      this.responses = {
        async create() {
          return streamFrom([{ type: 'response.completed' }]);
        }
      };
    }
  }
  const agent = createOpenAiAgent({ OpenAIClient: FakeOpenAI });

  agent.initialize({ ...TEST_CONFIG, headers: { 'x-source': 'test-source' } }, createEmptyToolRegistry());
  await agent.runTurn([{ role: 'user', text: 'hello' }], {});

  assert.deepEqual(clientOptions[0].defaultHeaders, { 'x-source': 'test-source' });
});

test('createOpenAiAgent treats abort as user interruption instead of service failure', async () => {
  const controller = new AbortController();
  const agent = createOpenAiAgent({
    createClient() {
      return {
        responses: {
          async create(_request, options) {
            assert.equal(options.signal, controller.signal);
            controller.abort();
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            throw error;
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

test('createRequest sends tools only when registry is non-empty', () => {
  const records = [{ role: 'user', text: 'hello' }];

  assert.deepEqual(
    createRequest(records, TEST_CONFIG),
    {
      input: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
      prompt_cache_key: createPromptCacheKey(records, TEST_CONFIG),
      stream: true
    }
  );

  const toolRegistry = createToolRegistry();
  assert.deepEqual(
    createRequest(records, TEST_CONFIG, toolRegistry),
    {
      input: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
      prompt_cache_key: createPromptCacheKey(records, TEST_CONFIG, toolRegistry.listDefinitions()),
      stream: true,
      tools: [
        {
          type: 'function',
          name: 'run_bash_command',
          description: 'Run bash',
          parameters: { type: 'object', additionalProperties: false },
          strict: true
        }
      ]
    }
  );
});

test('createRequest sends reasoning effort only when configured', () => {
  assert.deepEqual(
    createRequest([{ role: 'user', text: 'hello' }], { ...TEST_CONFIG, reasoningEffort: 'high' }),
    {
      input: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
      prompt_cache_key: createPromptCacheKey([{ role: 'user', text: 'hello' }], TEST_CONFIG),
      reasoning: { effort: 'high' },
      stream: true
    }
  );

  assert.equal('reasoning' in createRequest([{ role: 'user', text: 'hello' }], TEST_CONFIG), false);
});

test('createRequest sends reasoning summary with optional effort', () => {
  assert.deepEqual(
    createRequest([{ role: 'user', text: 'hello' }], { ...TEST_CONFIG, reasoningSummary: 'auto' }),
    {
      input: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
      prompt_cache_key: createPromptCacheKey([{ role: 'user', text: 'hello' }], TEST_CONFIG),
      reasoning: { summary: 'auto' },
      stream: true
    }
  );

  assert.deepEqual(
    createRequest([{ role: 'user', text: 'hello' }], { ...TEST_CONFIG, reasoningEffort: 'high', reasoningSummary: 'detailed' }),
    {
      input: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
      prompt_cache_key: createPromptCacheKey([{ role: 'user', text: 'hello' }], TEST_CONFIG),
      reasoning: { effort: 'high', summary: 'detailed' },
      stream: true
    }
  );
});

test('createDefaultToolRegistry enables the developed tools by default', () => {
  const request = createRequest([{ role: 'user', text: 'hello' }], TEST_CONFIG, createDefaultToolRegistry(TEST_CONFIG));

  assert.equal(Array.isArray(request.tools), true);
  assert.deepEqual(request.tools.map((tool) => tool.name), [
    'run_bash_command',
    'apply_patch',
    'ask_user_questions',
    'glob',
    'grep',
    'read_files',
    'read_memory',
    'add_memory',
    'update_memory',
    'remove_memory',
    'create_todos',
    'complete_todo',
    'use_skill',
    'web_fetch',
    'web_search'
  ]);
});

test('createOpenAiAgent rejects service failure events without completing', async () => {
  const fakeApiKey = `sk-${'secret'}`;
  const harness = createHarness([
    { type: 'response.output_text.delta', delta: 'partial' },
    { type: 'response.failed', error: { message: `service unavailable ${fakeApiKey}` } }
  ]);
  let completed = false;

  await assert.rejects(
    () => harness.runTurn([{ role: 'user', text: 'hello' }], {
      onToken() {}
    }),
    (error) => {
      assert.equal(error instanceof LlmAgentError, true);
      assert.match(error.message, /模型服务响应失败/);
      assert.doesNotMatch(error.message, new RegExp(fakeApiKey));
      return true;
    }
  );
  assert.equal(completed, false);
});

test('createOpenAiAgent rejects streams that end before completion', async () => {
  const harness = createHarness([
    { type: 'response.output_text.delta', delta: 'partial' }
  ]);

  await assert.rejects(
    () => harness.runTurn([{ role: 'user', text: 'hello' }], {}),
    /模型响应流未完成/
  );
});

test('createOpenAiAgent rejects incomplete events with clear service-side reason', async () => {
  const harness = createHarness([
    { type: 'response.output_text.delta', delta: 'partial' },
    {
      type: 'response.incomplete',
      response: {
        incomplete_details: {
          reason: 'max_output_tokens'
        }
      }
    }
  ]);
  let completed = false;

  await assert.rejects(
    () => harness.runTurn([{ role: 'user', text: 'hello' }], {
      onToken(delta, draft) {
        harness.callbacks.push(['token', delta, draft]);
      }
    }),
    /服务端未完整结束响应：max_output_tokens/
  );
  assert.equal(completed, false);
  assert.deepEqual(harness.callbacks, [['token', 'partial', 'partial']]);
});

test('createOpenAiAgent rejects SDK create and stream errors', async () => {
  const fakeAuthText = ['Bear', 'er secret-value'].join('');
  const fakeStreamKey = `sk-${'stream-secret'}`;
  const createErrorAgent = createOpenAiAgent({
    createClient() {
      return {
        responses: {
          async create() {
            throw new Error(`create failed ${fakeAuthText}`);
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

  const harness = createHarness([new Error(`stream failed ${fakeStreamKey}`)]);
  await assert.rejects(
    () => harness.runTurn([{ role: 'user', text: 'hello' }], {}),
    (error) => {
      assert.match(error.message, /模型响应流异常/);
      assert.doesNotMatch(error.message, new RegExp(fakeStreamKey));
      return true;
    }
  );
});

test('redactSensitiveText removes common credential shapes', () => {
  const fakeAuthText = ['Bear', 'er abc.def'].join('');
  const fakeApiKey = `sk-${'test-secret'}`;

  assert.equal(
    redactSensitiveText(`${fakeAuthText} and ${fakeApiKey}`),
    'Bearer <redacted> and <redacted>'
  );
});

test('convertTranscriptToOpenAiInput maps supported roles and filters local-only records', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiInput([
      { role: 'system', text: '你是助手' },
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '你好，有什么可以帮你？' },
      { role: 'error', text: '模型响应失败：timeout' },
      { role: 'local_notice', text: '已中断模型回答' },
      { role: 'reasoning_summary', text: '我在检查上下文。' },
      { role: 'custom-role', text: 'ignore me' },
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

test('convertTranscriptToOpenAiInput maps shell records as user messages', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiInput([
      {
        role: 'shell',
        text: '$ pwd\n\n/workspace',
        command: 'pwd',
        exitCode: 0,
        includeInContext: true,
        output: '/workspace\n',
        timedOut: false,
        truncated: false
      },
      {
        role: 'shell',
        text: '$ ls [local]\n\nsecret',
        command: 'ls',
        exitCode: 0,
        includeInContext: false,
        output: 'secret\n',
        timedOut: false,
        truncated: false
      },
      { role: 'user', text: '刚才在哪个目录？' }
    ]),
    [
      {
        role: 'user',
        content: 'The user ran a local bash command.\ncommand: pwd\nexit_code: 0\n\nterminal_output:\n/workspace\n'
      },
      { role: 'user', content: '刚才在哪个目录？' }
    ]
  );
});

test('convertTranscriptToOpenAiInput maps OpenAI private reasoning records', () => {
  const reasoningItem = {
    id: 'rs_1',
    type: 'reasoning',
    encrypted_content: 'encrypted-reasoning',
    summary: [{ type: 'summary_text', text: 'checked plan' }]
  };

  assert.deepEqual(
    convertTranscriptToOpenAiInput([
      { role: 'user', text: 'run' },
      { role: 'openai_reasoning', text: '', provider: 'openai', item: reasoningItem },
      { role: 'tool_result', text: 'ok', toolCallId: 'call_1', toolName: 'run_bash_command', ok: true }
    ]),
    [
      { role: 'user', content: 'run' },
      reasoningItem,
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' }
    ]
  );
});

test('convertTranscriptToOpenAiInput maps tool records and skips incomplete tool metadata', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiInput([
      { role: 'user', text: 'run ls' },
      {
        role: 'tool_call',
        text: '$ ls',
        toolCallId: 'call_1',
        toolName: 'run_bash_command',
        argumentsText: '{"command":"ls"}'
      },
      {
        role: 'tool_result',
        text: 'exit_code: 0',
        toolCallId: 'call_1',
        toolName: 'run_bash_command',
        ok: true,
        display: {
          kind: 'apply_patch',
          files: [{path: 'ignored.txt', kind: 'updated', lines: [{kind: 'added', text: 'ignored', postLine: 1}]}]
        }
      },
      { role: 'tool_call', text: 'missing metadata' },
      { role: 'tool_result', text: 'missing metadata' }
    ]),
    [
      { role: 'user', content: 'run ls' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'run_bash_command',
        arguments: '{"command":"ls"}'
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'exit_code: 0'
      }
    ]
  );
});

test('convertTranscriptToOpenAiInput maps image attachments from tool results', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiInput([
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
      {
        role: 'tool_result',
        text: 'plain',
        toolCallId: 'call_plain',
        toolName: 'read_files',
        ok: true
      }
    ]),
    [
      { type: 'function_call_output', call_id: 'call_img', output: 'image_attached: true' },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Images attached from tool result read_files (call_img).' },
          { type: 'input_image', image_url: 'data:image/png;base64,aW1nMQ==' },
          { type: 'input_image', image_url: 'data:image/jpeg;base64,aW1nMg==' }
        ]
      },
      { type: 'function_call_output', call_id: 'call_plain', output: 'plain' }
    ]
  );
});

test('convertTranscriptToOpenAiInput maps image attachments from user records', () => {
  assert.deepEqual(
    convertTranscriptToOpenAiInput([
      {
        role: 'user',
        text: '看 @image.png',
        attachments: [{ kind: 'image', mediaType: 'image/png', dataBase64: 'aW1n', path: 'image.png', sizeBytes: 3 }]
      }
    ]),
    [{
      role: 'user',
      content: [
        { type: 'input_text', text: '看 @image.png' },
        { type: 'input_image', image_url: 'data:image/png;base64,aW1n' }
      ]
    }]
  );
});

test('OpenAI tool converter maps definitions and extracts completed function calls', () => {
  assert.deepEqual(
    convertToolDefinitionsToOpenAiTools([
      { name: 'run_bash_command', description: 'Run bash', parameters: { type: 'object' } }
    ]),
    [
      {
        type: 'function',
        name: 'run_bash_command',
        description: 'Run bash',
        parameters: { type: 'object', additionalProperties: false },
        strict: true
      }
    ]
  );

  const semanticParameters = {
    type: 'object',
    additionalProperties: false,
    required: ['files'],
    properties: {
      files: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path'],
          properties: {
            path: { type: 'string' },
            offset: { type: 'number' },
            limit: { type: 'number' }
          }
        }
      },
      format: { type: 'string' }
    }
  };
  const [strictTool] = convertToolDefinitionsToOpenAiTools([
    { name: 'read_files', description: 'Read files', parameters: semanticParameters }
  ]);

  assert.deepEqual(strictTool.parameters.required, ['files', 'format']);
  assert.equal(strictTool.parameters.additionalProperties, false);
  assert.deepEqual(strictTool.parameters.properties.files.items.required, ['path', 'offset', 'limit']);
  assert.equal(strictTool.parameters.properties.files.items.additionalProperties, false);
  assert.deepEqual(strictTool.parameters.properties.files.items.properties.offset.type, ['number', 'null']);
  assert.deepEqual(strictTool.parameters.properties.files.items.properties.limit.type, ['number', 'null']);
  assert.deepEqual(strictTool.parameters.properties.format.type, ['string', 'null']);
  assert.deepEqual(semanticParameters.required, ['files']);
  assert.deepEqual(semanticParameters.properties.files.items.required, ['path']);

  const [mcpTool] = convertToolDefinitionsToOpenAiTools([
    {
      name: 'mcp__filesystem__read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        $schema: 'http://json-schema.org/draft-07/schema#',
        properties: {
          path: {type: 'string', format: 'uri', default: 'https://example.com'}
        },
        required: ['path']
      }
    }
  ]);

  assert.deepEqual(mcpTool.parameters, {
    type: 'object',
    properties: {
      path: {type: 'string'}
    },
    required: ['path'],
    additionalProperties: false
  });

  assert.deepEqual(
    extractFunctionToolCall({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'call_1',
        name: 'run_bash_command',
        arguments: '{"command":"pwd"}'
      }
    }),
    {
      callId: 'call_1',
      toolName: 'run_bash_command',
      argumentsText: '{"command":"pwd"}'
    }
  );
  assert.equal(extractFunctionToolCall({ type: 'response.function_call_arguments.delta', delta: '{}' }), null);
  assert.equal(
    extractFunctionToolCall({
      type: 'response.function_call_arguments.done',
      item_id: 'fc_item_1',
      name: 'run_bash_command',
      arguments: '{"command":"pwd"}'
    }),
    null
  );
});

test('OpenAI provider agent reports function tool calls without executing tools', async () => {
  const requests = [];
  const client = {
    responses: {
      async create(request) {
        requests.push(request);
        return streamFrom([
          { type: 'response.output_text.delta', delta: 'I will inspect.' },
          {
            type: 'response.output_item.done',
            item: {
              type: 'function_call',
              call_id: 'call_1',
              name: 'run_bash_command',
              arguments: '{"command":"pwd"}'
            }
          },
          { type: 'response.completed' }
        ]);
      }
    }
  };
  const agent = createOpenAiAgent({
    createClient() {
      return client;
    }
  });
  const toolRegistry = createToolRegistry();
  agent.initialize(TEST_CONFIG, toolRegistry);
  const result = await agent.runTurn([{ role: 'user', text: 'where am I?' }], {});

  assert.deepEqual(result, {
    draft: 'I will inspect.',
    toolCalls: [{ callId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' }],
    usageInputTokens: undefined
  });
  assert.deepEqual(requests[0], {
    input: [{ role: 'user', content: 'where am I?' }],
    model: 'test-model',
    prompt_cache_key: createPromptCacheKey([{ role: 'user', text: 'where am I?' }], TEST_CONFIG, toolRegistry.listDefinitions()),
    stream: true,
    tools: [
      {
        type: 'function',
        name: 'run_bash_command',
        description: 'Run bash',
        parameters: { type: 'object', additionalProperties: false },
        strict: true
      }
    ]
  });
});

test('OpenAI provider agent returns reasoning summary and private reasoning records', async () => {
  const reasoningItem = {
    id: 'rs_1',
    type: 'reasoning',
    encrypted_content: 'encrypted-reasoning',
    summary: [{ type: 'summary_text', text: 'I need a shell check.' }]
  };
  const harness = createHarness([
    { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 1, delta: 'second' },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'fir' },
    { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, text: 'first' },
    { type: 'response.reasoning_text.delta', delta: 'raw hidden reasoning' },
    { type: 'response.output_item.done', item: reasoningItem },
    {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'call_1',
        name: 'run_bash_command',
        arguments: '{"command":"pwd"}'
      }
    },
    { type: 'response.completed' }
  ]);

  const result = await harness.runTurn([{ role: 'user', text: 'where am I?' }], {});

  assert.deepEqual(result, {
    draft: '',
    providerRecords: [{ role: 'openai_reasoning', text: '', provider: 'openai', item: reasoningItem }],
    reasoningSummary: 'first\n\nsecond',
    toolCalls: [{ callId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' }],
    usageInputTokens: undefined
  });
});

test('OpenAI provider agent does not continue non-portable reasoning ids', async () => {
  const harness = createHarness([
    {
      type: 'response.output_item.done',
      item: {
        id: 'rs_missing_later',
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'No encrypted payload.' }]
      }
    },
    { type: 'response.completed' }
  ]);

  const result = await harness.runTurn([{ role: 'user', text: 'hello' }], {});

  assert.deepEqual(result, {
    draft: '',
    toolCalls: [],
    usageInputTokens: undefined
  });
});
