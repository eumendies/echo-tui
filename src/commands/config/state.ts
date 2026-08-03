import {getProviderPreset, providerRequiresApiKey} from '../../config/provider-presets';
import {normalizeConfigDraft} from '../../config/llm-config-editor';
import {REASONING_EFFORTS} from '../../types/agent';

import type {
  AppearanceConfigState,
  ConfigCommandState,
  ConfigCommandSurface,
  ConfigFormRow,
  ConfigModelDraft,
  ConfigProviderDraft,
  ConfigSurfaceTab,
  ConfigTabId,
  GeneralConfigState,
  LlmConfigDraft
} from '../../types/command';
import type {AppSettings} from '../../config/app-settings-config';
import type {ReasoningEffort} from '../../types/agent';

type ConfigStateSlot<T> = {
  error?: string;
  state?: T;
};

type ConfigCommandData = {
  activeTab: ConfigTabId;
  appearance?: ConfigStateSlot<AppearanceConfigState>;
  discardConfirm?: {
    dirtyTabs: string[];
    selectedIndex: number;
  };
  general?: ConfigStateSlot<GeneralConfigState>;
  models?: ConfigStateSlot<ConfigCommandState>;
};

const GENERAL_CONFIG_ROW_IDS = [
  'compactionThreshold',
  'skillCatalogRatio',
  'slashSuggestionLimit',
  'reasoningSummary',
  'defaultInteractionMode',
  'autoCompressImages',
  'fileEditMode',
  'instructionFile',
  'save'
] as const;

const CONFIG_TABS: ReadonlyArray<{id: ConfigTabId; label: string}> = [
  {id: 'general', label: '常规'},
  {id: 'models', label: '模型与 Provider'},
  {id: 'appearance', label: '外观'}
];

const CONFIG_MODEL_EFFORT_OPTIONS: readonly (ReasoningEffort | undefined)[] = [undefined, ...REASONING_EFFORTS];

/**
 * 读取模型草稿中的有效默认 effort；未知手写值按未设置展示，等待用户重新选择。
 */
function getConfigModelReasoningEffort(model: ConfigModelDraft | undefined): ReasoningEffort | undefined {
  const effort = model?.reasoning?.effort;
  return typeof effort === 'string' && (REASONING_EFFORTS as readonly string[]).includes(effort)
    ? effort as ReasoningEffort
    : undefined;
}

/**
 * 更新单个模型的默认 effort，同时保留 summary 等其它 reasoning 配置。
 */
function setConfigModelReasoningEffort(model: ConfigModelDraft, effort: ReasoningEffort | undefined): void {
  const reasoning = {...(model.reasoning || {})};

  if (effort === undefined) {
    delete reasoning.effort;
  } else {
    reasoning.effort = effort;
  }

  model.reasoning = Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function configProviderSupportsReasoningEffort(provider: ConfigProviderDraft | undefined): boolean {
  const preset = provider ? getProviderPreset(provider.preset) : undefined;
  return Boolean(preset && preset.agentType !== 'fake');
}

/**
 * 把配置中心 command data 投影为当前 Tab 的只读 surface 快照。
 */
function createConfigSurface(data: ConfigCommandData): ConfigCommandSurface {
  const tabs = createConfigTabs(data);

  if (data.discardConfirm) {
    return {
      kind: 'config',
      view: 'discardConfirm',
      activeTab: data.activeTab,
      tabs,
      dirtyTabs: [...data.discardConfirm.dirtyTabs],
      selectedIndex: data.discardConfirm.selectedIndex
    };
  }

  const slot = getActiveSlot(data);
  if (slot?.error) {
    return {kind: 'config', view: 'error', activeTab: data.activeTab, tabs, error: slot.error};
  }

  if (data.activeTab === 'general' && data.general?.state) {
    return {kind: 'config', view: 'general', activeTab: data.activeTab, tabs, state: structuredClone(data.general.state)};
  }

  if (data.activeTab === 'models' && data.models?.state) {
    return {
      kind: 'config',
      view: 'models',
      activeTab: data.activeTab,
      tabs,
      state: cloneConfigState(data.models.state),
      rows: getConfigRows(data.models.state)
    };
  }

  if (data.activeTab === 'appearance' && data.appearance?.state) {
    return {kind: 'config', view: 'appearance', activeTab: data.activeTab, tabs, state: structuredClone(data.appearance.state)};
  }

  return {kind: 'config', view: 'error', activeTab: data.activeTab, tabs, error: '配置页面未初始化'};
}

function createInitialConfigState(initialDraft: LlmConfigDraft): ConfigCommandState {
  const draft = normalizeConfigDraft(initialDraft);

  return {
    draft,
    editBuffer: '',
    editReplacePending: false,
    formIndex: 0,
    headerDetailIndex: 0,
    headerIndex: 0,
    initialDraftFingerprint: createDraftFingerprint(draft),
    mode: 'list',
    modelDetailIndex: 0,
    modelIndex: 0,
    presetIndex: 0,
    providerIndex: 0
  };
}

function createInitialGeneralConfigState(settings: AppSettings): GeneralConfigState {
  const draft = structuredClone(settings) as AppSettings;
  return {
    draft,
    initialDraftFingerprint: createGeneralDraftFingerprint(draft),
    selectedIndex: 0
  };
}

function createInitialAppearanceConfigState(themes: AppearanceConfigState['themes']): AppearanceConfigState {
  return {
    selectedIndex: Math.max(0, themes.findIndex((theme) => theme.selected)),
    themes: themes.map((theme) => ({...theme}))
  };
}

function cloneConfigState(state: ConfigCommandState): ConfigCommandState {
  return structuredClone(state) as ConfigCommandState;
}

function createDraftFingerprint(draft: LlmConfigDraft): string {
  return JSON.stringify({
    providers: draft.providers,
    selectedModelId: draft.selectedModelId
  });
}

function createGeneralDraftFingerprint(draft: AppSettings): string {
  return JSON.stringify(draft);
}

function isModelConfigDirty(state: ConfigCommandState | undefined): boolean {
  return Boolean(state && createDraftFingerprint(state.draft) !== state.initialDraftFingerprint);
}

function isGeneralConfigDirty(state: GeneralConfigState | undefined): boolean {
  return Boolean(state && createGeneralDraftFingerprint(state.draft) !== state.initialDraftFingerprint);
}

function markModelConfigSaved(state: ConfigCommandState): ConfigCommandState {
  return {
    ...cloneConfigState(state),
    error: undefined,
    feedback: '✓ 模型配置已保存',
    initialDraftFingerprint: createDraftFingerprint(state.draft)
  };
}

function markGeneralConfigSaved(state: GeneralConfigState): GeneralConfigState {
  return {
    ...structuredClone(state),
    error: undefined,
    feedback: '✓ 常规设置已保存',
    initialDraftFingerprint: createGeneralDraftFingerprint(state.draft)
  };
}

function getConfigRows(state: ConfigCommandState): ConfigFormRow[] {
  const provider = state.draft.providers[state.providerIndex];

  if (!provider) {
    return [];
  }

  const preset = getProviderPreset(provider.preset);
  const rows: ConfigFormRow[] = [
    {kind: 'preset'},
    {kind: 'field', field: 'label'}
  ];

  if (!preset || providerRequiresApiKey(preset) || provider.apiKey !== '') {
    rows.push({kind: 'field', field: 'apiKey'});
  }

  if (!preset || preset.baseURLMode !== 'hidden') {
    rows.push({kind: 'field', field: 'baseURL'});
  }

  if (preset?.codexOAuth) {
    rows.push({kind: 'field', field: 'codexAuthFile'});
  }

  rows.push({kind: 'headers'});
  provider.models.forEach((_model, modelIndex) => rows.push({kind: 'model', modelIndex}));
  rows.push({kind: 'addModel'});
  rows.push({kind: 'listModels'});
  rows.push({kind: 'deleteProvider'});
  rows.push({kind: 'save'});
  return rows;
}

function createConfigTabs(data: ConfigCommandData): ConfigSurfaceTab[] {
  return CONFIG_TABS.map((tab) => {
    const slot = tab.id === 'general' ? data.general : tab.id === 'models' ? data.models : data.appearance;
    const dirty = tab.id === 'general'
      ? isGeneralConfigDirty(data.general?.state)
      : tab.id === 'models'
        ? isModelConfigDirty(data.models?.state)
        : false;
    return {
      ...tab,
      ...(slot?.error ? {status: 'error' as const} : dirty ? {status: 'dirty' as const} : {})
    };
  });
}

function getActiveSlot(data: ConfigCommandData): ConfigStateSlot<unknown> | undefined {
  return data.activeTab === 'general' ? data.general : data.activeTab === 'models' ? data.models : data.appearance;
}

export {
  CONFIG_MODEL_EFFORT_OPTIONS,
  GENERAL_CONFIG_ROW_IDS,
  CONFIG_TABS,
  cloneConfigState,
  configProviderSupportsReasoningEffort,
  createConfigSurface,
  createDraftFingerprint,
  createInitialAppearanceConfigState,
  createInitialConfigState,
  createInitialGeneralConfigState,
  getConfigRows,
  getConfigModelReasoningEffort,
  isGeneralConfigDirty,
  isModelConfigDirty,
  markGeneralConfigSaved,
  markModelConfigSaved,
  setConfigModelReasoningEffort
};

export type {
  ConfigCommandData,
  ConfigStateSlot
};
