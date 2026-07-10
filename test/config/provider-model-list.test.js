const test = require('node:test');
const assert = require('node:assert/strict');

const { listProviderModels, resolveProviderConnection } = require('../../src/config/provider-model-list');

function createProvider(overrides = {}) {
  return {
    id: 'chat',
    label: 'Chat',
    preset: 'openai-chat-compatible-api',
    apiKey: 'chat-api-key',
    baseURL: 'https://chat.example/v1',
    headers: {'x-source': 'echo-tui'},
    models: [],
    ...overrides
  };
}

test('listProviderModels lists OpenAI-compatible models with baseURL and headers', async () => {
  let clientOptions;
  class FakeOpenAIClient {
    constructor(options) {
      clientOptions = options;
      this.models = {
        list: async () => ({data: [{id: 'gpt-4o'}, {model: 'fallback-model'}, {id: 'gpt-4o'}, {id: ''}]})
      };
    }
  }

  const result = await listProviderModels(createProvider(), {OpenAIClient: FakeOpenAIClient});

  assert.deepEqual(result, {ok: true, models: [{id: 'gpt-4o'}, {id: 'fallback-model'}]});
  assert.equal(clientOptions.apiKey, 'chat-api-key');
  assert.equal(clientOptions.baseURL, 'https://chat.example/v1');
  assert.deepEqual(clientOptions.defaultHeaders, {'x-source': 'echo-tui'});
});

test('listProviderModels uses fixed Xiaomi Mimo baseURL', async () => {
  let clientOptions;
  class FakeOpenAIClient {
    constructor(options) {
      clientOptions = options;
      this.models = {list: async () => ({data: [{id: 'mimo-model'}]})};
    }
  }

  const result = await listProviderModels(createProvider({
    preset: 'xiaomi-mimo-token-plan',
    baseURL: 'https://ignored.example/v1'
  }), {OpenAIClient: FakeOpenAIClient});

  assert.deepEqual(result, {ok: true, models: [{id: 'mimo-model'}]});
  assert.equal(clientOptions.baseURL, 'https://token-plan-cn.xiaomimimo.com/v1');
});

test('listProviderModels lists Anthropic-compatible models', async () => {
  let clientOptions;
  let listParams;
  class FakeAnthropicClient {
    constructor(options) {
      clientOptions = options;
      this.models = {
        list: async (params) => {
          listParams = params;
          return {data: [{id: 'claude-sonnet-4'}]};
        }
      };
    }
  }

  const result = await listProviderModels(createProvider({
    preset: 'anthropic-compatible-api',
    apiKey: 'anthropic-key',
    baseURL: undefined,
    headers: undefined
  }), {AnthropicClient: FakeAnthropicClient});

  assert.deepEqual(result, {ok: true, models: [{id: 'claude-sonnet-4'}]});
  assert.equal(clientOptions.apiKey, 'anthropic-key');
  assert.deepEqual(listParams, {limit: 100});
});

test('listProviderModels lists Codex OAuth models with bearer token and account header', async () => {
  let requestedUrl;
  let requestHeaders;
  const result = await listProviderModels(createProvider({
    preset: 'openai-codex-oauth',
    apiKey: '',
    codexAuthFile: '/tmp/codex-auth.json',
    headers: undefined
  }), {
    resolveCodexOAuthCredential: async (config) => {
      assert.deepEqual(config, {authFilePath: '/tmp/codex-auth.json'});
      return {accessToken: 'access-token', accountId: 'acct-123'};
    },
    fetch: async (url, options) => {
      requestedUrl = url;
      requestHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          models: [
            {slug: 'gpt-5.5', visibility: 'list'},
            {slug: 'hidden-model', visibility: 'hidden'},
            {id: 'fallback-id', visibility: 'list'},
            {slug: 'gpt-5.5', visibility: 'list'}
          ]
        })
      };
    }
  });

  assert.deepEqual(result, {ok: true, models: [{id: 'gpt-5.5'}, {id: 'fallback-id'}]});
  assert.equal(requestedUrl, 'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0');
  assert.equal(requestHeaders.Authorization, 'Bearer access-token');
  assert.equal(requestHeaders['ChatGPT-Account-ID'], 'acct-123');
});

test('listProviderModels handles empty Codex OAuth model list', async () => {
  const result = await listProviderModels(createProvider({
    preset: 'openai-codex-oauth',
    apiKey: ''
  }), {
    resolveCodexOAuthCredential: async () => ({accessToken: 'access-token'}),
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({models: []})
    })
  });

  assert.deepEqual(result, {ok: true, models: []});
});

test('listProviderModels reports Codex OAuth auth failures with redaction', async () => {
  const result = await listProviderModels(createProvider({
    preset: 'openai-codex-oauth',
    apiKey: ''
  }), {
    resolveCodexOAuthCredential: async () => {
      throw new Error('refresh_token=refresh-secret');
    },
    fetch: async () => {
      throw new Error('should not fetch');
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
  assert.doesNotMatch(result.error, /refresh-secret/);
  assert.match(result.error, /<redacted>/);
});

test('listProviderModels reports Codex OAuth network and invalid JSON failures', async () => {
  const provider = createProvider({preset: 'openai-codex-oauth', apiKey: ''});
  const auth = {resolveCodexOAuthCredential: async () => ({accessToken: 'access-token'})};
  const networkFailure = await listProviderModels(provider, {
    ...auth,
    fetch: async () => {
      throw new Error('network unavailable');
    }
  });
  const invalidJson = await listProviderModels(provider, {
    ...auth,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => 'not-json'
    })
  });

  assert.equal(networkFailure.ok, false);
  assert.match(networkFailure.error, /network unavailable/);
  assert.equal(invalidJson.ok, false);
  assert.match(invalidJson.error, /Unexpected token/);
});

test('listProviderModels reports Codex OAuth HTTP failures with redaction', async () => {
  const result = await listProviderModels(createProvider({
    preset: 'openai-codex-oauth',
    apiKey: ''
  }), {
    resolveCodexOAuthCredential: async () => ({accessToken: 'access-secret'}),
    fetch: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({error: 'unauthorized', access_token: 'access-secret'})
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
  assert.doesNotMatch(result.error, /access-secret/);
  assert.match(result.error, /<redacted>/);
});

test('listProviderModels validates draft fields before network calls', async () => {
  let didConstruct = false;
  class FakeOpenAIClient {
    constructor() {
      didConstruct = true;
    }
  }

  const result = await listProviderModels(createProvider({apiKey: ''}), {OpenAIClient: FakeOpenAIClient});

  assert.deepEqual(result, {ok: false, reason: 'invalid', error: 'provider Chat 缺少 API key'});
  assert.equal(didConstruct, false);
});

test('listProviderModels redacts provider secrets in failures', async () => {
  class FakeOpenAIClient {
    constructor() {
      this.models = {
        list: async () => {
          throw new Error('Authorization: Bearer secret-api-key x-api-key: gateway-secret hidden-header');
        }
      };
    }
  }

  const result = await listProviderModels(createProvider({
    apiKey: 'secret-api-key',
    headers: {'x-source': 'hidden-header'}
  }), {OpenAIClient: FakeOpenAIClient});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
  assert.doesNotMatch(result.error, /secret-api-key/);
  assert.doesNotMatch(result.error, /gateway-secret/);
  assert.doesNotMatch(result.error, /hidden-header/);
  assert.match(result.error, /<redacted>/);
});

test('resolveProviderConnection exposes OpenAI model listing metadata', () => {
  const connection = resolveProviderConnection(createProvider());

  assert.equal('ok' in connection, false);
  assert.equal(connection.listKind, 'openai');
});

test('resolveProviderConnection allows Codex OAuth without API key', () => {
  const connection = resolveProviderConnection(createProvider({preset: 'openai-codex-oauth', apiKey: ''}));

  assert.equal('ok' in connection, false);
  assert.equal(connection.listKind, 'codex');
});
