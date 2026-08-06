import {readAppSettingsDraft, saveAppSettingsDraft} from '../../config/app-settings-config';
import {readLlmConfigDraft, saveLlmConfigDraft} from '../../config/llm-config-editor';
import {listProviderModels} from '../../config/provider-model-list';

import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type ModelCommandContext = Pick<AppContext, 'clearContextUsage' | 'modelContext' | 'refreshAppSettingsFromConfig'>;

type ModelCommandPortOptions = {
  appContext: ModelCommandContext;
  renderFooter: () => void;
  renderResizeRecovery: () => void;
};

/**
 * 创建模型和配置中心端口；写入后刷新对应实例缓存并执行所需重绘。
 */
function createModelCommandPorts(options: ModelCommandPortOptions): Pick<CommandHostApp, 'model' | 'config'> {
  const {appContext, renderFooter, renderResizeRecovery} = options;

  return {
    model: {
      createModelCommandInfo() {
        return appContext.modelContext.createModelCommandInfo();
      },
      createEffortCommandInfo() {
        return appContext.modelContext.createEffortCommandInfo();
      },
      selectModel(modelId: string) {
        const result = appContext.modelContext.selectModel(modelId);

        if (result.ok) {
          appContext.clearContextUsage();
        }

        return result;
      },
      selectEffort(effort) {
        const result = appContext.modelContext.selectEffort(effort);

        if (result.ok) {
          appContext.clearContextUsage();
        }

        return result;
      }
    },
    config: {
      listApprovalModelProfiles() {
        try {
          return readLlmConfigDraft().providers.flatMap((provider) => provider.models.map((model) => ({
            id: model.id,
            model: model.model,
            provider: provider.id
          })));
        } catch {
          return [];
        }
      },
      readSettings() {
        return readAppSettingsDraft();
      },
      readDraft() {
        return readLlmConfigDraft();
      },
      listModels(provider) {
        return listProviderModels(provider);
      },
      saveSettings(draft) {
        try {
          saveAppSettingsDraft(draft);
          const refresh = appContext.refreshAppSettingsFromConfig();

          if (refresh.reasoningVisibilityChanged) {
            renderResizeRecovery();
          } else if (refresh.slashSuggestionLimitChanged) {
            renderFooter();
          }
          return {ok: true};
        } catch (error: unknown) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      },
      saveDraft(draft) {
        try {
          saveLlmConfigDraft(draft);
          appContext.modelContext.refreshModelState();
          appContext.clearContextUsage();
          return {ok: true};
        } catch (error: unknown) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
    }
  };
}

export {
  createModelCommandPorts
};

export type {
  ModelCommandPortOptions
};
