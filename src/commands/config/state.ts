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
  LlmConfigDraft,
  SandboxConfigDraft,
  SandboxConfigState,
  SavedModelProfile
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
  sandbox?: ConfigStateSlot<SandboxConfigState>;
};

const GENERAL_CONFIG_BASE_ROW_IDS = [
  'compactionThreshold',
  'skillCatalogRatio',
  'slashSuggestionLimit',
  'reasoningSummary',
  'defaultInteractionMode',
  'autoCompressImages',
  'fileEditMode',
  'toolApprovalMode',
  'goalEvaluationModel',
  'instructionFile',
  'save'
] as const;

type GeneralConfigRowId = typeof GENERAL_CONFIG_BASE_ROW_IDS[number] | 'toolApprovalModel';

/**
 * 根据常规草稿投影当前真实行集合；handler 和 renderer 必须共享该结果以避免动态焦点错位。
 */
function getGeneralConfigRowIds(state: Pick<GeneralConfigState, 'draft'>): GeneralConfigRowId[] {
  const rows = [...GENERAL_CONFIG_BASE_ROW_IDS] as GeneralConfigRowId[];
  if (state.draft.toolApprovalMode === 'auto') {
    rows.splice(rows.indexOf('toolApprovalMode') + 1, 0, 'toolApprovalModel');
  }
  return rows;
}

const CONFIG_TABS: ReadonlyArray<{id: ConfigTabId; label: string}> = [
  {id: 'general', label: '常规'},
  {id: 'models', label: '模型与 Provider'},
  {id: 'sandbox', label: '沙箱'},
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

  if (data.activeTab === 'sandbox' && data.sandbox?.state) {
    return {kind: 'config', view: 'sandbox', activeTab: data.activeTab, tabs, state: structuredClone(data.sandbox.state)};
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

function createInitialGeneralConfigState(settings: AppSettings, savedModelProfiles: SavedModelProfile[] = []): GeneralConfigState {
  const draft = structuredClone(settings) as AppSettings;
  return {
    savedModelProfiles: savedModelProfiles.map((profile) => ({...profile})),
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

const SANDBOX_MODE_CYCLE: readonly SandboxConfigDraft['mode'][] = ['off', 'read-only', 'workspace-write'];

type SandboxConfigRowId = 'mode' | 'network' | 'header' | 'addPath' | 'save' | `path:${number}`;
// header:「额外可写目录」分组标题行,仅用于渲染分组,焦点移动时必须跳过它。

/**
 * 根据沙箱草稿投影当前真实行集合；handler 和 renderer 必须共享该结果以避免动态焦点错位。
 */
function getSandboxConfigRowIds(state: Pick<SandboxConfigState, 'draft'>): SandboxConfigRowId[] {
  const rows: SandboxConfigRowId[] = ['mode', 'network'];
  if (state.draft.extraWritablePaths.length > 0) {
    // 仅在存在路径行时插入标题行,让额外可写目录区在面板中自解释。
    rows.push('header');
  }
  state.draft.extraWritablePaths.forEach((_path, index) => rows.push(`path:${index}`));
  rows.push('addPath', 'save');
  return rows;
}

function createInitialSandboxConfigState(draft: SandboxConfigDraft): SandboxConfigState {
  return {
    draft,
    initialDraftFingerprint: createSandboxDraftFingerprint(draft),
    selectedIndex: 0
  };
}

function createSandboxDraftFingerprint(draft: SandboxConfigDraft): string {
  return JSON.stringify(draft);
}

function isSandboxConfigDirty(state: SandboxConfigState | undefined): boolean {
  return Boolean(state && createSandboxDraftFingerprint(state.draft) !== state.initialDraftFingerprint);
}

function markSandboxConfigSaved(state: SandboxConfigState): SandboxConfigState {
  return {
    ...structuredClone(state),
    error: undefined,
    feedback: '✓ 沙箱设置已保存',
    initialDraftFingerprint: createSandboxDraftFingerprint(state.draft)
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
    const slot = tab.id === 'general'
      ? data.general
      : tab.id === 'models'
        ? data.models
        : tab.id === 'sandbox'
          ? data.sandbox
          : data.appearance;
    const dirty = tab.id === 'general'
      ? isGeneralConfigDirty(data.general?.state)
      : tab.id === 'models'
        ? isModelConfigDirty(data.models?.state)
        : tab.id === 'sandbox'
          ? isSandboxConfigDirty(data.sandbox?.state)
          : false;
    return {
      ...tab,
      ...(slot?.error ? {status: 'error' as const} : dirty ? {status: 'dirty' as const} : {})
    };
  });
}

function getActiveSlot(data: ConfigCommandData): ConfigStateSlot<unknown> | undefined {
  if (data.activeTab === 'general') {
    return data.general;
  }
  if (data.activeTab === 'models') {
    return data.models;
  }
  if (data.activeTab === 'sandbox') {
    return data.sandbox;
  }
  return data.appearance;
}

export {
  CONFIG_MODEL_EFFORT_OPTIONS,
  getGeneralConfigRowIds,
  CONFIG_TABS,
  SANDBOX_MODE_CYCLE,
  cloneConfigState,
  configProviderSupportsReasoningEffort,
  createConfigSurface,
  createDraftFingerprint,
  createInitialAppearanceConfigState,
  createInitialConfigState,
  createInitialGeneralConfigState,
  createInitialSandboxConfigState,
  getConfigRows,
  getConfigModelReasoningEffort,
  getSandboxConfigRowIds,
  isGeneralConfigDirty,
  isModelConfigDirty,
  isSandboxConfigDirty,
  markGeneralConfigSaved,
  markModelConfigSaved,
  markSandboxConfigSaved,
  setConfigModelReasoningEffort
};

export type {
  ConfigCommandData,
  ConfigStateSlot
};
