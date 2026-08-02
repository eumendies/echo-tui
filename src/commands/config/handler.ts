import {INPUT_EVENTS} from '../../input/event-types';
import {
  CONFIG_TABS,
  GENERAL_CONFIG_ROW_IDS,
  createConfigSurface,
  createInitialAppearanceConfigState,
  createInitialConfigState,
  createInitialGeneralConfigState,
  isGeneralConfigDirty,
  isModelConfigDirty,
  markGeneralConfigSaved,
  markModelConfigSaved
} from './state';
import {handleConfigPanelEvent} from './panel-state';

import type {
  AppearanceConfigState,
  CommandConfigListModelsResult,
  CommandHandler,
  CommandHost,
  CommandSession,
  ConfigCommandState,
  ConfigTabId,
  GeneralConfigState
} from '../../types/command';
import type {InputEvent} from '../../types/input';
import type {ConfigCommandData} from './state';

function createModelListState(requestId: number, result: CommandConfigListModelsResult): NonNullable<ConfigCommandState['modelList']> {
  if (result.ok) {
    return {
      models: result.models,
      requestId,
      selectedIndex: 0,
      status: result.models.length > 0 ? 'ready' : 'empty',
      ...(result.truncated ? {truncated: true} : {})
    };
  }

  return {
    error: result.error,
    models: [],
    requestId,
    selectedIndex: 0,
    status: result.reason === 'unsupported' ? 'unsupported' : 'error'
  };
}

/**
 * 管理带 Tab 的配置中心；子面板只处理领域状态，文件和重绘副作用经 CommandHost 执行。
 */
class ConfigCommandHandler implements CommandHandler<ConfigCommandData> {
  name = 'config';
  description = '配置常规设置、指令文件、模型和主题';

  match(text: string): boolean {
    return text.trimEnd() === '/config';
  }

  start(_text: string, host: CommandHost): void {
    const data = initializeTab({activeTab: 'general'}, 'general', host);
    host.session.open({
      commandName: 'config',
      handler: this,
      surface: createConfigSurface(data),
      data
    });
  }

  async handleEvent(session: CommandSession<ConfigCommandData>, event: InputEvent, host: CommandHost): Promise<void> {
    const data = session.data;
    if (!data) {
      return;
    }

    if (data.discardConfirm) {
      this.handleDiscardConfirm(data, event, host);
      return;
    }

    if (event.type === INPUT_EVENTS.TAB) {
      const currentIndex = CONFIG_TABS.findIndex((tab) => tab.id === data.activeTab);
      const nextTab = CONFIG_TABS[(currentIndex + 1) % CONFIG_TABS.length].id;
      this.update(initializeTab({...data, activeTab: nextTab}, nextTab, host), host);
      return;
    }

    const activeSlot = data.activeTab === 'general' ? data.general : data.activeTab === 'models' ? data.models : data.appearance;
    if (activeSlot?.error) {
      if (event.type === INPUT_EVENTS.ESCAPE) {
        this.requestClose(data, host);
      }
      return;
    }

    if (data.activeTab === 'general' && data.general?.state) {
      this.handleGeneralEvent(data, data.general.state, event, host);
      return;
    }

    if (data.activeTab === 'appearance' && data.appearance?.state) {
      this.handleAppearanceEvent(data, data.appearance.state, event, host);
      return;
    }

    if (data.activeTab === 'models' && data.models?.state) {
      await this.handleModelEvent(data, data.models.state, event, host);
    }
  }

  private handleGeneralEvent(data: ConfigCommandData, state: GeneralConfigState, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.requestClose(data, host);
      return;
    }

    let nextState = structuredClone(state) as GeneralConfigState;
    nextState.error = undefined;
    nextState.feedback = undefined;

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      nextState.selectedIndex = clamp(nextState.selectedIndex + delta, 0, GENERAL_CONFIG_ROW_IDS.length - 1);
    } else if (event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      nextState = adjustGeneralValue(nextState, event.type === INPUT_EVENTS.MOVE_LEFT ? -1 : 1);
    } else if (event.type === INPUT_EVENTS.SUBMIT) {
      const selectedRow = GENERAL_CONFIG_ROW_IDS[nextState.selectedIndex];
      if (selectedRow === 'reasoningSummary') {
        nextState.draft.showReasoningSummary = !nextState.draft.showReasoningSummary;
      } else if (selectedRow === 'autoCompressImages') {
        nextState.draft.autoCompressImages = !nextState.draft.autoCompressImages;
      } else if (selectedRow === 'save') {
        const result = host.config.saveSettings(nextState.draft);
        nextState = result.ok
          ? markGeneralConfigSaved(nextState)
          : {...nextState, error: result.error || '无法保存常规设置'};
      }
    }

    this.update({...data, general: {state: nextState}}, host);
  }

  private handleAppearanceEvent(data: ConfigCommandData, state: AppearanceConfigState, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.requestClose(data, host);
      return;
    }

    if (state.themes.length === 0) {
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      const nextState = {...state, error: undefined, feedback: undefined, selectedIndex: clamp(state.selectedIndex + delta, 0, state.themes.length - 1)};
      this.update({...data, appearance: {state: nextState}}, host);
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    const selectedTheme = state.themes[state.selectedIndex];
    if (!selectedTheme) {
      return;
    }

    const previousThemes = state.themes.map((theme) => ({...theme}));
    const optimisticState: AppearanceConfigState = {
      ...state,
      error: undefined,
      feedback: '✓ 主题已保存',
      themes: state.themes.map((theme) => ({...theme, selected: theme.id === selectedTheme.id}))
    };
    const optimisticData = {...data, appearance: {state: optimisticState}};
    this.update(optimisticData, host);
    const result = host.theme.selectTheme(selectedTheme.id);

    if (!result.ok) {
      this.update({
        ...data,
        appearance: {
          state: {
            ...state,
            themes: previousThemes,
            error: result.error,
            feedback: undefined
          }
        }
      }, host);
    }
  }

  private async handleModelEvent(data: ConfigCommandData, state: ConfigCommandState, event: InputEvent, host: CommandHost): Promise<void> {
    if (event.type === INPUT_EVENTS.ESCAPE && state.mode === 'list' && !state.editTarget) {
      this.requestClose(data, host);
      return;
    }

    const result = handleConfigPanelEvent({...state, feedback: undefined}, event);

    if (result.kind === 'continue') {
      this.update({...data, models: {state: result.state}}, host);
      return;
    }

    if (result.kind === 'listModels') {
      const requestId = result.state.modelList?.requestId;
      this.update({...data, models: {state: result.state}}, host);

      if (requestId === undefined) {
        return;
      }

      const listResult = await host.config.listModels(result.provider);
      const activeSession = host.session.getActive() as CommandSession<ConfigCommandData> | null;
      const activeState = activeSession?.data?.models?.state;

      if (!activeState || activeState.modelList?.requestId !== requestId || activeState.mode !== 'modelList') {
        return;
      }

      const nextData = activeSession?.data as ConfigCommandData;
      this.update({...nextData, models: {state: {...activeState, modelList: createModelListState(requestId, listResult)}}}, host);
      return;
    }

    if (result.kind === 'cancel') {
      this.requestClose(data, host);
      return;
    }

    const saveResult = host.config.saveDraft(result.draft);
    const nextState = saveResult.ok
      ? markModelConfigSaved({...result.state, draft: result.draft})
      : {...result.state, error: saveResult.error || '无法保存配置'};
    this.update({...data, models: {state: nextState}}, host);
  }

  private requestClose(data: ConfigCommandData, host: CommandHost): void {
    const dirtyTabs = [
      ...(isGeneralConfigDirty(data.general?.state) ? ['常规'] : []),
      ...(isModelConfigDirty(data.models?.state) ? ['模型与 Provider'] : [])
    ];

    if (dirtyTabs.length > 0) {
      this.update({...data, discardConfirm: {dirtyTabs, selectedIndex: 0}}, host);
      return;
    }

    host.session.close();
  }

  private handleDiscardConfirm(data: ConfigCommandData, event: InputEvent, host: CommandHost): void {
    const confirm = data.discardConfirm;
    if (!confirm) {
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.update({...data, discardConfirm: undefined}, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.update({...data, discardConfirm: {...confirm, selectedIndex: clamp(confirm.selectedIndex + delta, 0, 1)}}, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      if (confirm.selectedIndex === 1) {
        host.session.close();
      } else {
        this.update({...data, discardConfirm: undefined}, host);
      }
    }
  }

  private update(data: ConfigCommandData, host: CommandHost): void {
    host.session.update({surface: createConfigSurface(data), data});
  }
}

function initializeTab(data: ConfigCommandData, tab: ConfigTabId, host: CommandHost): ConfigCommandData {
  if (tab === 'general' && !data.general) {
    try {
      return {...data, general: {state: createInitialGeneralConfigState(host.config.readSettings())}};
    } catch (error: unknown) {
      return {...data, general: {error: toErrorMessage(error)}};
    }
  }

  if (tab === 'models' && !data.models) {
    try {
      return {...data, models: {state: createInitialConfigState(host.config.readDraft())}};
    } catch (error: unknown) {
      return {...data, models: {error: toErrorMessage(error)}};
    }
  }

  if (tab === 'appearance' && !data.appearance) {
    try {
      return {...data, appearance: {state: createInitialAppearanceConfigState(host.theme.listThemes())}};
    } catch (error: unknown) {
      return {...data, appearance: {error: toErrorMessage(error)}};
    }
  }

  return data;
}

function adjustGeneralValue(state: GeneralConfigState, direction: number): GeneralConfigState {
  const selectedRow = GENERAL_CONFIG_ROW_IDS[state.selectedIndex];
  if (selectedRow === 'compactionThreshold') {
    const next = Math.round((state.draft.compactionThresholdRatio + direction * 0.05) * 100) / 100;
    state.draft.compactionThresholdRatio = clamp(next, 0.5, 0.95);
  } else if (selectedRow === 'skillCatalogRatio') {
    const next = Math.round((state.draft.skillCatalogContextRatio + direction * 0.01) * 100) / 100;
    state.draft.skillCatalogContextRatio = clamp(next, 0.01, 0.1);
  } else if (selectedRow === 'slashSuggestionLimit') {
    state.draft.slashSuggestionMaxVisible = clamp(state.draft.slashSuggestionMaxVisible + direction, 1, 20);
  } else if (selectedRow === 'reasoningSummary') {
    state.draft.showReasoningSummary = !state.draft.showReasoningSummary;
  } else if (selectedRow === 'defaultInteractionMode') {
    state.draft.defaultInteractionMode = state.draft.defaultInteractionMode === 'normal' ? 'plan' : 'normal';
  } else if (selectedRow === 'autoCompressImages') {
    state.draft.autoCompressImages = !state.draft.autoCompressImages;
  } else if (selectedRow === 'fileEditMode') {
    state.draft.fileEditMode = state.draft.fileEditMode === 'apply_patch' ? 'edit_file' : 'apply_patch';
  } else if (selectedRow === 'instructionFile') {
    state.draft.agentInstructionFileName = state.draft.agentInstructionFileName === 'AGENTS.md' ? 'CLAUDE.md' : 'AGENTS.md';
  }
  return state;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  ConfigCommandHandler
};
