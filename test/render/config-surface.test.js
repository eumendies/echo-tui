const test = require('node:test');
const assert = require('node:assert/strict');

const { INPUT_EVENTS } = require('../../src/input/event-types');
const { displayWidth, stripAnsi } = require('../../src/render/layout');
const { createInitialAppearanceConfigState, createInitialConfigState, createInitialGeneralConfigState, getConfigRows } = require('../../src/commands/config/state');
const { handleConfigPanelEvent } = require('../../src/commands/config/panel-state');
const { listProviderPresets } = require('../../src/config/provider-presets');
const { renderConfigSurface } = require('../../src/render/footer/config-surface');

function renderConfigPanel(state, width, options = {}) {
  return renderConfigSurface({
    kind: 'config',
    view: 'models',
    activeTab: 'models',
    tabs: [
      {id: 'general', label: '常规'},
      {id: 'models', label: '模型与 Provider'},
      {id: 'appearance', label: '外观'}
    ],
    state,
    rows: options.rows || getConfigRows(state)
  }, width, options).lines;
}

function createDraft() {
  return {
    providers: [{
      id: 'chat',
      label: 'Chat',
      preset: 'openai-chat-compatible-api',
      apiKey: 'chat-api-key',
      baseURL: 'https://chat.example/v1',
      headers: {'x-secret': 'never-render-this'},
      models: [{
        id: 'chat-gpt',
        model: 'gpt-chat',
        contextWindow: 64000,
        reasoning: {effort: 'high', summary: 'auto'}
      }]
    }],
    selectedModelId: 'chat-gpt',
    rootConfig: {}
  };
}

function createManyProvidersDraft(count) {
  return {
    providers: Array.from({length: count}, (_value, index) => ({
      id: `provider-${index + 1}`,
      label: `Provider ${index + 1}`,
      preset: 'openai-chat-compatible-api',
      apiKey: `key-${index + 1}`,
      baseURL: `https://provider-${index + 1}.example/v1`,
      models: [{id: `model-${index + 1}`, model: `model-${index + 1}`}]
    })),
    selectedModelId: 'model-1',
    rootConfig: {}
  };
}

function createCodexDraft() {
  return {
    providers: [{
      id: 'codex',
      label: 'OpenAI Codex OAuth',
      preset: 'openai-codex-oauth',
      apiKey: '',
      codexAuthFile: '',
      models: [{id: 'codex-gpt', model: 'gpt-5.5'}]
    }],
    selectedModelId: 'codex-gpt',
    rootConfig: {}
  };
}

function nextState(state, event) {
  const result = handleConfigPanelEvent(state, event);
  assert.equal('state' in result, true);
  return result.state;
}

test('config center renders general tabs, settings, and constrained width', () => {
  const state = createInitialGeneralConfigState({
    compactionThresholdRatio: 0.8,
    skillCatalogContextRatio: 0.02,
    showReasoningSummary: true,
    slashSuggestionMaxVisible: 8
  });
  const layout = renderConfigSurface({
    kind: 'config',
    view: 'general',
    activeTab: 'general',
    tabs: [
      {id: 'general', label: '常规', status: 'dirty'},
      {id: 'models', label: '模型与 Provider'},
      {id: 'appearance', label: '外观'}
    ],
    state
  }, 42, {maxLines: 9});
  const text = layout.lines.map(stripAnsi).join('\n');

  assert.match(text, /常规/);
  assert.match(text, /模型与 Provider/);
  assert.match(text, /自动压缩阈值/);
  assert.match(text, /80%/);
  assert.match(text, /技能列表上下文占比上限/);
  assert.match(text, /2%/);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 38));
});

test('config center highlights active tab with foreground color only', () => {
  const state = createInitialGeneralConfigState({
    compactionThresholdRatio: 0.8,
    skillCatalogContextRatio: 0.02,
    showReasoningSummary: true,
    slashSuggestionMaxVisible: 8
  });
  const layout = renderConfigSurface({
    kind: 'config',
    view: 'general',
    activeTab: 'general',
    tabs: [
      {id: 'general', label: '常规'},
      {id: 'models', label: '模型与 Provider'},
      {id: 'appearance', label: '外观'}
    ],
    state
  }, 70);
  const tabLine = layout.lines.find((line) => stripAnsi(line).includes('[常规]'));

  assert.ok(tabLine);
  assert.equal(tabLine.includes('\x1b[48;5;23m'), false);
});

test('config center renders appearance markers, errors, and discard confirmation', () => {
  const appearance = createInitialAppearanceConfigState([
    {id: 'default', label: 'Default', description: 'cyan', selected: true},
    {id: 'amber', label: 'Amber', description: 'warm', selected: false}
  ]);
  const tabs = [
    {id: 'general', label: '常规'},
    {id: 'models', label: '模型与 Provider', status: 'error'},
    {id: 'appearance', label: '外观'}
  ];
  const appearanceText = renderConfigSurface({kind: 'config', view: 'appearance', activeTab: 'appearance', tabs, state: appearance}, 70).lines.map(stripAnsi).join('\n');
  const confirmText = renderConfigSurface({kind: 'config', view: 'discardConfirm', activeTab: 'general', tabs, dirtyTabs: ['常规', '模型与 Provider'], selectedIndex: 1}, 70).lines.map(stripAnsi).join('\n');

  assert.match(appearanceText, /● Default/);
  assert.match(appearanceText, /○ Amber/);
  assert.match(confirmText, /未保存：常规、模型与 Provider/);
  assert.match(confirmText, /放弃更改/);
});

test('config surface masks API keys and renders base URL mode', () => {
  let state = createInitialConfigState(createDraft());
  const listText = renderConfigPanel(state, 100, {rows: getConfigRows(state)}).join('\n');

  assert.match(listText, /\+ 新增 provider/);
  assert.match(listText, /创建 provider 配置/);
  assert.match(listText, /写入 ~\/\.echo\/config\.json/);
  assert.doesNotMatch(listText, /\badd\b|save changes|not set|empty/);

  state = nextState(state, {type: INPUT_EVENTS.SUBMIT});

  const lines = renderConfigPanel(state, 100, {rows: getConfigRows(state)});
  const text = lines.join('\n');

  assert.match(text, /Chat/);
  assert.match(text, /••••/);
  assert.doesNotMatch(text, /chat-api-key/);
  assert.match(text, /https:\/\/chat\.example\/v1/);
  assert.match(text, /自定义 headers/);
  assert.match(text, /ctx 64,000/);
  assert.match(text, /\+ 新增 model/);
  assert.match(text, /获取 model 列表/);
  assert.match(text, /保存更改/);
  assert.match(text, /写入 ~\/\.echo\/config\.json/);
  assert.doesNotMatch(text, /high|summary|reasoning|never-render-this/);
});

test('config surface renders Codex OAuth as configured without an API key', () => {
  const state = createInitialConfigState(createCodexDraft());
  const text = stripAnsi(renderConfigPanel(state, 100, {rows: getConfigRows(state)}).join('\n'));

  assert.match(text, /● OpenAI Codex OAuth/);
  assert.doesNotMatch(text, /○ OpenAI Codex OAuth/);
});

test('config surface keeps provider preset descriptions visible when styled', () => {
  const codexPresetIndex = listProviderPresets().findIndex((preset) => preset.id === 'openai-codex-oauth');
  const selectedState = {...createInitialConfigState(createCodexDraft()), mode: 'preset', presetIndex: codexPresetIndex};
  const unselectedState = {...selectedState, presetIndex: 0};

  const selectedText = stripAnsi(renderConfigPanel(selectedState, 100, {rows: getConfigRows(selectedState)}).join('\n'));
  const unselectedText = stripAnsi(renderConfigPanel(unselectedState, 100, {rows: getConfigRows(unselectedState)}).join('\n'));

  assert.match(selectedText, /OpenAI Codex OAuth 读取本机 Codex auth\.json/);
  assert.match(unselectedText, /OpenAI Codex OAuth 读取本机 Codex auth\.json/);
  assertUniformLineWidths(renderConfigPanel(selectedState, 100, {rows: getConfigRows(selectedState)}));
});

test('config surface keeps focus bar outside active row background', () => {
  let state = createInitialConfigState(createDraft());
  assertFocusBarOutsideSelectionBackground(renderConfigPanel(state, 100, {rows: getConfigRows(state)}));

  state = nextState(state, {type: INPUT_EVENTS.SUBMIT});
  assertFocusBarOutsideSelectionBackground(renderConfigPanel(state, 100, {rows: getConfigRows(state)}));

  state = {...state, mode: 'preset', presetIndex: 1};
  assertFocusBarOutsideSelectionBackground(renderConfigPanel(state, 100, {rows: getConfigRows(state)}));
});

test('config surface renders provider model listing states', () => {
  let state = createInitialConfigState(createDraft());
  state = nextState(state, {type: INPUT_EVENTS.SUBMIT});
  state = {
    ...state,
    mode: 'modelList',
    modelList: {
      models: [{id: 'gpt-4o'}, {id: 'gpt-4.1'}],
      requestId: 1,
      selectedIndex: 1,
      status: 'ready',
      truncated: true
    }
  };

  const readyText = renderConfigPanel(state, 100, {rows: getConfigRows(state)}).join('\n');
  assert.match(readyText, /可用 MODELS/);
  assert.match(readyText, /gpt-4o/);
  assert.match(readyText, /gpt-4\.1/);
  assert.match(readyText, /仅显示前 100 个 models/);

  const loadingText = renderConfigPanel({...state, modelList: {...state.modelList, status: 'loading', models: []}}, 100, {rows: getConfigRows(state)}).join('\n');
  assert.match(loadingText, /正在从 provider 获取 models/);

  const errorText = renderConfigPanel({...state, modelList: {...state.modelList, status: 'error', models: [], error: '无法列出模型：<redacted>'}}, 100, {rows: getConfigRows(state)}).join('\n');
  assert.match(errorText, /无法列出模型/);
  assertUniformLineWidths(renderConfigPanel(state, 30, {rows: getConfigRows(state)}));
});

test('config surface keeps frame lines the same width', () => {
  let state = createInitialConfigState(createDraft());

  assertUniformLineWidths(renderConfigPanel(state, 100, {rows: getConfigRows(state)}));
  assertUniformLineWidths(renderConfigPanel(state, 60, {rows: getConfigRows(state)}));
  state = nextState(state, {type: INPUT_EVENTS.SUBMIT});
  assertUniformLineWidths(renderConfigPanel(state, 100, {rows: getConfigRows(state)}));
  assertUniformLineWidths(renderConfigPanel(state, 60, {rows: getConfigRows(state)}));
  state = nextState(state, {type: INPUT_EVENTS.SUBMIT});
  assertUniformLineWidths(renderConfigPanel(state, 100, {rows: getConfigRows(state)}));
  assertUniformLineWidths(renderConfigPanel(state, 60, {rows: getConfigRows(state)}));
  assertUniformLineWidths(renderConfigPanel(state, 30, {rows: getConfigRows(state)}));
  assertMaxLineWidth(renderConfigPanel(state, 30, {rows: getConfigRows(state)}), 30);
});

test('config surface windows long provider and preset lists within max lines', () => {
  let state = createInitialConfigState(createManyProvidersDraft(14));
  state = {...state, providerIndex: 12};

  const listLines = renderConfigPanel(state, 100, {maxLines: 10, rows: getConfigRows(state)});
  const listText = stripAnsi(listLines.join('\n'));
  assert.ok(listLines.length <= 10);
  assert.match(listText, /↑ \d+ 更多/);
  assert.match(listText, /Provider 13/);
  assert.match(stripAnsi(listLines[0]), /PROVIDERS/);
  assert.match(stripAnsi(listLines.at(-1)), /^╰/);
  assertUniformLineWidths(listLines);

  state = {...state, mode: 'preset', presetIndex: 14};

  const presetLines = renderConfigPanel(state, 100, {maxLines: 10, rows: getConfigRows(state)});
  const presetText = stripAnsi(presetLines.join('\n'));
  const selectedPreset = listProviderPresets()[state.presetIndex];
  assert.ok(presetLines.length <= 10);
  assert.match(presetText, /↑ \d+ 更多/);
  assert.match(presetText, new RegExp(selectedPreset.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stripAnsi(presetLines[0]), /PROVIDER 类型/);
  assert.match(stripAnsi(presetLines.at(-1)), /^╰/);
  assertUniformLineWidths(presetLines);
});

test('config surface windows long form and model lists within max lines', () => {
  let state = createInitialConfigState(createManyProvidersDraft(1));
  state.draft.providers[0].models = Array.from({length: 16}, (_value, index) => ({
    id: `model-${index + 1}`,
    model: `model-${index + 1}`
  }));
  state = {...state, mode: 'form', formIndex: 13};

  const formLines = renderConfigPanel(state, 100, {maxLines: 10, rows: getConfigRows(state)});
  const formText = stripAnsi(formLines.join('\n'));
  assert.ok(formLines.length <= 10);
  assert.match(formText, /↑ \d+ 更多/);
  assert.match(formText, /model-9/);
  assert.match(stripAnsi(formLines[0]), /Provider 1/);
  assert.match(stripAnsi(formLines.at(-1)), /^╰/);
  assertUniformLineWidths(formLines);

  state = {
    ...state,
    mode: 'modelList',
    modelList: {
      models: Array.from({length: 20}, (_value, index) => ({id: `remote-model-${index + 1}`})),
      requestId: 1,
      selectedIndex: 15,
      status: 'ready',
      truncated: false
    }
  };

  const modelListLines = renderConfigPanel(state, 100, {maxLines: 10, rows: getConfigRows(state)});
  const modelListText = stripAnsi(modelListLines.join('\n'));
  assert.ok(modelListLines.length <= 10);
  assert.match(modelListText, /↑ \d+ 更多/);
  assert.match(modelListText, /remote-model-16/);
  assert.match(stripAnsi(modelListLines[0]), /可用 MODELS/);
  assert.match(stripAnsi(modelListLines.at(-1)), /^╰/);
  assertUniformLineWidths(modelListLines);
});

test('config surface masks custom headers and renders model details without reasoning fields', () => {
  let state = createInitialConfigState(createDraft());
  state = nextState(state, {type: INPUT_EVENTS.SUBMIT});
  const headerRowIndex = getConfigRows(state).findIndex((row) => row.kind === 'headers');
  state = {...state, formIndex: headerRowIndex};
  state = nextState(state, {type: INPUT_EVENTS.SUBMIT});

  const headerText = stripAnsi(renderConfigPanel(state, 100, {rows: getConfigRows(state)}).join('\n'));
  assert.match(headerText, /x-secret/);
  assert.match(headerText, /••••••••/);
  assert.doesNotMatch(headerText, /never-render-this/);

  state = nextState(state, {type: INPUT_EVENTS.ESCAPE});
  const modelRowIndex = getConfigRows(state).findIndex((row) => row.kind === 'model');
  state = {...state, formIndex: modelRowIndex};
  state = nextState(state, {type: INPUT_EVENTS.SUBMIT});

  const modelText = stripAnsi(renderConfigPanel(state, 100, {rows: getConfigRows(state)}).join('\n'));
  assert.match(modelText, /Context window/);
  assert.match(modelText, /64,000/);
  assert.doesNotMatch(modelText, /effort|summary|reasoning|high|auto/);
  assertUniformLineWidths(renderConfigPanel(state, 30, {rows: getConfigRows(state)}));
});

function assertUniformLineWidths(lines) {
  const widths = lines.map(displayWidth);
  assert.deepEqual(widths, Array(lines.length).fill(widths[0]));
}

function assertMaxLineWidth(lines, maxWidth) {
  for (const line of lines) {
    assert.ok(displayWidth(line) <= maxWidth, line);
  }
}

function assertFocusBarOutsideSelectionBackground(lines) {
  const activeLines = lines.filter((line) => stripAnsi(line).includes('▌'));

  assert.ok(activeLines.length > 0);
  for (const line of activeLines) {
    const focusIndex = line.indexOf('▌');
    const backgroundIndex = line.indexOf('\x1b[48');

    assert.ok(focusIndex >= 0, line);
    if (backgroundIndex >= 0) {
      assert.ok(focusIndex < backgroundIndex, line);
    }
  }
}
