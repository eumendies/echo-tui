import {prepareAgent} from '../../agent/agent-setup';
import {runCompaction} from '../../agent/context/context-compaction';
import {readLlmConfigDraft, saveLlmConfigDraft} from '../../config/llm-config-editor';
import {readMcpConfigDraft, saveMcpEnabledStateDraft} from '../../config/mcp-config';
import {createLifecycleHookRuntimeConfigFromDraft, readLifecycleHookConfigDraft, saveLifecycleHookConfigDraft} from '../../hooks/config';
import {createLifecycleHookSyntheticPayload, executeLifecycleHookSyntheticTest} from '../../hooks/synthetic-test';
import {listProviderModels} from '../../config/provider-model-list';
import {listBuiltinThemes, readTuiTheme, readTuiThemeBaseId, selectBuiltinTheme} from '../../config/theme-config';
import {calculateCommandSurfaceMaxLines} from '../../render/footer';
import {sanitizeMcpError} from '../../mcp/manager';
import {createSkillManager} from '../../skills/skill-manager';
import {writeClipboardText} from '../clipboard';

import type {CommandCompactionResult, CommandHostApp, CommandMcpServerInfo, CopyableMessageRecord} from '../../types/command';
import type {TranscriptRecord} from '../../types/transcript';
import type {LifecycleHookDispatcher} from '../../types/hooks';
import type {UsageStore} from '../../types/usage';
import type {McpManager} from '../../mcp/manager';
import type {AppContext} from '../state/app-context';

type CommandHostOptions = {
  appContext: AppContext;
  appendRecord: (record: TranscriptRecord) => void;
  exit: () => void;
  hooks?: LifecycleHookDispatcher;
  mcpManager?: McpManager;
  renderFooter: () => void;
  renderResizeRecovery: () => void;
  usageStore?: UsageStore;
};

/**
 * 创建 command handler 可用的受控 app facade；handler 只能通过这些领域能力触达 app 状态。
 *
 * @param options app context 与渲染回调
 * @returns command host 的 app 能力部分
 */
function createCommandHost(options: CommandHostOptions): CommandHostApp {
  const {appContext, appendRecord, exit, hooks, mcpManager, renderFooter, renderResizeRecovery, usageStore} = options;
  const skillManager = createSkillManager({cwd: () => appContext.getCurrentCwd()});

  return {
    composer: {
      reset() {
        appContext.resetComposer();
        appContext.leaveHistoryBrowsing();
      },
      leaveHistoryBrowsing() {
        appContext.leaveHistoryBrowsing();
      }
    },
    transcript: {
      clear() {
        appContext.clearTranscriptRecords();
        appContext.clearContextUsage();
        renderResizeRecovery();
      },
      loadSession(sessionId: string): boolean {
        const didLoad = Boolean(appContext.loadTranscriptSession(sessionId));

        if (didLoad) {
          appContext.clearContextUsage();
          renderResizeRecovery();
        }

        return didLoad;
      },
      append(record: TranscriptRecord) {
        appendRecord(appContext.appendTranscriptRecord(record));
      },
      listCopyableRecords() {
        return createCopyableRecords(appContext.transcriptRecords);
      },
      listResumeSessions() {
        return appContext.transcriptContext.listResumeSessions();
      }
    },
    clipboard: {
      writeText(text: string) {
        return writeClipboardText(text);
      }
    },
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
    },
    skills: {
      createSkillInvocation(skillName: string, argumentsText?: string) {
        const result = skillManager.loadSkill(skillName);

        if (!result.ok) {
          return {
            ok: false as const,
            reason: result.reason === 'disabled' ? 'disabled' as const : 'missing' as const,
            message: result.message
          };
        }

        const userRequestText = argumentsText && argumentsText.trim() !== '' ? argumentsText.trim() : undefined;
        const lines = [
          '[Skill Invocation]',
          `skill: ${result.skill.name}`,
          `source: ${result.skill.sourceKind}`,
          `source_path: ${result.skill.sourcePath}`,
          '',
          '[Skill Instructions]',
          result.skill.content
        ];

        if (result.skill.resources.length > 0) {
          lines.push('', '[Skill Resources]', ...result.skill.resources.map((resourcePath) => `- ${resourcePath}`));
        }

        if (userRequestText) {
          lines.push('', '[User Request]', userRequestText);
        }

        return {
          ok: true as const,
          text: lines.join('\n'),
          metadata: {
            skillInvocation: {
              source: 'slash',
              skillName: result.skill.name,
              argumentsText: userRequestText,
              userRequestText,
              sourceKind: result.skill.sourceKind,
              sourcePath: result.skill.sourcePath
            }
          }
        };
      },
      listSkills() {
        return skillManager.listSkills();
      },
      listEnabledSkillDescriptors() {
        return skillManager.listCatalog().map((skill) => ({
          name: skill.name,
          description: `Skill: ${skill.description}`
        }));
      },
      saveSkillStates(skills) {
        skillManager.saveSkillStates(skills);
        appContext.clearContextUsage();
      }
    },
    mcp: {
      listServers() {
        const draft = readMcpConfigDraft();
        const toolCountByServer = new Map<string, number>();
        const diagnosticsByServer = new Map<string, string>();

        if (draft.servers.length === 0) {
          return [];
        }

        for (const tool of mcpManager?.listTools() || []) {
          toolCountByServer.set(tool.serverName, (toolCountByServer.get(tool.serverName) || 0) + 1);
        }

        for (const diagnostic of mcpManager?.getDiagnostics() || []) {
          diagnosticsByServer.set(diagnostic.serverName, diagnostic.message);
        }

        return [
          {
            kind: 'global' as const,
            name: 'MCP global',
            enabled: draft.enabled,
            valid: true,
            summary: draft.enabled ? 'enabled' : 'disabled'
          },
          ...draft.servers.map((server): CommandMcpServerInfo => ({
            kind: 'server' as const,
            name: server.name,
            enabled: server.enabled,
            valid: server.valid,
            summary: server.summary,
            ...(server.transport ? {transport: server.transport} : {}),
            ...(server.diagnostic || diagnosticsByServer.get(server.name) ? {diagnostic: server.diagnostic || diagnosticsByServer.get(server.name)} : {}),
            ...(toolCountByServer.has(server.name) ? {toolCount: toolCountByServer.get(server.name)} : {})
          }))
        ];
      },
      async saveServerStates(servers) {
        appContext.setMcpBootstrapStatus('initializing');
        appContext.startSpinner('working');
        renderFooter();

        try {
          const globalState = servers.find((server) => server.kind === 'global');
          saveMcpEnabledStateDraft({
            enabled: globalState ? globalState.enabled : true,
            servers: servers
              .filter((server) => server.kind === 'server')
              .map((server) => ({name: server.name, enabled: server.enabled}))
          });
          await mcpManager?.reload();
          appContext.clearContextUsage();
          const diagnostics = (mcpManager?.getDiagnostics() || []).map((diagnostic) => `${diagnostic.serverName}: ${diagnostic.message}`);
          return {ok: true, diagnostics};
        } catch (error: unknown) {
          return {ok: false, error: sanitizeMcpError(error)};
        } finally {
          appContext.stopSpinner();
          appContext.clearWorking();
          appContext.setMcpBootstrapStatus('ready');
          renderFooter();
        }
      }
    },
    hooks: {
      readDraft() {
        return readLifecycleHookConfigDraft();
      },
      saveDraft(draft) {
        try {
          const nextConfig = createLifecycleHookRuntimeConfigFromDraft(draft);
          saveLifecycleHookConfigDraft(draft);
          hooks?.updateConfig(nextConfig);
          return {ok: true};
        } catch (error: unknown) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      },
      testEntry(event, entry) {
        const payload = createLifecycleHookSyntheticPayload({
          cwd: appContext.getCurrentCwd(),
          event,
          interactionMode: appContext.getInteractionMode()
        });
        return executeLifecycleHookSyntheticTest({
          cwd: appContext.getCurrentCwd(),
          entry,
          payload
        });
      }
    },
    mode: {
      getInteractionMode() {
        return appContext.getInteractionMode();
      },
      setInteractionMode(mode) {
        appContext.setInteractionMode(mode);
        appContext.clearContextUsage();
        renderFooter();
      }
    },
    theme: {
      listThemes() {
        const currentThemeId = readTuiThemeBaseId();
        return listBuiltinThemes().map((theme) => ({
          description: theme.description,
          id: theme.id,
          label: theme.label,
          selected: theme.id === currentThemeId
        }));
      },
      selectTheme(themeId: string) {
        const result = selectBuiltinTheme(themeId);

        if (!result.ok) {
          return result;
        }

        appContext.setTheme(readTuiTheme());
        renderResizeRecovery();
        return {ok: true};
      }
    },
    context: {
      getUsage() {
        return appContext.contextUsage
          ? {...appContext.contextUsage, segments: appContext.contextUsage.segments ? [...appContext.contextUsage.segments] : undefined}
          : null;
      }
    },
    usage: {
      listDailyUsage(query) {
        return usageStore ? usageStore.listDailyUsage(query) : [];
      },
      getViewport() {
        const state = appContext.createRenderState();
        return {
          maxLines: calculateCommandSurfaceMaxLines(state.rows),
          width: state.width
        };
      }
    },
    diff: {
      getSource() {
        return appContext.createDiffSourceResult();
      },
      /**
       * 返回当前 command surface 的渲染预算，供滚动状态按真实视口截断。
       */
      getViewport() {
        const state = appContext.createRenderState();
        return {
          maxLines: calculateCommandSurfaceMaxLines(state.rows),
          width: state.width
        };
      }
    },
    undo: {
      getSummary() {
        return appContext.getUndoSummary();
      },
      execute() {
        return appContext.executeUndo();
      }
    },
    assistant: {
      beginManualCompaction(): boolean {
        if (appContext.responding) {
          renderFooter();
          return false;
        }

        appContext.beginManualCompaction();
        appContext.startSpinner('working');
        renderFooter();
        return true;
      },
      compactContext(options: {force: true}) {
        const prepared = prepareAgent(() => appContext.getCurrentCwd());
        const session = appContext.getAgentSession();

        return runCompaction({
          records: session.records,
          compaction: session.compaction,
          force: options.force,
          agent: prepared.agent
        });
      },
      finishManualCompaction(result: CommandCompactionResult) {
        appContext.stopSpinner();

        if (result.didCompact && result.compaction) {
          const noticeRecord = appContext.applyCompaction(result.compaction);
          appContext.finishAssistantTurn('');
          appendRecord(noticeRecord);
          return;
        }

        appContext.finishAssistantTurn('');
        appendRecord(appContext.appendTranscriptRecord({
          role: 'compaction_notice',
          text: '当前无需压缩'
        }));
      },
      fail(error: unknown) {
        appContext.stopSpinner();
        appendRecord(appContext.failAssistantTurn(error));
      }
    },
    ui: {
      renderFooter,
      renderResizeRecovery,
      exit
    }
  };
}

function createCopyableRecords(records: TranscriptRecord[]): CopyableMessageRecord[] {
  return records
    .map((record, index) => ({record, index}))
    .filter(({record}) => record.role === 'user' || record.role === 'assistant')
    .map(({record, index}) => ({
      createdAt: record.createdAt,
      id: `message-${index}`,
      role: record.role as CopyableMessageRecord['role'],
      text: record.text
    }));
}

export {
  createCommandHost,
  createCopyableRecords
};

export type {
  CommandHostOptions
};
