const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {DEFAULT_APP_SETTINGS} = require('../../src/config/app-settings-config');
const {UserConfigContext} = require('../../src/config/user-config-context');

function createConfigRoot(overrides = {}) {
  return {
    llm: {
      selectedModel: 'fast',
      providers: {fake: {preset: 'fake-agent'}},
      models: [{id: 'fast', provider: 'fake', model: 'echo-fast'}]
    },
    ...overrides
  };
}

function createMemoryContext(initialRoot, overrides = {}) {
  const state = {
    raw: typeof initialRoot === 'string' || initialRoot instanceof Error ? initialRoot : JSON.stringify(initialRoot),
    reads: 0,
    writes: [],
    renames: []
  };
  const context = new UserConfigContext({
    configPath: '/tmp/echo/config.json',
    createTempPath: () => '/tmp/echo/config.json.tmp',
    mkdir() {},
    readFile() {
      state.reads += 1;
      if (state.raw instanceof Error) throw state.raw;
      return state.raw;
    },
    writeFile(filePath, data) {
      state.writes.push([filePath, data]);
      overrides.writeFile?.(filePath, data);
    },
    rename(from, to) {
      overrides.rename?.(from, to);
      state.renames.push([from, to]);
      state.raw = state.writes.at(-1)[1];
    },
    watchConfig: overrides.watchConfig
  });
  return {context, state};
}

test('UserConfigContext reads once and reuses one immutable revision across selectors', () => {
  const {context, state} = createMemoryContext(createConfigRoot({
    hooks: {assistant_turn_end: ['echo done']},
    mcp: {servers: {docs: {enabled: false, transport: 'http', url: 'https://example.invalid/mcp'}}},
    tools: {bash: {timeoutMs: 1000}}
  }));
  const snapshot = context.capture();

  assert.equal(state.reads, 1);
  assert.equal(snapshot.getAppSettings().compactionThresholdRatio, 0.8);
  assert.equal(snapshot.getLlmModelConfigInfo().selectedModelId, 'fast');
  assert.equal(snapshot.resolveLlmConfig().tools.bash.timeoutMs, 1000);
  assert.equal(snapshot.getMcpConfigDraft().servers[0].name, 'docs');
  assert.equal(snapshot.getLifecycleHookConfig().assistant_turn_end[0].command, 'echo done');
  assert.equal(state.reads, 1);

  assert.equal(Object.isFrozen(snapshot.getAppSettings()), true);
  assert.equal(Object.isFrozen(snapshot.resolveLlmConfig()), true);
  assert.equal(Object.isFrozen(snapshot.resolveLlmConfig().tools), true);
  assert.equal(Object.isFrozen(snapshot.getLlmModelConfigInfo()), true);
  assert.equal(Object.isFrozen(snapshot.getLlmModelConfigInfo().models), true);
  assert.equal(Object.isFrozen(snapshot.getMcpConfig()), true);
  assert.equal(Object.isFrozen(snapshot.getMcpConfig().servers), true);
  assert.equal(Object.isFrozen(snapshot.getLifecycleHookConfig()), true);
  assert.equal(Object.isFrozen(snapshot.getLifecycleHookConfig().assistant_turn_end), true);

  const llmDraft = snapshot.getLlmConfigDraft();
  llmDraft.providers[0].models[0].model = 'changed-only-in-draft';
  assert.equal(snapshot.getLlmConfigDraft().providers[0].models[0].model, 'echo-fast');
  context.close();
});

test('UserConfigContext deduplicates semantic JSON and reports only changed known domains', () => {
  const root = createConfigRoot({unknown: {value: 1}});
  const {context, state} = createMemoryContext(root);
  const changes = [];
  const unsubscribe = context.subscribe((change) => changes.push(change));

  state.raw = JSON.stringify({unknown: {value: 1}, llm: root.llm}, null, 4);
  assert.equal(context.refresh().changed, false);
  assert.equal(context.capture().revision, 1);

  state.raw = JSON.stringify({...root, unknown: {value: 2}});
  const unknownChange = context.refresh();
  assert.equal(unknownChange.changed, true);
  assert.deepEqual(unknownChange.domains, {
    appSettings: false,
    hooks: false,
    llm: false,
    mcp: false,
    tools: false
  });

  state.raw = JSON.stringify({...root, unknown: {value: 2}, ui: {showReasoningSummary: false}});
  const appChange = context.refresh();
  assert.equal(appChange.domains.appSettings, true);
  assert.equal(appChange.domains.llm, false);
  assert.equal(changes.length, 2);

  unsubscribe();
  state.raw = JSON.stringify({...root, ui: {showReasoningSummary: true}});
  context.refresh();
  assert.equal(changes.length, 2);
  context.close();
});

test('UserConfigContext installs invalid source states and recovers without last-known-good values', () => {
  const {context, state} = createMemoryContext(createConfigRoot({ui: {showReasoningSummary: false}}));
  const validSnapshot = context.capture();

  state.raw = '{broken';
  const invalid = context.refresh().snapshot;
  assert.equal(invalid.sourceState, 'invalid_json');
  assert.equal(invalid.revision, 2);
  assert.deepEqual(invalid.getAppSettings(), DEFAULT_APP_SETTINGS);
  assert.throws(() => invalid.resolveLlmConfig(), /不是有效 JSON/);
  assert.throws(() => invalid.getAppSettingsDraft(), /不是有效 JSON/);
  assert.equal(validSnapshot.getAppSettings().showReasoningSummary, false);

  state.raw = JSON.stringify(createConfigRoot({ui: {showReasoningSummary: true}}));
  const recovered = context.refresh().snapshot;
  assert.equal(recovered.sourceState, 'valid');
  assert.equal(recovered.revision, 3);
  assert.equal(recovered.getAppSettings().showReasoningSummary, true);
  context.close();
});

test('UserConfigContext instances and watcher lifecycles are isolated', () => {
  let firstOnChange;
  let firstClosed = 0;
  let secondClosed = 0;
  const first = createMemoryContext(createConfigRoot(), {
    watchConfig(onChange) {
      firstOnChange = onChange;
      return {close() { firstClosed += 1; }};
    }
  });
  const second = createMemoryContext(createConfigRoot({ui: {showReasoningSummary: false}}), {
    watchConfig() {
      return {close() { secondClosed += 1; }};
    }
  });
  const firstChanges = [];

  first.context.subscribe((change) => firstChanges.push(change));
  first.context.startWatching();
  first.context.startWatching();
  second.context.startWatching();
  first.state.raw = JSON.stringify(createConfigRoot({ui: {showReasoningSummary: false}}));
  firstOnChange();

  assert.equal(firstChanges.length, 1);
  assert.equal(first.context.capture().revision, 2);
  assert.equal(second.context.capture().revision, 1);
  first.context.close();
  second.context.close();
  assert.equal(firstClosed, 1);
  assert.equal(secondClosed, 1);
});

test('UserConfigContext catches changes made before watcher registration and deduplicates the later event', () => {
  let onChange;
  const root = createConfigRoot();
  const {context, state} = createMemoryContext(root, {
    watchConfig(nextOnChange) {
      onChange = nextOnChange;
      return {close() {}};
    }
  });
  const changes = [];
  context.subscribe((change) => changes.push(change));

  state.raw = JSON.stringify(createConfigRoot({ui: {showReasoningSummary: false}}));
  context.startWatching();

  assert.equal(context.capture().revision, 2);
  assert.equal(context.capture().getAppSettings().showReasoningSummary, false);
  assert.equal(changes.length, 1);
  assert.equal(state.reads, 2);

  onChange();
  assert.equal(context.capture().revision, 2);
  assert.equal(changes.length, 1);
  assert.equal(state.reads, 3);
  context.close();
});

test('UserConfigContext registers the watcher before performing its startup catch-up read', () => {
  let reads = 0;
  let watching = false;
  const context = new UserConfigContext({
    configPath: '/tmp/echo/config.json',
    readFile() {
      reads += 1;
      if (reads === 2) assert.equal(watching, true);
      return JSON.stringify(createConfigRoot({unknown: {revision: reads}}));
    },
    watchConfig() {
      watching = true;
      return {close() {}};
    }
  });

  context.startWatching();
  assert.equal(reads, 2);
  assert.equal(context.capture().revision, 2);
  context.close();
});

test('UserConfigContext writers merge the latest disk root and install exactly one revision', () => {
  const root = createConfigRoot({unknown: {initial: true}});
  const {context, state} = createMemoryContext(root);
  const changes = [];
  context.subscribe((change) => changes.push(change));

  state.raw = JSON.stringify({...root, externallyAdded: {kept: true}});
  const saved = context.saveAppSettingsDraft({
    ...DEFAULT_APP_SETTINGS,
    showReasoningSummary: false
  });
  const written = JSON.parse(state.writes[0][1]);

  assert.equal(saved.revision, 2);
  assert.equal(saved.snapshot.getAppSettings().showReasoningSummary, false);
  assert.deepEqual(written.externallyAdded, {kept: true});
  assert.equal(changes.length, 1);
  assert.equal(context.refresh().changed, false);
  assert.equal(changes.length, 1);
  context.close();
});

test('UserConfigContext validation, read, write, and rename failures never install a draft revision', () => {
  const cases = [
    {
      name: 'validation',
      create() { return createMemoryContext(createConfigRoot()); },
      save(context) { context.saveAppSettingsDraft({...DEFAULT_APP_SETTINGS, compactionThresholdRatio: 2}); },
      error: /50% 到 95%/
    },
    {
      name: 'read',
      create() {
        const fixture = createMemoryContext(createConfigRoot());
        fixture.state.raw = Object.assign(new Error('read failed'), {code: 'EACCES'});
        return fixture;
      },
      save(context) { context.saveAppSettingsDraft(DEFAULT_APP_SETTINGS); },
      error: /无法读取配置文件/
    },
    {
      name: 'write',
      create() { return createMemoryContext(createConfigRoot(), {writeFile() { throw new Error('write failed'); }}); },
      save(context) { context.saveAppSettingsDraft(DEFAULT_APP_SETTINGS); },
      error: /write failed/
    },
    {
      name: 'rename',
      create() { return createMemoryContext(createConfigRoot(), {rename() { throw new Error('rename failed'); }}); },
      save(context) { context.saveAppSettingsDraft(DEFAULT_APP_SETTINGS); },
      error: /rename failed/
    }
  ];

  for (const scenario of cases) {
    const {context} = scenario.create();
    const before = context.capture();
    assert.throws(() => scenario.save(context), scenario.error, scenario.name);
    assert.equal(context.capture(), before, scenario.name);
    assert.equal(context.capture().revision, 1, scenario.name);
    context.close();
  }
});

test('UserConfigContext MCP writer requires an existing config while hooks can create one', () => {
  const missingError = Object.assign(new Error('missing'), {code: 'ENOENT'});
  const mcp = createMemoryContext(missingError);
  assert.throws(() => mcp.context.saveMcpEnabledStateDraft({enabled: true, servers: []}), /不存在/);
  assert.equal(mcp.context.capture().revision, 1);
  mcp.context.close();

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-user-config-context-'));
  const configPath = path.join(directory, 'config.json');
  try {
    const hooks = new UserConfigContext({configPath});
    const draft = hooks.capture().getLifecycleHookConfigDraft();
    draft.events.find((event) => event.event === 'assistant_turn_end').entries.push({
      command: 'echo done',
      enabled: true,
      timeoutMs: 1000
    });
    hooks.saveLifecycleHookConfigDraft(draft);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).hooks.assistant_turn_end, [
      {command: 'echo done', timeoutMs: 1000}
    ]);
    hooks.close();
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
