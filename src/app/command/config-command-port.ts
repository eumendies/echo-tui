import {createMainAgentToolCatalog} from '../../tools/main-agent-tool-catalog';
import {listProviderModels} from '../../config/provider-model-list';
import {createSystemPromptCommandPort} from './system-prompt-command-port';

import type {McpManager} from '../../mcp/manager';
import type {UserConfigContext} from '../../config/user-config-context';
import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type ConfigCommandContext = Pick<AppContext, 'clearContextUsage' | 'getCurrentCwd'>;

type ConfigCommandPortOptions = {
  appContext: ConfigCommandContext; // 系统提示词端口共享的 cwd 与 context usage 入口。
  mcpManager?: McpManager; // 只读取已发现目录，不为配置页建立新连接。
  userConfigContext: UserConfigContext; // 配置 snapshot 与分域原子保存入口。
};

/**
 * 装配 config 命名空间：用户配置读写、工具偏好、沙箱与系统提示词分别由独立实现提供。
 */
function createConfigCommandPorts(options: ConfigCommandPortOptions): CommandHostApp['config'] {
  const {mcpManager, userConfigContext} = options;

  return {
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
        mcpManager,
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
    },
    ...createSystemPromptCommandPort({appContext: options.appContext, userConfigContext})
  };
}

export {
  createConfigCommandPorts
};

export type {
  ConfigCommandPortOptions
};
