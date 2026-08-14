import {createAssistantCommandPort} from './assistant-command-port';
import {writeClipboardText} from '../clipboard';
import {createConversationReferenceCommandPort} from './conversation-reference-command-port';
import {createAgentsCommandPort} from './agents-command-port';
import {createHistoryCommandPorts} from './history-command-ports';
import {createHooksCommandPort} from './hooks-command-port';
import {createMcpCommandPort} from './mcp-command-port';
import {createMemoryCommandPort} from './memory-command-port';
import {createModelCommandPorts} from './model-command-ports';
import {createSettingsCommandPorts} from './settings-command-ports';
import {createSkillsCommandPort} from './skills-command-port';
import {createStatusCommandPorts, createStatusSnapshot} from './status-command-ports';
import {createCopyableRecords, createTranscriptCommandPort} from './transcript-command-ports';
import type {CommandHostApp} from '../../types/command';
import type {UserConfigContext} from '../../config/user-config-context';
import type {LifecycleHookDispatcher} from '../../types/hooks';
import type {TranscriptRecord} from '../../types/transcript';
import type {UsageStore} from '../../types/usage';
import type {McpManager} from '../../mcp/manager';
import type {AppContext} from '../state/app-context';
import type {InputEvent} from '../../types/input';

type CommandHostOptions = {
  appContext: AppContext;
  renderRecords: (records: TranscriptRecord[]) => void;
  exit: () => void;
  hooks: LifecycleHookDispatcher;
  mcpManager: McpManager;
  render: () => void;
  renderResizeRecovery: () => void;
  usageStore: UsageStore;
  userConfigContext: UserConfigContext;
  btw: {
    open(initialQuestion?: string): void; // 打开 BTW 临时会话。
    handleEvent(event: InputEvent): Promise<void> | void; // 转发 BTW composer 输入。
    close(): void; // 丢弃 BTW 并退出临时视图。
  };
};

/**
 * 在 app 组合根装配 command handler 可用的受控领域端口。
 */
function createCommandHost(options: CommandHostOptions): CommandHostApp {
  const {appContext, renderRecords, btw, exit, hooks, mcpManager, render, renderResizeRecovery, usageStore} = options;
  const userConfigContext = options.userConfigContext;
  if (appContext.captureUserConfigSnapshot() !== userConfigContext.capture()) {
    throw new Error('CommandHost 与 AppContext 必须共享同一个 UserConfigContext');
  }
  const modelPorts = createModelCommandPorts({appContext, userConfigContext});
  const settingsPorts = createSettingsCommandPorts({appContext, render, renderResizeRecovery});
  const statusPorts = createStatusCommandPorts({
    appContext,
    usageStore,
    userConfigContext
  });
  const historyPorts = createHistoryCommandPorts(appContext);
  const cwd = () => appContext.getCurrentCwd();

  return {
    btw,
    transcript: createTranscriptCommandPort({appContext, renderRecords, renderResizeRecovery}),
    reference: createConversationReferenceCommandPort({appContext, render, usageStore, userConfigContext}),
    clipboard: {writeText: writeClipboardText},
    model: modelPorts.model,
    config: modelPorts.config,
    skills: createSkillsCommandPort({cwd, clearContextUsage: () => appContext.clearContextUsage()}),
    mcp: createMcpCommandPort({appContext, mcpManager, render, userConfigContext}),
    memory: createMemoryCommandPort(cwd),
    agents: createAgentsCommandPort({
      captureUserConfigSnapshot: () => userConfigContext.capture(),
      cwd
    }),
    hooks: createHooksCommandPort({
      cwd,
      getInteractionMode: () => appContext.getInteractionMode(),
      hooks,
      userConfigContext
    }),
    mode: settingsPorts.mode,
    theme: settingsPorts.theme,
    context: statusPorts.context,
    status: statusPorts.status,
    usage: statusPorts.usage,
    diff: historyPorts.diff,
    undo: historyPorts.undo,
    assistant: createAssistantCommandPort({appContext, renderRecords, render}),
    ui: {exit, render, renderResizeRecovery}
  };
}

export {
  createCommandHost,
  createCopyableRecords,
  createStatusSnapshot
};

export type {
  CommandHostOptions
};
