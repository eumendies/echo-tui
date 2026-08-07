import {listProviderModels} from '../../config/provider-model-list';
import type {UserConfigContext} from '../../config/user-config-context';
import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type ModelCommandContext = Pick<AppContext, 'clearContextUsage' | 'modelContext'>;

type ModelCommandPortOptions = {
  appContext: ModelCommandContext;
  userConfigContext: UserConfigContext;
};

/**
 * 创建模型和配置中心端口；用户配置写入只发布 Context revision，副作用统一交给订阅者。
 */
function createModelCommandPorts(options: ModelCommandPortOptions): Pick<CommandHostApp, 'model' | 'config'> {
  const {appContext} = options;
  const userConfigContext = options.userConfigContext;

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
          return userConfigContext.capture().getLlmConfigDraft().providers.flatMap((provider) => provider.models.map((model) => ({
            id: model.id,
            model: model.model,
            provider: provider.id
          })));
        } catch {
          return [];
        }
      },
      readSettings() {
        return userConfigContext.capture().getAppSettingsDraft();
      },
      readDraft() {
        return userConfigContext.capture().getLlmConfigDraft();
      },
      listModels(provider) {
        return listProviderModels(provider);
      },
      saveSettings(draft) {
        try {
          userConfigContext.saveAppSettingsDraft(draft);
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
          userConfigContext.saveLlmConfigDraft(draft);
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
