import {ASK_USER_QUESTIONS_TOOL_NAME} from '../../tools/ask-user-questions-tool-handler';
import {classifyReadonlyToolCall, classifyToolCallRisk} from '../../tools/tool-risk-classifier';
import {executeTodoToolCall, isTodoToolName} from '../../tools/todo-tool-handler';
import {throwIfAborted} from '../../types/agent';
import {
  createRejectedToolResult,
  createRejectedToolResultFromDecision,
  executeUserQuestionToolCall,
  isToolExecutionAllowed
} from './shared';

import type {
  AgentCallbacks,
  AgentExecutionMode,
  AgentToolPolicy,
  InteractionMode,
  SubagentWorkspaceSelection,
  ToolApprovalDecision
} from '../../types/agent';
import type {
  ToolApprovalRequest,
  ToolCall,
  ToolExecutionResult,
  ToolExecutor,
  ToolRegistry,
  ToolRiskAssessment
} from '../../types/tool';
import type {TodoState} from '../../types/transcript';
import type {AgentRunScope, Observation} from '../../observation/observation';

/**
 * 执行一次 tool call 所需的运行事实。
 *
 * 只包含准入链真正会读到的字段；provider、压缩、skill 预算等循环状态不在其中，
 * 避免执行层反向依赖整份运行状态。
 */
type ToolCallRuntime = {
  abortSignal?: AbortSignal; // 贯穿审批与执行的父级取消信号。
  executionMode: AgentExecutionMode; // interactive 或 headless 审批边界。
  executor: ToolExecutor; // 与 provider schema 共用 registry 的统一执行器。
  interactionMode: InteractionMode; // 风险分类使用的当前交互模式。
  observation: Observation; // 单一旁路观察边界。
  observationScope: AgentRunScope; // 当前运行复用的语义 scope。
  planBashSandboxed: boolean; // plan 运行且生效沙箱为 read-only 档。
  readonlyBashSandboxed: boolean; // 只读运行且 bash 沙箱实际生效。
  readonlyMcpToolNames?: ReadonlySet<string>; // run 启动时固定的 MCP 只读工具名称集合。
  readonlySubagentNames?: ReadonlySet<string>; // run 启动时固定的只读子 Agent 名称集合。
  registry: ToolRegistry; // provider schema 查询的权威目录，也是执行准入边界。
  todoState: TodoState | undefined; // 待办状态；Todo 工具执行后会原地回写。
  toolPolicy: AgentToolPolicy; // default 或 readonly 执行策略。
};

type ToolApprovalResolution = {
  decision: ToolApprovalDecision; // 实际生效的授权决策。
  emitLifecycleEvents: boolean; // 是否发布审批 response hook；交互式 UI 自行发布。
};

type ToolCallExecutionContext = {
  subagentGroupSize?: number; // 并行批内 run_subagent 调用总数；仅 ≥2 时设置。
  subagentWorkspace?: SubagentWorkspaceSelection; // 调度器选定的工作区方式。
};

/**
 * 执行单个 tool call：registry 准入 → 只读短路 → Todo/提问 → 风险分类 → 审批 → 执行。
 *
 * 这是 provider 输出进入本地工具的唯一准入链；授权与 full-access 都不能恢复已禁用工具。
 */
async function executeToolCall(toolCall: ToolCall, runtime: ToolCallRuntime, callbacks: AgentCallbacks, context: ToolCallExecutionContext = {}): Promise<ToolExecutionResult> {
  throwIfAborted(runtime.abortSignal);

  // provider 输出不可信；最终 registry 是普通、并行及特殊工具共同的执行准入边界。
  // 必须先于 Todo、提问、委派和风险审批，授权与 full-access 不能恢复已禁用工具。
  if (!runtime.registry.getHandler(toolCall.toolName)) {
    return createRejectedToolResult(toolCall, `Unknown tool: ${toolCall.toolName}`);
  }

  // 只读运行由 readonly classifier 一次性判定:rejected 立即短路,safe 直接沿用到执行链路,
  // 不再回落普通风险分类——否则 allowlist 内的只读命令会被启发式写风险规则二次误判为需要审批。
  // 只读运行里的 MCP 工具沿用同一判定:命中 run 启动时固定的只读集合才放行,不进入审批。
  const readonlyAssessment = runtime.toolPolicy === 'readonly'
    ? classifyReadonlyToolCall(toolCall, runtime.readonlySubagentNames, runtime.readonlyBashSandboxed, runtime.readonlyMcpToolNames)
    : null;

  if (readonlyAssessment !== null && readonlyAssessment.risk === 'rejected') {
    runtime.observation.toolRiskAssessed({scope: runtime.observationScope, call: toolCall, assessment: readonlyAssessment});
    return createRejectedToolResult(toolCall, readonlyAssessment.message);
  }

  if (isTodoToolName(toolCall.toolName)) {
    const todoResult = executeTodoToolCall(toolCall, runtime.todoState);

    if (todoResult.ok) {
      runtime.todoState = todoResult.todoState;
      callbacks.onTodoStateChange?.(todoResult.todoState);
    }

    return todoResult.result;
  }

  if (toolCall.toolName === ASK_USER_QUESTIONS_TOOL_NAME) {
    return executeUserQuestionToolCall(toolCall, {
      abortSignal: runtime.abortSignal,
      executionMode: runtime.executionMode,
      onRequest: (call, request) => runtime.observation.userQuestionRequested({scope: runtime.observationScope, call, request}),
      onResponse: (call, result) => runtime.observation.userQuestionCompleted({scope: runtime.observationScope, call, result}),
      request: callbacks.onUserQuestionRequest
    });
  }

  // 默认运行在这里执行普通风险分类;只读运行复用 readonly 判定结果,不进入审批分支。
  // Bash 分层由 runtime 在初始化及引导应用边界解析，分类器不自行读取配置。
  const riskAssessment: ToolRiskAssessment = readonlyAssessment
    ?? classifyToolCallRisk(toolCall, runtime.interactionMode, runtime.readonlyMcpToolNames, runtime.planBashSandboxed);
  runtime.observation.toolRiskAssessed({scope: runtime.observationScope, call: toolCall, assessment: riskAssessment});

  if (riskAssessment.risk === 'rejected') {
    return createRejectedToolResult(toolCall, riskAssessment.message);
  }

  const approval = riskAssessment.risk === 'approval_required' ? riskAssessment.approval : undefined;
  const approvalResolution = riskAssessment.risk === 'approval_required'
    ? await resolveToolApprovalDecision(toolCall, approval, runtime, callbacks)
    : undefined;
  const approvalDecision = approvalResolution?.decision;
  runtime.observation.toolApprovalResolved({
    scope: runtime.observationScope,
    call: toolCall,
    approval: {
      decision: approvalDecision,
      emitLifecycleEvent: approvalResolution?.emitLifecycleEvents === true,
      required: riskAssessment.risk === 'approval_required'
    }
  });
  throwIfAborted(runtime.abortSignal);

  if (approvalDecision && !isToolExecutionAllowed(approvalDecision.kind)) {
    return createRejectedToolResultFromDecision(toolCall, approvalDecision);
  }

  const result = await runtime.executor.execute(toolCall, {
    abortSignal: runtime.abortSignal,
    changeRecorder: callbacks.changeRecorder,
    ...(context.subagentGroupSize === undefined ? {} : {subagentGroupSize: context.subagentGroupSize}),
    ...(context.subagentWorkspace ? {subagentWorkspace: context.subagentWorkspace} : {})
  });
  throwIfAborted(runtime.abortSignal);
  return result;
}

/**
 * 根据 execution mode 决定是否等待 UI；headless 策略永远不会触碰交互 callback。
 */
async function resolveToolApprovalDecision(
  toolCall: ToolCall,
  approval: ToolApprovalRequest | undefined,
  runtime: Pick<ToolCallRuntime, 'executionMode' | 'observation' | 'observationScope'>,
  callbacks: AgentCallbacks
): Promise<ToolApprovalResolution> {
  if (runtime.executionMode.kind === 'headless') {
    runtime.observation.toolApprovalRequested({scope: runtime.observationScope, call: toolCall, approval});

    if (runtime.executionMode.approvalPolicy === 'full-access') {
      return {decision: {kind: 'allow_once'}, emitLifecycleEvents: true};
    }

    return {
      decision: {
        kind: 'deny',
        message: `Tool execution requires approval in headless mode: ${toolCall.toolName}. Re-run with --full-access to allow it.`
      },
      emitLifecycleEvents: true
    };
  }

  return {
    decision: await Promise.resolve(callbacks.onToolApprovalRequest!(toolCall, approval)),
    emitLifecycleEvents: false
  };
}

export {executeToolCall, resolveToolApprovalDecision};

export type {ToolApprovalResolution, ToolCallExecutionContext, ToolCallRuntime};
