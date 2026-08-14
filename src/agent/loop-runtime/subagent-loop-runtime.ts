import {resolveContextWindow} from '../../config/llm-config';
import {getMcpToolApproval} from '../../mcp/manager';
import {createUsageCwdHash} from '../../persistence/usage-store';
import {
  ASK_USER_QUESTIONS_TOOL_NAME
} from '../../tools/ask-user-questions-tool-handler';
import {createToolExecutor} from '../../tools/tool-executor';
import {classifySubagentToolCall, classifyToolCallRisk} from '../../tools/tool-risk-classifier';
import {createToolCallTranscriptRecord, createToolResultTranscriptRecord} from '../../tools/tool-transcript-record';
import {executeTodoToolCall, isTodoToolName} from '../../tools/todo-tool-handler';
import {throwIfAborted} from '../../types/agent';
import {prepareAgent} from '../agent-setup';
import {normalizeError} from '../agent-errors';
import {createCompactionNoticeRecord, runCompaction} from '../context/context-compaction';
import {
  buildProviderRecords,
  executeUserQuestionToolCall,
  hasRecordableProviderUsage
} from './shared';
import {disabledObservation} from '../../observation/observation';

import type {TokenUsageAnchor} from '../context/context-compaction';
import type {AgentTurnCallbacks, LlmConfig, ProviderAgent, ProviderRetry, ProviderUsage, ToolApprovalDecision} from '../../types/agent';
import type {ToolCall, ToolDefinition, ToolExecutionResult, ToolExecutor, ToolRegistry} from '../../types/tool';
import type {CompactionState, TodoState, TranscriptRecord} from '../../types/transcript';
import type {UsageStore} from '../../types/usage';
import type {InheritedAgentRunContext, RunSubagentAgent, SubagentLoopCallbacks, SubagentLoopInput} from './types';
import type {SubagentDefinition} from '../subagent/definition';
import type {McpManager} from '../../mcp/manager';
import type {AgentRunScope, Observation, ProviderObservationConfig} from '../../observation/observation';

const TOOL_REJECTED_BY_USER_TEXT = 'Tool execution was rejected by the user.';

type SubagentLoopRunState = {
  agent: ProviderAgent; // 已绑定子 Agent裁剪工具目录的 provider adapter。
  contextWindow: number; // 子运行压缩和上下文估算使用的模型窗口。
  executor: ToolExecutor; // 只解析子 registry中真实存在 handler的执行器。
  model: string; // 子运行固定的 provider模型名。
  observation: Observation; // 单一旁路观察边界。
  observationProvider: ProviderObservationConfig; // 从完整配置显式挑选的非敏感 provider 诊断事实。
  observationScope: AgentRunScope; // 当前子运行复用的语义 scope。
  providerType: LlmConfig['agentType']; // usage记录使用的 provider协议类型。
  reasoningEffort?: LlmConfig['reasoningEffort']; // 子运行固定的推理强度。
  registry: ToolRegistry; // 子 provider schema与执行器共用的裁剪目录。
  todoState: TodoState | undefined; // general 子 Agent 独立维护的待办状态；readonly 子 Agent 始终为空。
  toolDefinitions: ToolDefinition[]; // 真正发送给子 provider的工具 schema。
};

/** 生成保留原工具身份的拒绝结果，保证子 provider continuation协议完整。 */
function createRejectedToolResult(call: ToolCall, message?: string): ToolExecutionResult {
  return {
    callId: call.callId,
    toolName: call.toolName,
    ok: false,
    details: {kind: 'generic'},
    text: typeof message === 'string' && message.trim() !== '' ? message.trim() : TOOL_REJECTED_BY_USER_TEXT
  };
}

function createRejectedToolResultFromDecision(call: ToolCall, decision: ToolApprovalDecision): ToolExecutionResult {
  return createRejectedToolResult(call, decision.kind === 'provide_feedback'
    ? `Tool execution was rejected by the user.\n\nUser instruction:\n${decision.message}`
    : decision.kind === 'deny' ? decision.message : undefined);
}

function isToolExecutionAllowed(kind: string): boolean {
  return kind === 'allow_once' || kind === 'allow_tool_for_session' || kind === 'allow_command_for_session' || kind === 'allow_all_for_session';
}

/**
 * 执行子 Agent内部工具；定义策略决定Todo/提问、风险分类、审批和headless边界。
 */
async function executeSubagentToolCall(toolCall: ToolCall, input: SubagentLoopInput, state: SubagentLoopRunState, callbacks: SubagentLoopCallbacks, definition: SubagentDefinition, mcpManager?: McpManager): Promise<ToolExecutionResult> {
  throwIfAborted(input.abortSignal);
  const generalPurpose = definition.executionPolicy === 'general_purpose';

  // provider 输出不可信；仅定义白名单映射后真实存在的 handler 可以进入特殊分支或执行器。
  if (!state.registry.getHandler(toolCall.toolName)) {
    return createRejectedToolResult(toolCall, `Unknown tool: ${toolCall.toolName}`);
  }

  if (generalPurpose && isTodoToolName(toolCall.toolName)) {
    const todoResult = executeTodoToolCall(toolCall, state.todoState);
    if (todoResult.ok) {
      state.todoState = todoResult.todoState;
    }
    return todoResult.result;
  }

  if (generalPurpose && toolCall.toolName === ASK_USER_QUESTIONS_TOOL_NAME) {
    return executeUserQuestionToolCall(toolCall, {
      abortSignal: input.abortSignal,
      executionMode: input.executionMode,
      onRequest: (call, request) => state.observation.userQuestionRequested({scope: state.observationScope, call, request}),
      onResponse: (call, result) => state.observation.userQuestionCompleted({scope: state.observationScope, call, result}),
      onWaiting: callbacks.onWaitingQuestion,
      request: callbacks.onUserQuestionRequest
    });
  }

  const assessment = generalPurpose
    ? classifyToolCallRisk(toolCall, input.interactionMode, (toolName) => getMcpToolApproval(definition.includeMcpTools ? mcpManager : undefined, toolName))
    : classifySubagentToolCall(toolCall, input.metadata);
  state.observation.toolRiskAssessed({scope: state.observationScope, call: toolCall, assessment});

  if (assessment.risk === 'rejected') {
    return createRejectedToolResult(toolCall, assessment.message);
  }
  if (assessment.risk === 'approval_required') {
    const approval = {
      ...(assessment.approval || {}),
      origin: {
        kind: 'subagent' as const,
        agentName: input.metadata.agentName,
        runId: input.metadata.runId,
        task: input.task
      }
    };
    callbacks.onWaitingApproval?.(toolCall);
    let decision: ToolApprovalDecision;

    if (input.executionMode.kind === 'headless') {
      state.observation.toolApprovalRequested({scope: state.observationScope, call: toolCall, approval});
      decision = generalPurpose && input.executionMode.approvalPolicy === 'full-access'
        ? {kind: 'allow_once'}
        : {
            kind: 'deny',
            message: generalPurpose
              ? `Tool execution requires approval in headless mode: ${toolCall.toolName}. Re-run with --full-access to allow it.`
              : `Tool execution requires interactive manual approval and is unavailable in headless mode: ${toolCall.toolName}.`
          };
    } else {
      decision = callbacks.onToolApprovalRequest
        ? await callbacks.onToolApprovalRequest(toolCall, approval)
        : {kind: 'deny'};
    }
    state.observation.toolApprovalResolved({
      scope: state.observationScope,
      call: toolCall,
      approval: {decision, emitLifecycleEvent: input.executionMode.kind === 'headless', required: true}
    });

    throwIfAborted(input.abortSignal);
    if (!isToolExecutionAllowed(decision.kind)) {
      return createRejectedToolResultFromDecision(toolCall, decision);
    }
  } else {
    state.observation.toolApprovalResolved({
      scope: state.observationScope,
      call: toolCall,
      approval: {emitLifecycleEvent: false, required: false}
    });
  }

  const result = await state.executor.execute(toolCall, {
    abortSignal: input.abortSignal,
    changeRecorder: callbacks.changeRecorder
  });
  throwIfAborted(input.abortSignal);
  return result;
}

/**
 * 创建定义绑定的 subagent loop runtime；每个实例只运行隔离任务，不接收主 session或完整主 callbacks。
 */
function createSubagentLoopRuntime(cwd: string, inheritedContext: InheritedAgentRunContext, definition: SubagentDefinition, observation: Observation = disabledObservation, usageStore?: UsageStore, mcpManager?: McpManager): RunSubagentAgent {
  const cwdHash = createUsageCwdHash(cwd);

  const runSubagentLoop: RunSubagentAgent = async function runSubagentLoop(input, callbacks = {}): Promise<string> {
    throwIfAborted(input.abortSignal);
    let state: SubagentLoopRunState;

    try {
      const resolvedConfig = resolveSubagentLlmConfig(input, definition);
      const {agent, config, registry} = prepareAgent({
        allowedToolNames: new Set(definition.localToolNames),
        config: resolvedConfig,
        cwd,
        ...(definition.includeMcpTools && mcpManager ? {mcpManager} : {}),
      });
      state = {
        agent,
        contextWindow: resolveContextWindow(config),
        executor: createToolExecutor(registry),
        model: config.model,
        observation,
        observationProvider: {
          agentType: config.agentType,
          ...(config.baseURL ? {baseURL: config.baseURL} : {}),
          ...(typeof config.contextWindow === 'number' ? {contextWindow: config.contextWindow} : {}),
          model: config.model,
          ...(config.reasoningEffort ? {reasoningEffort: config.reasoningEffort} : {}),
          ...(config.reasoningSummary ? {reasoningSummary: config.reasoningSummary} : {})
        },
        observationScope: {
          conversationKind: 'subagent',
          interactionMode: input.interactionMode,
          subagent: input.metadata
        },
        providerType: config.agentType,
        reasoningEffort: config.reasoningEffort,
        registry,
        todoState: undefined,
        toolDefinitions: registry.listDefinitions()
      };
    } catch (error: unknown) {
      throw normalizeError(error, '无法加载子 Agent LLM 配置');
    }

    const recordRegion: TranscriptRecord[] = [{role: 'user', text: input.task}];
    let compactionState: CompactionState | undefined;
    let usageAnchor: TokenUsageAnchor | null = null;
    callbacks.onThinking?.();

    /** 子运行独立维护压缩状态，不向主 transcript提交 compaction notice。 */
    async function maybeCompact(): Promise<void> {
      throwIfAborted(input.abortSignal);
      const result = await runCompaction({
        records: recordRegion,
        compaction: compactionState,
        anchor: usageAnchor,
        contextWindow: state.contextWindow,
        thresholdRatio: input.configSnapshot.getAppSettings().compactionThresholdRatio,
        force: false,
        agent: state.agent,
        abortSignal: input.abortSignal
      });
      throwIfAborted(input.abortSignal);
      if (!result.didCompact || !result.compaction) {
        return;
      }

      compactionState = result.compaction;
      usageAnchor = null;
      recordRegion.push(createCompactionNoticeRecord(compactionState));
      state.observation.compactionCompleted({scope: state.observationScope, compaction: compactionState});
    }

    function commitProviderRetry(retry: ProviderRetry): void {
      recordRegion.push({role: 'local_notice', text: retry.message});
    }

    function recordProviderUsage(usage: ProviderUsage | undefined, usageInputTokens: number | undefined): void {
      if (!usageStore || !hasRecordableProviderUsage(usage, usageInputTokens)) {
        return;
      }

      try {
        usageStore.appendEvent({
          cwdHash,
          providerType: state.providerType,
          model: state.model,
          contextWindow: state.contextWindow,
          inputTokens: usage?.inputTokens ?? usageInputTokens,
          cacheCreationInputTokens: usage?.cacheCreationInputTokens,
          cacheReadInputTokens: usage?.cacheReadInputTokens,
          outputTokens: usage?.outputTokens
        });
      } catch (error: unknown) {
        state.observation.providerUsageStoreFailed({scope: state.observationScope, error});
      }
    }

    while (true) {
      await maybeCompact();
      throwIfAborted(input.abortSignal);
      const activeStartIndex = compactionState ? compactionState.activeStartIndex : 0;
      const activeRecords = recordRegion.slice(activeStartIndex);
      const memoryPrompt = inheritedContext.memoryPrompt;
      const providerRecords = buildProviderRecords(
        activeRecords,
        cwd,
        compactionState,
        inheritedContext.skillCatalog,
        inheritedContext.agentInstructions,
        state.todoState,
        memoryPrompt.sections,
        inheritedContext.basePrompt,
        undefined,
        definition.prompt
      );
      state.observation.providerRequestBuilt({
        scope: state.observationScope,
        request: {
          activeRecordCount: activeRecords.length,
          activeStartIndex,
          agentInstructionsCount: inheritedContext.agentInstructions.length,
          compaction: compactionState,
          memoryPrompt,
          provider: state.observationProvider,
          providerRecords,
          skillCatalog: inheritedContext.skillCatalog,
          skillCatalogProjection: inheritedContext.skillCatalogProjection,
          skillCatalogTokens: inheritedContext.skillCatalogTokens,
          toolDefinitions: state.toolDefinitions
        }
      });

      const providerTurnCallbacks: AgentTurnCallbacks = {
        onProviderRetry: commitProviderRetry,
        ...(callbacks.onReasoningUpdate ? {
          onReasoningUpdate(update) {
            callbacks.onReasoningUpdate?.(update);
            if (update.kind === 'complete') {
              recordRegion.push({role: 'reasoning_summary', text: update.text});
            }
          }
        } : {}),
        onToken: callbacks.onToken
      };
      const {draft, providerRecords: turnProviderRecords, toolCalls, usage, usageInputTokens} = await state.agent.runTurn(providerRecords, providerTurnCallbacks, {abortSignal: input.abortSignal});
      throwIfAborted(input.abortSignal);

      if (typeof usageInputTokens === 'number') {
        usageAnchor = {usageInputTokens, measuredAtRecordCount: recordRegion.length - activeStartIndex};
      }
      state.observation.providerUsage({scope: state.observationScope, usage, usageInputTokens});
      recordProviderUsage(usage, usageInputTokens);

      if (turnProviderRecords?.length) {
        recordRegion.push(...turnProviderRecords);
      }
      if (toolCalls.length === 0) {
        callbacks.onComplete?.(draft);
        return draft;
      }
      if (draft.trim() !== '') {
        callbacks.onAssistantSegment?.(draft);
        recordRegion.push({role: 'assistant', text: draft});
      }

      for (const toolCall of toolCalls) {
        throwIfAborted(input.abortSignal);
        callbacks.onToolCall?.(toolCall);
        recordRegion.push(createToolCallTranscriptRecord(toolCall));
        state.observation.toolStarted({scope: state.observationScope, call: toolCall});

        const result = await executeSubagentToolCall(toolCall, input, state, callbacks, definition, mcpManager);
        throwIfAborted(input.abortSignal);
        recordRegion.push(createToolResultTranscriptRecord(result));
        callbacks.onToolResult?.(result);
        state.observation.toolCompleted({scope: state.observationScope, result});
      }

      callbacks.onThinking?.();
    }
  };

  return runSubagentLoop;
}

/**
 * 在父 revision 内解析冻结定义的最终模型策略。
 * inherit 传递父覆盖，default 删除覆盖，固定枚举直接替换；显式 profile 始终严格解析。
 */
function resolveSubagentLlmConfig(input: SubagentLoopInput, definition: SubagentDefinition): LlmConfig {
  const modelProfileId = definition.modelProfileId || input.modelProfileId;
  const reasoningEffortOverride = definition.effortPolicy === 'inherit'
    ? input.reasoningEffortOverride
    : definition.effortPolicy === 'default'
      ? undefined
      : definition.effortPolicy;

  if (modelProfileId) {
    return input.configSnapshot.resolveLlmConfigStrict({
      modelProfileId,
      ...(reasoningEffortOverride !== undefined ? {reasoningEffortOverride} : {})
    });
  }
  return input.configSnapshot.resolveLlmConfig({
    ...(reasoningEffortOverride !== undefined ? {reasoningEffortOverride} : {})
  });
}

export {createSubagentLoopRuntime};
