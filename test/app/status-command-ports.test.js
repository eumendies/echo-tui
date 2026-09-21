const {test} = require('node:test');
const assert = require('node:assert/strict');

const {createStatusCommandPorts, createStatusSnapshot} = require('../../src/app/command/status-command-ports');

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

test('createStatusSnapshot copies current compaction and todo state without retaining context references', () => {
  const compaction = {
    summaryText: '当前压缩摘要',
    activeStartIndex: 7,
    createdAt: '2030-01-02T03:04:00.000Z'
  };
  const todoState = {
    updatedAt: '2030-01-02T03:05:00.000Z',
    items: [{id: 'todo-1', text: '查看 status', status: 'open'}]
  };
  const snapshot = createStatusSnapshot({
    getCurrentCwd() {
      return process.cwd();
    },
    getInteractionMode() {
      return 'normal';
    },
    modelContext: {
      createStatusInfo() {
        return {agentType: 'fake', model: 'echo-fake-agent', provider: 'fake'};
      }
    },
    transcriptContext: {
      getCurrentSessionId() {
        return 'session-1';
      },
      compaction,
      todoState
    }
  }, {
    capture() {
      return {
        getAppSettings() {
          return {agentInstructionFileName: 'AGENTS.md'};
        },
        getSandboxToolConfig() {
          return {mode: 'off'};
        }
      };
    }
  });

  assert.deepEqual(snapshot.compaction, compaction);
  assert.deepEqual(snapshot.todoState, todoState);
  assert.notEqual(snapshot.compaction, compaction);
  assert.notEqual(snapshot.todoState, todoState);
  assert.notEqual(snapshot.todoState.items, todoState.items);

  compaction.summaryText = '已变更';
  todoState.items[0].text = '已变更';
  assert.equal(snapshot.compaction.summaryText, '当前压缩摘要');
  assert.equal(snapshot.todoState.items[0].text, '查看 status');
});

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
