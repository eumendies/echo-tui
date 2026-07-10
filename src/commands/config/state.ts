import {getProviderPreset, providerRequiresApiKey} from '../../config/provider-presets';
import {normalizeConfigDraft} from '../../config/llm-config-editor';
import type {
  ConfigCommandState,
  ConfigCommandSurface,
  ConfigFormRow,
  InfoCommandSurface,
  LlmConfigDraft
} from '../../types/command';

type ConfigCommandData = {
  state?: ConfigCommandState;
  result?: {
    providersCount: number;
    modelsCount: number;
  };
};

function createConfigSurface(data: ConfigCommandData): ConfigCommandSurface {
  if (data.result) {
    return {kind: 'config', result: data.result};
  }

  if (!data.state) {
    return {kind: 'config'};
  }

  return {
    kind: 'config',
    state: cloneConfigState(data.state),
    rows: getConfigRows(data.state)
  };
}

function createConfigErrorSurface(error: string): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/config',
    lines: ['无法打开配置面板。', error],
    dismissHint: 'Esc 关闭'
  };
}

function createResult(state: ConfigCommandState): ConfigCommandData['result'] {
  return {
    providersCount: state.draft.providers.length,
    modelsCount: state.draft.providers.reduce((sum, provider) => sum + provider.models.length, 0)
  };
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

function cloneConfigState(state: ConfigCommandState): ConfigCommandState {
  return structuredClone(state) as ConfigCommandState;
}

function createDraftFingerprint(draft: LlmConfigDraft): string {
  return JSON.stringify({
    providers: draft.providers,
    selectedModelId: draft.selectedModelId
  });
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

export {
  cloneConfigState,
  createConfigErrorSurface,
  createConfigSurface,
  createDraftFingerprint,
  createInitialConfigState,
  createResult,
  getConfigRows
};

export type {
  ConfigCommandData
};
