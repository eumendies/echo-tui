import {INPUT_EVENTS} from '../../input/event-types';
import {getProviderPreset, listProviderPresets, providerRequiresApiKey} from '../../config/provider-presets';
import {normalizeConfigDraft, validateConfigDraft} from '../../config/llm-config-editor';
import {
  cloneConfigState,
  createDraftFingerprint,
  getConfigRows
} from './state';
import type {
  ConfigCommandState,
  ConfigEditTarget,
  ConfigFormRow,
  ConfigProviderDraft,
  LlmConfigDraft
} from '../../types/command';
import type {InputEvent} from '../../types/input';

type ConfigCommandEventResult =
  | {kind: 'continue'; state: ConfigCommandState}
  | {kind: 'cancel'}
  | {kind: 'listModels'; provider: ConfigProviderDraft; state: ConfigCommandState}
  | {kind: 'save'; state: ConfigCommandState; draft: LlmConfigDraft};

const PRESETS = listProviderPresets();
let nextModelListRequestId = 1;

/**
 * 处理 /config 面板输入事件；只变更 command session data，不读写文件或终端。
 */
function handleConfigPanelEvent(initialState: ConfigCommandState, event: InputEvent): ConfigCommandEventResult {
  return new ConfigPanelController(initialState, event).handle();
}

/**
 * 承载 /config 面板的状态转移；每次输入事件创建一个短生命周期 controller。
 */
class ConfigPanelController {
  private state: ConfigCommandState;

  constructor(initialState: ConfigCommandState, private readonly event: InputEvent) {
    this.state = cloneConfigState(initialState);
  }

  handle(): ConfigCommandEventResult {
    if (this.state.editTarget) {
      return this.handleEditEvent();
    }

    if (this.state.mode === 'preset') {
      return this.handlePresetEvent();
    }
    if (this.state.mode === 'modelList') {
      return this.handleModelListEvent();
    }
    if (this.state.mode === 'form') {
      return this.handleFormEvent();
    }
    if (this.state.mode === 'headerList') {
      return this.handleHeaderListEvent();
    }
    if (this.state.mode === 'headerDetail') {
      return this.handleHeaderDetailEvent();
    }
    if (this.state.mode === 'modelDetail') {
      return this.handleModelDetailEvent();
    }
    if (this.state.mode === 'discardConfirm') {
      return this.handleDiscardConfirmEvent();
    }
    return this.handleListEvent();
  }

  private getState(): ConfigCommandState {
    return cloneConfigState(this.state);
  }

  private activeProvider(): ConfigProviderDraft | undefined {
    return this.state.draft.providers[this.state.providerIndex];
  }

  private activeModel() {
    return this.activeProvider()?.models[this.state.modelIndex];
  }

  private updateDraft(draft: LlmConfigDraft): void {
    this.state = {
      ...this.state,
      draft,
      error: undefined,
      providerIndex: clamp(this.state.providerIndex, 0, Math.max(0, draft.providers.length + 1))
    };
  }

  private isDirty(): boolean {
    return createDraftFingerprint(this.state.draft) !== this.state.initialDraftFingerprint;
  }

  private saveCurrentDraft(): ConfigCommandEventResult {
    const validation = validateConfigDraft(this.state.draft);

    if (!validation.ok) {
      this.state = {...this.state, error: validation.error};
      return {kind: 'continue', state: this.getState()};
    }

    return {kind: 'save', state: this.getState(), draft: normalizeConfigDraft(this.state.draft)};
  }

  private handleListEvent(): ConfigCommandEventResult {
    const addIndex = this.state.draft.providers.length;
    const saveIndex = addIndex + 1;

    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      if (this.isDirty()) {
        this.state = {...this.state, error: undefined, formIndex: 0, mode: 'discardConfirm'};
        return {kind: 'continue', state: this.getState()};
      }

      return {kind: 'cancel'};
    }

    if (this.event.type === INPUT_EVENTS.MOVE_UP || this.event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = this.event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.state = {...this.state, error: undefined, providerIndex: clamp(this.state.providerIndex + delta, 0, saveIndex)};
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.SUBMIT) {
      if (this.state.providerIndex === addIndex) {
        this.addProvider();
      } else if (this.state.providerIndex === saveIndex) {
        return this.saveCurrentDraft();
      } else if (this.activeProvider()) {
        this.state = {...this.state, error: undefined, formIndex: 0, mode: 'form'};
      }
    } else if (this.event.type === INPUT_EVENTS.TEXT && this.event.value === 'd') {
      this.deleteProvider();
    }

    return {kind: 'continue', state: this.getState()};
  }

  private addProvider(): void {
    const preset = PRESETS[0];
    const draft = normalizeConfigDraft({
      ...this.state.draft,
      providers: [
        ...this.state.draft.providers,
        {
          id: preset.id,
          label: preset.label,
          preset: preset.id,
          apiKey: '',
          models: preset.suggestedModels?.[0] ? [{id: '', model: preset.suggestedModels[0]}] : []
        }
      ]
    });

    this.state = {
      ...this.state,
      draft,
      error: undefined,
      formIndex: 0,
      mode: 'form',
      providerIndex: draft.providers.length - 1
    };
  }

  private deleteProvider(): void {
    if (!this.activeProvider()) {
      return;
    }

    const providers = this.state.draft.providers.filter((_provider, index) => index !== this.state.providerIndex);
    this.updateDraft(normalizeConfigDraft({...this.state.draft, providers}));
    this.state = {...this.state, mode: 'list'};
  }

  private handleFormEvent(): ConfigCommandEventResult {
    const rows = getConfigRows(this.state);

    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      this.state = {...this.state, error: undefined, mode: 'list'};
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.MOVE_UP || this.event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = this.event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.state = {...this.state, error: undefined, formIndex: clamp(this.state.formIndex + delta, 0, Math.max(0, rows.length - 1))};
      return {kind: 'continue', state: this.getState()};
    }

    const row = rows[this.state.formIndex];

    if (this.event.type === INPUT_EVENTS.SUBMIT) {
      if (row?.kind === 'save') {
        return this.saveCurrentDraft();
      }

      return this.activateFormRow(row) || {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.TEXT && this.event.value === 'd') {
      if (row?.kind === 'model') {
        this.deleteModel(row.modelIndex);
      } else if (row?.kind === 'deleteProvider') {
        this.deleteProvider();
      }
    }

    if (this.event.type === INPUT_EVENTS.TEXT && this.event.value === 's' && row?.kind === 'model') {
      this.selectModel(row.modelIndex);
    }

    return {kind: 'continue', state: this.getState()};
  }

  private activateFormRow(row: ConfigFormRow | undefined): ConfigCommandEventResult | undefined {
    const provider = this.activeProvider();

    if (!row || !provider) {
      return undefined;
    }

    if (row.kind === 'preset') {
      this.state = {
        ...this.state,
        error: undefined,
        mode: 'preset',
        presetIndex: Math.max(0, PRESETS.findIndex((preset) => preset.id === provider.preset))
      };
      return undefined;
    }

    if (row.kind === 'field') {
      const preset = getProviderPreset(provider.preset);

      if (row.field === 'baseURL' && preset?.baseURLMode === 'fixed') {
        return undefined;
      }

      const current = row.field === 'label'
        ? provider.label
        : row.field === 'apiKey'
          ? ''
          : row.field === 'baseURL'
            ? provider.baseURL || ''
            : provider.codexAuthFile || '';
      this.startEdit({kind: 'field', field: row.field}, current, current !== '');
      return undefined;
    }

    if (row.kind === 'headers') {
      this.state = {...this.state, error: undefined, headerIndex: 0, mode: 'headerList'};
      return undefined;
    }

    if (row.kind === 'model') {
      this.state = {...this.state, error: undefined, mode: 'modelDetail', modelDetailIndex: 0, modelIndex: row.modelIndex};
      return undefined;
    }

    if (row.kind === 'addModel') {
      provider.models.push({id: '', model: ''});
      this.state = {
        ...this.state,
        draft: normalizeConfigDraft(this.state.draft),
        error: undefined,
        mode: 'modelDetail',
        modelDetailIndex: 0,
        modelIndex: provider.models.length - 1
      };
      this.startEdit({kind: 'modelName'}, '', false);
      return undefined;
    }

    if (row.kind === 'listModels') {
      return this.startModelListing(provider);
    }

    if (row.kind === 'deleteProvider') {
      this.deleteProvider();
    }

    return undefined;
  }

  private startModelListing(provider: ConfigProviderDraft): ConfigCommandEventResult {
    const preset = getProviderPreset(provider.preset);

    if (!preset) {
      this.state = {...this.state, error: `provider ${provider.label || provider.id} 的 preset 不存在：${provider.preset || '<空>'}`};
      return {kind: 'continue', state: this.getState()};
    }

    if (providerRequiresApiKey(preset) && provider.apiKey.trim() === '') {
      this.state = {...this.state, error: `provider ${provider.label || provider.id} 缺少 API key`};
      return {kind: 'continue', state: this.getState()};
    }

    if (preset.baseURLMode === 'required' && !provider.baseURL) {
      this.state = {...this.state, error: `provider ${provider.label || provider.id} 缺少 Base URL`};
      return {kind: 'continue', state: this.getState()};
    }

    const requestId = nextModelListRequestId++;
    this.state = {
      ...this.state,
      error: undefined,
      mode: 'modelList',
      modelList: {models: [], requestId, selectedIndex: 0, status: 'loading'}
    };
    return {kind: 'listModels', provider: structuredClone(provider) as ConfigProviderDraft, state: this.getState()};
  }

  private handleHeaderListEvent(): ConfigCommandEventResult {
    const headers = Object.entries(this.activeProvider()?.headers || {});
    const addIndex = headers.length;

    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      this.state = {...this.state, error: undefined, mode: 'form'};
    } else if (this.event.type === INPUT_EVENTS.MOVE_UP || this.event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = this.event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.state = {...this.state, error: undefined, headerIndex: clamp(this.state.headerIndex + delta, 0, addIndex)};
    } else if (this.event.type === INPUT_EVENTS.SUBMIT) {
      if (this.state.headerIndex === addIndex) {
        this.state = {
          ...this.state,
          error: undefined,
          headerDetailIndex: 0,
          headerEditor: {isNew: true, name: '', value: ''},
          mode: 'headerDetail'
        };
      } else {
        const [name, value] = headers[this.state.headerIndex] || [];

        if (name !== undefined && value !== undefined) {
          this.state = {
            ...this.state,
            error: undefined,
            headerDetailIndex: 0,
            headerEditor: {existingValue: value, isNew: false, name, originalName: name, value: ''},
            mode: 'headerDetail'
          };
        }
      }
    }

    return {kind: 'continue', state: this.getState()};
  }

  private handleHeaderDetailEvent(): ConfigCommandEventResult {
    const editor = this.state.headerEditor;

    if (!editor) {
      this.state = {...this.state, mode: 'headerList'};
      return {kind: 'continue', state: this.getState()};
    }

    const saveIndex = editor.isNew ? 2 : 3;

    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      this.state = {...this.state, error: undefined, headerEditor: undefined, mode: 'headerList'};
    } else if (this.event.type === INPUT_EVENTS.MOVE_UP || this.event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = this.event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.state = {...this.state, error: undefined, headerDetailIndex: clamp(this.state.headerDetailIndex + delta, 0, saveIndex)};
    } else if (this.event.type === INPUT_EVENTS.SUBMIT) {
      if (this.state.headerDetailIndex === 0) {
        this.startEdit({kind: 'headerName'}, editor.name, editor.name !== '');
      } else if (this.state.headerDetailIndex === 1) {
        this.startEdit({kind: 'headerValue'}, '', false);
      } else if (!editor.isNew && this.state.headerDetailIndex === 2) {
        this.deleteHeader(editor.originalName);
      } else if (this.state.headerDetailIndex === saveIndex) {
        this.saveHeader();
      }
    }

    return {kind: 'continue', state: this.getState()};
  }

  private saveHeader(): void {
    const provider = this.activeProvider();
    const editor = this.state.headerEditor;

    if (!provider || !editor) {
      return;
    }

    const name = editor.name.trim();
    const value = editor.value || editor.existingValue || '';
    const duplicate = Object.keys(provider.headers || {}).find((headerName) => (
      headerName.toLowerCase() === name.toLowerCase()
      && headerName !== editor.originalName
    ));

    if (!name || /[\r\n]/.test(name)) {
      this.state = {...this.state, error: 'header name 不能为空，也不能包含换行'};
      return;
    }

    if (duplicate) {
      this.state = {...this.state, error: `header 已存在：${name}`};
      return;
    }

    if (!value || /[\r\n]/.test(value)) {
      this.state = {...this.state, error: 'header value 不能为空，也不能包含换行'};
      return;
    }

    const headers = {...(provider.headers || {})};

    if (editor.originalName && editor.originalName !== name) {
      delete headers[editor.originalName];
    }

    headers[name] = value;
    provider.headers = headers;
    this.state = {...this.state, error: undefined, headerEditor: undefined, mode: 'headerList'};
  }

  private deleteHeader(name: string | undefined): void {
    const provider = this.activeProvider();

    if (!provider || !name) {
      return;
    }

    const headers = {...(provider.headers || {})};
    delete headers[name];
    provider.headers = Object.keys(headers).length > 0 ? headers : undefined;
    this.state = {...this.state, error: undefined, headerEditor: undefined, headerIndex: 0, mode: 'headerList'};
  }

  private handleModelDetailEvent(): ConfigCommandEventResult {
    if (!this.activeModel()) {
      this.state = {...this.state, mode: 'form'};
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      this.cleanupBlankModel();
      this.state = {...this.state, error: undefined, mode: 'form'};
    } else if (this.event.type === INPUT_EVENTS.MOVE_UP || this.event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = this.event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.state = {...this.state, error: undefined, modelDetailIndex: clamp(this.state.modelDetailIndex + delta, 0, 3)};
    } else if (this.event.type === INPUT_EVENTS.SUBMIT) {
      if (this.state.modelDetailIndex === 0) {
        const current = this.activeModel()?.model || '';
        this.startEdit({kind: 'modelName'}, current, current !== '');
      } else if (this.state.modelDetailIndex === 1) {
        const current = this.activeModel()?.contextWindow?.toString() || '';
        this.startEdit({kind: 'contextWindow'}, current, current !== '');
      } else if (this.state.modelDetailIndex === 2) {
        this.selectModel(this.state.modelIndex);
      } else {
        this.deleteModel(this.state.modelIndex);
        this.state = {...this.state, mode: 'form'};
      }
    }

    return {kind: 'continue', state: this.getState()};
  }

  private selectModel(modelIndex: number): void {
    const model = this.activeProvider()?.models[modelIndex];

    if (model?.id) {
      this.state = {...this.state, error: undefined, draft: {...this.state.draft, selectedModelId: model.id}};
    }
  }

  private deleteModel(modelIndex: number): void {
    const provider = this.activeProvider();

    if (!provider) {
      return;
    }

    const [removed] = provider.models.splice(modelIndex, 1);

    if (removed?.id === this.state.draft.selectedModelId) {
      this.state.draft.selectedModelId = this.state.draft.providers.flatMap((item) => item.models)[0]?.id;
    }

    this.state = {
      ...this.state,
      draft: normalizeConfigDraft(this.state.draft),
      error: undefined,
      formIndex: clamp(this.state.formIndex, 0, Math.max(0, getConfigRows(this.state).length - 1))
    };
  }

  private handlePresetEvent(): ConfigCommandEventResult {
    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      this.state = {...this.state, error: undefined, mode: 'form'};
    } else if (this.event.type === INPUT_EVENTS.MOVE_UP || this.event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = this.event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.state = {...this.state, error: undefined, presetIndex: clamp(this.state.presetIndex + delta, 0, PRESETS.length - 1)};
    } else if (this.event.type === INPUT_EVENTS.SUBMIT) {
      const provider = this.activeProvider();
      const preset = PRESETS[this.state.presetIndex];

      if (provider && preset) {
        provider.preset = preset.id;
        provider.label = preset.label;
        provider.models = (preset.suggestedModels || []).map((model) => ({id: '', model}));
        if (preset.baseURLMode === 'fixed' || preset.baseURLMode === 'hidden') {
          provider.baseURL = undefined;
        }
        if (!providerRequiresApiKey(preset)) {
          provider.apiKey = '';
        }
        if (!preset.codexOAuth) {
          provider.codexAuthFile = undefined;
        }
      }

      this.state = {...this.state, draft: normalizeConfigDraft(this.state.draft), error: undefined, mode: 'form'};
    }

    return {kind: 'continue', state: this.getState()};
  }

  private handleModelListEvent(): ConfigCommandEventResult {
    const modelList = this.state.modelList;

    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      this.state = {...this.state, error: undefined, mode: 'form'};
      return {kind: 'continue', state: this.getState()};
    }

    if (!modelList || modelList.status !== 'ready') {
      if (this.event.type === INPUT_EVENTS.SUBMIT) {
        this.state = {...this.state, error: undefined, mode: 'form'};
      }
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.MOVE_UP || this.event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = this.event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.state = {...this.state, modelList: {...modelList, selectedIndex: clamp(modelList.selectedIndex + delta, 0, modelList.models.length - 1)}};
    } else if (this.event.type === INPUT_EVENTS.SUBMIT) {
      this.selectListedModel(modelList.models[modelList.selectedIndex]?.id);
    }

    return {kind: 'continue', state: this.getState()};
  }

  private selectListedModel(modelId: string | undefined): void {
    const provider = this.activeProvider();

    if (!provider || !modelId) {
      this.state = {...this.state, mode: 'form'};
      return;
    }

    let modelIndex = provider.models.findIndex((model) => model.model === modelId);

    if (modelIndex === -1) {
      provider.models.push({id: '', model: modelId});
      this.state = {...this.state, draft: normalizeConfigDraft(this.state.draft)};
      modelIndex = this.activeProvider()?.models.findIndex((model) => model.model === modelId) ?? -1;
    }

    const rowIndex = getConfigRows({...this.state, mode: 'form'}).findIndex((row) => row.kind === 'model' && row.modelIndex === modelIndex);
    this.state = {...this.state, error: undefined, formIndex: rowIndex === -1 ? this.state.formIndex : rowIndex, mode: 'form'};
  }

  private handleDiscardConfirmEvent(): ConfigCommandEventResult {
    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      this.state = {...this.state, formIndex: 0, mode: 'list'};
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.MOVE_UP || this.event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = this.event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.state = {...this.state, formIndex: clamp(this.state.formIndex + delta, 0, 1)};
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.SUBMIT) {
      if (this.state.formIndex === 1) {
        return {kind: 'cancel'};
      }

      this.state = {...this.state, formIndex: 0, mode: 'list'};
    }

    return {kind: 'continue', state: this.getState()};
  }

  private startEdit(target: ConfigEditTarget, value: string, replacePending: boolean): void {
    this.state = {
      ...this.state,
      editBuffer: value,
      editReplacePending: replacePending,
      editTarget: target,
      error: undefined
    };
  }

  private handleEditEvent(): ConfigCommandEventResult {
    if (this.event.type === INPUT_EVENTS.ESCAPE) {
      if (this.state.editTarget?.kind === 'modelName') {
        this.cleanupBlankModel();
      }
      this.state = {...this.state, editBuffer: '', editReplacePending: false, editTarget: undefined};
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.BACKSPACE) {
      this.state = {
        ...this.state,
        editBuffer: this.state.editReplacePending ? '' : Array.from(this.state.editBuffer).slice(0, -1).join(''),
        editReplacePending: false
      };
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.SUBMIT) {
      this.commitEdit();
      return {kind: 'continue', state: this.getState()};
    }

    if (this.event.type === INPUT_EVENTS.TEXT) {
      this.state = {
        ...this.state,
        editBuffer: this.state.editReplacePending ? this.event.value : this.state.editBuffer + this.event.value,
        editReplacePending: false
      };
    }

    return {kind: 'continue', state: this.getState()};
  }

  private commitEdit(): void {
    const provider = this.activeProvider();
    const target = this.state.editTarget;

    if (!provider || !target) {
      return;
    }

    if (target.kind === 'field') {
      if (target.field === 'label') {
        provider.label = this.state.editBuffer.trim() || provider.id;
      } else if (target.field === 'apiKey') {
        provider.apiKey = this.state.editBuffer;
      } else if (target.field === 'baseURL') {
        provider.baseURL = this.state.editBuffer.trim() || undefined;
      } else {
        provider.codexAuthFile = this.state.editBuffer.trim() || undefined;
      }
    } else if (target.kind === 'headerName' && this.state.headerEditor) {
      this.state.headerEditor.name = this.state.editBuffer;
    } else if (target.kind === 'headerValue' && this.state.headerEditor) {
      this.state.headerEditor.value = this.state.editBuffer;
    } else if (target.kind === 'modelName') {
      const value = this.state.editBuffer.trim();

      if (!value) {
        this.state = {...this.state, error: 'model API id 不能为空'};
        return;
      }

      const model = this.activeModel();
      if (model) {
        model.model = value;
      }
    } else if (target.kind === 'contextWindow') {
      const value = this.state.editBuffer.trim();
      const model = this.activeModel();

      if (value && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
        this.state = {...this.state, error: 'context window 必须是正整数'};
        return;
      }

      if (model) {
        model.contextWindow = value ? Number(value) : undefined;
      }
    }

    this.state = {
      ...this.state,
      draft: normalizeConfigDraft(this.state.draft),
      editBuffer: '',
      editReplacePending: false,
      editTarget: undefined,
      error: undefined
    };
  }

  private cleanupBlankModel(): void {
    const provider = this.activeProvider();
    const model = this.activeModel();

    if (provider && model?.model === '') {
      provider.models.splice(this.state.modelIndex, 1);
      this.state = {...this.state, draft: normalizeConfigDraft(this.state.draft), mode: 'form'};
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export {
  handleConfigPanelEvent
};

export type {
  ConfigCommandEventResult
};
