const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSessionTitleGenerator,
  normalizeSessionTitle,
  parseSessionTitle,
  SESSION_TITLE_MAX_CHARS
} = require('../../src/app/session-title-generator');
const {splitGraphemes} = require('../../src/input/graphemes');

function createConfig(overrides = {}) {
  return {
    agentType: 'openai',
    apiKey: 'secret',
    model: 'gpt-title',
    contextWindow: 128000,
    tools: {
      autoCompressImages: true,
      bash: {timeoutMs: null, maxOutputBytes: 65536},
      sandbox: {mode: 'off', network: false, extraWritablePaths: []}
    },
    ...overrides
  };
}

function createSnapshot(options = {}) {
  const calls = [];

  return {
    calls,
    snapshot: {
      getAppSettings() {
        return {
          ...(options.enabled === false ? {titleGenerationEnabled: false} : {}),
          ...(options.profileId ? {titleGenerationModelProfileId: options.profileId} : {})
        };
      },
      resolveLlmConfig(resolveOptions) {
        calls.push({kind: 'default', options: resolveOptions});
        return options.defaultConfig || createConfig();
      },
      resolveLlmConfigForProfile(profileId) {
        calls.push({kind: 'profile', profileId});

        if (options.profileConfigError) {
          throw options.profileConfigError;
        }

        return options.profileConfig || createConfig({model: 'haiku'});
      }
    }
  };
}

function createAgent(handler) {
  return {
    runTurn(records, _callbacks, turnOptions) {
      return handler(records, turnOptions);
    }
  };
}

test('session title normalization strips quotes, collapses whitespace, and drops trailing punctuation', () => {
  assert.equal(normalizeSessionTitle('  "修复登录按钮。"  '), '修复登录按钮');
  assert.equal(normalizeSessionTitle('`Debug   failing\n CI tests!`'), 'Debug failing CI tests');
  assert.equal(normalizeSessionTitle('“优化 undo 机制？”'), '优化 undo 机制');
  assert.equal(normalizeSessionTitle('   '), null);
  assert.equal(normalizeSessionTitle('""'), null);
});

test('session title normalization truncates by grapheme without splitting emoji sequences', () => {
  const emojiTitle = '👨‍👩‍👧'.repeat(SESSION_TITLE_MAX_CHARS + 20);
  const normalized = normalizeSessionTitle(emojiTitle);

  assert.equal(splitGraphemes(normalized).length, SESSION_TITLE_MAX_CHARS);
  assert.ok(normalized.includes('👨‍👩‍👧'));
  assert.equal(normalized.includes('\uFFFD'), false);
});

test('session title parsing prefers the JSON title field and falls back to plain text', () => {
  assert.equal(parseSessionTitle('{"title": "Add OAuth authentication"}'), 'Add OAuth authentication');
  assert.equal(parseSessionTitle('```json\n{"title": "Fix login bug"}\n```'), 'Fix login bug');
  assert.equal(parseSessionTitle('Refactor API client'), 'Refactor API client');
  assert.equal(parseSessionTitle('{not json'), '{not json');
  assert.equal(parseSessionTitle(''), null);
  assert.equal(parseSessionTitle('{"title": "   "}'), null);
  // 多段 JSON 或带解释文字时只取首个对象，不应因贪婪匹配整体失败。
  assert.equal(parseSessionTitle('{"title": "first"} {"title": "second"}'), 'first');
  assert.equal(parseSessionTitle('Here you go: {"title": "OAuth login"}'), 'OAuth login');
});

test('session title generator uses the current model with low effort when no profile is configured', async () => {
  const {snapshot, calls} = createSnapshot();
  let capturedConfig;
  let capturedRecords;
  const generate = createSessionTitleGenerator({
    createAgent(config) {
      capturedConfig = config;
      return createAgent((records) => {
        capturedRecords = records;
        return Promise.resolve({draft: '{"title": "生成的标题"}', toolCalls: []});
      });
    }
  });

  const title = await generate({firstUserMessage: '帮我看看这个', userConfigSnapshot: snapshot});

  assert.equal(title, '生成的标题');
  assert.deepEqual(calls, [{kind: 'default', options: {reasoningEffortOverride: 'low'}}]);
  assert.equal(capturedConfig.reasoningEffort, 'low');
  assert.deepEqual(capturedRecords.map((record) => record.role), ['system', 'user']);
  assert.equal(capturedRecords[1].text, '帮我看看这个');
  assert.equal(capturedConfig.reasoningSummary, undefined);
});

test('session title generator strictly resolves a configured profile and still forces low effort', async () => {
  const {snapshot, calls} = createSnapshot({
    profileId: 'title-model',
    profileConfig: createConfig({model: 'haiku', reasoningEffort: 'high', reasoningSummary: 'detailed'})
  });
  let capturedConfig;
  const generate = createSessionTitleGenerator({
    createAgent(config) {
      capturedConfig = config;
      return createAgent(() => Promise.resolve({draft: '标题', toolCalls: []}));
    }
  });

  const title = await generate({firstUserMessage: 'inspect', userConfigSnapshot: snapshot});

  assert.equal(title, '标题');
  assert.deepEqual(calls, [{kind: 'profile', profileId: 'title-model'}]);
  assert.equal(capturedConfig.model, 'haiku');
  assert.equal(capturedConfig.reasoningEffort, 'low');
  assert.equal(capturedConfig.reasoningSummary, undefined);
});

test('session title generator fails closed when the configured profile is invalid', async () => {
  const {snapshot, calls} = createSnapshot({
    profileId: 'missing',
    profileConfigError: new Error('profile not found')
  });
  let agentCreated = false;
  const generate = createSessionTitleGenerator({
    createAgent() {
      agentCreated = true;
      return createAgent(() => Promise.resolve({draft: '标题', toolCalls: []}));
    }
  });

  const title = await generate({firstUserMessage: 'inspect', userConfigSnapshot: snapshot});

  assert.equal(title, null);
  assert.equal(agentCreated, false);
  assert.deepEqual(calls.map((call) => call.kind), ['profile']);
});

test('session title generator ignores tool calls and empty messages without calling the provider', async () => {
  let providerCalls = 0;
  const generate = createSessionTitleGenerator({
    createAgent() {
      return createAgent(() => {
        providerCalls += 1;
        return Promise.resolve({draft: 'ignored', toolCalls: [{name: 'read_file'}]});
      });
    }
  });

  const {snapshot} = createSnapshot();

  assert.equal(await generate({firstUserMessage: '   ', userConfigSnapshot: snapshot}), null);
  assert.equal(providerCalls, 0);
  assert.equal(await generate({firstUserMessage: 'inspect', userConfigSnapshot: snapshot}), null);
  assert.equal(providerCalls, 1);
});

test('session title generator returns null when the provider times out', async () => {
  const generate = createSessionTitleGenerator({
    timeoutMs: 5,
    createAgent: () => createAgent(() => new Promise(() => {}))
  });
  const {snapshot} = createSnapshot();

  assert.equal(await generate({firstUserMessage: 'inspect', userConfigSnapshot: snapshot}), null);
});

test('session title generator stays inert when title generation is disabled', async () => {
  const {snapshot, calls} = createSnapshot({enabled: false});
  let agentCreated = false;
  const generate = createSessionTitleGenerator({
    createAgent() {
      agentCreated = true;
      return createAgent(() => Promise.resolve({draft: '不应生成', toolCalls: []}));
    }
  });

  assert.equal(await generate({firstUserMessage: 'inspect', userConfigSnapshot: snapshot}), null);
  assert.equal(agentCreated, false);
  assert.deepEqual(calls, []);
});
