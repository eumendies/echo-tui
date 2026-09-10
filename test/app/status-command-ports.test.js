const {test} = require('node:test');
const assert = require('node:assert/strict');

const {createStatusCommandPorts} = require('../../src/app/command/status-command-ports');

function createPorts(config, options = {}) {
  return createStatusCommandPorts({
    appContext: {
      modelContext: {
        createActiveLlmConfig() {
          return config;
        }
      }
    },
    usageStore: {listDailyUsage: () => []},
    userConfigContext: {},
    ...options
  });
}

function createOkResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  };
}

const USAGE_PAYLOAD = {
  usage: {
    rolling: {status: 'ok', percent: 3, resetsAt: '2026-09-10T10:09:43.223Z'}
  }
};

test('queryOpencodeUsage returns unavailable with the active config error and never fetches', async (t) => {
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    return createOkResponse(USAGE_PAYLOAD);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const ports = createPorts({error: '模型配置错误'});
  const result = await ports.status.queryOpencodeUsage();

  assert.deepEqual(result, {status: 'unavailable', error: '模型配置错误'});
  assert.equal(fetchCalls.length, 0);
});

test('queryOpencodeUsage gates non-opencode base urls without any request', async (t) => {
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    return createOkResponse(USAGE_PAYLOAD);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  for (const baseURL of [undefined, 'https://api.deepseek.com/v1', 'https://opencode.ai/zen/v1']) {
    const ports = createPorts({agentType: 'openai-chat', apiKey: 'k', baseURL});
    const result = await ports.status.queryOpencodeUsage();
    assert.deepEqual(result, {status: 'not_applicable'});
  }

  assert.equal(fetchCalls.length, 0);
});

test('queryOpencodeUsage passes through the normalized usage on opencode-go base urls', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createOkResponse(USAGE_PAYLOAD);
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const ports = createPorts({agentType: 'openai-chat', apiKey: 'oc-secret', baseURL: 'https://opencode.ai/zen/go/v1/responses'});
  const result = await ports.status.queryOpencodeUsage();

  assert.deepEqual(result, {
    status: 'available',
    windows: [{name: 'rolling', status: 'ok', percent: 3, resetsAtMs: Date.parse('2026-09-10T10:09:43.223Z')}]
  });
});

test('queryOpencodeUsage degrades fetch failures to a redacted unavailable state', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Authorization: Bearer oc-secret-key');
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const ports = createPorts({agentType: 'openai-chat', apiKey: 'oc-secret', baseURL: 'https://opencode.ai/zen/go/v1'});
  const result = await ports.status.queryOpencodeUsage();

  assert.equal(result.status, 'unavailable');
  assert.doesNotMatch(result.error, /oc-secret-key/u);
  assert.match(result.error, /<redacted>/u);
});
