import {resolveContextWindow} from '../../config/llm-config';
import {disabledDebugContext, hashValue, redactProviderConfig, summarizeText} from '../../debug/debug-context';
import {emitToolApprovalRequestHook, emitToolApprovalResponseHook} from '../../hooks/lifecycle-events';
import {emitUserQuestionRequestHook, emitUserQuestionResponseHook} from '../../hooks/lifecycle-events';
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
  createProviderUsageDebugPayload,
  executeUserQuestionToolCall,
  hasRecordableProviderUsage,
  isToolResultTruncated
} from './shared';

import type {TokenUsageAnchor} from '../context/context-compaction';
import type {DebugContext} from '../../debug/debug-context';
import type {AgentTurnCallbacks, LlmConfig, ProviderAgent, ProviderRetry, ProviderUsage, ToolApprovalDecision} from '../../types/agent';
import type {LifecycleHookDispatcher} from '../../types/hooks';
import type {ToolCall, ToolDefinition, ToolExecutionResult, ToolExecutor, ToolRegistry} from '../../types/tool';
import type {CompactionState, TodoState, TranscriptRecord} from '../../types/transcript';
import type {UsageStore} from '../../types/usage';
import type {InheritedAgentRunContext, RunSubagentAgent, SubagentLoopCallbacks, SubagentLoopInput} from './types';
import type {SubagentDefinition} from '../subagent/definition';
import type {McpManager} from '../../mcp/manager';

const TOOL_REJECTED_BY_USER_TEXT = 'Tool execution was rejected by the user.';

type SubagentLoopRunState = {
  agent: ProviderAgent; // 已绑定子 Agent裁剪工具目录的 provider adapter。
  contextWindow: number; // 子运行压缩和上下文估算使用的模型窗口。
  debug: DebugContext; // 子运行使用的脱敏调试 sink。
  executor: ToolExecutor; // 只解析子 registry中真实存在 handler的执行器。
  hooks?: LifecycleHookDispatcher; // 子运行自行决定顺序的 lifecycle hook派发器。
  model: string; // 子运行固定的 provider模型名。
  providerConfig: Record<string, unknown>; // 仅用于脱敏调试的 provider配置投影。
  providerType: LlmConfig['agentType']; // usage记录使用的 provider协议类型。
  reasoningEffort?: LlmConfig['reasoningEffort']; // 子运行固定的推理强度。
  registry: ToolRegistry; // 子 provider schema与执行器共用的裁剪目录。
  todoState: TodoState | undefined; // Worker独立维护的待办状态；Explorer始终为空。
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
  const generalPurpose = definition.executionPolicy.kind === 'general_purpose';

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
      onRequest(call, request) {
        emitUserQuestionRequestHook(state.hooks, {
          interactionMode: input.interactionMode,
          toolCall: call,
          request
        });
      },
      onResponse(call, result) {
        emitUserQuestionResponseHook(state.hooks, {
          interactionMode: input.interactionMode,
          toolCall: call,
          result
        });
      },
      onWaiting: callbacks.onWaitingQuestion,
      request: callbacks.onUserQuestionRequest
    });
  }

  const assessment = generalPurpose
    ? classifyToolCallRisk(toolCall, input.interactionMode, (toolName) => getMcpToolApproval(mcpManager, toolName))
    : classifySubagentToolCall(toolCall, input.metadata);

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
      emitToolApprovalRequestHook(state.hooks, {interactionMode: input.interactionMode, toolCall, approval});
      decision = generalPurpose && input.executionMode.approvalPolicy === 'full-access'
        ? {kind: 'allow_once'}
        : {
            kind: 'deny',
            message: generalPurpose
              ? `Tool execution requires approval in headless mode: ${toolCall.toolName}. Re-run with --full-access to allow it.`
              : `Tool execution requires interactive manual approval and is unavailable in headless mode: ${toolCall.toolName}.`
          };
      emitToolApprovalResponseHook(state.hooks, {toolCall, decision});
    } else {
      decision = callbacks.onToolApprovalRequest
        ? await callbacks.onToolApprovalRequest(toolCall, approval)
        : {kind: 'deny'};
    }

    throwIfAborted(input.abortSignal);
    if (!isToolExecutionAllowed(decision.kind)) {
      return createRejectedToolResultFromDecision(toolCall, decision);
    }
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
function createSubagentLoopRuntime(cwd: string, inheritedContext: InheritedAgentRunContext, definition: SubagentDefinition, hooks?: LifecycleHookDispatcher, debug: DebugContext = disabledDebugContext, usageStore?: UsageStore, mcpManager?: McpManager): RunSubagentAgent {
  const cwdHash = createUsageCwdHash(cwd);

  const runSubagentLoop: RunSubagentAgent = async function runSubagentLoop(input, callbacks = {}): Promise<string> {
    throwIfAborted(input.abortSignal);
    let state: SubagentLoopRunState;

    try {
      const {agent, config, registry} = prepareAgent({
        allowedToolNames: definition.localToolNames,
        configSnapshot: input.configSnapshot,
        cwd,
        ...(definition.includeMcpTools && mcpManager ? {mcpManager} : {}),
        modelProfileId: input.modelProfileId,
        reasoningEffortOverride: input.reasoningEffortOverride
      });
      state = {
        agent,
        contextWindow: resolveContextWindow(config),
        debug,
        executor: createToolExecutor(registry),
        hooks,
        model: config.model,
        providerConfig: redactProviderConfig(config),
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
      state.debug.emit('compaction_end', {
        activeStartIndex: compactionState.activeStartIndex,
        createdAt: compactionState.createdAt,
        summary: summarizeText(compactionState.summaryText, 0)
      });
      state.hooks?.emit('compaction_end', {
        activeStartIndex: compactionState.activeStartIndex,
        createdAt: compactionState.createdAt
      });
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
        state.debug.emit('provider_usage_store_error', {
          error: error instanceof Error ? {name: error.name, message: error.message} : {message: String(error)}
        });
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
      state.debug.emit('provider_request_built', {
        activeRecordCount: activeRecords.length,
        activeStartIndex,
        agentInstructionsCount: inheritedContext.agentInstructions.length,
        userMemoryCount: memoryPrompt.userMemoryCount,
        agentMemoryCatalogCount: memoryPrompt.agentMemory.catalogCount,
        agentMemoryItemCount: memoryPrompt.agentMemory.itemCount,
        agentMemoryMode: memoryPrompt.agentMemory.mode,
        agentMemoryTokens: memoryPrompt.agentMemory.estimatedTokens,
        compaction: compactionState ? {
          activeStartIndex: compactionState.activeStartIndex,
          createdAt: compactionState.createdAt,
          summary: summarizeText(compactionState.summaryText, 0)
        } : null,
        providerConfig: state.providerConfig,
        providerInputHash: hashValue(providerRecords),
        recordCount: providerRecords.length,
        recordRoles: providerRecords.map((record) => record.role),
        skillCatalogBudgetTokens: inheritedContext.skillCatalogProjection.budgetTokens,
        skillCatalogCount: inheritedContext.skillCatalog.length,
        skillCatalogMode: inheritedContext.skillCatalogProjection.mode,
        skillCatalogOriginalTokens: inheritedContext.skillCatalogProjection.originalTokens,
        skillCatalogTokens: inheritedContext.skillCatalogTokens,
        systemPromptHash: providerRecords[0]?.role === 'system' ? hashValue(providerRecords[0].text) : null,
        toolNames: state.toolDefinitions.map((definition) => definition.name),
        toolSchemaHash: hashValue(state.toolDefinitions)
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
      state.debug.emit('provider_usage', {
        usage: createProviderUsageDebugPayload(usage, usageInputTokens)
      });
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
        state.debug.emit('tool_call_start', {
          argumentsText: summarizeText(toolCall.argumentsText, 0),
          toolCallId: toolCall.callId,
          toolName: toolCall.toolName
        });
        state.hooks?.emit('tool_call_start', {
          toolCallId: toolCall.callId,
          toolName: toolCall.toolName,
          argumentsText: toolCall.argumentsText
        });

        const result = await executeSubagentToolCall(toolCall, input, state, callbacks, definition, mcpManager);
        throwIfAborted(input.abortSignal);
        recordRegion.push(createToolResultTranscriptRecord(result));
        callbacks.onToolResult?.(result);
        state.debug.emit('tool_call_end', {
          ok: result.ok,
          resultText: summarizeText(result.text, 0),
          toolCallId: result.callId,
          toolName: result.toolName,
          truncated: isToolResultTruncated(result)
        });
        state.hooks?.emit('tool_call_end', {
          toolCallId: result.callId,
          toolName: result.toolName,
          ok: result.ok
        });
      }

      callbacks.onThinking?.();
    }
  };

  return runSubagentLoop;
}

export {createSubagentLoopRuntime};
