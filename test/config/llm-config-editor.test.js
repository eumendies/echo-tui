const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LlmConfigEditorError,
  normalizeConfigDraft,
  validateConfigDraft
} = require('../../src/config/llm-config-editor');
const {UserConfigContext} = require('../../src/config/user-config-context');

function withContext(options, read) {
  const context = new UserConfigContext(options);
  try {
    return read(context);
  } finally {
    context.close();
  }
}

function readLlmConfigDraft(options = {}) {
  return withContext(options, (context) => context.capture().getLlmConfigDraft());
}

function saveLlmConfigDraft(draft, options = {}) {
  return withContext(options, (context) => context.saveLlmConfigDraft(draft));
}

function readConfigFrom(value) {
  return () => value;
}

function readConfigError(code) {
  return () => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };
}

test('readLlmConfigDraft returns empty draft when config file is missing', () => {
  const draft = readLlmConfigDraft({
    configPath: '/tmp/echo/config.json',
    readFile: readConfigError('ENOENT')
  });

  assert.deepEqual(draft, {
    providers: [],
    selectedModelId: undefined,
    rootConfig: {}
  });
});

test('readLlmConfigDraft reads preset providers and model drafts', () => {
  const draft = readLlmConfigDraft({
    configPath: '/tmp/echo/config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'chat-gpt-4o',
        providers: {
          chat: {
            label: 'Chat Gateway',
            preset: 'openai-chat-compatible-api',
            apiKey: 'chat-api-key',
            baseURL: 'https://chat.example/v1',
            headers: {'x-source': 'echo-tui'}
          }
        },
        models: [
          {
            id: 'chat-gpt-4o',
            provider: 'chat',
            model: 'gpt-4o',
            contextWindow: 128000,
            reasoning: {effort: 'none', summary: 'auto'}
          }
        ]
      },
      tools: {bash: {timeoutMs: 2000}}
    }))
  });

  assert.equal(draft.providers[0].id, 'chat');
  assert.equal(draft.providers[0].label, 'Chat Gateway');
  assert.equal(draft.providers[0].preset, 'openai-chat-compatible-api');
  assert.deepEqual(draft.providers[0].headers, {'x-source': 'echo-tui'});
  assert.equal(draft.providers[0].models[0].model, 'gpt-4o');
  assert.equal(draft.providers[0].models[0].contextWindow, 128000);
  assert.deepEqual(draft.providers[0].models[0].reasoning, {effort: 'none', summary: 'auto'});
  assert.equal(draft.selectedModelId, 'chat-gpt-4o');
  assert.deepEqual(draft.rootConfig.tools, {bash: {timeoutMs: 2000}});
});

test('readLlmConfigDraft preserves unknown presets for repair while validation rejects saving them', () => {
  const draft = readLlmConfigDraft({
    configPath: '/tmp/echo/config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'future-model',
        providers: {
          future: {
            label: 'Future Provider',
            preset: 'future-provider-preset',
            apiKey: 'future-api-key'
          }
        },
        models: [
          {id: 'future-model', provider: 'future', model: 'future-model-name'}
        ]
      }
    }))
  });

  assert.equal(draft.providers[0].id, 'future');
  assert.equal(draft.providers[0].preset, 'future-provider-preset');
  assert.deepEqual(draft.providers[0].models, [{id: 'future-model', model: 'future-model-name'}]);
  assert.equal(draft.selectedModelId, 'future-model');
  assert.deepEqual(validateConfigDraft(draft), {
    ok: false,
    error: 'provider Future Provider 的 preset 不存在：future-provider-preset'
  });
});

test('readLlmConfigDraft rejects non-object config roots', () => {
  assert.throws(
    () => readLlmConfigDraft({
      configPath: '/tmp/echo/config.json',
      readFile: readConfigFrom('[]')
    }),
    /LLM 配置文件根节点必须是对象/
  );
});

test('normalizeConfigDraft generates unique provider and model ids', () => {
  const draft = normalizeConfigDraft({
    providers: [
      {
        id: '',
        label: 'My Provider',
        preset: 'openai-responses-api',
        apiKey: 'key-1',
        models: [{id: '', model: 'gpt-4.1'}]
      },
      {
        id: '',
        label: 'My Provider',
        preset: 'openai-responses-api',
        apiKey: 'key-2',
        models: [{id: '', model: 'gpt-4.1'}]
      }
    ],
    rootConfig: {}
  });

  assert.deepEqual(draft.providers.map((provider) => provider.id), ['my-provider', 'my-provider-2']);
  assert.deepEqual(draft.providers.flatMap((provider) => provider.models.map((model) => model.id)), ['my-provider-gpt-4-1', 'my-provider-2-gpt-4-1']);
  assert.equal(draft.selectedModelId, 'my-provider-gpt-4-1');
});

test('validateConfigDraft catches provider and model errors', () => {
  assert.deepEqual(validateConfigDraft({providers: [], rootConfig: {}}), {ok: false, error: '至少需要配置一个 provider'});
  assert.deepEqual(validateConfigDraft({
    providers: [{id: 'bad', label: 'Bad', preset: 'missing', apiKey: 'key', models: [{id: 'bad-model', model: 'x'}]}],
    rootConfig: {}
  }), {ok: false, error: 'provider Bad 的 preset 不存在：missing'});
  assert.deepEqual(validateConfigDraft({
    providers: [{id: 'openai', label: 'OpenAI', preset: 'openai-responses-api', apiKey: '', models: [{id: 'model', model: 'gpt'}]}],
    rootConfig: {}
  }), {ok: false, error: 'provider OpenAI 缺少 API key'});
  assert.deepEqual(validateConfigDraft({
    providers: [{id: 'openai', label: 'OpenAI', preset: 'openai-responses-api', apiKey: 'key', models: []}],
    rootConfig: {}
  }), {ok: false, error: 'provider OpenAI 至少需要一个模型'});
});

test('validateConfigDraft accepts fake provider without API key', () => {
  assert.deepEqual(validateConfigDraft({
    providers: [{id: 'default', label: 'Fake Agent', preset: 'fake-agent', apiKey: '', models: [{id: 'default', model: 'echo-fake-agent'}]}],
    rootConfig: {}
  }), {ok: true});
});

test('validateConfigDraft accepts Codex OAuth provider without API key', () => {
  assert.deepEqual(validateConfigDraft({
    providers: [{
      id: 'codex',
      label: 'OpenAI Codex OAuth',
      preset: 'openai-codex-oauth',
      apiKey: '',
      codexAuthFile: '/tmp/codex-auth.json',
      models: [{id: 'codex-gpt', model: 'gpt-5.5'}]
    }],
    rootConfig: {}
  }), {ok: true});
});

test('validateConfigDraft validates context windows and headers without exposing values', () => {
  const baseProvider = {
    id: 'chat',
    label: 'Chat',
    preset: 'openai-chat-compatible-api',
    apiKey: 'key',
    models: [{id: 'chat-gpt', model: 'gpt-chat'}]
  };

  assert.match(validateConfigDraft({
    providers: [{...baseProvider, models: [{...baseProvider.models[0], contextWindow: 0}]}],
    rootConfig: {}
  }).error, /context window 必须是正整数/);

  assert.match(validateConfigDraft({
    providers: [{...baseProvider, headers: {'X-Test': 'secret', 'x-test': 'other-secret'}}],
    rootConfig: {}
  }).error, /重复 header/);

  const invalidValue = validateConfigDraft({
    providers: [{...baseProvider, headers: {'X-Test': 'secret\r\ninjected'}}],
    rootConfig: {}
  });
  assert.match(invalidValue.error, /value 无效/);
  assert.doesNotMatch(invalidValue.error, /secret|injected/);
});

test('saveLlmConfigDraft omits empty API key for fake provider', () => {
  const writes = [];

  saveLlmConfigDraft({
    providers: [{
      id: 'default',
      label: 'Fake Agent',
      preset: 'fake-agent',
      apiKey: '',
      models: [{id: 'default', model: 'echo-fake-agent'}]
    }],
    selectedModelId: 'default',
    rootConfig: {}
  }, {
    configPath: '/tmp/echo/config.json',
    createTempPath: (targetPath) => `${targetPath}.tmp-test`,
    mkdir() {},
    readFile: readConfigError('ENOENT'),
    writeFile(filePath, data) {
      writes.push([filePath, data]);
    },
    rename() {}
  });

  const saved = JSON.parse(writes[0][1]);

  assert.deepEqual(saved.llm.providers.default, {
    preset: 'fake-agent',
    label: 'Fake Agent'
  });
  assert.deepEqual(saved.llm.models, [{id: 'default', provider: 'default', model: 'echo-fake-agent'}]);
  assert.equal(saved.llm.selectedModel, 'default');
});

test('saveLlmConfigDraft preserves unrelated config and writes atomically', () => {
  const writes = [];
  const renames = [];
  const mkdirs = [];
  const rootConfig = {
    tools: {bash: {timeoutMs: 2000}},
    llm: {unknown: true}
  };

  saveLlmConfigDraft({
    providers: [{
      id: 'chat',
      label: 'Chat',
      preset: 'openai-chat-compatible-api',
      apiKey: 'chat-api-key',
      baseURL: 'https://chat.example/v1',
      headers: {'x-source': 'echo-tui'},
      models: [{
        id: 'chat-gpt',
        model: 'gpt-chat',
        contextWindow: 64000,
        reasoning: {effort: 'none', summary: 'auto'}
      }]
    }],
    selectedModelId: 'chat-gpt',
    rootConfig
  }, {
    configPath: '/tmp/echo/config.json',
    createTempPath: (targetPath) => `${targetPath}.tmp-test`,
    mkdir(dirPath, options) {
      mkdirs.push([dirPath, options]);
    },
    readFile: readConfigFrom(JSON.stringify(rootConfig)),
    writeFile(filePath, data) {
      writes.push([filePath, data]);
    },
    rename(oldPath, newPath) {
      renames.push([oldPath, newPath]);
    }
  });

  const saved = JSON.parse(writes[0][1]);

  assert.deepEqual(mkdirs, [['/tmp/echo', {recursive: true}]]);
  assert.equal(writes[0][0], '/tmp/echo/config.json.tmp-test');
  assert.deepEqual(renames, [['/tmp/echo/config.json.tmp-test', '/tmp/echo/config.json']]);
  assert.deepEqual(saved.tools, {bash: {timeoutMs: 2000}});
  assert.equal(saved.llm.unknown, true);
  assert.deepEqual(saved.llm.providers.chat, {
    preset: 'openai-chat-compatible-api',
    apiKey: 'chat-api-key',
    label: 'Chat',
    baseURL: 'https://chat.example/v1',
    headers: {'x-source': 'echo-tui'}
  });
  assert.deepEqual(saved.llm.models, [{
    id: 'chat-gpt',
    provider: 'chat',
    model: 'gpt-chat',
    contextWindow: 64000,
    reasoning: {effort: 'none', summary: 'auto'}
  }]);
  assert.equal(saved.llm.selectedModel, 'chat-gpt');
});

test('saveLlmConfigDraft falls back to draft root when config file disappears', () => {
  const writes = [];

  saveLlmConfigDraft({
    providers: [{
      id: 'default',
      label: 'Fake Agent',
      preset: 'fake-agent',
      apiKey: '',
      models: [{id: 'default', model: 'echo-fake-agent'}]
    }],
    selectedModelId: 'default',
    rootConfig: {
      hooks: {assistant_turn_end: ['echo done']},
      mcp: {enabled: false},
      tools: {bash: {timeoutMs: 2000}}
    }
  }, {
    configPath: '/tmp/echo/config.json',
    createTempPath: (targetPath) => `${targetPath}.tmp-test`,
    mkdir() {},
    readFile: readConfigError('ENOENT'),
    rename() {},
    writeFile(_filePath, data) {
      writes.push(data);
    }
  });

  const saved = JSON.parse(writes[0]);

  assert.deepEqual(saved.hooks, {assistant_turn_end: ['echo done']});
  assert.deepEqual(saved.mcp, {enabled: false});
  assert.deepEqual(saved.tools, {bash: {timeoutMs: 2000}});
  assert.equal(saved.llm.selectedModel, 'default');
});

test('saveLlmConfigDraft writes Codex OAuth provider without API key', () => {
  const writes = [];

  saveLlmConfigDraft({
    providers: [{
      id: 'codex',
      label: 'OpenAI Codex OAuth',
      preset: 'openai-codex-oauth',
      apiKey: '',
      codexAuthFile: '/tmp/codex-auth.json',
      models: [{id: 'codex-gpt', model: 'gpt-5.5'}]
    }],
    selectedModelId: 'codex-gpt',
    rootConfig: {}
  }, {
    configPath: '/tmp/echo/config.json',
    createTempPath: (targetPath) => `${targetPath}.tmp-test`,
    mkdir() {},
    readFile: readConfigError('ENOENT'),
    writeFile(filePath, data) {
      writes.push([filePath, data]);
    },
    rename() {}
  });

  const saved = JSON.parse(writes[0][1]);

  assert.deepEqual(saved.llm.providers.codex, {
    preset: 'openai-codex-oauth',
    label: 'OpenAI Codex OAuth',
    codexAuthFile: '/tmp/codex-auth.json'
  });
  assert.deepEqual(saved.llm.models, [{id: 'codex-gpt', provider: 'codex', model: 'gpt-5.5'}]);
});

test('saveLlmConfigDraft rejects invalid drafts without writing secrets', () => {
  let didWrite = false;

  assert.throws(
    () => saveLlmConfigDraft({
      providers: [{id: 'bad', label: 'Bad', preset: 'openai-responses-api', apiKey: '', models: []}],
      rootConfig: {}
    }, {
      writeFile() {
        didWrite = true;
      }
    }),
    (error) => {
      assert.equal(error instanceof LlmConfigEditorError, true);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    }
  );
  assert.equal(didWrite, false);
});
