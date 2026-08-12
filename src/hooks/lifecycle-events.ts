import type {InteractionMode, ToolApprovalDecision} from '../types/agent';
import type {LifecycleHookDispatcher, LifecycleHookPayloadData} from '../types/hooks';
import type {AskUserQuestionsRequest, ToolApprovalRequest, ToolCall, ToolExecutionResult} from '../types/tool';

type ToolApprovalRequestHookInput = {
  interactionMode?: InteractionMode;
  toolCall: ToolCall;
  approval?: ToolApprovalRequest;
};

type ToolApprovalResponseHookInput = {
  interactionMode?: InteractionMode;
  toolCall: ToolCall;
  decision: ToolApprovalDecision;
};

type UserQuestionRequestHookInput = {
  interactionMode: InteractionMode;
  toolCall: ToolCall;
  request: AskUserQuestionsRequest;
};

type UserQuestionResponseHookInput = {
  interactionMode: InteractionMode;
  toolCall: ToolCall;
  result: ToolExecutionResult;
};

/** 将工具授权请求映射为稳定的 lifecycle hook 业务字段。 */
function createToolApprovalRequestHookPayloadData(input: ToolApprovalRequestHookInput): LifecycleHookPayloadData {
  return {
    ...(input.interactionMode ? {interactionMode: input.interactionMode} : {}),
    toolCallId: input.toolCall.callId,
    toolName: input.toolCall.toolName,
    argumentsText: input.toolCall.argumentsText,
    ...(input.approval?.previewTitle ? {previewTitle: input.approval.previewTitle} : {}),
    ...(input.approval?.preview ? {preview: input.approval.preview} : {})
  };
}

/** 将工具授权结果映射为稳定的 lifecycle hook 业务字段。 */
function createToolApprovalResponseHookPayloadData(input: ToolApprovalResponseHookInput): LifecycleHookPayloadData {
  const decisionPayload = input.decision.kind === 'provide_feedback'
    ? {decision: input.decision.kind, feedbackText: input.decision.message}
    : input.decision.kind === 'allow_command_for_session'
      ? {decision: input.decision.kind, approvedCommand: input.decision.command}
      : {decision: input.decision.kind};

  return {
    ...(input.interactionMode ? {interactionMode: input.interactionMode} : {}),
    toolCallId: input.toolCall.callId,
    toolName: input.toolCall.toolName,
    argumentsText: input.toolCall.argumentsText,
    ...decisionPayload
  };
}

/** 将用户问题请求映射为稳定的 lifecycle hook 业务字段。 */
function createUserQuestionRequestHookPayloadData(input: UserQuestionRequestHookInput): LifecycleHookPayloadData {
  return {
    interactionMode: input.interactionMode,
    toolCallId: input.toolCall.callId,
    toolName: input.toolCall.toolName,
    argumentsText: input.toolCall.argumentsText,
    questionCount: input.request.questions.length,
    questionsText: input.request.questions.map((question) => question.question).join('\n')
  };
}

/** 将用户问题结果映射为稳定的 lifecycle hook 业务字段。 */
function createUserQuestionResponseHookPayloadData(input: UserQuestionResponseHookInput): LifecycleHookPayloadData {
  return {
    interactionMode: input.interactionMode,
    toolCallId: input.toolCall.callId,
    toolName: input.toolCall.toolName,
    argumentsText: input.toolCall.argumentsText,
    ok: input.result.ok,
    resultText: input.result.text,
    ...createAnswerCountPayload(input.result.text)
  };
}

/** 派发工具授权请求；调用方仍负责判断该请求是否代表真实生命周期事件。 */
function emitToolApprovalRequestHook(hooks: LifecycleHookDispatcher | undefined, input: ToolApprovalRequestHookInput): void {
  hooks?.emit('tool_approval_request', createToolApprovalRequestHookPayloadData(input));
}

/** 派发工具授权结果；调用方仍负责过滤 session cache 等非交互决策。 */
function emitToolApprovalResponseHook(hooks: LifecycleHookDispatcher | undefined, input: ToolApprovalResponseHookInput): void {
  hooks?.emit('tool_approval_response', createToolApprovalResponseHookPayloadData(input));
}

/** 派发用户问题请求。 */
function emitUserQuestionRequestHook(hooks: LifecycleHookDispatcher | undefined, input: UserQuestionRequestHookInput): void {
  hooks?.emit('user_question_request', createUserQuestionRequestHookPayloadData(input));
}

/** 派发用户问题结果。 */
function emitUserQuestionResponseHook(hooks: LifecycleHookDispatcher | undefined, input: UserQuestionResponseHookInput): void {
  hooks?.emit('user_question_response', createUserQuestionResponseHookPayloadData(input));
}

function createAnswerCountPayload(resultText: string): {answerCount?: number} {
  try {
    const parsed: unknown = JSON.parse(resultText);

    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as {answers?: unknown}).answers)) {
      return {answerCount: (parsed as {answers: unknown[]}).answers.length};
    }
  } catch {
    return {};
  }

  return {};
}

export {
  createToolApprovalRequestHookPayloadData,
  createToolApprovalResponseHookPayloadData,
  createUserQuestionRequestHookPayloadData,
  createUserQuestionResponseHookPayloadData,
  emitToolApprovalRequestHook,
  emitToolApprovalResponseHook,
  emitUserQuestionRequestHook,
  emitUserQuestionResponseHook
};
