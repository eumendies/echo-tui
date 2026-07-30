import {isAbortError} from '../types/agent';
import {summarizeText} from '../debug/debug-context';

import type {AgentCallbacks, ReasoningEffort, RunAgent} from '../types/agent';
import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {ToolResultAttachment} from '../types/tool';
import type {TranscriptRecord, UserTranscriptMetadata} from '../types/transcript';
import type {AppContext} from './state/app-context';
import type {ToolApprovalContext} from './state/tool-approval-context';
import type {UserQuestionContext} from './state/user-question-context';

type AssistantTurnRunnerInput = {
  appContext: AppContext;
  runAgent: RunAgent;
  toolApproval: ToolApprovalContext;
  userQuestion: UserQuestionContext;
  userText: string;
  displayText?: string;
  metadata?: UserTranscriptMetadata;
  modelProfileId?: string;
  reasoningEffortOverride?: ReasoningEffort;
  attachments?: ToolResultAttachment[];
  debug: DebugContext;
  appendRecord: (record: TranscriptRecord) => void;
  appendRecords: (records: TranscriptRecord[]) => void;
  hooks: LifecycleHookDispatcher;
  renderFooter: () => void;
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
    modelProfileId,
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
  const userRecord = appContext.beginUserTurn(userText, {
    displayText,
    metadata: {...metadata, interactionMode},
    attachments
  });
  // thinking 和 streaming 都只进入 pending preview，完成或 partial 失败后才正式追加 assistant block。
  const turn = appContext.beginAssistantTurn(modelProfileId, reasoningEffortOverride);
  const isCurrentTurn = () => appContext.turnContext.isCurrentAssistantTurn(turn);
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
    await runAgent({...appContext.getAgentSession(), abortSignal: turn.abortSignal, modelProfileId, reasoningEffortOverride}, {
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
      onReasoningSummary(text: string) {
        if (!isCurrentTurn()) {
          return;
        }

        appendRecord(appContext.turnContext.appendReasoningSummary(text));
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
        if (!isCurrentTurn()) {
          return {kind: 'deny', message: 'Tool execution was interrupted.'};
        }

        return toolApproval.request(call, request);
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
      appContext.refreshModelStateFromConfig();
      renderFooter();
    }
  }
}

export {
  runAssistantTurn
};
