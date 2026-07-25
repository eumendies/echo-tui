import {createAssistantCommandPort} from './assistant-command-port';
import {createCoreCommandPorts} from './core-command-ports';
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
import type {LifecycleHookDispatcher} from '../../types/hooks';
import type {TranscriptRecord} from '../../types/transcript';
import type {UsageStore} from '../../types/usage';
import type {McpManager} from '../../mcp/manager';
import type {AppContext} from '../state/app-context';

type CommandHostOptions = {
  appContext: AppContext;
  appendRecord: (record: TranscriptRecord) => void;
  exit: () => void;
  hooks: LifecycleHookDispatcher;
  mcpManager: McpManager;
  renderFooter: () => void;
  renderResizeRecovery: () => void;
  usageStore: UsageStore;
};

/**
 * 在 app 组合根装配 command handler 可用的受控领域端口。
 */
function createCommandHost(options: CommandHostOptions): CommandHostApp {
  const {appContext, appendRecord, exit, hooks, mcpManager, renderFooter, renderResizeRecovery, usageStore} = options;
  const corePorts = createCoreCommandPorts({
    composerContext: appContext.composerContext,
    exit,
    renderFooter,
    renderResizeRecovery
  });
  const modelPorts = createModelCommandPorts({appContext, renderFooter, renderResizeRecovery});
  const settingsPorts = createSettingsCommandPorts({appContext, renderFooter, renderResizeRecovery});
  const statusPorts = createStatusCommandPorts({
    appContext,
    usageStore
  });
  const historyPorts = createHistoryCommandPorts(appContext);
  const cwd = () => appContext.getCurrentCwd();

  return {
    composer: corePorts.composer,
    transcript: createTranscriptCommandPort({appContext, appendRecord, renderResizeRecovery}),
    clipboard: corePorts.clipboard,
    model: modelPorts.model,
    config: modelPorts.config,
    skills: createSkillsCommandPort({cwd, clearContextUsage: () => appContext.clearContextUsage()}),
    mcp: createMcpCommandPort({appContext, mcpManager, renderFooter}),
    memory: createMemoryCommandPort(cwd),
    hooks: createHooksCommandPort({
      cwd,
      getInteractionMode: () => appContext.getInteractionMode(),
      hooks
    }),
    mode: settingsPorts.mode,
    theme: settingsPorts.theme,
    context: statusPorts.context,
    status: statusPorts.status,
    usage: statusPorts.usage,
    diff: historyPorts.diff,
    undo: historyPorts.undo,
    assistant: createAssistantCommandPort({appContext, appendRecord, renderFooter}),
    ui: corePorts.ui
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
