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
        refreshModelState() {
          calls.modelRefreshes += 1;
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
    }
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
