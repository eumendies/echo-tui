import {redactSensitiveText} from '../../agent/agent-errors';
import {loadAgentInstructions} from '../../agent/agent-instructions';
import {queryCodexUsage} from '../../config/codex-oauth';
import {isDeepseekBaseUrl, queryDeepseekBalance as fetchDeepseekBalance} from '../../config/deepseek-balance';
import {isOpencodeGoBaseUrl, queryOpencodeUsage as fetchOpencodeUsage} from '../../config/opencode-usage';
import {listEffectiveAgentMemoryCatalogs} from '../../memory/agent-memory-store';
import {readUserMemories} from '../../memory/memory-store';
import {resolveEffectiveSandbox} from '../../sandbox/provider';
import {createCommandViewport} from './command-viewport';

import type {CodexUsage} from '../../config/codex-oauth';
import type {DeepseekBalance} from '../../config/deepseek-balance';
import type {OpencodeUsage} from '../../config/opencode-usage';
import type {CommandHostApp, CommandStatusGoalSummary, CommandStatusSandboxState, CommandStatusSnapshot} from '../../types/command';
import type {GoalState} from '../../types/goal';
import type {UserConfigContext} from '../../config/user-config-context';
import type {SandboxToolConfig} from '../../types/agent';
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
  userConfigContext: UserConfigContext;
};

/**
 * 创建 context、status 和历史 usage 的只读查询端口。
 */
function createStatusCommandPorts(options: StatusCommandPortOptions): Pick<CommandHostApp, 'context' | 'status' | 'usage'> {
  const {appContext, usageStore} = options;
  const userConfigContext = options.userConfigContext;

  return {
    context: {
      getUsage() {
        return appContext.getContextUsage();
      }
    },
    status: {
      createSnapshot() {
        return createStatusSnapshot(appContext, userConfigContext);
      },
      async queryDeepseekBalance() {
        const config = appContext.modelContext.createActiveLlmConfig();

        if ('error' in config) {
          return {status: 'unavailable' as const, error: config.error};
        }

        if (!isDeepseekBaseUrl(config.baseURL)) {
          return {status: 'not_applicable' as const};
        }

        try {
          return createAvailableDeepseekBalance(await fetchDeepseekBalance(config.apiKey));
        } catch (error: unknown) {
          return {status: 'unavailable' as const, error: formatStatusError(error, 'DeepSeek 余额不可用')};
        }
      },
      async queryCodexUsage() {
        const config = appContext.modelContext.createActiveLlmConfig();

        if ('error' in config) {
          return {status: 'unavailable' as const, error: config.error};
        }

        if (config.agentType !== 'codex') {
          return {status: 'not_applicable' as const};
        }

        try {
          return createAvailableCodexUsage(await queryCodexUsage(config.codexOAuth || {}));
        } catch (error: unknown) {
          return {status: 'unavailable' as const, error: formatStatusError(error, 'Codex 用量不可用')};
        }
      },
      async queryOpencodeUsage() {
        const config = appContext.modelContext.createActiveLlmConfig();

        if ('error' in config) {
          return {status: 'unavailable' as const, error: config.error};
        }

        if (!isOpencodeGoBaseUrl(config.baseURL)) {
          return {status: 'not_applicable' as const};
        }

        try {
          return createAvailableOpencodeUsage(await fetchOpencodeUsage(config.apiKey));
        } catch (error: unknown) {
          return {status: 'unavailable' as const, error: formatStatusError(error, 'OpenCode Go 用量不可用')};
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
function createStatusSnapshot(appContext: StatusCommandContext, userConfigContext: UserConfigContext): CommandStatusSnapshot {
  const cwd = appContext.getCurrentCwd();
  const userMemoryResult = readUserMemories();
  const agentMemoryResult = listEffectiveAgentMemoryCatalogs(cwd);
  const modelResult = appContext.modelContext.createStatusInfo();
  const appSettings = userConfigContext.capture().getAppSettings();
  const goalState = appContext.transcriptContext.goalState;
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
    goal: goalState ? createStatusGoalSummary(goalState) : null,
    sandbox: createStatusSandboxState(userConfigContext.capture().getSandboxToolConfig()),
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

/** 条件摘要按字符数上限截断；更宽卡片的二次裁剪由渲染层负责。 */
const STATUS_GOAL_CONDITION_SUMMARY_MAX_LENGTH = 80;

/**
 * 生成 status 卡的只读 goal 摘要:状态与轮次直接取自 GoalState,条件只带走有界的单行副本。
 */
function createStatusGoalSummary(goalState: GoalState): CommandStatusGoalSummary {
  return {
    conditionSummary: createGoalConditionSummary(goalState.condition),
    maxTurns: goalState.maxTurns,
    status: goalState.status,
    turns: goalState.turns
  };
}

/**
 * 截断只作用于摘要副本,不修改 GoalState 中保存的完整条件。
 */
function createGoalConditionSummary(condition: string): string {
  const singleLine = condition.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(singleLine);

  if (characters.length <= STATUS_GOAL_CONDITION_SUMMARY_MAX_LENGTH) {
    return singleLine;
  }

  return `${characters.slice(0, STATUS_GOAL_CONDITION_SUMMARY_MAX_LENGTH - 1).join('')}…`;
}

/**
 * 聚合沙箱展示事实:归一化后的生效档位/网络 + 当前环境是否真正可用;降级必须带原因,不允许静默。
 */
function createStatusSandboxState(config: SandboxToolConfig): CommandStatusSandboxState {
  if (config.mode === 'off') {
    return {mode: 'off', network: false, provider: null, available: false};
  }

  const effective = resolveEffectiveSandbox(config);
  if (effective === null) {
    // status 仅由交互式命令构造,不会命中 headless full-access 豁免;此分支只为类型完备兜底。
    return {mode: config.mode, network: false, provider: null, available: false, unavailableReason: '当前平台不支持沙箱'};
  }

  if (effective.provider === null) {
    return {mode: effective.policy.mode, network: effective.policy.network, provider: null, available: false, unavailableReason: '当前平台不支持沙箱'};
  }

  if (!effective.available) {
    return {mode: effective.policy.mode, network: effective.policy.network, provider: effective.provider.name, available: false, unavailableReason: effective.provider.describeUnavailable()};
  }

  return {mode: effective.policy.mode, network: effective.policy.network, provider: effective.provider.name, available: true};
}

function createAvailableCodexUsage(usage: CodexUsage) {
  return {
    status: 'available' as const,
    primary: {...usage.primary},
    ...(usage.secondary ? {secondary: {...usage.secondary}} : {})
  };
}

function createAvailableDeepseekBalance(balance: DeepseekBalance) {
  return {
    status: 'available' as const,
    isAvailable: balance.isAvailable,
    balanceInfos: balance.balanceInfos.map((info) => ({...info}))
  };
}

function createAvailableOpencodeUsage(usage: OpencodeUsage) {
  return {
    status: 'available' as const,
    windows: usage.windows.map((window) => ({...window}))
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
