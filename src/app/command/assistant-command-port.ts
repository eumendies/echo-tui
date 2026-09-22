import {prepareAgent} from '../../agent/agent-setup';
import {runCompaction} from '../../agent/context/context-compaction';
import {resolveMemoryPrompt} from '../../agent/context/memory-prompt';
import {buildProviderRequestPrefix, resolveProviderPromptMaterials} from '../../agent/context/provider-request-prefix';
import {createSubagentSchemaPort} from '../../agent/subagent/runtime';
import {recordStandaloneProviderUsage} from './standalone-provider-usage';

import type {AgentExecutionMode} from '../../types/agent';
import type {CommandCompactionResult, CommandHostApp} from '../../types/command';
import type {TranscriptRecord} from '../../types/transcript';
import type {McpManager} from '../../mcp/manager';
import type {UserConfigContext} from '../../config/user-config-context';
import type {UsageStore} from '../../types/usage';
import type {AppContext} from '../state/app-context';

type AssistantCommandContext = Pick<AppContext,
  'getAgentSession' |
  'getCurrentCwd' |
  'getInteractionMode' |
  'transcriptContext' |
  'turnContext'
>;

type AssistantCommandPortOptions = {
  appContext: AssistantCommandContext;
  mcpManager: McpManager; // 与 runtime 同源的 MCP 目录；手动压缩用它保持缓存键材料口径一致。
  renderRecords: (records: TranscriptRecord[]) => void;
  render: () => void;
  submitUserMessage: CommandHostApp['assistant']['submitUserMessage']; // 命令完成多步收集后复用 app 的提交路径。
  usageStore: UsageStore; // 手动压缩摘要请求的 token 事实记账目标。
  userConfigContext: UserConfigContext; // 与 AppContext 共享的配置实例，用于补齐缺省配置快照。
};

/**
 * 创建手动 compaction 端口，协调 turn 生命周期、agent 请求和 transcript 更新。
 */
function createAssistantCommandPort(options: AssistantCommandPortOptions): CommandHostApp['assistant'] {
  const {appContext, mcpManager, renderRecords, render, submitUserMessage, usageStore} = options;
  const userConfigContext = options.userConfigContext;

  return {
    submitUserMessage,
    beginManualCompaction(): boolean {
      if (appContext.turnContext.responding) {
        render();
        return false;
      }

      appContext.turnContext.beginManualCompaction();
      appContext.turnContext.startSpinner('working');
      render();
      return true;
    },
    /**
     * 手动压缩与 agent loop 共用同一前导与材料口径：按同一规则派生 execution/sandbox 边界、
     * 构建含 MCP 合并与委派目录的 registry，并透传会话身份，使摘要请求复用普通请求已建立的前缀缓存。
     */
    async compactContext(compactionOptions: {force: true}) {
      const session = appContext.getAgentSession();
      const cwd = appContext.getCurrentCwd();
      const configSnapshot = session.userConfigSnapshot || userConfigContext.capture();
      const appSettings = configSnapshot.getAppSettings();
      // 手动压缩只发生在交互式主会话：默认工具策略下 plan 模式派生的 read-only 收紧与 runAgentLoop 一致。
      const executionMode: AgentExecutionMode = {kind: 'interactive'};
      const sandboxModeOverride = appContext.getInteractionMode() === 'plan' ? 'read-only' as const : undefined;
      const prepared = prepareAgent({
        configSnapshot,
        cwd,
        executionMode,
        mcpManager,
        // 手动压缩请求不执行工具，但 provider schema 需要与主会话一致：注入 schema-only 委派端口。
        subagentPort: createSubagentSchemaPort({configSnapshot, cwd}),
        modelProfileId: session.modelProfileId,
        reasoningEffortOverride: session.reasoningEffortOverride,
        ...(sandboxModeOverride ? {sandboxModeOverride} : {}),
        ...(session.sessionId ? {sessionId: session.sessionId} : {})
      });
      const materials = resolveProviderPromptMaterials({
        agentInstructionFileName: appSettings.agentInstructionFileName,
        config: prepared.config,
        cwd,
        executionMode,
        ...(sandboxModeOverride ? {sandboxModeOverride} : {}),
        registry: prepared.registry,
        skillCatalogContextRatio: appSettings.skillCatalogContextRatio
      });
      const result = await runCompaction({
        records: session.records,
        compaction: session.compaction,
        force: compactionOptions.force,
        agent: prepared.agent,
        promptPrefix: buildProviderRequestPrefix({
          agentInstructions: materials.agentInstructions,
          basePrompt: materials.basePrompt,
          compaction: session.compaction,
          cwd,
          memoryPrompts: resolveMemoryPrompt(cwd, materials.contextWindow).sections,
          sandboxNote: materials.sandboxNote,
          sessionJournalPath: session.sessionJournalPath,
          skillCatalog: materials.skillCatalog
        }),
        ...(session.sessionId ? {sessionId: session.sessionId} : {})
      });
      recordStandaloneProviderUsage({appContext, config: prepared.config, result, usageStore});

      return result;
    },
    finishManualCompaction(result: CommandCompactionResult) {
      appContext.turnContext.stopSpinner();

      if (result.didCompact && result.compaction) {
        const noticeRecord = appContext.transcriptContext.applyCompaction(result.compaction);
        appContext.turnContext.finishAssistantTurn('');
        renderRecords([noticeRecord]);
        return;
      }

      appContext.turnContext.finishAssistantTurn('');
      renderRecords([appContext.transcriptContext.appendRecord({
        role: 'compaction_notice',
        text: '当前无需压缩'
      })]);
    },
    fail(error: unknown) {
      appContext.turnContext.stopSpinner();
      renderRecords([appContext.turnContext.failAssistantTurn(error)]);
    }
  };
}

export {
  createAssistantCommandPort
};

export type {
  AssistantCommandPortOptions
};
