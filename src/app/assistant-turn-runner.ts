import {isAbortError} from '../types/agent';
import {summarizeText} from '../debug/debug-context';

import type {AgentCallbacks, RunAgent} from '../types/agent';
import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {ToolResultAttachment} from '../types/tool';
import type {TranscriptRecord} from '../types/transcript';
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
  metadata?: Record<string, unknown>;
  modelProfileId?: string;
  attachments?: ToolResultAttachment[];
  debug?: DebugContext;
  appendRecord: (record: TranscriptRecord) => void;
  appendRecords: (records: TranscriptRecord[]) => void;
  hooks?: LifecycleHookDispatcher;
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
    metadata: {...(metadata || {}), interactionMode},
    attachments
  });
  // thinking 和 streaming 都只进入 pending preview，完成或 partial 失败后才正式追加 assistant block。
  const turn = appContext.beginAssistantTurn(modelProfileId);
  const isCurrentTurn = () => appContext.isCurrentAssistantTurn(turn);
  appContext.startSpinner('thinking');
  appendRecord(userRecord);
  const skillOverrideModelLabel = appContext.getActiveSkillOverrideModelLabel();

  if (skillOverrideModelLabel) {
    appendRecord(appContext.appendTranscriptRecord({
      role: 'local_notice',
      text: `已切换到 ${skillOverrideModelLabel} 执行当前 skill。`
    }));
  }
  debug?.emit('assistant_turn_start', {
    interactionMode,
    recordCount: appContext.transcriptRecords.length,
    userText: summarizeText(userText, 0)
  });
  hooks?.emit('assistant_turn_start', {
    interactionMode,
    status: 'started'
  });

  try {
    await runAgent({...appContext.getAgentSession(), abortSignal: turn.abortSignal, modelProfileId}, {
      changeRecorder: appContext.createChangeRecorder(),
      onModelResolved(model) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.setAssistantTurnModel(turn, {
          modelLabel: model.model,
          ...(model.reasoningEffort ? {reasoningEffort: model.reasoningEffort} : {}),
          ...(skillOverrideModelLabel ? {skillOverride: true} : {})
        });
        renderFooter();
      },
      onThinking() {
        if (!isCurrentTurn()) {
          return;
        }

        if (!appContext.getWorking()) {
          appContext.startSpinner('thinking');
        }
        renderFooter();
      },
      onCompacted(compaction) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.cancelStreamingRender();
        appendRecord(appContext.applyCompaction(compaction));
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

        if (!appContext.getWorking()) {
          appContext.startSpinner('working');
        }
        appContext.setStreamingPending(draft);
        appContext.scheduleStreamingRender();
      },
      onReasoningSummary(text: string) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.cancelStreamingRender();
        appendRecord(appContext.appendReasoningSummary(text));
      },
      onProviderRecords(records: TranscriptRecord[]) {
        if (!isCurrentTurn() || records.length === 0) {
          return;
        }

        appendRecords(appContext.appendTranscriptRecords(records));
      },
      onAssistantSegment(segmentText: string) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.cancelStreamingRender();
        const segmentRecord = appContext.commitPartialAssistantTurn(segmentText);

        if (segmentRecord) {
          appendRecord(segmentRecord);
        }
      },
      onToolCall(call) {
        if (!isCurrentTurn()) {
          return;
        }

        if (!appContext.getWorking()) {
          appContext.startSpinner('working');
        }
        appContext.cancelStreamingRender();
        appContext.setToolCallPending(call);
        renderFooter();
      },
      onToolApprovalRequest(call, request) {
        if (!isCurrentTurn()) {
          return {kind: 'deny', message: 'Tool execution was interrupted.'};
        }

        appContext.cancelStreamingRender();
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

        appContext.cancelStreamingRender();
        return userQuestion.request(call, request);
      },
      onToolResult(result) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.cancelStreamingRender();
        appendRecords(appContext.appendTranscriptRecords(appContext.appendPendingToolResult(result)));
      },
      onTodoStateChange(todoState) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.updateTodoState(todoState);
      },
      onComplete(finalText: string) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.cancelStreamingRender();
        appContext.stopSpinner();
        const assistantRecord = appContext.finishAssistantTurn(finalText);

        if (assistantRecord) {
          appendRecord(assistantRecord);
        } else {
          renderFooter();
        }
        hooks?.emit('assistant_turn_end', {
          interactionMode: appContext.getInteractionMode(),
          status: 'completed'
        });
        debug?.emit('assistant_turn_end', {
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

    appContext.cancelStreamingRender();
    appContext.stopSpinner();
    const partialRecord = appContext.commitPendingAssistantDraft();

    if (partialRecord) {
      appendRecord(partialRecord);
    }

    if (isAbortError(error) || turn.abortSignal.aborted) {
      appendRecord(appContext.cancelAssistantTurn());
      hooks?.emit('assistant_turn_cancelled', {
        interactionMode: appContext.getInteractionMode(),
        status: 'cancelled'
      });
      debug?.emit('assistant_turn_cancelled', {
        interactionMode: appContext.getInteractionMode(),
        status: 'cancelled'
      });
    } else {
      appendRecord(appContext.failAssistantTurn(error));
      hooks?.emit('assistant_turn_error', {
        interactionMode: appContext.getInteractionMode(),
        status: 'error',
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : undefined
      });
      debug?.emit('assistant_turn_error', {
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
    appContext.clearAssistantTurnIfCurrent(turn);

    if (wasCurrentTurn) {
      appContext.refreshModelStateFromConfig();
      renderFooter();
    }
  }
}

export {
  runAssistantTurn
};
