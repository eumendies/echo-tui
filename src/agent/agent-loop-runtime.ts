import crypto from 'node:crypto';

import {readLlmConfig, resolveContextWindow} from '../config/llm-config';
import {
  ASK_USER_QUESTIONS_TOOL_NAME,
  createAskUserQuestionsFailureResult,
  parseAskUserQuestionsToolCall
} from '../tools/ask-user-questions-tool-handler';
import {classifyToolCallRisk} from '../tools/tool-risk-classifier';
import {createToolExecutor} from '../tools/tool-executor';
import {createDefaultToolRegistry} from '../tools/tool-registry';
import {executeTodoToolCall, isTodoToolName} from '../tools/todo-tool-handler';
import {createMcpToolRegistry, mergeToolRegistries} from '../mcp/tool-adapter';
import {getMcpToolApproval} from '../mcp/manager';
import {formatSkillCatalogPrompt} from '../skills/skill-catalog-prompt';
import {throwIfAborted} from '../types/agent';
import {normalizeError} from './agent-errors';
import {loadAgentInstructions} from './agent-instructions';
import {calibrateContextUsageSegments, estimateContextUsageSegments} from './context/context-usage-breakdown';
import {estimateTextTokens} from './context/token-estimator';
import {createBuiltInSystemPrompt} from './system-prompt';
import {createConfiguredAgent} from './agent-setup';
import {runCompaction} from './context/context-compaction';
import {disabledDebugContext, hashValue, redactProviderConfig, summarizeText} from '../debug/debug-context';

import type {TokenUsageAnchor} from './context/context-compaction';

import type {AgentCallbacks, AgentInstruction, AgentSessionInput, InteractionMode, LlmConfig, ProviderAgent, ProviderUsage, RunAgent, ToolApprovalDecision} from '../types/agent';
import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {UsageStore} from '../types/usage';
import type {SkillCatalogEntry} from '../types/skill';
import type {
  ApplyPatchToolExecutionResult,
  BashToolExecutionResult,
  GlobToolExecutionResult,
  GrepToolExecutionResult,
  ReadFilesToolExecutionResult,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutor,
  ToolRegistry,
  WebFetchToolExecutionResult,
  WebSearchToolExecutionResult
} from '../types/tool';
import type {CompactionState, TodoState, TranscriptRecord} from '../types/transcript';
import type {McpManager} from '../mcp/manager';

const TOOL_REJECTED_BY_USER_TEXT = 'Tool execution was rejected by the user.';
const RUNTIME_CONTEXT_NOTICE = 'Not a user request. Use silently; continue the current turn.';
const PLAN_MODE_USER_PROMPT = 'Plan: discuss/inspect only; no file changes, mutating commands, tests/builds, dependency installs, branch/state changes, or MCP tools. Ask user to run /mode normal before implementing.';

/**
 * 创建 continuation 用的 tool_call record；可见文本由 app 层按工具类型格式化。
 */
function createToolCallRecord(call: ToolCall): TranscriptRecord {
  return {
    role: 'tool_call',
    text: '',
    toolCallId: call.callId,
    toolName: call.toolName,
    argumentsText: call.argumentsText
  };
}

/**
 * 创建 continuation 用的 tool_result record，保留执行状态供下一轮 provider input 回注。
 */
function createToolResultRecord(result: ToolExecutionResult): TranscriptRecord {
  const baseRecord = {
    role: 'tool_result' as const,
    text: result.text,
    toolCallId: result.callId,
    toolName: result.toolName,
    ok: result.ok,
    ...(result.attachments ? {attachments: result.attachments} : {})
  };

  switch (result.toolName) {
    case 'run_bash_command': {
      const bashResult = result as BashToolExecutionResult;

      return {
        ...baseRecord,
        exitCode: bashResult.exitCode,
        timedOut: bashResult.timedOut,
        truncated: bashResult.truncated,
        durationMs: bashResult.durationMs
      };
    }
    case 'glob': {
      const globResult = result as GlobToolExecutionResult;

      return {
        ...baseRecord,
        exitCode: globResult.exitCode,
        truncated: globResult.truncated
      };
    }
    case 'grep': {
      const grepResult = result as GrepToolExecutionResult;

      return {
        ...baseRecord,
        exitCode: grepResult.exitCode,
        truncated: grepResult.truncated
      };
    }
    case 'read_files': {
      const readFilesResult = result as ReadFilesToolExecutionResult;

      return {
        ...baseRecord,
        truncated: readFilesResult.truncated
      };
    }
    case 'web_fetch': {
      const webFetchResult = result as WebFetchToolExecutionResult;

      return {
        ...baseRecord,
        timedOut: webFetchResult.timedOut,
        truncated: webFetchResult.truncated
      };
    }
    case 'web_search': {
      const webSearchResult = result as WebSearchToolExecutionResult;

      return {
        ...baseRecord,
        timedOut: webSearchResult.timedOut,
        truncated: webSearchResult.truncated
      };
    }
    case 'apply_patch': {
      const applyPatchResult = result as ApplyPatchToolExecutionResult;

      return {
        ...baseRecord,
        ...(applyPatchResult.display ? {display: applyPatchResult.display} : {})
      };
    }
  }

  return baseRecord;
}

/**
 * 用户拒绝工具授权时，生成 provider 可消费的 tool result，保证 continuation 不缺结果。
 */
function createRejectedToolResult(call: ToolCall, message?: string): ToolExecutionResult {
  const normalizedMessage = typeof message === 'string' && message.trim() !== '' ? message.trim() : TOOL_REJECTED_BY_USER_TEXT;

  return {
    callId: call.callId,
    toolName: call.toolName,
    ok: false,
    text: normalizedMessage
  };
}

function createRejectedToolResultFromDecision(call: ToolCall, decision: ToolApprovalDecision): ToolExecutionResult {
  if (decision.kind === 'provide_feedback') {
    return createRejectedToolResult(call, `Tool execution was rejected by the user.\n\nUser instruction:\n${decision.message}`);
  }

  return createRejectedToolResult(call, decision.kind === 'deny' ? decision.message : undefined);
}

/**
 * 根据结构化授权决策判断是否允许执行，保留后续 session 级授权扩展空间。
 */
function isToolExecutionAllowed(kind: string): boolean {
  return kind === 'allow_once' || kind === 'allow_tool_for_session' || kind === 'allow_command_for_session' || kind === 'allow_all_for_session';
}

/**
 * 执行单个 tool call；交互式工具在这里短路到 app callback，避免普通 executor 持有 UI 状态。
 */
async function executeToolCall(toolCall: ToolCall, state: AgentLoopRunState, callbacks: AgentCallbacks): Promise<ToolExecutionResult> {
  throwIfAborted(state.abortSignal);

  if (isTodoToolName(toolCall.toolName)) {
    const todoResult = executeTodoToolCall(toolCall, state.todoState);

    if (todoResult.ok) {
      state.todoState = todoResult.todoState;
      callbacks.onTodoStateChange?.(todoResult.todoState);
    }

    return todoResult.result;
  }

  if (toolCall.toolName === ASK_USER_QUESTIONS_TOOL_NAME) {
    const parsed = parseAskUserQuestionsToolCall(toolCall);

    if (!parsed.ok) {
      return createAskUserQuestionsFailureResult(toolCall, parsed.message);
    }

    const result = await Promise.resolve(callbacks.onUserQuestionRequest!(toolCall, parsed.value));
    throwIfAborted(state.abortSignal);
    return result;
  }

  const riskAssessment = classifyToolCallRisk(toolCall, state.interactionMode, (toolName) => getMcpToolApproval(state.mcpManager, toolName));
  state.debug.emit('tool_call_risk', {
    interactionMode: state.interactionMode,
    reason: riskAssessment.risk === 'rejected' ? riskAssessment.reason : undefined,
    risk: riskAssessment.risk,
    toolCallId: toolCall.callId,
    toolName: toolCall.toolName
  });

  if (riskAssessment.risk === 'rejected') {
    return createRejectedToolResult(toolCall, riskAssessment.message);
  }

  const approval = riskAssessment.risk === 'approval_required' ? riskAssessment.approval : undefined;
  const approvalDecision = riskAssessment.risk === 'approval_required'
    ? await Promise.resolve(callbacks.onToolApprovalRequest?.(toolCall, approval))
    : undefined;
  state.debug.emit('tool_call_approval', {
    decision: approvalDecision?.kind || (riskAssessment.risk === 'approval_required' ? 'missing' : 'not_required'),
    interactionMode: state.interactionMode,
    toolCallId: toolCall.callId,
    toolName: toolCall.toolName
  });
  throwIfAborted(state.abortSignal);

  if (approvalDecision && !isToolExecutionAllowed(approvalDecision.kind)) {
    return createRejectedToolResultFromDecision(toolCall, approvalDecision);
  }

  const result = await state.executor.execute(toolCall, {abortSignal: state.abortSignal, changeRecorder: callbacks.changeRecorder});
  throwIfAborted(state.abortSignal);
  return result;
}

/**
 * 构造 provider 请求上下文：稳定前缀 + 活跃区间记录 + 运行时 suffix。
 * system prompt、摘要和运行时状态只存在于 provider 上下文，不写回 app transcript。
 */
function buildProviderRecords(activeRecords: TranscriptRecord[], cwd: string, compaction?: CompactionState, skillCatalog: SkillCatalogEntry[] = [], interactionMode: InteractionMode = 'normal', agentInstructions: AgentInstruction[] = [], todoState?: TodoState): TranscriptRecord[] {
  const prefix: TranscriptRecord[] = [
    {
      role: 'system',
      text: createBuiltInSystemPrompt({agentInstructions, cwd, skillCatalog})
    }
  ];

  if (compaction && compaction.summaryText.trim() !== '') {
    prefix.push({
      role: 'user',
      text: `Here is a structured summary of the earlier conversation:\n${compaction.summaryText}`
    });
  }

  const suffix = createRuntimeContextSuffixRecords(todoState, interactionMode);

  return [...prefix, ...activeRecords.filter((record) => record.role !== 'reasoning_summary'), ...suffix];
}

function createRuntimeContextSuffixRecords(todoState: TodoState | undefined, interactionMode: InteractionMode): TranscriptRecord[] {
  const sections: string[][] = [];
  const todoLines = createTodoRuntimeContextLines(todoState);

  if (interactionMode === 'plan') {
    sections.push(['## Mode', PLAN_MODE_USER_PROMPT]);
  }

  if (todoLines.length > 0) {
    sections.push(todoLines);
  }

  if (sections.length === 0) {
    return [];
  }

  return [{
    role: 'user',
    text: [
      '# Echo Runtime Context',
      '',
      RUNTIME_CONTEXT_NOTICE,
      '',
      ...sections.flatMap((section, index) => index === 0 ? section : ['', ...section])
    ].join('\n')
  }];
}

function createTodoRuntimeContextLines(todoState: TodoState | undefined): string[] {
  const openTodos = (todoState?.items || []).filter((item) => item.status === 'open');

  if (openTodos.length === 0) {
    return [];
  }

  const lines = ['## Todos'];
  lines.push('Open:', ...openTodos.map((item) => `- [${item.id}] ${item.text}`));

  return lines;
}

type AgentLoopRunState = {
  agent: ProviderAgent;
  agentInstructions: AgentInstruction[];
  providerConfig: Record<string, unknown>;
  providerType: LlmConfig['agentType'];
  model: string;
  interactionMode: InteractionMode;
  executor: ToolExecutor;
  contextWindow: number;
  skillCatalog: SkillCatalogEntry[];
  skillCatalogTokens: number;
  todoState: TodoState | undefined;
  toolDefinitions: ToolDefinition[];
  mcpManager?: McpManager;
  abortSignal?: AbortSignal;
  hooks?: LifecycleHookDispatcher;
  debug: DebugContext;
};

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

function createUsageCwdHash(cwd: string): string {
  return crypto.createHash('sha1').update(String(cwd)).digest('hex');
}

function hasRecordableProviderUsage(usage: ProviderUsage | undefined, usageInputTokens: number | undefined): boolean {
  return (
    typeof usageInputTokens === 'number' ||
    typeof usage?.inputTokens === 'number' ||
    typeof usage?.cacheCreationInputTokens === 'number' ||
    typeof usage?.cacheReadInputTokens === 'number' ||
    typeof usage?.outputTokens === 'number'
  );
}

function isToolResultTruncated(result: ToolExecutionResult): boolean | undefined {
  return typeof (result as {truncated?: unknown}).truncated === 'boolean' ? (result as {truncated: boolean}).truncated : undefined;
}

/**
 * 创建 provider-neutral agent loop runtime；该层拥有配置/工具加载和 tool-call continuation 状态机。
 */
function createAgentLoopRuntime(cwd: string, mcpManager?: McpManager, hooks?: LifecycleHookDispatcher, debug: DebugContext = disabledDebugContext, usageStore?: UsageStore): RunAgent {
  const cwdHash = createUsageCwdHash(cwd);

  function createRegistry(config: LlmConfig): ToolRegistry {
    const baseRegistry = createDefaultToolRegistry(config, cwd);

    return mcpManager ? mergeToolRegistries(baseRegistry, createMcpToolRegistry(mcpManager)) : baseRegistry;
  }

  /**
   * 初始化单次 agent 调用需要的 provider、工具运行时和上下文窗口；三者来自同一份配置。
   * agent 的配置装配（loadConfig + initialize）下沉到 prepareAgent，拉模式下每轮重读配置。
   */
  function initializeRunState(interactionMode: InteractionMode, abortSignal?: AbortSignal): AgentLoopRunState {
    const config = readLlmConfig();
    const registry = createRegistry(config);
    const agent = createConfiguredAgent(config);

    agent.initialize(config, registry);

    const skillCatalog = registry.listSkillCatalog?.() || [];

    return {
      agent,
      agentInstructions: loadAgentInstructions({cwd}),
      providerConfig: redactProviderConfig(config),
      providerType: config.agentType,
      model: config.model,
      interactionMode,
      executor: createToolExecutor(registry),
      contextWindow: resolveContextWindow(config),
      skillCatalog,
      skillCatalogTokens: estimateTextTokens(formatSkillCatalogPrompt(skillCatalog)),
      todoState: undefined,
      toolDefinitions: registry.listDefinitions(),
      mcpManager,
      abortSignal,
      hooks,
      debug
    };
  }

  return async function runAgentLoop(session: AgentSessionInput, callbacks: AgentCallbacks = {}): Promise<string> {
    const abortSignal = session.abortSignal;
    const interactionMode = session.interactionMode || 'normal';

    throwIfAborted(abortSignal);
    callbacks.onThinking?.();
    throwIfAborted(abortSignal);

    let state: AgentLoopRunState;

    try {
      state = initializeRunState(interactionMode, abortSignal);
    } catch (error: unknown) {
      throw normalizeError(error, '无法加载 LLM 配置');
    }

    // recordRegion 与 app records[] 平行：append-only，activeStartIndex 指向其上的活跃区间起点。
    const recordRegion: TranscriptRecord[] = [...session.records];
    let compactionState: CompactionState | undefined = session.compaction;
    let usageAnchor: TokenUsageAnchor | null = null;
    state.todoState = session.todoState;

    /**
     * 发请求前检查：调用共享压缩核心，压缩发生时回填运行态并通知 app。
     */
    async function maybeCompact(): Promise<void> {
      throwIfAborted(abortSignal);
      const result = await runCompaction({
        records: recordRegion,
        compaction: compactionState,
        anchor: usageAnchor,
        contextWindow: state.contextWindow,
        force: false,
        agent: state.agent,
        abortSignal
      });
      throwIfAborted(abortSignal);

      if (!result.didCompact || !result.compaction) {
        return;
      }

      compactionState = result.compaction;
      // 压缩后活跃区间已变，旧 usage 锚点失效，回退到纯字符估算直到下一次真值到达。
      usageAnchor = null;
      callbacks.onCompacted?.(compactionState);
      state.debug.emit('compaction_end', {
        activeStartIndex: compactionState.activeStartIndex,
        createdAt: compactionState.createdAt,
        interactionMode,
        summary: summarizeText(compactionState.summaryText, 0)
      });
      state.hooks?.emit('compaction_end', {
        interactionMode,
        activeStartIndex: compactionState.activeStartIndex,
        createdAt: compactionState.createdAt
      });
    }

    function commitReasoningSummary(summary?: string): void {
      if (!summary) {
        return;
      }

      callbacks.onReasoningSummary?.(summary);
      recordRegion.push({role: 'reasoning_summary', text: summary});
    }

    function commitProviderRecords(records?: TranscriptRecord[]): void {
      if (!records || records.length === 0) {
        return;
      }

      callbacks.onProviderRecords?.(records);
      recordRegion.push(...records);
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
          interactionMode,
          contextWindow: state.contextWindow,
          inputTokens: usage?.inputTokens ?? usageInputTokens,
          cacheCreationInputTokens: usage?.cacheCreationInputTokens,
          cacheReadInputTokens: usage?.cacheReadInputTokens,
          outputTokens: usage?.outputTokens
        });
      } catch (error: unknown) {
        state.debug.emit('provider_usage_store_error', {
          interactionMode,
          error: error instanceof Error ? {name: error.name, message: error.message} : {message: String(error)}
        });
      }
    }

    while (true) {
      await maybeCompact();
      throwIfAborted(abortSignal);

      const activeStartIndex = compactionState ? compactionState.activeStartIndex : 0;
      const activeRecords = recordRegion.slice(activeStartIndex);
      const providerRecords = buildProviderRecords(activeRecords, cwd, compactionState, state.skillCatalog, interactionMode, state.agentInstructions, state.todoState);
      state.debug.emit('provider_request_built', {
        activeRecordCount: activeRecords.length,
        activeStartIndex,
        agentInstructionsCount: state.agentInstructions.length,
        compaction: compactionState ? {
          activeStartIndex: compactionState.activeStartIndex,
          createdAt: compactionState.createdAt,
          summary: summarizeText(compactionState.summaryText, 0)
        } : null,
        interactionMode,
        providerConfig: state.providerConfig,
        providerInputHash: hashValue(providerRecords),
        recordCount: providerRecords.length,
        recordRoles: providerRecords.map((record) => record.role),
        systemPromptHash: providerRecords[0]?.role === 'system' ? hashValue(providerRecords[0].text) : null,
        toolNames: state.toolDefinitions.map((definition) => definition.name),
        toolSchemaHash: hashValue(state.toolDefinitions)
      });
      throwIfAborted(abortSignal);
      const {draft, providerRecords: turnProviderRecords, reasoningSummary, toolCalls, usage, usageInputTokens} = await state.agent.runTurn(providerRecords, callbacks, {abortSignal});
      throwIfAborted(abortSignal);

      if (typeof usageInputTokens === 'number') {
        const estimatedUsageSegments = estimateContextUsageSegments(providerRecords, state.toolDefinitions, state.skillCatalogTokens);

        // 以本次真实 prompt token 为锚点，记下当时活跃记录数，供下一轮叠加字符增量。
        usageAnchor = {usageInputTokens, measuredAtRecordCount: recordRegion.length - activeStartIndex};
        callbacks.onContextUsage?.({
          usedTokens: usageInputTokens,
          contextWindow: state.contextWindow,
          source: 'provider',
          segments: calibrateContextUsageSegments(estimatedUsageSegments, usageInputTokens)
        });
      }
      state.debug.emit('provider_usage', {
        interactionMode,
        usage: createProviderUsageDebugPayload(usage, usageInputTokens)
      });
      recordProviderUsage(usage, usageInputTokens);

      if (toolCalls.length === 0) {
        // 没有 tool call 表示模型已经给出本轮最终 assistant 回复。
        commitProviderRecords(turnProviderRecords);
        commitReasoningSummary(reasoningSummary);

        throwIfAborted(abortSignal);
        callbacks.onComplete?.(draft);
        return draft;
      }

      commitProviderRecords(turnProviderRecords);

      commitReasoningSummary(reasoningSummary);

      if (draft.trim() !== '') {
        // tool call 前的文本是已完成 assistant segment，需要先交给 app 落盘但不释放响应锁。
        callbacks.onAssistantSegment?.(draft);
        recordRegion.push({role: 'assistant', text: draft});
      }

      for (const toolCall of toolCalls) {
        throwIfAborted(abortSignal);
        callbacks.onToolCall?.(toolCall);
        recordRegion.push(createToolCallRecord(toolCall));
        state.debug.emit('tool_call_start', {
          argumentsText: summarizeText(toolCall.argumentsText, 0),
          interactionMode,
          toolCallId: toolCall.callId,
          toolName: toolCall.toolName
        });
        state.hooks?.emit('tool_call_start', {
          interactionMode,
          toolCallId: toolCall.callId,
          toolName: toolCall.toolName,
          argumentsText: toolCall.argumentsText
        });

        const result = await executeToolCall(toolCall, state, callbacks);
        throwIfAborted(abortSignal);
        callbacks.onToolResult?.(result);
        recordRegion.push(createToolResultRecord(result));
        state.debug.emit('tool_call_end', {
          interactionMode,
          ok: result.ok,
          resultText: summarizeText(result.text, 0),
          toolCallId: result.callId,
          toolName: result.toolName,
          truncated: isToolResultTruncated(result)
        });
        state.hooks?.emit('tool_call_end', {
          interactionMode,
          toolCallId: result.callId,
          toolName: result.toolName,
          ok: result.ok
        });
      }

      throwIfAborted(abortSignal);
    }
  };
}

export {PLAN_MODE_USER_PROMPT, buildProviderRecords, createAgentLoopRuntime};
