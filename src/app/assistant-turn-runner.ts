import {isAbortError} from '../types/agent';
import {summarizeText} from '../debug/debug-context';
import {emitToolApprovalRequestHook, emitToolApprovalResponseHook} from '../hooks/lifecycle-events';
import {createToolApprovalResolver} from './tool-approval/resolver';

import type {AgentCallbacks, ReasoningEffort, RunAgent, ToolApprovalDecision} from '../types/agent';
import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {ToolApprovalRequest, ToolCall, ToolResultAttachment} from '../types/tool';
import type {SubagentTranscriptRecord, TranscriptRecord, UserTranscriptMetadata} from '../types/transcript';
import type {AppContext} from './state/app-context';
import type {ToolApprovalContext} from './state/tool-approval-context';
import type {ToolApprovalReviewer} from './tool-approval/resolver';
import type {UserQuestionContext} from './state/user-question-context';

type AssistantTurnRunnerInput = {
  appContext: AppContext;
  runAgent: RunAgent;
  toolApproval: ToolApprovalContext;
  userQuestion: UserQuestionContext;
  userText: string;
  userRequestText: string; // 展开前的用户原始输入，不能退化为 provider-facing 展开文本。
  displayText?: string;
  metadata?: UserTranscriptMetadata;
  modelProfileIdOverride?: string;
  reasoningEffortOverride?: ReasoningEffort;
  attachments?: ToolResultAttachment[];
  debug: DebugContext;
  renderRecords: (records: TranscriptRecord[]) => void;
  render: (finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>) => void;
  hooks: LifecycleHookDispatcher;
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
    userRequestText,
    displayText,
    metadata,
    modelProfileIdOverride,
    reasoningEffortOverride,
    attachments,
    debug,
    renderRecords,
    render,
    hooks
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
  const turnUserRecordIndex = appContext.transcriptContext.getRecords().length - 1;
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
    currentUserRequest: userRequestText,
    cwd: () => appContext.getCurrentCwd(),
    debug,
    getRecords: () => appContext.transcriptContext.getRecords(),
    interactionMode,
    isCurrentTurn,
    reviewer: input.toolApprovalReviewer,
    settings: toolApprovalSettings,
    turnUserRecordIndex,
    userConfigSnapshot,
    toolApproval: {
      getCachedDecision: (call) => toolApproval.getCachedDecision(call),
      requestManual: requestManualApproval
    }
  });
  appContext.turnContext.startSpinner('thinking');
  renderRecords([userRecord]);
  const activeStatusLineModel = appContext.turnContext.getActiveStatusLineModelState();
  const hasSkillOverride = Boolean(activeStatusLineModel?.skillOverride);

  if (activeStatusLineModel && hasSkillOverride) {
    const effortText = activeStatusLineModel.reasoningEffort ? `，effort ${activeStatusLineModel.reasoningEffort}` : '';
    renderRecords([appContext.transcriptContext.appendRecord({
      role: 'local_notice',
      text: `当前 skill 本轮使用 ${activeStatusLineModel.modelLabel}${effortText}。`
    })]);
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
        render();
      },
      onThinking() {
        if (!isCurrentTurn()) {
          return;
        }

        if (!appContext.turnContext.getWorking()) {
          appContext.turnContext.startSpinner('thinking');
        }
        render();
      },
      onCompacted(compaction) {
        if (!isCurrentTurn()) {
          return;
        }

        render();
        renderRecords([appContext.transcriptContext.applyCompaction(compaction)]);
      },
      onProviderRetry(retry) {
        if (!isCurrentTurn()) {
          return;
        }

        render();
        renderRecords([appContext.transcriptContext.appendRecord({
          role: 'local_notice',
          text: retry.message
        })]);
      },
      onContextUsage(usage) {
        if (!isCurrentTurn()) {
          return;
        }

        appContext.setContextUsage(usage);
        render();
      },
      onToken(_char: string, draft: string) {
        if (!isCurrentTurn()) {
          return;
        }

        const startsAssistant = appContext.turnContext.streamingDraft === '';
        if (!appContext.turnContext.getWorking()) {
          appContext.turnContext.startSpinner('working');
        }
        // 首个正文 token 到达时立即交给 renderer，使 reasoning 尾行先于正文进入终端历史区。
        appContext.turnContext.setStreamingPending(draft);
        if (startsAssistant) {
          render();
        }
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

        const reasoning = appContext.turnContext.finalizeReasoning(update.text);
        if (reasoning) {
          render(reasoning);
        }
      },
      onProviderRecords(records: TranscriptRecord[]) {
        if (!isCurrentTurn() || records.length === 0) {
          return;
        }

        renderRecords(appContext.transcriptContext.appendRecords(records));
      },
      onAssistantSegment(segmentText: string) {
        if (!isCurrentTurn()) {
          return;
        }

        const segment = appContext.turnContext.finalizeAssistantSegment(segmentText);
        if (segment) {
          render(segment);
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
        render();
      },
      onToolApprovalRequest(call, request) {
        if (!isCurrentTurn() || request?.origin && !appContext.subagentRunContext.isCurrentRun(request.origin.runId)) {
          return {kind: 'deny', message: 'Tool execution was interrupted.'};
        }
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

        renderRecords(appContext.transcriptContext.appendRecords(appContext.turnContext.appendPendingToolResult(result)));
      },
      onSubagentRecords(records: SubagentTranscriptRecord[]) {
        if (!isCurrentTurn() || records.length === 0 || !appContext.subagentRunContext.acceptRecords(records)) {
          return;
        }

        renderRecords(appContext.transcriptContext.appendRecords(records));
      },
      onSubagentActivity(activity) {
        if (!isCurrentTurn() || !appContext.subagentRunContext.updateActivity(activity)) {
          return;
        }
        // 高频 token 只更新草稿；统一由常驻 timer 读取最新状态并刷新 footer。
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
        const assistant = appContext.turnContext.finishAssistantTurn(finalText);

        if (assistant) {
          render(assistant);
        } else {
          render();
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
    const reasoning = appContext.turnContext.finalizeReasoning();
    if (reasoning) {
      render(reasoning);
    }
    const partial = appContext.turnContext.finalizeAssistantSegment(appContext.turnContext.streamingDraft);

    if (partial) {
      render(partial);
    }

    if (isAbortError(error) || turn.abortSignal.aborted) {
      renderRecords([appContext.turnContext.cancelAssistantTurn()]);
      hooks.emit('assistant_turn_cancelled', {
        interactionMode: appContext.getInteractionMode(),
        status: 'cancelled'
      });
      debug.emit('assistant_turn_cancelled', {
        interactionMode: appContext.getInteractionMode(),
        status: 'cancelled'
      });
    } else {
      renderRecords([appContext.turnContext.failAssistantTurn(error)]);
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
      appContext.subagentRunContext.clear();
      appContext.finalizeChangeCheckpoint();
    }
    appContext.turnContext.clearAssistantTurnIfCurrent(turn);

    if (wasCurrentTurn) {
      // 恢复 session 状态只消费 Context 当前已安装 revision；磁盘刷新由 watcher 或显式写入负责。
      appContext.applyModelConfigSnapshot(appContext.captureUserConfigSnapshot());
      render();
    }
  }
}

export {
  runAssistantTurn
};
