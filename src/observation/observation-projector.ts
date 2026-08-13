import {hashValue, summarizeText} from '../debug/debug-context';
import {
  emitToolApprovalRequestHook,
  emitToolApprovalResponseHook,
  emitUserQuestionRequestHook,
  emitUserQuestionResponseHook
} from '../hooks/lifecycle-events';
import {createCompositeObservation, disabledObservation} from './observation';

import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {ProviderUsage} from '../types/agent';
import type {ToolApprovalRequest, ToolExecutionResult} from '../types/tool';
import type {AgentRunScope, Observation} from './observation';

type ObservationOutput = Pick<NodeJS.WriteStream, 'write'>;

/** 创建唯一生产 observation；debug 关闭时不安装诊断 projector。 */
function createObservation(debug?: DebugContext, hooks?: LifecycleHookDispatcher, output?: ObservationOutput): Observation {
  const observations: Observation[] = [];
  if (debug?.enabled) observations.push(createDebugObservation(debug, output));
  if (hooks) observations.push(createHookObservation(hooks));
  return createCompositeObservation(observations);
}

/** 把所有 runtime 事实投影为兼容的脱敏 debug JSONL。 */
function createDebugObservation(debug: DebugContext, output?: ObservationOutput): Observation {
  return {
    ...disabledObservation,
    appStarted({scope, terminalSize}) {
      if (debug.logPath) output?.write(`[debug] logging to ${debug.logPath}\n`);
      debug.emit('app_start', {
        cwd: scope.cwd,
        logPath: debug.logPath,
        nodeVersion: scope.nodeVersion,
        pid: scope.pid,
        terminalSize
      });
    },
    appExiting({cwd, interactionMode}) {
      debug.emit('app_exit', {cwd, interactionMode});
    },
    close() {
      debug.close();
    },
    configurationWatchFailed({error}) {
      debug.emit('user_config_watch_error', {error: createErrorPayload(error)});
    },
    resizeRecovered({recordCount, terminalSize}) {
      debug.emit('resize_recovery', {recordCount, terminalSize});
    },
    transcriptBatchRendered({records}) {
      debug.emit('transcript_render_batch', {count: records.length, roles: records.map((record) => record.role)});
    },
    userSubmitted(input) {
      debug.emit('user_submit', {
        interactionMode: input.interactionMode,
        text: summarizeText(input.text, 0),
        displayText: input.displayText ? summarizeText(input.displayText, 0) : undefined,
        attachmentCount: input.attachmentCount,
        recordCount: input.recordCount
      });
    },
    assistantTurnStarted({scope, userText, recordCount}) {
      if (scope.runtimeKind === 'headless') return;
      debug.emit('assistant_turn_start', {
        interactionMode: scope.interactionMode,
        recordCount,
        userText: summarizeText(userText, 0)
      });
    },
    assistantTurnCompleted({scope, finalText}) {
      if (scope.runtimeKind === 'headless') return;
      debug.emit('assistant_turn_end', {
        interactionMode: scope.interactionMode,
        finalText: summarizeText(finalText, 0),
        status: 'completed'
      });
    },
    assistantTurnCancelled({scope}) {
      if (scope.runtimeKind === 'headless') return;
      debug.emit('assistant_turn_cancelled', {interactionMode: scope.interactionMode, status: 'cancelled'});
    },
    assistantTurnFailed({scope, error}) {
      if (scope.runtimeKind === 'headless') return;
      debug.emit('assistant_turn_error', {
        interactionMode: scope.interactionMode,
        status: 'error',
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    },
    toolApprovalReviewed(input) {
      debug.emit('tool_approval_review', {
        model: input.model,
        toolName: input.call.toolName,
        result: input.result,
        argumentsHash: hashValue(input.call.argumentsText),
        latencyMs: input.latencyMs,
        promptCharacters: input.promptCharacters,
        actionCharacters: input.actionCharacters,
        actionProjection: input.actionProjection,
        hasPriorExchange: input.hasPriorExchange,
        hasClarifications: input.hasClarifications,
        ...(input.fallbackReason ? {fallbackReason: input.fallbackReason} : {}),
        ...(input.errorName ? {errorName: input.errorName} : {})
      });
    },
    toolApprovalUsageStoreFailed({call, error, model}) {
      debug.emit('tool_approval_usage_store_error', {
        errorName: error instanceof Error ? error.name : undefined,
        model,
        toolName: call.toolName
      });
    },
    compactionCompleted({scope, compaction}) {
      debug.emit('compaction_end', {
        ...createDebugScopePayload(scope),
        activeStartIndex: compaction.activeStartIndex,
        createdAt: compaction.createdAt,
        summary: summarizeText(compaction.summaryText, 0)
      });
    },
    providerRequestBuilt({scope, request}) {
      const {memoryPrompt} = request;
      debug.emit('provider_request_built', {
        ...createDebugScopePayload(scope),
        activeRecordCount: request.activeRecordCount,
        activeStartIndex: request.activeStartIndex,
        agentInstructionsCount: request.agentInstructionsCount,
        userMemoryCount: memoryPrompt.userMemoryCount,
        agentMemoryCatalogCount: memoryPrompt.agentMemory.catalogCount,
        agentMemoryItemCount: memoryPrompt.agentMemory.itemCount,
        agentMemoryMode: memoryPrompt.agentMemory.mode,
        agentMemoryTokens: memoryPrompt.agentMemory.estimatedTokens,
        compaction: request.compaction ? {
          activeStartIndex: request.compaction.activeStartIndex,
          createdAt: request.compaction.createdAt,
          summary: summarizeText(request.compaction.summaryText, 0)
        } : null,
        providerConfig: request.provider,
        providerInputHash: hashValue(request.providerRecords),
        recordCount: request.providerRecords.length,
        recordRoles: request.providerRecords.map((record) => record.role),
        skillCatalogBudgetTokens: request.skillCatalogProjection.budgetTokens,
        skillCatalogCount: request.skillCatalog.length,
        skillCatalogMode: request.skillCatalogProjection.mode,
        skillCatalogOriginalTokens: request.skillCatalogProjection.originalTokens,
        skillCatalogTokens: request.skillCatalogTokens,
        systemPromptHash: request.providerRecords[0]?.role === 'system' ? hashValue(request.providerRecords[0].text) : null,
        toolNames: request.toolDefinitions.map((definition) => definition.name),
        toolSchemaHash: hashValue(request.toolDefinitions)
      });
    },
    providerUsage({scope, usage, usageInputTokens}) {
      debug.emit('provider_usage', {...createDebugScopePayload(scope), usage: createProviderUsageDebugPayload(usage, usageInputTokens)});
    },
    providerUsageStoreFailed({scope, error}) {
      debug.emit('provider_usage_store_error', {
        ...createDebugScopePayload(scope),
        error: createErrorPayload(error)
      });
    },
    subagentCatalogLoaded(diagnostics) {
      for (const diagnostic of diagnostics) {
        debug.emit('subagent_catalog_diagnostic', {
          code: diagnostic.code,
          message: diagnostic.message,
          sourceKind: diagnostic.sourceKind,
          sourcePath: diagnostic.sourcePath
        });
      }
    },
    toolApprovalResolved({scope, call, approval}) {
      debug.emit('tool_call_approval', {
        ...createDebugScopePayload(scope),
        decision: approval.decision?.kind || (approval.required ? 'missing' : 'not_required'),
        toolCallId: call.callId,
        toolName: call.toolName
      });
    },
    toolCompleted({scope, result}) {
      debug.emit('tool_call_end', {
        ...createDebugScopePayload(scope),
        ok: result.ok,
        resultText: summarizeText(result.text, 0),
        toolCallId: result.callId,
        toolName: result.toolName,
        truncated: isToolResultTruncated(result)
      });
    },
    toolRiskAssessed({scope, call, assessment}) {
      debug.emit('tool_call_risk', {
        ...createDebugScopePayload(scope),
        reason: assessment.risk === 'rejected' ? assessment.reason : undefined,
        risk: assessment.risk,
        toolCallId: call.callId,
        toolName: call.toolName
      });
    },
    toolStarted({scope, call}) {
      debug.emit('tool_call_start', {
        ...createDebugScopePayload(scope),
        argumentsText: summarizeText(call.argumentsText, 0),
        toolCallId: call.callId,
        toolName: call.toolName
      });
    }
  };
}

/** 把全部 lifecycle 事实投影到既有 hook dispatcher。 */
function createHookObservation(hooks: LifecycleHookDispatcher): Observation {
  return {
    ...disabledObservation,
    assistantTurnStarted({scope}) {
      hooks.emit('assistant_turn_start', {interactionMode: scope.interactionMode, status: 'started'});
    },
    assistantTurnCompleted({scope}) {
      hooks.emit('assistant_turn_end', {interactionMode: scope.interactionMode, status: 'completed'});
    },
    assistantTurnCancelled({scope}) {
      hooks.emit('assistant_turn_cancelled', {interactionMode: scope.interactionMode, status: 'cancelled'});
    },
    assistantTurnFailed({scope, error}) {
      hooks.emit('assistant_turn_error', {
        interactionMode: scope.interactionMode,
        status: 'error',
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : scope.runtimeKind === 'headless' ? String(error) : undefined
      });
    },
    manualApprovalRequested({scope, call, request}) {
      emitToolApprovalRequestHook(hooks, {
        ...createManualApprovalHookScope(request),
        interactionMode: scope.interactionMode,
        toolCall: call,
        approval: request
      });
    },
    manualApprovalCompleted({scope, call, decision, request}) {
      emitToolApprovalResponseHook(hooks, {
        ...createManualApprovalHookScope(request),
        interactionMode: scope.interactionMode,
        toolCall: call,
        decision
      });
    },
    compactionCompleted({scope, compaction}) {
      hooks.emit('compaction_end', {
        ...createHookLoopScope(scope),
        activeStartIndex: compaction.activeStartIndex,
        createdAt: compaction.createdAt
      });
    },
    toolApprovalRequested({scope, call, approval}) {
      emitToolApprovalRequestHook(hooks, {...createHookLoopScope(scope), toolCall: call, approval});
    },
    toolApprovalResolved({scope, call, approval}) {
      if (approval.emitLifecycleEvent && approval.decision) {
        emitToolApprovalResponseHook(hooks, {
          ...createHookLoopScope(scope),
          toolCall: call,
          decision: approval.decision
        });
      }
    },
    toolCompleted({scope, result}) {
      hooks.emit('tool_call_end', {
        ...createHookLoopScope(scope),
        toolCallId: result.callId,
        toolName: result.toolName,
        ok: result.ok
      });
    },
    toolStarted({scope, call}) {
      hooks.emit('tool_call_start', {
        ...createHookLoopScope(scope),
        toolCallId: call.callId,
        toolName: call.toolName,
        argumentsText: call.argumentsText
      });
    },
    userQuestionCompleted({scope, call, result}) {
      emitUserQuestionResponseHook(hooks, {...createHookLoopScope(scope), interactionMode: scope.interactionMode, toolCall: call, result});
    },
    userQuestionRequested({scope, call, request}) {
      emitUserQuestionRequestHook(hooks, {...createHookLoopScope(scope), interactionMode: scope.interactionMode, toolCall: call, request});
    }
  };
}

function createDebugScopePayload(scope: AgentRunScope): Record<string, unknown> {
  return {
    conversationKind: scope.conversationKind,
    interactionMode: scope.interactionMode,
    ...(scope.subagent ? {
      agentName: scope.subagent.agentName,
      parentToolCallId: scope.subagent.parentToolCallId,
      runId: scope.subagent.runId
    } : {})
  };
}

function createHookLoopScope(scope: AgentRunScope): {agentName?: string; conversationKind: AgentRunScope['conversationKind']; interactionMode: AgentRunScope['interactionMode']} {
  return {
    conversationKind: scope.conversationKind,
    interactionMode: scope.interactionMode,
    ...(scope.subagent ? {agentName: scope.subagent.agentName} : {})
  };
}

function createManualApprovalHookScope(request: Readonly<ToolApprovalRequest> | undefined): {agentName?: string; conversationKind: AgentRunScope['conversationKind']} {
  return request?.origin?.kind === 'subagent'
    ? {agentName: request.origin.agentName, conversationKind: 'subagent'}
    : {conversationKind: 'primary'};
}

function createProviderUsageDebugPayload(usage: ProviderUsage | undefined, usageInputTokens: number | undefined): ProviderUsage | null {
  const payload: ProviderUsage = {
    ...(typeof usageInputTokens === 'number' ? {inputTokens: usageInputTokens} : {}),
    ...(typeof usage?.inputTokens === 'number' ? {inputTokens: usage.inputTokens} : {}),
    ...(typeof usage?.cacheCreationInputTokens === 'number' ? {cacheCreationInputTokens: usage.cacheCreationInputTokens} : {}),
    ...(typeof usage?.cacheReadInputTokens === 'number' ? {cacheReadInputTokens: usage.cacheReadInputTokens} : {}),
    ...(typeof usage?.outputTokens === 'number' ? {outputTokens: usage.outputTokens} : {})
  };
  return Object.keys(payload).length > 0 ? payload : null;
}

function isToolResultTruncated(result: Readonly<ToolExecutionResult>): boolean | undefined {
  switch (result.details.kind) {
    case 'glob':
    case 'grep':
    case 'read_files':
    case 'web_fetch':
    case 'web_search':
    case 'bash':
      return result.details.truncated;
    case 'apply_patch':
    case 'edit_file':
    case 'generic':
      return undefined;
  }
}

function createErrorPayload(error: unknown): {name?: string; message: string} {
  return error instanceof Error ? {name: error.name, message: error.message} : {message: String(error)};
}

export {createDebugObservation, createHookObservation, createObservation};
