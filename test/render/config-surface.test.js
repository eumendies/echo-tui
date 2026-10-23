const test = require('node:test');
const assert = require('node:assert/strict');

const { INPUT_EVENTS } = require('../../src/input/event-types');
const { displayWidth, stripAnsi } = require('../../src/render/layout');
const { createInitialAppearanceConfigState, createInitialConfigState, createInitialGeneralConfigState, getConfigRows, getGeneralConfigRowIds } = require('../../src/commands/config/state');
const {DEFAULT_APP_SETTINGS} = require('../../src/config/app-settings-config');
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

function renderSandboxPanel(state, width, options = {}) {
  return renderConfigSurface({
    kind: 'config',
    view: 'sandbox',
    activeTab: 'sandbox',
    tabs: [
      {id: 'general', label: '常规'},
      {id: 'models', label: '模型与 Provider'},
      {id: 'sandbox', label: '沙箱', status: 'dirty'},
      {id: 'appearance', label: '外观'}
    ],
    state
  }, width, options).lines;
}

test('renderConfigSurface projects sandbox tab rows, selection, and dirty tab marker', () => {
  const draft = {mode: 'workspace-write', network: true, extraWritablePaths: ['/Users/me/code']};
  const lines = renderSandboxPanel({
    draft,
    initialDraftFingerprint: JSON.stringify(draft),
    selectedIndex: 3
  }, 100).map((line) => stripAnsi(line));
  const text = lines.join('\n');

  assert.match(text, /\[● 沙箱\]/);
  assert.match(text, /沙箱档位\s+工作区可写/);
  assert.match(text, /允许网络访问\s+开/);
  assert.match(text, /\/Users\/me\/code/);
  assert.match(text, /额外可写目录/);
  assert.match(text, /↳ \/Users\/me\/code/);
  assert.match(text, /Enter 移除/);
  assert.match(text, /\+ 添加可写目录/);
  assert.match(text, /保存沙箱设置/);
  assert.match(text, /写入 ~\/\.echo\/config\.json/);
});

test('renderConfigSurface renders sandbox path input with cursor, error, and cancel hint', () => {
  const lines = renderSandboxPanel({
    draft: {mode: 'off', network: false, extraWritablePaths: []},
    initialDraftFingerprint: '',
    pathInput: '/Users/me/cod',
    selectedIndex: 2,
    error: '路径必须是绝对路径'
  }, 100).map((line) => stripAnsi(line));
  const text = lines.join('\n');

  assert.match(text, /新目录路径\s+\/Users\/me\/cod█/);
  assert.match(text, /路径必须是绝对路径/);
  assert.match(text, /Enter 确认添加 · Esc 取消/);
  assert.doesNotMatch(text, /保存沙箱设置/);
});

test('renderConfigSurface keeps the tail of long sandbox path input visible', () => {
  const lines = renderSandboxPanel({
    draft: {mode: 'off', network: false, extraWritablePaths: []},
    initialDraftFingerprint: '',
    pathInput: 'HEAD' + 'a'.repeat(600) + 'TAIL',
    selectedIndex: 2,
    error: '路径必须是绝对路径'
  }, 100).map((line) => stripAnsi(line));
  const text = lines.join('\n');

  // 显示保留结尾(光标与最新输入),开头被截断并带省略号。
  assert.match(text, /TAIL█/);
  assert.doesNotMatch(text, /HEAD/);
});

test('renderConfigSurface shows sandbox save feedback and windows long path lists', () => {
  const paths = Array.from({length: 12}, (_value, index) => `/tmp/sandbox-${index + 1}`);
  const draft = {mode: 'read-only', network: false, extraWritablePaths: paths};
  const lines = renderSandboxPanel({
    draft,
    initialDraftFingerprint: JSON.stringify(draft),
    feedback: '✓ 沙箱设置已保存',
    selectedIndex: 0
  }, 100, {maxLines: 12}).map((line) => stripAnsi(line));
  const text = lines.join('\n');

  assert.match(text, /沙箱档位\s+只读/);
  assert.match(text, /✓ 沙箱设置已保存/);
  assert.match(text, /更多/);
  assert.match(text, /额外可写目录/);
  assert.match(text, /↳ \/tmp\/sandbox-1/);
});

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
    activeTurnMessagePolicy: 'pending',
    agentInstructionFileName: 'CLAUDE.md',
    autoCompressImages: true,
    checkUpdatesOnStartup: true,
    compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'plan',
    mouseInteractionEnabled: false,
    skillCatalogContextRatio: 0.02,
    showReasoningSummary: true,
    slashSuggestionMaxVisible: 8,
    toolApprovalMode: 'manual'
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
  }, 42, {maxLines: 15});
  const text = layout.lines.map(stripAnsi).join('\n');

  assert.match(text, /常规/);
  assert.match(text, /模型与 Provider/);
  assert.match(text, /自动压缩阈值/);
  assert.match(text, /80%/);
  assert.match(text, /技能列表上下文占比上限/);
  assert.match(text, /2%/);
  assert.match(text, /UI 鼠标交互\s+关/);
  assert.match(text, /默认启动模式/);
  assert.match(text, /plan/);
  assert.match(text, /启动时检查更新\s+开/);
  assert.doesNotMatch(text, /文件编辑工具|edit_file|apply_patch/);
  assert.match(text, /超限图片自动压缩/);
  assert.match(text, /↓ 3 更多/);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 38));
});

test('config center renders Chinese message policies and bounded tool safety hint', () => {
  for (const [policy, label] of [['pending', '排队'], ['steer', '即时引导']]) {
    const state = createInitialGeneralConfigState({...DEFAULT_APP_SETTINGS, activeTurnMessagePolicy: policy});
    state.selectedIndex = getGeneralConfigRowIds(state).indexOf('activeTurnMessagePolicy');
    const surface = {kind: 'config', view: 'general', activeTab: 'general', tabs: [{id: 'general', label: '常规'}], state};
    const layout = renderConfigSurface(surface, 100, {maxLines: 12});
    const text = layout.lines.map(stripAnsi).join('\n');
    assert.match(text, new RegExp(`响应期间发送消息\\s+${label}`));
    assert.match(text, /下一轮生效/);
    assert.match(text, /即时引导不强停工具，等待其完成/);
    assert.ok(layout.lines.length <= 12);
    assert.ok(layout.lines.every((line) => displayWidth(line) <= 96));
    for (const columns of [24, 42, 70]) {
      const narrow = renderConfigSurface(surface, columns, {maxLines: 10});
      assert.ok(narrow.lines.length <= 10);
      assert.ok(narrow.lines.every((line) => displayWidth(line) <= columns - 4));
      assert.match(narrow.lines.map(stripAnsi).join('\n'), columns < 42 ? /响应期间发送/ : /响应期间发送消息/);
    }
  }
});

test('config center highlights active tab with foreground color only', () => {
  const state = createInitialGeneralConfigState({
    activeTurnMessagePolicy: 'pending',
    agentInstructionFileName: 'AGENTS.md',
    autoCompressImages: false,
    checkUpdatesOnStartup: true,
    compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal',
    mouseInteractionEnabled: false,
    skillCatalogContextRatio: 0.02,
    showReasoningSummary: true,
    slashSuggestionMaxVisible: 8,
    toolApprovalMode: 'manual'
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

test('config center only renders approval model for auto draft', () => {
  const settings = {
    activeTurnMessagePolicy: 'pending',
    agentInstructionFileName: 'AGENTS.md',
    autoCompressImages: true,
    checkUpdatesOnStartup: true,
    compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal',
    mouseInteractionEnabled: true,
    skillCatalogContextRatio: 0.02,
    showReasoningSummary: true,
    slashSuggestionMaxVisible: 8,
    toolApprovalMode: 'manual',
    toolApprovalModelProfileId: 'reviewer'
  };
  const profiles = [{id: 'reviewer', model: 'gpt-review', provider: 'openai'}];
  const tabs = [{id: 'general', label: '常规'}];
  const manual = createInitialGeneralConfigState(settings, profiles);
  const manualText = renderConfigSurface({kind: 'config', view: 'general', activeTab: 'general', tabs, state: manual}, 90).lines.map(stripAnsi).join('\n');
  assert.match(manualText, /工具审批模式/);
  assert.match(manualText, /manual/);
  assert.doesNotMatch(manualText, /自动审批模型/);

  const auto = createInitialGeneralConfigState({...settings, toolApprovalMode: 'auto'}, profiles);
  const autoText = renderConfigSurface({kind: 'config', view: 'general', activeTab: 'general', tabs, state: auto}, 90).lines.map(stripAnsi).join('\n');
  assert.match(autoText, /工具审批模式/);
  assert.match(autoText, /自动审批模型/);
  assert.match(autoText, /gpt-review \(openai\)/);
  assert.doesNotMatch(autoText, /reviewer/);

  const unavailable = createInitialGeneralConfigState({...settings, toolApprovalMode: 'auto', toolApprovalModelProfileId: undefined}, []);
  const unavailableText = renderConfigSurface({kind: 'config', view: 'general', activeTab: 'general', tabs, state: unavailable}, 90).lines.map(stripAnsi).join('\n');
  assert.match(unavailableText, /未配置（无法保存 auto）/);
});

test('config center renders approval API model name and provider without the profile id', () => {
  const state = createInitialGeneralConfigState({
    agentInstructionFileName: 'AGENTS.md',
    autoCompressImages: true,
    checkUpdatesOnStartup: true,
    compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal',
    mouseInteractionEnabled: true,
    skillCatalogContextRatio: 0.02,
    showReasoningSummary: true,
    slashSuggestionMaxVisible: 8,
    toolApprovalMode: 'auto',
    toolApprovalModelProfileId: 'deepseek-v4-pro'
  }, [{id: 'deepseek-v4-pro', model: 'deepseek-v4-pro-202608', provider: 'deepseek'}]);
  const layout = renderConfigSurface({
    kind: 'config',
    view: 'general',
    activeTab: 'general',
    tabs: [{id: 'general', label: '常规'}],
    state
  }, 90);
  const modelLine = stripAnsi(layout.lines.find((line) => stripAnsi(line).includes('自动审批模型')));

  assert.match(modelLine, /deepseek-v4-pro-202608 \(deepseek\)/);
  assert.doesNotMatch(modelLine, /…/);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 86));
});

test('config center separates a selected approval model from its label at constrained width', () => {
  const state = createInitialGeneralConfigState({
    agentInstructionFileName: 'AGENTS.md',
    autoCompressImages: true,
    checkUpdatesOnStartup: true,
    compactionThresholdRatio: 0.8,
    defaultInteractionMode: 'normal',
    mouseInteractionEnabled: true,
    skillCatalogContextRatio: 0.02,
    showReasoningSummary: true,
    slashSuggestionMaxVisible: 8,
    toolApprovalMode: 'auto',
    toolApprovalModelProfileId: 'deepseek-api-deepseek-v4-flash'
  }, [{id: 'deepseek-api-deepseek-v4-flash', model: 'deepseek-v4-flash', provider: 'deepseek-api'}]);
  state.selectedIndex = getGeneralConfigRowIds(state).indexOf('toolApprovalModel');

  const layout = renderConfigSurface({
    kind: 'config',
    view: 'general',
    activeTab: 'general',
    tabs: [{id: 'general', label: '常规'}],
    state
  }, 55);
  const modelLine = stripAnsi(layout.lines.find((line) => stripAnsi(line).includes('自动审批模型')));

  assert.match(modelLine, /自动审批模型 {2}deepseek-v4/);
  assert.match(modelLine, /…/);
  assert.match(modelLine, /… │$/);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 51));
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

test('config surface masks custom headers and renders model effort without exposing other reasoning fields', () => {
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
  assert.match(modelText, /默认 Effort/);
  assert.match(modelText, /high/);
  assert.doesNotMatch(modelText, /summary|reasoning|auto/);
  assertUniformLineWidths(renderConfigPanel(state, 30, {rows: getConfigRows(state)}));
});

test('config surface hides model effort for fake agent', () => {
  const state = {
    ...createInitialConfigState({
      providers: [{id: 'default', label: 'Fake Agent', preset: 'fake-agent', apiKey: '', models: [{id: 'default', model: 'echo-fake-agent'}]}],
      selectedModelId: 'default',
      rootConfig: {}
    }),
    mode: 'modelDetail'
  };
  const text = stripAnsi(renderConfigPanel(state, 100, {rows: getConfigRows(state)}).join('\n'));

  assert.doesNotMatch(text, /Effort/);
  assert.match(text, /设为默认 model|当前默认 model/);
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

const {CONFIG_TABS, createConfigSurface, createInitialToolsConfigState} = require('../../src/commands/config/state');
const {createMainAgentToolCatalog} = require('../../src/tools/main-agent-tool-catalog');

function toolsSurface(state) {
  return {kind: 'config', view: 'tools', activeTab: 'tools', tabs: CONFIG_TABS.map((tab) => ({...tab})), state};
}

test('tools surface shows compact Chinese choices, one Todo, independent editors, Bash lock and availability', () => {
  const catalog = [
    ...['run_bash_command', 'apply_patch', 'edit_file', 'create_todos', 'complete_todo'].map((name) => ({name, available: true})),
    {name: 'list_mcp_resources', available: false},
    {name: 'mcp__docs__search', available: true, serverName: 'docs'},
    {name: 'mcp__offline__search', available: false, serverName: 'offline'}
  ];
  const state = createInitialToolsConfigState({disabledTools: ['edit_file', 'mcp__offline__search']}, catalog);
  const lines = renderConfigSurface(toolsSurface(state), 120).lines;
  const text = lines.map(stripAnsi).join('\n');
  assert.match(text, /主 Agent 工具/);
  assert.doesNotMatch(text, /工具选择非权限限制|新工具默认开启|不影响子 Agent|当前可用|run_bash_command:/);
  assert.match(text, /内置工具/);
  assert.doesNotMatch(text, /未知项|未识别工具/);
  assert.match(text, /● run_bash_command.*运行 Bash 命令（必选）/);
  assert.equal((text.match(/run_bash_command/g) || []).length, 1);
  assert.match(text, /● apply_patch.*应用文件补丁/);
  assert.match(text, /○ edit_file.*替换文件内容/);
  assert.equal((text.match(/[●○] Todo/g) || []).length, 1);
  assert.doesNotMatch(text, /[●○] create_todos|[●○] complete_todo/);
  assert.match(text, /Todo.*创建与完成任务/);
  assert.doesNotMatch(text, /create_todos|complete_todo/);
  assert.match(text, /MCP · docs/);
  assert.match(text, /MCP · offline/);
  assert.match(text, /● mcp__docs__search.*调用 MCP 工具/);
  assert.match(text, /● list_mcp_resources.*暂不可用/);
  assert.match(text, /○ mcp__offline__search.*暂不可用/);
  assert.match(text, /Space\/Enter 切换/);
  assert.match(text, /保存主 Agent 工具/);
  assertUniformLineWidths(lines);
});

test('tools surface right-aligns short descriptions using the shared configuration row layout', () => {
  const catalog = createMainAgentToolCatalog({disabledTools: []});
  const initial = createInitialToolsConfigState({disabledTools: []}, catalog);
  for (const columns of [80, 120]) {
    for (const selectedIndex of [0, 1, initial.items.length]) {
      const lines = renderConfigSurface(toolsSurface({...initial, selectedIndex}), columns).lines;
      const plainLines = lines.map(stripAnsi);
      for (const item of initial.items) {
        const row = plainLines.find((line) => line.includes(` ${item.label} `));
        assert.ok(row, item.label);
        const description = item.available ? item.description : `${item.description}（暂不可用）`;
        assert.ok(row.endsWith(`${description} │`), row);
        assert.match(item.description, /[\u4e00-\u9fff]/);
        assert.ok(displayWidth(item.description) <= 28, item.description);
        assert.notEqual(item.description, '调用内置工具', item.label);
      }
      assertUniformLineWidths(lines);
    }
  }
});

test('tools surface separates unresolved preferences only when present, not known unavailable resources', () => {
  const catalog = createMainAgentToolCatalog({disabledTools: ['obsolete_tool', 'mcp__offline__search']});
  const state = createInitialToolsConfigState({disabledTools: ['obsolete_tool', 'mcp__offline__search']}, catalog);
  const text = renderConfigSurface(toolsSurface(state), 120).lines.map(stripAnsi).join('\n');
  assert.equal((text.match(/未识别工具/g) || []).length, 1);
  assert.doesNotMatch(text, /内置工具 \/|未知项|Tool is unknown/);
  assert.ok(text.indexOf('list_mcp_resources') < text.indexOf('未识别工具'));
  assert.ok(text.indexOf('obsolete_tool') > text.indexOf('未识别工具'));
  assert.ok(text.indexOf('mcp__offline__search') > text.indexOf('未识别工具'));
  assert.match(text, /○ obsolete_tool.*未发现工具定义（暂不可用）/);
  assertUniformLineWidths(renderConfigSurface(toolsSurface(state), 120).lines);
});

test('tools surface spends the removed hint rows on list entries rather than scrolling', () => {
  const catalog = ['run_bash_command', 'apply_patch', 'edit_file'].map((name) => ({name, available: true}));
  const state = createInitialToolsConfigState({disabledTools: []}, catalog);
  const layout = renderConfigSurface(toolsSurface(state), 100, {maxLines: 9});
  const text = layout.lines.map(stripAnsi).join('\n');
  assert.equal(layout.lines.length, 9);
  assert.doesNotMatch(text, /更多|run_bash_command:/);
  assert.match(text, /run_bash_command/);
  assert.match(text, /apply_patch/);
  assert.match(text, /edit_file/);
  assert.match(text, /保存主 Agent 工具/);
});

test('tools surface keeps every focus and save accessible within narrow and tiny height budgets', () => {
  const catalog = Array.from({length: 36}, (_, index) => ({name: `mcp__docs__tool_${index}`, available: index % 2 === 0, serverName: 'docs'}));
  const state = createInitialToolsConfigState({disabledTools: ['mcp__docs__tool_1']}, catalog);
  for (const columns of [24, 42, 100]) {
    for (const maxLines of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
      for (let index = 0; index <= state.items.length; index += 1) {
        const layout = renderConfigSurface(toolsSurface({...state, selectedIndex: index}), columns, {maxLines});
        const text = layout.lines.map(stripAnsi).join('\n');
        assert.ok(layout.lines.length <= maxLines, `${columns}x${maxLines}, focus ${index}`);
        assert.ok(layout.lines.every((line) => displayWidth(line) <= columns - 4));
        const focusLine = layout.lines.map(stripAnsi).find((line) => line.includes('▌'));
        assert.ok(focusLine, `${columns}x${maxLines}, focus ${index}\n${text}`);
        if (columns >= 42) assert.match(focusLine, index === state.items.length ? /保存主 Agent/ : new RegExp(`tool_${index}(?:\\s|$)`));
        if (maxLines >= 5) assert.match(layout.lines.map(stripAnsi)[1], /\[工具\]/);
      }
    }
  }
});

test('tools surface budgets save feedback and errors without hiding the active row', () => {
  const initial = createInitialToolsConfigState({disabledTools: []}, [{name: 'web_fetch', available: true}]);
  for (const status of [{error: '工具保存失败'}, {feedback: '✓ 主 Agent 工具已保存，下轮生效'}]) {
    const state = {...initial, ...status, selectedIndex: initial.items.length};
    const layout = renderConfigSurface(toolsSurface(state), 100, {maxLines: 8});
    const text = layout.lines.map(stripAnsi).join('\n');
    assert.ok(layout.lines.length <= 8);
    assert.match(text, /▌.*保存主 Agent 工具/);
    assert.match(text, status.error ? /工具保存失败/ : /已保存，下轮生效/);
    assertUniformLineWidths(layout.lines);
  }
});

test('config surface reads each tab slot and projects its isolated error status', () => {
  for (const tab of CONFIG_TABS) {
    const error = `${tab.label}配置读取失败`;
    const surface = createConfigSurface({activeTab: tab.id, [tab.id]: {error}});
    assert.equal(surface.view, 'error');
    assert.equal(surface.error, error);
    assert.equal(surface.tabs.find(({id}) => id === tab.id).status, 'error');
    assert.ok(surface.tabs.filter(({id}) => id !== tab.id).every(({status}) => status === undefined));
  }
});

test('tools state copies the normalized snapshot draft without sharing mutable arrays', () => {
  const draft = Object.freeze({disabledTools: Object.freeze(['create_todos', 'complete_todo'])});
  const state = createInitialToolsConfigState(draft, createMainAgentToolCatalog({disabledTools: draft.disabledTools}));
  assert.deepEqual(state.draft, draft);
  state.draft.disabledTools.push('web_fetch');
  assert.deepEqual(draft.disabledTools, ['create_todos', 'complete_todo']);
});
