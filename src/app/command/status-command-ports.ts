import {redactSensitiveText} from '../../agent/agent-errors';
import {loadAgentInstructions} from '../../agent/agent-instructions';
import {queryCodexUsage} from '../../config/codex-oauth';
import {readLlmConfig} from '../../config/llm-config';
import {readAppSettings} from '../../config/app-settings-config';
import {listEffectiveAgentMemoryCatalogs} from '../../memory/agent-memory-store';
import {readUserMemories} from '../../memory/memory-store';
import {createCommandViewport} from './command-viewport';

import type {CodexUsage} from '../../config/codex-oauth';
import type {CommandHostApp, CommandStatusSnapshot} from '../../types/command';
import type {UsageStore} from '../../types/usage';
import type {AppContext} from '../state/app-context';

type StatusCommandContext = Pick<AppContext,
  'createRenderState' |
  'getContextUsage' |
  'getCurrentCwd' |
  'modelContext' |
  'transcriptContext'
>;

type StatusCommandPortOptions = {
  appContext: StatusCommandContext;
  usageStore: UsageStore;
};

/**
 * 创建 context、status 和历史 usage 的只读查询端口。
 */
function createStatusCommandPorts(options: StatusCommandPortOptions): Pick<CommandHostApp, 'context' | 'status' | 'usage'> {
  const {appContext, usageStore} = options;

  return {
    context: {
      getUsage() {
        return appContext.getContextUsage();
      }
    },
    status: {
      createSnapshot() {
        return createStatusSnapshot(appContext);
      },
      async queryCodexUsage() {
        let config;

        try {
          config = readLlmConfig();
        } catch (error: unknown) {
          return {status: 'unavailable' as const, error: formatStatusError(error, '无法读取当前模型配置')};
        }

        if (config.agentType !== 'codex') {
          return {status: 'not_applicable' as const};
        }

        try {
          return createAvailableCodexUsage(await queryCodexUsage(config.codexOAuth || {}));
        } catch (error: unknown) {
          return {status: 'unavailable' as const, error: formatStatusError(error, 'Codex 用量不可用')};
        }
      }
    },
    usage: {
      listDailyUsage(query) {
        return usageStore.listDailyUsage(query);
      },
      getViewport() {
        return createCommandViewport(appContext);
      }
    }
  };
}

/**
 * 聚合 `/status` 所需的本地只读信息；各来源失败时保留其余可用字段。
 */
function createStatusSnapshot(appContext: StatusCommandContext): CommandStatusSnapshot {
  const cwd = appContext.getCurrentCwd();
  const userMemoryResult = readUserMemories();
  const agentMemoryResult = listEffectiveAgentMemoryCatalogs(cwd);
  const modelResult = appContext.modelContext.createStatusInfo();
  const appSettings = readAppSettings();
  const diagnostics: string[] = [];

  if (!userMemoryResult.ok) {
    diagnostics.push(userMemoryResult.error);
  }

  if (!agentMemoryResult.ok) {
    diagnostics.push(agentMemoryResult.error);
  }

  if ('error' in modelResult) {
    diagnostics.push(modelResult.error);
  }

  return {
    cwd,
    agentInstructionFileName: appSettings.agentInstructionFileName,
    sessionId: appContext.transcriptContext.getCurrentSessionId(),
    model: 'error' in modelResult ? null : {...modelResult},
    agentInstructions: loadAgentInstructions({cwd, fileName: appSettings.agentInstructionFileName}).map((instruction) => ({
      filePath: instruction.filePath,
      label: instruction.label,
      sourceKind: instruction.sourceKind
    })),
    userMemoryCount: userMemoryResult.ok
      ? userMemoryResult.memories.filter((memory) => memory.enabled).length
      : 0,
    agentMemoryCatalogs: agentMemoryResult.ok
      ? agentMemoryResult.catalogs.map((catalog) => ({name: catalog.name, scope: catalog.scope.kind}))
      : [],
    diagnostics: diagnostics.map((diagnostic) => redactSensitiveText(diagnostic))
  };
}

function createAvailableCodexUsage(usage: CodexUsage) {
  return {
    status: 'available' as const,
    primary: {...usage.primary},
    ...(usage.secondary ? {secondary: {...usage.secondary}} : {})
  };
}

function formatStatusError(error: unknown, fallback: string): string {
  return redactSensitiveText(error instanceof Error && error.message.trim() !== '' ? error.message : fallback);
}

export {
  createStatusCommandPorts,
  createStatusSnapshot
};

export type {
  StatusCommandPortOptions
};
