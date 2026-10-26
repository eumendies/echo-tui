import {createMainAgentToolCatalog} from '../../tools/main-agent-tool-catalog';
import type {McpManager} from '../../mcp/manager';
import {listProviderModels} from '../../config/provider-model-list';
import type {UserConfigContext} from '../../config/user-config-context';
import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type ModelCommandContext = Pick<AppContext, 'clearContextUsage' | 'modelContext'>;

type ModelCommandPortOptions = {
  appContext: ModelCommandContext; // 共享模型状态与上下文用量失效入口。
  userConfigContext: UserConfigContext; // 配置 snapshot 与分域原子保存入口。
  mcpManager?: McpManager; // 只读取已发现目录，不为配置页建立新连接。
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
      },
      /** 从共享快照读取独立工具草稿，不要求模型配置有效。 */
      readToolsDraft() {
        return userConfigContext.capture().getMainAgentToolsDraft();
      },
      /** 只发布工具配置 revision；运行刷新和用量失效交给已有订阅者。 */
      saveToolsDraft(draft) {
        try {
          userConfigContext.saveMainAgentToolsDraft(draft);
          return {ok: true};
        } catch (error: unknown) {
          return {ok: false, error: error instanceof Error ? error.message : String(error)};
        }
      },
      /** 枚举未筛选候选及已记录离线项，不读取 provider 配置或主动连接 MCP。 */
      listToolCatalog() {
        return createMainAgentToolCatalog({
          mcpManager: options.mcpManager,
          disabledTools: userConfigContext.capture().getMainAgentToolsConfig().disabledTools
        });
      },
      readSandboxDraft() {
        return userConfigContext.capture().getSandboxConfigDraft();
      },
      saveSandboxDraft(draft) {
        try {
          userConfigContext.saveSandboxConfigDraft(draft);
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
