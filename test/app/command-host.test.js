const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {createCommandHost, createCopyableRecords} = require('../../src/app/command/command-host');
const {ModelContext} = require('../../src/app/state/model-context');
const {readBuiltinTheme} = require('../../src/config/theme-config');

function withTemporaryThemeConfig(content, callback) {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-theme-host-'));
  const themePath = path.join(homeDir, '.echo', 'theme.json');

  fs.mkdirSync(path.dirname(themePath), {recursive: true});
  if (content !== null) {
    fs.writeFileSync(themePath, content, 'utf8');
  }
  os.homedir = () => homeDir;

  try {
    return callback({
      readThemeConfig() {
        return JSON.parse(fs.readFileSync(themePath, 'utf8'));
      },
      themePath
    });
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
}

function withTemporaryUserConfig(content, callback) {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-host-config-'));
  const configPath = path.join(homeDir, '.echo', 'config.json');

  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  if (content !== null) {
    fs.writeFileSync(configPath, content, 'utf8');
  }
  os.homedir = () => homeDir;

  function cleanup() {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }

  try {
    const result = callback({
      configPath,
      readConfig() {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    });

    if (result && typeof result.then === 'function') {
      return result.finally(cleanup);
    }

    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function createHostHarness(options = {}) {
  const setThemes = [];
  const calls = {
    contextUsageClears: 0,
    hookConfigs: [],
    modelRefreshes: 0,
    resizeRecoveries: 0
  };
  const host = createCommandHost({
    appContext: {
      clearContextUsage() {
        calls.contextUsageClears += 1;
      },
      getCurrentCwd() {
        return options.cwd || '/tmp/echo_tui';
      },
      getInteractionMode() {
        return 'plan';
      },
      modelContext: options.modelContext || {
        createStatusInfo() {
          return {error: 'LLM 配置缺少 models'};
        },
        refreshModelState() {
          calls.modelRefreshes += 1;
        }
      },
      transcriptContext: {
        getCurrentSessionId() {
          return options.sessionId || null;
        }
      },
      setTheme(theme) {
        setThemes.push(theme);
      }
    },
    appendRecord() {},
    exit() {},
    hooks: options.hooks === false ? undefined : {
      updateConfig(config) {
        calls.hookConfigs.push(config);

        if (options.reloadError) {
          throw new Error(options.reloadError);
        }
      }
    },
    renderFooter() {},
    renderResizeRecovery() {
      calls.resizeRecoveries += 1;
    },
    queryCodexUsage: options.queryCodexUsage
  });

  return {calls, host, setThemes};
}

test('CommandHost theme facade lists selected builtin theme and applies selection', () => {
  withTemporaryThemeConfig(JSON.stringify({
    theme: 'amber',
    footer: {
      colors: {
        accent: '#010203'
      }
    }
  }), ({readThemeConfig}) => {
    const {calls, host, setThemes} = createHostHarness();
    const themes = host.theme.listThemes();
    const selected = themes.filter((theme) => theme.selected);
    const violetTheme = readBuiltinTheme('violet');

    assert.deepEqual(themes.map((theme) => theme.id), ['acid-lime', 'amber', 'aurora', 'crimson', 'default', 'default-light', 'desert', 'evergreen', 'frost', 'graphite', 'ink-wash', 'lagoon', 'lavender', 'macaron', 'monochrome', 'paper-dark', 'paper-light', 'plum-gold', 'porcelain', 'rose-dusk', 'solarized-light', 'spring-mist', 'sunbeam', 'violet']);
    assert.deepEqual(selected.map((theme) => theme.id), ['amber']);
    assert.deepEqual(host.theme.selectTheme('violet'), {ok: true});
    assert.equal(readThemeConfig().theme, 'violet');
    assert.deepEqual(readThemeConfig().footer.colors.accent, '#010203');
    assert.equal(calls.resizeRecoveries, 1);
    assert.equal(setThemes.length, 1);
    assert.deepEqual(setThemes[0].footer.colors.accent, {kind: 'rgb', value: [1, 2, 3]});
    assert.deepEqual(setThemes[0].footer.colors.accentStrong, violetTheme.footer.colors.accentStrong);
  });
});

test('CommandHost memory facade persists user memories without exposing filesystem access to handlers', () => {
  withTemporaryUserConfig(null, () => {
    const {host} = createHostHarness();
    const created = host.memory.create('使用 TypeScript');

    assert.equal(created.ok, true);
    assert.equal(host.memory.list().memories[0].content, '使用 TypeScript');
    assert.equal(host.memory.update(created.memories[0].id, '使用 TypeScript 和中文注释').ok, true);
    assert.equal(host.memory.delete(created.memories[0].id).ok, true);
    assert.deepEqual(host.memory.list(), {ok: true, memories: []});
  });
});

test('CommandHost memory facade manages scoped agent catalogs through current cwd', () => {
  withTemporaryUserConfig(null, () => {
    const {host} = createHostHarness();
    const created = host.memory.addAgentMemory({catalog: 'rendering', description: 'Terminal rules', content: 'Use real cursors'});
    assert.equal(created.ok, true);
    const listed = host.memory.listAgentCatalogs();
    assert.equal(listed.ok, true);
    assert.equal(listed.catalogs[0].scope.kind, 'project');
    const read = host.memory.readAgentCatalog('rendering');
    assert.equal(read.ok, true);
    assert.equal(read.memories[0].content, 'Use real cursors');
    assert.equal(host.memory.setAgentCatalogEnabled('rendering', false).catalog.enabled, false);
    assert.equal(host.memory.setAgentItemEnabled('rendering', read.memories[0].id, false).memories[0].enabled, false);
    assert.equal(host.memory.updateAgentItem('rendering', read.memories[0].id, 'Use terminal cursors').ok, true);
    assert.equal(host.memory.removeAgentItem('rendering', read.memories[0].id).removedCatalog, true);
  });
});

test('CommandHost theme facade keeps current theme when selection cannot be saved', () => {
  withTemporaryThemeConfig('{broken', () => {
    const {calls, host, setThemes} = createHostHarness();
    const result = host.theme.selectTheme('amber');

    assert.equal(result.ok, false);
    assert.match(result.error, /无法读取/);
    assert.equal(calls.resizeRecoveries, 0);
    assert.deepEqual(setThemes, []);
  });
});

test('CommandHost hooks facade saves draft and reloads dispatcher config', () => {
  withTemporaryUserConfig(JSON.stringify({theme: 'amber', hooks: {assistant_turn_end: ['echo old']}}), ({readConfig}) => {
    const {calls, host} = createHostHarness();
    const draft = host.hooks.readDraft();
    const assistantTurnEnd = draft.events.find((eventDraft) => eventDraft.event === 'assistant_turn_end');

    assert.deepEqual(assistantTurnEnd.entries, [{command: 'echo old', enabled: true, timeoutMs: 5000}]);
    assistantTurnEnd.entries = [
      {command: 'echo new', enabled: true, timeoutMs: 1000},
      {command: 'echo disabled', enabled: false, timeoutMs: 1000}
    ];

    assert.deepEqual(host.hooks.saveDraft(draft), {ok: true});
    assert.deepEqual(readConfig(), {
      theme: 'amber',
      hooks: {
        assistant_turn_end: [
          {command: 'echo new', timeoutMs: 1000},
          {command: 'echo disabled', timeoutMs: 1000, enabled: false}
        ]
      }
    });
    assert.deepEqual(calls.hookConfigs, [{assistant_turn_end: [{command: 'echo new', timeoutMs: 1000}]}]);
  });
});

test('CommandHost hooks facade reports save and reload failures without transcript side effects', () => {
  withTemporaryUserConfig('{broken', () => {
    const {calls, host} = createHostHarness();
    const draft = {
      configPath: path.join(os.homedir(), '.echo', 'config.json'),
      diagnostics: [],
      events: [
        {event: 'assistant_turn_start', entries: [{command: 'echo valid', enabled: true, timeoutMs: 1000}]},
        {event: 'assistant_turn_end', entries: []},
        {event: 'assistant_turn_error', entries: []},
        {event: 'assistant_turn_cancelled', entries: []},
        {event: 'tool_call_start', entries: []},
        {event: 'tool_call_end', entries: []},
        {event: 'compaction_end', entries: []}
      ]
    };
    const result = host.hooks.saveDraft(draft);

    assert.equal(result.ok, false);
    assert.match(result.error, /不是有效 JSON/);
    assert.deepEqual(calls.hookConfigs, []);
  });

  withTemporaryUserConfig(JSON.stringify({}), () => {
    const {calls, host} = createHostHarness({reloadError: 'reload failed'});
    const draft = host.hooks.readDraft();
    draft.events[0].entries.push({command: 'echo valid', enabled: true, timeoutMs: 1000});
    const result = host.hooks.saveDraft(draft);

    assert.equal(result.ok, false);
    assert.match(result.error, /reload failed/);
    assert.deepEqual(calls.hookConfigs, [{assistant_turn_start: [{command: 'echo valid', timeoutMs: 1000}]}]);
  });

  withTemporaryUserConfig(JSON.stringify({}), () => {
    const {host} = createHostHarness({hooks: false});
    const draft = host.hooks.readDraft();
    draft.events[0].entries.push({command: 'echo valid', enabled: true, timeoutMs: 1000});

    assert.deepEqual(host.hooks.saveDraft(draft), {ok: true});
  });
});

test('CommandHost hooks facade creates synthetic payload and maps test result', async () => {
  await withTemporaryUserConfig(JSON.stringify({}), async () => {
    const cwd = process.cwd();
    const {host} = createHostHarness({hooks: false, cwd});

    const result = await host.hooks.testEntry('tool_call_start', {
      command: 'node -e "let s = \'\'; process.stdin.on(\'data\', c => s += c); process.stdin.on(\'end\', () => { const p = JSON.parse(s); process.stdout.write(process.env.ECHO_HOOK_EVENT + \':\' + p.toolName + \':\' + p.cwd); });"',
      enabled: false,
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.match(result.stdout, new RegExp(`tool_call_start:hook_test:${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(result.stderr, '');
  });
});

test('CommandHost config facade refreshes model status cache after successful save', () => {
  withTemporaryUserConfig(JSON.stringify({
    llm: {
      selectedModel: 'fast',
      providers: {
        openai: {preset: 'openai-responses-api', apiKey: 'openai-api-key'}
      },
      models: [
        {id: 'fast', provider: 'openai', model: 'gpt-fast'}
      ]
    }
  }), ({readConfig}) => {
    const modelContext = new ModelContext();
    const {calls, host} = createHostHarness({modelContext});

    assert.equal(modelContext.getStatusLineModelState().modelLabel, 'gpt-fast');

    const result = host.config.saveDraft({
      providers: [{
        id: 'openai',
        label: 'OpenAI',
        preset: 'openai-responses-api',
        apiKey: 'openai-api-key',
        models: [
          {id: 'fast', model: 'gpt-fast'},
          {id: 'deep', model: 'gpt-deep', reasoning: {effort: 'high'}}
        ]
      }],
      selectedModelId: 'deep',
      rootConfig: readConfig()
    });

    assert.deepEqual(result, {ok: true});
    assert.equal(calls.contextUsageClears, 1);
    assert.equal(modelContext.getStatusLineModelState().modelLabel, 'gpt-deep');
    assert.equal(modelContext.getStatusLineModelState().reasoningEffort, 'high');
  });
});

test('CommandHost config facade does not refresh model cache when save fails', () => {
  withTemporaryUserConfig(JSON.stringify({}), () => {
    const {calls, host} = createHostHarness();
    const result = host.config.saveDraft({providers: [], rootConfig: {}});

    assert.equal(result.ok, false);
    assert.match(result.error, /至少需要配置一个 provider/);
    assert.equal(calls.modelRefreshes, 0);
    assert.equal(calls.contextUsageClears, 0);
  });
});

test('CommandHost status facade aggregates non-sensitive runtime state and Codex usage', async () => {
  await withTemporaryUserConfig(JSON.stringify({
    llm: {
      selectedModel: 'codex-main',
      providers: {
        codex: {preset: 'openai-codex-oauth', codexAuthFile: '/tmp/codex-auth.json'}
      },
      models: [{id: 'codex-main', provider: 'codex', model: 'gpt-codex'}]
    }
  }), async ({configPath}) => {
    const homeDir = path.dirname(path.dirname(configPath));
    const cwd = path.join(homeDir, 'project');
    fs.mkdirSync(path.join(cwd, '.git'), {recursive: true});
    fs.writeFileSync(path.join(homeDir, '.echo', 'AGENTS.md'), 'global instructions', 'utf8');
    fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'project instructions', 'utf8');
    const queryCalls = [];
    const modelContext = new ModelContext();
    const {host} = createHostHarness({
      cwd,
      modelContext,
      sessionId: 'session-status',
      async queryCodexUsage(config) {
        queryCalls.push(config);
        return {
          primary: {usedPercent: 20, resetAt: 1_800_000_000_000},
          secondary: {usedPercent: 30, resetAt: 1_900_000_000_000}
        };
      }
    });

    host.memory.create('enabled user memory');
    const disabled = host.memory.create('disabled user memory');
    host.memory.setEnabled(disabled.memories.at(-1).id, false);
    const catalogResult = host.memory.addAgentMemory({catalog: 'runtime', description: 'Runtime preferences', content: 'catalog item', scope: 'global'});
    assert.equal(catalogResult.ok, true);

    const snapshot = host.status.createSnapshot();
    const usage = await host.status.queryCodexUsage();

    assert.equal(snapshot.cwd, cwd);
    assert.equal(snapshot.sessionId, 'session-status');
    assert.deepEqual(snapshot.model, {agentType: 'codex', model: 'gpt-codex', provider: 'codex'});
    assert.deepEqual(snapshot.agentInstructions.map((source) => source.sourceKind), ['global', 'project']);
    assert.equal(snapshot.userMemoryCount, 1);
    assert.deepEqual(snapshot.agentMemoryCatalogs, [{name: 'runtime', scope: 'global'}]);
    assert.deepEqual(snapshot.diagnostics, []);
    assert.deepEqual(queryCalls, [{authFilePath: '/tmp/codex-auth.json'}]);
    assert.equal(usage.status, 'available');
    assert.equal(usage.primary.usedPercent, 20);
  });
});

test('CommandHost status facade preserves empty state and reports local read failures', async () => {
  await withTemporaryUserConfig('{broken config', async ({configPath}) => {
    fs.writeFileSync(path.join(path.dirname(configPath), 'memories.json'), '{broken memories', 'utf8');
    let didQuery = false;
    const {host} = createHostHarness({
      modelContext: new ModelContext(),
      async queryCodexUsage() {
        didQuery = true;
        throw new Error('should not query');
      }
    });

    const snapshot = host.status.createSnapshot();
    const usage = await host.status.queryCodexUsage();

    assert.equal(snapshot.model, null);
    assert.equal(snapshot.sessionId, null);
    assert.equal(snapshot.userMemoryCount, 0);
    assert.equal(snapshot.agentMemoryCatalogs.length, 0);
    assert.equal(snapshot.diagnostics.length >= 2, true);
    assert.equal(usage.status, 'unavailable');
    assert.equal(didQuery, false);
  });
});

test('CommandHost status facade skips Codex request for non-Codex provider', async () => {
  await withTemporaryUserConfig(JSON.stringify({
    llm: {
      providers: {chat: {preset: 'openai-chat-compatible-api', apiKey: 'secret'}},
      models: [{id: 'chat', provider: 'chat', model: 'gpt-chat'}]
    }
  }), async () => {
    let didQuery = false;
    const {host} = createHostHarness({
      modelContext: new ModelContext(),
      async queryCodexUsage() {
        didQuery = true;
        throw new Error('should not query');
      }
    });

    assert.deepEqual(await host.status.queryCodexUsage(), {status: 'not_applicable'});
    assert.equal(didQuery, false);
  });
});


test('createCopyableRecords only returns user and assistant original text', () => {
  const records = [
    {role: 'system', text: 'system'},
    {role: 'user', text: 'hello', createdAt: '2026-01-01T00:00:00.000Z'},
    {role: 'tool_call', text: 'tool'},
    {role: 'assistant', text: 'answer'},
    {role: 'local_notice', text: 'notice'}
  ];

  assert.deepEqual(createCopyableRecords(records), [
    {id: 'message-1', role: 'user', text: 'hello', createdAt: '2026-01-01T00:00:00.000Z'},
    {id: 'message-3', role: 'assistant', text: 'answer', createdAt: undefined}
  ]);
});
