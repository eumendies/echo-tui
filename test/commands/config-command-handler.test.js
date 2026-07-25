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
  assert.equal(driver.getState().mode, 'form');
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
