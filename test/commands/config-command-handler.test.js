const test = require('node:test');
const assert = require('node:assert/strict');

const { INPUT_EVENTS } = require('../../src/input/event-types');
const { createInitialConfigState, getConfigRows } = require('../../src/commands/config/state');
const { handleConfigPanelEvent } = require('../../src/commands/config/panel-state');
const { listProviderPresets } = require('../../src/config/provider-presets');

function createDraft() {
  return {
    providers: [{
      id: 'chat',
      label: 'Chat',
      preset: 'openai-chat-compatible-api',
      apiKey: 'chat-api-key',
      baseURL: 'https://chat.example/v1',
      models: [{id: 'chat-gpt', model: 'gpt-chat'}]
    }],
    selectedModelId: 'chat-gpt',
    rootConfig: {}
  };
}

function createStateDriver(draft = createDraft()) {
  let state = createInitialConfigState(draft);

  return {
    getState() {
      return state;
    },
    handle(event) {
      const result = handleConfigPanelEvent(state, event);
      if ('state' in result) {
        state = result.state;
      }
      return result;
    }
  };
}

function moveFormToRow(driver, rowKind) {
  const rowIndex = getConfigRows(driver.getState()).findIndex((row) => row.kind === rowKind);

  for (let index = driver.getState().formIndex; index < rowIndex; index += 1) {
    driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  }
}

function openForm(driver) {
  driver.handle({type: INPUT_EVENTS.SUBMIT});
}

function selectPresetByLabel(driver, label) {
  const presets = listProviderPresets();
  const targetIndex = presets.findIndex((preset) => preset.label === label);
  assert.ok(targetIndex >= 0, `missing preset label: ${label}`);

  while (driver.getState().presetIndex < targetIndex) {
    driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  }

  while (driver.getState().presetIndex > targetIndex) {
    driver.handle({type: INPUT_EVENTS.MOVE_UP});
  }

  driver.handle({type: INPUT_EVENTS.SUBMIT});
  return presets[targetIndex];
}

function submitFormSave(driver) {
  moveFormToRow(driver, 'save');
  return driver.handle({type: INPUT_EVENTS.SUBMIT});
}

function submitListSave(driver) {
  while (driver.getState().providerIndex < driver.getState().draft.providers.length + 1) {
    driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  }

  return driver.handle({type: INPUT_EVENTS.SUBMIT});
}

test('config command state edits provider fields and models', () => {
  const driver = createStateDriver();

  openForm(driver);
  assert.equal(driver.getState().mode, 'form');

  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.TEXT, value: 'Renamed'});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  assert.equal(driver.getState().draft.providers[0].label, 'Renamed');

  moveFormToRow(driver, 'addModel');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.TEXT, value: '新'});
  driver.handle({type: INPUT_EVENTS.TEXT, value: 'model'});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  assert.equal(driver.getState().draft.providers[0].models[1].model, '新model');
});

test('config command state exposes list models row after add model', () => {
  const driver = createStateDriver();

  openForm(driver);

  assert.deepEqual(getConfigRows(driver.getState()).slice(-4).map((row) => row.kind), ['addModel', 'listModels', 'deleteProvider', 'save']);
});

test('config command state opens model details and edits context window', () => {
  const driver = createStateDriver();

  openForm(driver);
  moveFormToRow(driver, 'model');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  assert.equal(driver.getState().mode, 'modelDetail');

  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.TEXT, value: '64000'});
  driver.handle({type: INPUT_EVENTS.SUBMIT});

  assert.equal(driver.getState().draft.providers[0].models[0].contextWindow, 64000);
  assert.equal(driver.getState().draft.providers[0].models[0].reasoning, undefined);
});

test('config command state configures model effort and preserves other reasoning settings', () => {
  const draft = createDraft();
  draft.providers[0].models[0].reasoning = {summary: 'auto'};
  const driver = createStateDriver(draft);

  openForm(driver);
  moveFormToRow(driver, 'model');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});

  driver.handle({type: INPUT_EVENTS.MOVE_RIGHT});
  assert.deepEqual(driver.getState().draft.providers[0].models[0].reasoning, {summary: 'auto', effort: 'none'});

  driver.handle({type: INPUT_EVENTS.MOVE_RIGHT});
  assert.deepEqual(driver.getState().draft.providers[0].models[0].reasoning, {summary: 'auto', effort: 'low'});

  driver.handle({type: INPUT_EVENTS.MOVE_LEFT});
  driver.handle({type: INPUT_EVENTS.MOVE_LEFT});
  assert.deepEqual(driver.getState().draft.providers[0].models[0].reasoning, {summary: 'auto'});

  driver.handle({type: INPUT_EVENTS.MOVE_RIGHT});
  driver.handle({type: INPUT_EVENTS.ESCAPE});
  const saveResult = submitFormSave(driver);
  assert.equal(saveResult.kind, 'save');
  assert.deepEqual(saveResult.draft.providers[0].models[0].reasoning, {summary: 'auto', effort: 'none'});
});

test('config command state ignores submit on the effort row', () => {
  const draft = createDraft();
  draft.providers[0].models[0].reasoning = {effort: 'low'};
  const driver = createStateDriver(draft);

  openForm(driver);
  moveFormToRow(driver, 'model');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});

  driver.handle({type: INPUT_EVENTS.SUBMIT});
  assert.equal(driver.getState().mode, 'modelDetail');
  assert.deepEqual(driver.getState().draft.providers[0].models[0].reasoning, {effort: 'low'});
});

test('config command state does not offer model effort for fake agent', () => {
  const driver = createStateDriver({
    providers: [{id: 'default', label: 'Fake Agent', preset: 'fake-agent', apiKey: '', models: [{id: 'default', model: 'echo-fake-agent'}]}],
    selectedModelId: 'default',
    rootConfig: {}
  });

  openForm(driver);
  moveFormToRow(driver, 'model');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.MOVE_RIGHT});

  assert.equal(driver.getState().draft.providers[0].models[0].reasoning, undefined);
});

test('config command state adds, edits, and deletes custom headers', () => {
  const driver = createStateDriver();

  openForm(driver);
  moveFormToRow(driver, 'headers');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  assert.equal(driver.getState().mode, 'headerList');

  driver.handle({type: INPUT_EVENTS.SUBMIT});
  assert.equal(driver.getState().mode, 'headerDetail');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.TEXT, value: 'x-tenant'});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.TEXT, value: 'secret-value'});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.SUBMIT});

  assert.deepEqual(driver.getState().draft.providers[0].headers, {'x-tenant': 'secret-value'});
  assert.equal(driver.getState().mode, 'headerList');

  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  assert.equal(driver.getState().draft.providers[0].headers, undefined);
});

test('config command state preserves an existing header value when no replacement is entered', () => {
  const draft = createDraft();
  draft.providers[0].headers = {'x-source': 'hidden-value'};
  const driver = createStateDriver(draft);

  openForm(driver);
  moveFormToRow(driver, 'headers');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  for (let index = 0; index < 3; index += 1) {
    driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  }
  driver.handle({type: INPUT_EVENTS.SUBMIT});

  assert.deepEqual(driver.getState().draft.providers[0].headers, {'x-source': 'hidden-value'});
});

test('config command state delegates dirty discard confirmation to the config center root', () => {
  const driver = createStateDriver();

  openForm(driver);
  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.TEXT, value: 'Renamed'});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.ESCAPE});
  const result = driver.handle({type: INPUT_EVENTS.ESCAPE});

  assert.equal(driver.getState().mode, 'list');
  assert.equal(result.kind, 'cancel');
});

test('config command state starts provider model listing from explicit row', () => {
  const driver = createStateDriver();

  openForm(driver);
  moveFormToRow(driver, 'listModels');
  const result = driver.handle({type: INPUT_EVENTS.SUBMIT});

  assert.equal(result.kind, 'listModels');
  assert.equal(driver.getState().mode, 'modelList');
  assert.equal(driver.getState().modelList.status, 'loading');
  assert.equal(result.provider.apiKey, 'chat-api-key');
});

test('config command state validates list models prerequisites before requests', () => {
  const driver = createStateDriver({
    providers: [{id: 'chat', label: 'Chat', preset: 'openai-chat-compatible-api', apiKey: '', models: [{id: 'chat-gpt', model: 'gpt-chat'}]}],
    selectedModelId: 'chat-gpt',
    rootConfig: {}
  });

  openForm(driver);
  moveFormToRow(driver, 'listModels');
  const result = driver.handle({type: INPUT_EVENTS.SUBMIT});

  assert.equal(result.kind, 'continue');
  assert.match(driver.getState().error, /API key/);
});

test('config command state reads existing fake provider without offering fake as a new preset', () => {
  const driver = createStateDriver({
    providers: [{id: 'default', label: 'Fake Agent', preset: 'fake-agent', apiKey: '', models: [{id: 'default', model: 'echo-fake-agent'}]}],
    selectedModelId: 'default',
    rootConfig: {}
  });

  assert.equal(listProviderPresets().some((preset) => preset.id === 'fake-agent'), false);
  openForm(driver);
  assert.equal(getConfigRows(driver.getState()).some((row) => row.kind === 'field' && row.field === 'baseURL'), false);

  moveFormToRow(driver, 'listModels');
  const result = driver.handle({type: INPUT_EVENTS.SUBMIT});

  assert.equal(result.kind, 'listModels');
  assert.equal(result.provider.preset, 'fake-agent');
});

test('config command state gives a new provider the id of the selected preset', () => {
  const driver = createStateDriver({
    providers: [],
    selectedModelId: undefined,
    rootConfig: {}
  });

  driver.handle({type: INPUT_EVENTS.SUBMIT});
  assert.equal(driver.getState().mode, 'preset');
  assert.equal(driver.getState().draft.providers.length, 1);

  const preset = selectPresetByLabel(driver, 'Ollama (Local)');

  assert.equal(driver.getState().draft.providers[0].id, 'ollama');
  assert.equal(driver.getState().draft.providers[0].preset, 'ollama');
  assert.deepEqual(driver.getState().draft.providers[0].models.map((model) => model.model), preset.suggestedModels);
  assert.equal(driver.getState().mode, 'form');
});

test('config command state keeps an existing provider id when switching presets', () => {
  const driver = createStateDriver();

  openForm(driver);
  moveFormToRow(driver, 'preset');
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  selectPresetByLabel(driver, 'Ollama (Local)');

  assert.equal(driver.getState().draft.providers[0].id, 'chat');
  assert.equal(driver.getState().draft.providers[0].preset, 'ollama');
});

test('config command state selects listed models without duplicates', () => {
  const driver = createStateDriver();

  openForm(driver);
  let state = driver.getState();
  state = {
    ...state,
    mode: 'modelList',
    modelList: {
      models: [{id: 'gpt-new'}],
      requestId: 1,
      selectedIndex: 0,
      status: 'ready'
    }
  };
  let result = handleConfigPanelEvent(state, {type: INPUT_EVENTS.SUBMIT});

  assert.equal(result.kind, 'continue');
  assert.equal(result.state.mode, 'form');
  assert.deepEqual(result.state.draft.providers[0].models.map((model) => model.model), ['gpt-chat', 'gpt-new']);

  state = {
    ...result.state,
    mode: 'modelList',
    modelList: {
      models: [{id: 'gpt-chat'}],
      requestId: 2,
      selectedIndex: 0,
      status: 'ready'
    }
  };
  result = handleConfigPanelEvent(state, {type: INPUT_EVENTS.SUBMIT});

  assert.equal(result.kind, 'continue');
  assert.deepEqual(result.state.draft.providers[0].models.map((model) => model.model), ['gpt-chat', 'gpt-new']);
  assert.equal(result.state.formIndex, getConfigRows(result.state).findIndex((row) => row.kind === 'model' && row.modelIndex === 0));
});

test('config command state adds providers from the explicit add row', () => {
  const driver = createStateDriver();

  driver.handle({type: INPUT_EVENTS.MOVE_DOWN});
  const result = driver.handle({type: INPUT_EVENTS.SUBMIT});

  assert.equal(result.kind, 'continue');
  assert.equal(driver.getState().mode, 'preset');
  assert.equal(driver.getState().draft.providers.length, 2);
});

test('config command state saves from explicit save rows', () => {
  const listDriver = createStateDriver();

  const listSaveResult = submitListSave(listDriver);
  assert.equal(listSaveResult.kind, 'save');

  const formDriver = createStateDriver();
  formDriver.handle({type: INPUT_EVENTS.SUBMIT});
  const formSaveResult = submitFormSave(formDriver);
  assert.equal(formSaveResult.kind, 'save');
});

test('config command state selects preset and validates save', () => {
  const driver = createStateDriver();

  openForm(driver);
  openForm(driver);
  assert.equal(driver.getState().mode, 'preset');
  const preset = selectPresetByLabel(driver, 'Anthropic Compatible API');
  assert.equal(driver.getState().draft.providers[0].preset, preset.id);
  assert.equal(driver.getState().draft.providers[0].label, preset.label);
  assert.deepEqual(driver.getState().draft.providers[0].models.map((model) => model.model), ['claude-sonnet-4', 'claude-opus-4']);

  const saveResult = submitFormSave(driver);
  assert.equal(saveResult.kind, 'save');
  assert.equal(saveResult.draft.providers[0].preset, preset.id);
});

test('config command state clears models when selected preset has no suggestions', () => {
  const driver = createStateDriver();

  driver.handle({type: INPUT_EVENTS.SUBMIT});
  driver.handle({type: INPUT_EVENTS.SUBMIT});
  const preset = selectPresetByLabel(driver, 'Xiaomi Mimo Token Plan');

  assert.equal(driver.getState().draft.providers[0].preset, preset.id);
  assert.equal(driver.getState().draft.providers[0].label, preset.label);
  assert.deepEqual(driver.getState().draft.providers[0].models, []);

  const saveResult = submitFormSave(driver);
  assert.equal(saveResult.kind, 'continue');
  assert.match(driver.getState().error, /至少需要一个模型/);
});

test('config command state returns validation error instead of saving invalid draft', () => {
  const driver = createStateDriver({
    providers: [{id: 'bad', label: 'Bad', preset: 'openai-responses-api', apiKey: '', models: []}],
    rootConfig: {}
  });
  const result = submitListSave(driver);

  assert.equal(result.kind, 'continue');
  assert.match(driver.getState().error, /API key/);
});

const {ConfigCommandHandler} = require('../../src/commands/config/handler');
const {createCommandRuntime} = require('../../src/app/command/command-runtime');
const {DEFAULT_APP_SETTINGS} = require('../../src/config/app-settings-config');

const {parseMainAgentToolsConfig} = require('../../src/config/main-agent-tools-config');

function createToolsDriver(options = {}) {
  let toolsDraft = parseMainAgentToolsConfig(options.draft ? {tools: {mainAgent: options.draft}} : {});
  const savedTools = [];
  const savedSettings = [];
  const handler = new ConfigCommandHandler();
  const catalog = options.catalog || [
    ...['run_bash_command', 'apply_patch', 'edit_file', 'create_todos', 'complete_todo', 'web_fetch'].map((name) => ({name, available: true})),
    {name: 'list_mcp_resources', available: false},
    {name: 'mcp__docs__search', available: true, serverName: 'docs'},
    {name: 'mcp__offline__search', available: false, serverName: 'offline'},
    {name: 'unknown_future', available: false, unknown: true}
  ];
  const runtime = createCommandRuntime({
    resolveSlashCommand: () => handler,
    host: {
      ui: {render() {}, exit() {}},
      theme: {listThemes: () => []},
      config: {
        readSettings() {
          if (options.settingsError) throw new Error(options.settingsError);
          return structuredClone(DEFAULT_APP_SETTINGS);
        },
        listApprovalModelProfiles: () => [],
        readDraft() {
          if (options.modelsError) throw new Error(options.modelsError);
          return createDraft();
        },
        readToolsDraft() {
          if (options.readError) throw new Error(options.readError);
          return structuredClone(toolsDraft);
        },
        listToolCatalog: () => catalog,
        saveToolsDraft(draft) {
          if (options.saveError) return {ok: false, error: options.saveError};
          toolsDraft = structuredClone(draft);
          savedTools.push(toolsDraft);
          return {ok: true};
        },
        saveSettings(draft) {
          savedSettings.push(structuredClone(draft));
          return {ok: true};
        },
        readSandboxDraft: () => ({mode: 'off', network: false, extraWritablePaths: []})
      }
    }
  });
  runtime.startFromText('/config');
  const surface = () => runtime.getSurface();
  const send = (type, value) => runtime.handleEvent(value === undefined ? {type} : {type, value});
  return {
    runtime, surface, send, savedTools, savedSettings,
    async tab(id) {
      for (let count = 0; count < 5 && surface().activeTab !== id; count += 1) await send(INPUT_EVENTS.TAB);
      assert.equal(surface().activeTab, id);
    },
    async select(label) {
      await send(INPUT_EVENTS.MOVE_HOME);
      const index = label === 'save' ? surface().state.items.length : surface().state.items.findIndex((item) => item.label === label);
      assert.ok(index >= 0, label);
      for (let count = 0; count < index; count += 1) await send(INPUT_EVENTS.MOVE_DOWN);
      assert.equal(surface().state.selectedIndex, index);
    }
  };
}

test('tools tab locks Bash without dirty and independently toggles both editing tools', async () => {
  const driver = createToolsDriver();
  assert.deepEqual(driver.surface().tabs.map((tab) => tab.id), ['general', 'models', 'tools', 'sandbox', 'appearance']);
  await driver.tab('tools');
  assert.deepEqual(driver.surface().state.draft.disabledTools, []);
  for (const name of ['apply_patch', 'edit_file']) {
    assert.ok(driver.surface().state.items.some((item) => item.label === name));
    assert.equal(driver.surface().state.draft.disabledTools.includes(name), false);
  }
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.send(INPUT_EVENTS.TEXT, ' ');
  assert.equal(driver.surface().tabs.find((tab) => tab.id === 'tools').status, undefined);
  assert.equal(driver.savedTools.length, 0);

  await driver.select('edit_file');
  await driver.send(INPUT_EVENTS.TEXT, ' ');
  assert.equal(driver.surface().state.draft.disabledTools.includes('edit_file'), true);
  await driver.select('apply_patch');
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.surface().state.draft.disabledTools.includes('apply_patch'), true);
  assert.equal(driver.surface().state.draft.disabledTools.includes('edit_file'), true);
  await driver.select('edit_file');
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.surface().state.draft.disabledTools.includes('edit_file'), false);
  await driver.select('apply_patch');
  await driver.send(INPUT_EVENTS.TEXT, ' ');
  assert.equal(driver.surface().tabs.find((tab) => tab.id === 'tools').status, undefined);
  assert.equal(driver.savedTools.length, 0);
});

test('tools tab projects normalized Todo snapshots, saves and re-enables both names', async () => {
  for (const name of ['create_todos', 'complete_todo']) {
    const driver = createToolsDriver({draft: {disabledTools: [name]}});
    await driver.tab('tools');
    assert.equal(driver.surface().state.items.filter((item) => item.label === 'Todo').length, 1);
    assert.equal(driver.surface().state.items.some((item) => ['create_todos', 'complete_todo'].includes(item.label)), false);
    assert.deepEqual(new Set(driver.surface().state.draft.disabledTools), new Set(['create_todos', 'complete_todo']));
    assert.equal(driver.surface().tabs.find((tab) => tab.id === 'tools').status, undefined);
    await driver.select('save');
    await driver.send(INPUT_EVENTS.SUBMIT);
    assert.deepEqual(new Set(driver.savedTools[0].disabledTools), new Set(['create_todos', 'complete_todo']));
    await driver.select('Todo');
    await driver.send(INPUT_EVENTS.TEXT, ' ');
    assert.deepEqual(driver.surface().state.draft.disabledTools, []);
    await driver.select('save');
    await driver.send(INPUT_EVENTS.SUBMIT);
    assert.deepEqual(driver.savedTools[1], {disabledTools: []});
    await driver.send(INPUT_EVENTS.ESCAPE);
    assert.equal(driver.runtime.hasActiveSession(), false);
    driver.runtime.startFromText('/config');
    await driver.tab('tools');
    await driver.select('Todo');
    await driver.send(INPUT_EVENTS.SUBMIT);
    assert.deepEqual(new Set(driver.surface().state.draft.disabledTools), new Set(['create_todos', 'complete_todo']));
    await driver.select('save');
    await driver.send(INPUT_EVENTS.SUBMIT);
    assert.deepEqual(new Set(driver.savedTools[2].disabledTools), new Set(['create_todos', 'complete_todo']));
  }
});

test('tools draft, selection, unavailable preferences and unknown names survive tab changes and independent save', async () => {
  const driver = createToolsDriver({draft: {disabledTools: ['unknown_future', 'mcp__offline__search']}});
  await driver.send(INPUT_EVENTS.MOVE_RIGHT);
  await driver.tab('tools');
  await driver.select('list_mcp_resources');
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.surface().state.draft.disabledTools.includes('list_mcp_resources'), true);
  await driver.select('mcp__offline__search');
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.surface().state.draft.disabledTools.includes('mcp__offline__search'), false);
  const previous = driver.surface().state;
  await driver.tab('appearance');
  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.deepEqual(driver.surface().dirtyTabs, ['常规', '工具']);
  await driver.send(INPUT_EVENTS.ESCAPE);
  await driver.tab('tools');
  assert.deepEqual(driver.surface().state, previous);
  await driver.select('save');
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.savedSettings.length, 0);
  assert.equal(driver.savedTools[0].disabledTools.includes('unknown_future'), true);
  assert.equal(driver.surface().tabs.find((tab) => tab.id === 'tools').status, undefined);
  assert.equal(driver.surface().tabs.find((tab) => tab.id === 'general').status, 'dirty');
  assert.match(driver.surface().state.feedback, /已保存.*下轮生效/);
  await driver.tab('general');
  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.deepEqual(driver.surface().dirtyTabs, ['常规']);
});

test('tools read and save failures are isolated, preserve dirty state and protect discard', async () => {
  const readFailure = createToolsDriver({readError: '非法 disabledTools'});
  await readFailure.tab('tools');
  assert.equal(readFailure.surface().view, 'error');
  assert.match(readFailure.surface().error, /非法 disabledTools/);
  await readFailure.tab('sandbox');
  assert.equal(readFailure.surface().view, 'sandbox');
  await readFailure.tab('appearance');
  assert.equal(readFailure.surface().view, 'appearance');
  await readFailure.tab('general');
  assert.equal(readFailure.surface().view, 'general');

  const independent = createToolsDriver({modelsError: '非法 provider', settingsError: '常规错误'});
  await independent.tab('tools');
  assert.equal(independent.surface().view, 'tools');
  const failure = createToolsDriver({saveError: '不能写配置'});
  await failure.tab('tools');
  await failure.select('edit_file');
  await failure.send(INPUT_EVENTS.SUBMIT);
  await failure.select('save');
  await failure.send(INPUT_EVENTS.SUBMIT);
  assert.equal(failure.surface().state.error, '不能写配置');
  assert.equal(failure.surface().tabs.find((tab) => tab.id === 'tools').status, 'dirty');
  await failure.tab('general');
  await failure.send(INPUT_EVENTS.ESCAPE);
  assert.deepEqual(failure.surface().dirtyTabs, ['工具']);
  await failure.send(INPUT_EVENTS.MOVE_DOWN);
  await failure.send(INPUT_EVENTS.SUBMIT);
  assert.equal(failure.runtime.hasActiveSession(), false);
  assert.equal(failure.savedTools.length, 0);
});

test('tools keyboard navigation reaches every candidate and the explicit save action', async () => {
  const catalog = Array.from({length: 80}, (_, index) => ({name: `mcp__many__tool_${index}`, available: true, serverName: 'many'}));
  const driver = createToolsDriver({catalog, draft: {disabledTools: []}});
  await driver.tab('tools');
  for (let index = 0; index < 80; index += 1) {
    assert.equal(driver.surface().state.selectedIndex, index);
    await driver.send(INPUT_EVENTS.TEXT, ' ');
    await driver.send(INPUT_EVENTS.MOVE_DOWN);
  }
  assert.equal(driver.surface().state.selectedIndex, 80);
  assert.equal(driver.savedTools.length, 0);
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.savedTools[0].disabledTools.length, 80);
  await driver.send(INPUT_EVENTS.MOVE_HOME);
  assert.equal(driver.surface().state.selectedIndex, 0);
  await driver.send(INPUT_EVENTS.MOVE_END);
  assert.equal(driver.surface().state.selectedIndex, 80);
});

test('general save does not submit tools draft and tools dirty remains protected from other tabs', async () => {
  const {getGeneralConfigRowIds} = require('../../src/commands/config/state');
  const driver = createToolsDriver();
  await driver.tab('tools');
  await driver.select('edit_file');
  await driver.send(INPUT_EVENTS.SUBMIT);
  const toolsDraft = driver.surface().state;
  await driver.tab('general');
  await driver.send(INPUT_EVENTS.MOVE_RIGHT);
  const saveIndex = getGeneralConfigRowIds(driver.surface().state).indexOf('save');
  for (let index = 0; index < saveIndex; index += 1) await driver.send(INPUT_EVENTS.MOVE_DOWN);
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.savedSettings.length, 1);
  assert.equal(driver.savedTools.length, 0);
  assert.equal(driver.surface().tabs.find((tab) => tab.id === 'tools').status, 'dirty');
  assert.equal(driver.surface().tabs.find((tab) => tab.id === 'general').status, undefined);
  await driver.tab('tools');
  assert.deepEqual(driver.surface().state, toolsDraft);
  await driver.tab('models');
  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.deepEqual(driver.surface().dirtyTabs, ['工具']);
});

test('model editor buffer and local Esc behavior survive switching through tools tab', async () => {
  const driver = createToolsDriver();
  await driver.tab('models');
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.send(INPUT_EVENTS.MOVE_DOWN);
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.send(INPUT_EVENTS.TEXT, 'Renamed provider');
  const modelState = driver.surface().state;
  assert.ok(modelState.editTarget);
  await driver.tab('tools');
  await driver.select('edit_file');
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.tab('models');
  assert.deepEqual(driver.surface().state, modelState);
  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.equal(driver.surface().view, 'models');
  assert.equal(driver.surface().state.editTarget, undefined);
  assert.equal(driver.surface().state.mode, 'form');
  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.equal(driver.surface().state.mode, 'list');
  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.deepEqual(driver.surface().dirtyTabs, ['工具']);
});
