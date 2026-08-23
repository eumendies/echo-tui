import {isAbortError} from '../types/agent';
import {createToolApprovalResolver} from './tool-approval/resolver';

import type {AgentCallbacks, ReasoningEffort, RunAgent, ToolApprovalDecision} from '../types/agent';
import type {AssistantTurnScope, Observation} from '../observation/observation';
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
  observation: Observation;
  observationScope: AssistantTurnScope;
  renderRecords: (records: TranscriptRecord[]) => void;
  render: (finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>) => void;
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
    observation,
    observationScope,
    renderRecords,
    render
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
  const cancelQuestionOnAbort = () => {
    userQuestion.cancelActiveRequest('User question was interrupted because the assistant turn ended.');
  };
  turn.abortSignal.addEventListener('abort', cancelQuestionOnAbort, {once: true});
  const turnUserRecordIndex = appContext.transcriptContext.getRecords().length - 1;
  const isCurrentTurn = () => appContext.turnContext.isCurrentAssistantTurn(turn);
  /** 只有创建人工审批 surface 时才发布交互式审批事实。 */
  async function requestManualApproval(call: ToolCall, request?: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    const pendingDecision = toolApproval.requestManual(call, request);
    observation.manualApprovalRequested({scope: observationScope, call, request});
    const decision = await pendingDecision;
    observation.manualApprovalCompleted({scope: observationScope, call, decision, request});
    return decision;
  }
  const toolApprovalResolver = createToolApprovalResolver({
    abortSignal: turn.abortSignal,
    currentUserRequest: userRequestText,
    cwd: () => appContext.getCurrentCwd(),
    observation,
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
  observation.assistantTurnStarted({scope: observationScope, userText, recordCount: appContext.transcriptContext.records.length});

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
      async onSubagentUserQuestionRequest(runMetadata, call, request) {
        if (!isCurrentTurn() || !appContext.subagentRunContext.isCurrentRun(runMetadata.runId)) {
          return {
            callId: call.callId,
            toolName: call.toolName,
            ok: false,
            details: {kind: 'generic'},
            text: 'User question was interrupted.'
          };
        }

        const result = await userQuestion.request(call, request, {
          agentName: runMetadata.agentName
        });
        if (!isCurrentTurn() || !appContext.subagentRunContext.isCurrentRun(runMetadata.runId)) {
          return {
            callId: call.callId,
            toolName: call.toolName,
            ok: false,
            details: {kind: 'generic'},
            text: 'User question was interrupted.'
          };
        }
        return result;
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
        observation.assistantTurnCompleted({scope: observationScope, finalText});
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
      observation.assistantTurnCancelled({scope: observationScope});
    } else {
      renderRecords([appContext.turnContext.failAssistantTurn(error)]);
      observation.assistantTurnFailed({scope: observationScope, error});
    }
  } finally {
    turn.abortSignal.removeEventListener('abort', cancelQuestionOnAbort);
    const wasCurrentTurn = isCurrentTurn();

    if (wasCurrentTurn) {
      userQuestion.cancelActiveRequest('User question was interrupted because the assistant turn ended.');
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
