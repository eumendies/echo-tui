const test = require('node:test');
const assert = require('node:assert/strict');

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
      timeoutMs: 30000,
      maxOutputBytes: 65536
    }
  }
};

async function* streamFrom(events) {
  for (const event of events) {
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

test('createCodexAgent resolves OAuth credential for each provider turn', async () => {
  const clientConfigs = [];
  const requests = [];
  const agent = createCodexAgent({
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
  });

  agent.initialize({...TEST_CONFIG, headers: {'x-source': 'echo-tui'}}, createEmptyToolRegistry());
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
