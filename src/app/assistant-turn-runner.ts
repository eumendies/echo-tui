import {isAbortError} from '../types/agent';
import {summarizeText} from '../debug/debug-context';
import {emitToolApprovalRequestHook, emitToolApprovalResponseHook} from '../hooks/lifecycle-events';
import {createToolApprovalResolver} from './tool-approval-resolver';

import type {AgentCallbacks, ReasoningEffort, RunAgent, ToolApprovalDecision} from '../types/agent';
import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {ToolApprovalRequest, ToolCall, ToolResultAttachment} from '../types/tool';
import type {TranscriptRecord, UserTranscriptMetadata} from '../types/transcript';
import type {AppContext} from './state/app-context';
import type {ToolApprovalContext} from './state/tool-approval-context';
import type {ToolApprovalReviewer} from './tool-approval-resolver';
import type {UserQuestionContext} from './state/user-question-context';

type AssistantTurnRunnerInput = {
  appContext: AppContext;
  runAgent: RunAgent;
  toolApproval: ToolApprovalContext;
  userQuestion: UserQuestionContext;
  userText: string;
  displayText?: string;
  metadata?: UserTranscriptMetadata;
  modelProfileIdOverride?: string;
  reasoningEffortOverride?: ReasoningEffort;
  attachments?: ToolResultAttachment[];
  debug: DebugContext;
  appendRecord: (record: TranscriptRecord) => void;
  appendRecords: (records: TranscriptRecord[]) => void;
  hooks: LifecycleHookDispatcher;
  renderFooter: () => void;
  toolApprovalReviewer?: ToolApprovalReviewer; // 仅交互式 auto 审批使用的独立模型判断器。
};

/**
 * 驱动一次普通 assistant turn，把 agent callback 翻译为 app 状态变化和 transcript 追加。
 * 调用方负责提交前路由；本模块只处理 user record 之后的模型响应生命周期。
 */
async function runAssistantTurn(input: AssistantTurnRunnerInput): Promise<void> {
  const {
    appContext,
    runAgent,
    toolApproval,
    userQuestion,
    userText,
    displayText,
    metadata,
    modelProfileIdOverride,
    reasoningEffortOverride,
    attachments,
    debug,
    appendRecord,
    appendRecords,
    hooks,
    renderFooter
  } = input;

  appContext.beginChangeCheckpoint();
  const interactionMode = appContext.getInteractionMode();
  const userConfigSnapshot = appContext.captureUserConfigSnapshot();
  const toolApprovalSettings = appContext.getToolApprovalSettings(userConfigSnapshot);
  const userRecord = appContext.beginUserTurn(userText, {
    displayText,
    metadata: {...metadata, interactionMode},
    attachments
  });
  // thinking 和 streaming 都只进入 pending preview，完成或 partial 失败后才正式追加 assistant block。
  const turn = appContext.beginAssistantTurn(modelProfileIdOverride, reasoningEffortOverride);
  const isCurrentTurn = () => appContext.turnContext.isCurrentAssistantTurn(turn);
  /** 只有创建人工审批 surface 时才派发交互式审批 lifecycle hooks。 */
  async function requestManualApproval(call: ToolCall, request?: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    const pendingDecision = toolApproval.requestManual(call, request);
    emitToolApprovalRequestHook(hooks, {interactionMode, toolCall: call, approval: request});
    const decision = await pendingDecision;
    emitToolApprovalResponseHook(hooks, {interactionMode, toolCall: call, decision});
    return decision;
  }
  const toolApprovalResolver = createToolApprovalResolver({
    abortSignal: turn.abortSignal,
    getRecords: () => appContext.transcriptContext.getRecords(),
    interactionMode,
    isCurrentTurn,
    reviewer: input.toolApprovalReviewer,
    settings: toolApprovalSettings,
    userConfigSnapshot,
    toolApproval: {
      getCachedDecision: (call) => toolApproval.getCachedDecision(call),
      requestManual: requestManualApproval
    }
  });
  appContext.turnContext.startSpinner('thinking');
  appendRecord(userRecord);
  const activeStatusLineModel = appContext.turnContext.getActiveStatusLineModelState();
  const hasSkillOverride = Boolean(activeStatusLineModel?.skillOverride);

  if (activeStatusLineModel && hasSkillOverride) {
    const effortText = activeStatusLineModel.reasoningEffort ? `，effort ${activeStatusLineModel.reasoningEffort}` : '';
    appendRecord(appContext.transcriptContext.appendRecord({
      role: 'local_notice',
      text: `当前 skill 本轮使用 ${activeStatusLineModel.modelLabel}${effortText}。`
    }));
  }
  debug.emit('assistant_turn_start', {
    interactionMode,
    recordCount: appContext.transcriptContext.records.length,
    userText: summarizeText(userText, 0)
  });
  hooks.emit('assistant_turn_start', {
    interactionMode,
    status: 'started'
  });

  try {
    const session = appContext.getAgentSession({modelProfileIdOverride, reasoningEffortOverride}, userConfigSnapshot);
    await runAgent({
      ...session,
      abortSignal: turn.abortSignal
    }, {
      changeRecorder: appContext.changeHistoryContext.createRecorder(),
      onModelResolved(model) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.turnContext.setActiveStatusLineModelState(turn, {
          modelLabel: model.model,
          ...(model.reasoningEffort ? {reasoningEffort: model.reasoningEffort} : {}),
          ...(hasSkillOverride ? {skillOverride: true} : {})
        });
        renderFooter();
      },
      onThinking() {
        if (!isCurrentTurn()) {
          return;
        }

        if (!appContext.turnContext.getWorking()) {
          appContext.turnContext.startSpinner('thinking');
        }
        renderFooter();
      },
      onCompacted(compaction) {
        if (!isCurrentTurn()) {
          return;
        }

        appendRecord(appContext.transcriptContext.applyCompaction(compaction));
      },
      onProviderRetry(retry) {
        if (!isCurrentTurn()) {
          return;
        }

        appendRecord(appContext.transcriptContext.appendRecord({
          role: 'local_notice',
          text: retry.message
        }));
      },
      onContextUsage(usage) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.setContextUsage(usage);
        renderFooter();
      },
      onToken(_char: string, draft: string) {
        if (!isCurrentTurn()) {
          return;
        }

        if (!appContext.turnContext.getWorking()) {
          appContext.turnContext.startSpinner('working');
        }
        appContext.turnContext.setStreamingPending(draft);
      },
      onReasoningUpdate(update) {
        if (!isCurrentTurn()) {
          return;
        }

        if (!appContext.turnContext.getWorking()) {
          appContext.turnContext.startSpinner('working');
        }

        if (update.kind === 'draft') {
          appContext.turnContext.setReasoningStreamingPending(update.text);
          return;
        }

        appendRecord(appContext.turnContext.appendReasoningSummary(update.text));
      },
      onProviderRecords(records: TranscriptRecord[]) {
        if (!isCurrentTurn() || records.length === 0) {
          return;
        }

        appendRecords(appContext.transcriptContext.appendRecords(records));
      },
      onAssistantSegment(segmentText: string) {
        if (!isCurrentTurn()) {
          return;
        }

        const segmentRecord = appContext.turnContext.commitPartialAssistantTurn(segmentText);

        if (segmentRecord) {
          appendRecord(segmentRecord);
        }
      },
      onToolCall(call) {
        if (!isCurrentTurn()) {
          return;
        }

        if (!appContext.turnContext.getWorking()) {
          appContext.turnContext.startSpinner('working');
        }
        appContext.turnContext.setToolCallPending(call);
        renderFooter();
      },
      onToolApprovalRequest(call, request) {
        return toolApprovalResolver.request(call, request);
      },
      onUserQuestionRequest(call, request) {
        if (!isCurrentTurn()) {
          return {
            callId: call.callId,
            toolName: call.toolName,
            ok: false,
            text: 'User question was interrupted.'
          };
        }

        return userQuestion.request(call, request);
      },
      onToolResult(result) {
        if (!isCurrentTurn()) {
          return;
        }

        appendRecords(appContext.transcriptContext.appendRecords(appContext.turnContext.appendPendingToolResult(result)));
      },
      onTodoStateChange(todoState) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.transcriptContext.updateTodoState(todoState);
      },
      onComplete(finalText: string) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.turnContext.stopSpinner();
        const assistantRecord = appContext.turnContext.finishAssistantTurn(finalText);

        if (assistantRecord) {
          appendRecord(assistantRecord);
        } else {
          renderFooter();
        }
        hooks.emit('assistant_turn_end', {
          interactionMode: appContext.getInteractionMode(),
          status: 'completed'
        });
        debug.emit('assistant_turn_end', {
          interactionMode: appContext.getInteractionMode(),
          finalText: summarizeText(finalText, 0),
          status: 'completed'
        });
      }
    } as AgentCallbacks);

  } catch (error: unknown) {
    if (!isCurrentTurn()) {
      return;
    }

    appContext.turnContext.stopSpinner();
    const partialRecord = appContext.turnContext.commitPendingAssistantDraft();

    if (partialRecord) {
      appendRecord(partialRecord);
    }

    if (isAbortError(error) || turn.abortSignal.aborted) {
      appendRecord(appContext.turnContext.cancelAssistantTurn());
      hooks.emit('assistant_turn_cancelled', {
        interactionMode: appContext.getInteractionMode(),
        status: 'cancelled'
      });
      debug.emit('assistant_turn_cancelled', {
        interactionMode: appContext.getInteractionMode(),
        status: 'cancelled'
      });
    } else {
      appendRecord(appContext.turnContext.failAssistantTurn(error));
      hooks.emit('assistant_turn_error', {
        interactionMode: appContext.getInteractionMode(),
        status: 'error',
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : undefined
      });
      debug.emit('assistant_turn_error', {
        interactionMode: appContext.getInteractionMode(),
        status: 'error',
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  } finally {
    const wasCurrentTurn = isCurrentTurn();

    if (wasCurrentTurn) {
      appContext.finalizeChangeCheckpoint();
    }
    appContext.turnContext.clearAssistantTurnIfCurrent(turn);

    if (wasCurrentTurn) {
      // 恢复 session 状态只消费 Context 当前已安装 revision；磁盘刷新由 watcher 或显式写入负责。
      appContext.applyModelConfigSnapshot(appContext.captureUserConfigSnapshot());
      renderFooter();
    }
  }
}

export {
  runAssistantTurn
};
