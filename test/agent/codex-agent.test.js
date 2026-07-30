const test = require('node:test');
const assert = require('node:assert/strict');

const { mock } = test;
const { createCodexAgent, createCodexRequest } = require('../../src/agent/codex/agent');
const { createPromptCacheKey } = require('../../src/agent/prompt-cache');

const TEST_CONFIG = {
  agentType: 'codex',
  apiKey: '',
  baseURL: 'https://chatgpt.com/backend-api/codex',
  codexOAuth: {authFilePath: '/tmp/codex-auth.json'},
  model: 'test-model',
  tools: {
    bash: {
      timeoutMs: null,
      maxOutputBytes: 65536
    }
  }
};
const RETRYABLE_PROCESSING_ERROR = 'An error occurred while processing your request. You can retry your request';
const RESPONSE_STREAM_RETRY_TEST_DELAYS_MS = [1000, 2000, 4000];

async function flushPendingAsyncWork() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

async function runWithMockedRetryTimers(action, retryDelaysMs) {
  mock.timers.enable({apis: ['setTimeout']});

  try {
    const promise = action();

    for (const delayMs of retryDelaysMs) {
      await flushPendingAsyncWork();
      mock.timers.tick(delayMs);
    }

    return await promise;
  } finally {
    mock.timers.reset();
  }
}

async function* streamFrom(events) {
  for (const event of events) {
    if (event instanceof Error) {
      throw event;
    }

    yield event;
  }
}

function createRetryableStreamError(requestId) {
  return new Error(`${RETRYABLE_PROCESSING_ERROR}, or contact support with request ID ${requestId}.`);
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

test('createCodexAgent resolves OAuth credential for each provider turn', async () => {
  const clientConfigs = [];
  const requests = [];
  const agent = createCodexAgent(
    {...TEST_CONFIG, headers: {'x-source': 'echo-tui'}},
    createEmptyToolRegistry(),
    {
      createClient(config) {
        clientConfigs.push(config);
        return {
          responses: {
            async create(request) {
              requests.push(request);
              return streamFrom([
                {type: 'response.output_text.delta', delta: 'ok'},
                {type: 'response.completed'}
              ]);
            }
          }
        };
      },
      async resolveCodexOAuthCredential(config) {
        assert.deepEqual(config, {authFilePath: '/tmp/codex-auth.json'});
        return {accessToken: 'access-token', accountId: 'acct-123'};
      }
    }
  );

  assert.equal(clientConfigs.length, 0);

  const result = await agent.runTurn([{role: 'user', text: 'hello'}], {});

  assert.deepEqual(result, {draft: 'ok', toolCalls: [], usageInputTokens: undefined});
  assert.equal(clientConfigs.length, 1);
  assert.equal(clientConfigs[0].apiKey, 'access-token');
  assert.equal(clientConfigs[0].baseURL, 'https://chatgpt.com/backend-api/codex');
  assert.deepEqual(clientConfigs[0].headers, {
    'x-source': 'echo-tui',
    'OpenAI-Beta': 'responses=experimental',
    originator: 'echo-tui',
    'ChatGPT-Account-ID': 'acct-123'
  });
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].instructions, 'You are a helpful assistant.');
  assert.deepEqual(requests[0].text, {verbosity: 'low'});
  assert.deepEqual(requests[0].include, ['reasoning.encrypted_content']);
});

test('createCodexAgent retries a transient stream error with one OAuth runtime client', async () => {
  let attempts = 0;
  let credentialReads = 0;
  const clientConfigs = [];
  const requests = [];
  const agent = createCodexAgent(TEST_CONFIG, createEmptyToolRegistry(), {
    createClient(config) {
      clientConfigs.push(config);
      return {
        responses: {
          async create(request) {
            requests.push(request);
            attempts += 1;
            return streamFrom(attempts === 1
              ? [createRetryableStreamError('first-codex-request')]
              : [{type: 'response.output_text.delta', delta: 'recovered'}, {type: 'response.completed'}]);
          }
        }
      };
    },
    async resolveCodexOAuthCredential() {
      credentialReads += 1;
      return {accessToken: 'access-token', accountId: 'acct-123'};
    }
  });

  const result = await runWithMockedRetryTimers(
    () => agent.runTurn([{role: 'user', text: 'hello'}], {}),
    [RESPONSE_STREAM_RETRY_TEST_DELAYS_MS[0]]
  );

  assert.deepEqual(result, {draft: 'recovered', toolCalls: [], usageInputTokens: undefined});
  assert.equal(credentialReads, 1);
  assert.equal(clientConfigs.length, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
});

test('createCodexAgent stops after three retries and does not retry compaction streams', async () => {
  let attempts = 0;
  const retryAgent = createCodexAgent(TEST_CONFIG, createEmptyToolRegistry(), {
    createClient() {
      return {
        responses: {
          async create() {
            attempts += 1;
            return streamFrom([createRetryableStreamError(attempts <= 3 ? `retry-codex-request-${attempts}` : 'final-codex-request')]);
          }
        }
      };
    },
    async resolveCodexOAuthCredential() {
      return {accessToken: 'access-token'};
    }
  });

  await assert.rejects(
    () => runWithMockedRetryTimers(
      () => retryAgent.runTurn([{role: 'user', text: 'hello'}], {}),
      RESPONSE_STREAM_RETRY_TEST_DELAYS_MS
    ),
    /final-codex-request/
  );
  assert.equal(attempts, 4);

  let compactionAttempts = 0;
  const compactionAgent = createCodexAgent(TEST_CONFIG, createEmptyToolRegistry(), {
    createClient() {
      return {
        responses: {
          async create() {
            compactionAttempts += 1;
            return streamFrom([createRetryableStreamError('compaction-codex-request')]);
          }
        }
      };
    },
    async resolveCodexOAuthCredential() {
      return {accessToken: 'access-token'};
    }
  });

  await assert.rejects(
    () => compactionAgent.runTurn([{role: 'user', text: 'summarize'}], {}, {isCompaction: true}),
    /compaction-codex-request/
  );
  assert.equal(compactionAttempts, 1);
});

test('createCodexRequest shapes payload for ChatGPT Codex backend', () => {
  const records = [
    {role: 'system', text: '你是助手'},
    {role: 'user', text: 'hello'}
  ];
  const toolRegistry = createToolRegistry();

  assert.deepEqual(
    createCodexRequest(records, TEST_CONFIG, toolRegistry),
    {
      input: [{role: 'user', content: 'hello'}],
      model: 'test-model',
      prompt_cache_key: createPromptCacheKey(records, TEST_CONFIG, toolRegistry.listDefinitions()),
      stream: true,
      store: false,
      instructions: '你是助手',
      text: {verbosity: 'low'},
      include: ['reasoning.encrypted_content'],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      tools: [
        {
          type: 'function',
          name: 'run_bash_command',
          description: 'Run bash',
          parameters: {type: 'object', additionalProperties: false}
        }
      ]
    }
  );
});

test('createCodexRequest sends reasoning effort when configured', () => {
  const records = [{role: 'user', text: 'hello'}];

  assert.deepEqual(
    createCodexRequest(records, {...TEST_CONFIG, reasoningEffort: 'high'}, createEmptyToolRegistry()),
    {
      input: [{role: 'user', content: 'hello'}],
      model: 'test-model',
      prompt_cache_key: createPromptCacheKey(records, {...TEST_CONFIG, reasoningEffort: 'high'}, []),
      stream: true,
      store: false,
      instructions: 'You are a helpful assistant.',
      text: {verbosity: 'low'},
      include: ['reasoning.encrypted_content'],
      reasoning: {effort: 'high'}
    }
  );
});

test('createCodexRequest omits tools and reasoning for compaction requests', () => {
  const records = [{role: 'system', text: 'compress'}, {role: 'user', text: 'summarize'}];
  const config = {...TEST_CONFIG, reasoningEffort: 'high'};
  const request = createCodexRequest(records, config, createToolRegistry(), {isCompaction: true});

  assert.deepEqual(request, {
    input: [{role: 'user', content: 'summarize'}],
    model: 'test-model',
    prompt_cache_key: createPromptCacheKey(records, config),
    stream: true,
    store: false,
    instructions: 'compress',
    text: {verbosity: 'low'}
  });
  assert.equal('include' in request, false);
  assert.equal('reasoning' in request, false);
  assert.equal('tools' in request, false);
  assert.equal('tool_choice' in request, false);
  assert.equal('parallel_tool_calls' in request, false);
});
