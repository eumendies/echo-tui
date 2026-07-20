import {readLlmConfigDraft, saveLlmConfigDraft} from '../../config/llm-config-editor';
import {listProviderModels} from '../../config/provider-model-list';

import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type ModelCommandContext = Pick<AppContext, 'clearContextUsage' | 'modelContext'>;

/**
 * 创建模型选择和 LLM 配置编辑端口；配置变化后同步刷新运行时模型状态。
 */
function createModelCommandPorts(appContext: ModelCommandContext): Pick<CommandHostApp, 'model' | 'config'> {
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
        return appContext.modelContext.selectEffort(effort);
      }
    },
    config: {
      readDraft() {
        return readLlmConfigDraft();
      },
      listModels(provider) {
        return listProviderModels(provider);
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
