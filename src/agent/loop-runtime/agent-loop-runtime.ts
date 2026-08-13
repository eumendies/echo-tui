import {resolveContextWindow} from '../../config/llm-config';
import {DEFAULT_APP_SETTINGS} from '../../config/app-settings-config';
import {
  ASK_USER_QUESTIONS_TOOL_NAME
} from '../../tools/ask-user-questions-tool-handler';
import {classifyReadonlyToolCall, classifyToolCallRisk} from '../../tools/tool-risk-classifier';
import {createToolExecutor} from '../../tools/tool-executor';
import {createToolCallTranscriptRecord, createToolResultTranscriptRecord} from '../../tools/tool-transcript-record';
import {executeTodoToolCall, isTodoToolName} from '../../tools/todo-tool-handler';
import {getMcpToolApproval} from '../../mcp/manager';
import {createSkillCatalogPromptProjection} from '../../skills/skill-catalog-prompt';
import {throwIfAborted} from '../../types/agent';
import {normalizeError} from '../agent-errors';
import {loadAgentInstructions} from '../agent-instructions';
import {calibrateContextUsageSegments, estimateContextUsageSegments} from '../context/context-usage-breakdown';
import {resolveMemoryPrompt} from '../context/memory-prompt';
import {loadSystemPromptOverride} from '../context/system-prompt';
import {prepareAgent} from '../agent-setup';
import {createCompactionNoticeRecord, runCompaction} from '../context/context-compaction';
import {createUsageCwdHash} from '../../persistence/usage-store';
import {createSubagentToolPort} from '../subagent/runtime';
import {createSubagentLoopRuntime} from './subagent-loop-runtime';
import {
  buildProviderRecords,
  executeUserQuestionToolCall,
  hasRecordableProviderUsage
} from './shared';
import {disabledObservation} from '../../observation/observation';

import type {TokenUsageAnchor} from '../context/context-compaction';
import type {MemoryPromptResolution} from '../context/memory-prompt';
import type {AgentCallbacks, AgentConversationKind, AgentExecutionMode, AgentInstruction, AgentInstructionFileName, AgentSessionInput, AgentToolPolicy, AgentTurnCallbacks, AgentUserConfigSnapshot, InteractionMode, LlmConfig, ProviderAgent, ProviderRetry, ProviderUsage, RunAgent, SubagentToolPort, ToolApprovalDecision} from '../../types/agent';
import type {UsageStore} from '../../types/usage';
import type {SkillCatalogEntry} from '../../types/skill';
import type {SkillCatalogPromptProjection} from '../../skills/skill-catalog-prompt';
import type {ToolApprovalRequest, ToolCall, ToolDefinition, ToolExecutionResult, ToolExecutor, ToolRegistry} from '../../types/tool';
import type {CompactionState, SubagentTranscriptRecord, TodoState, TranscriptRecord} from '../../types/transcript';
import type {McpManager} from '../../mcp/manager';
import type {AgentRunScope, Observation, ProviderObservationConfig} from '../../observation/observation';

const TOOL_REJECTED_BY_USER_TEXT = 'Tool execution was rejected by the user.';
const INTERACTIVE_EXECUTION_MODE: AgentExecutionMode = {kind: 'interactive'};

/**
 * 用户拒绝工具授权时，生成 provider 可消费的 tool result，保证 continuation 不缺结果。
 */
function createRejectedToolResult(call: ToolCall, message?: string): ToolExecutionResult {
  const normalizedMessage = typeof message === 'string' && message.trim() !== '' ? message.trim() : TOOL_REJECTED_BY_USER_TEXT;

  return {
    callId: call.callId,
    toolName: call.toolName,
    ok: false,
    details: {kind: 'generic'},
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

type ToolApprovalResolution = {
  decision: ToolApprovalDecision;
  emitLifecycleEvents: boolean;
};

/**
 * 执行单个 tool call；交互式工具在这里短路到 app callback，避免普通 executor 持有 UI 状态。
 */
async function executeToolCall(toolCall: ToolCall, state: AgentLoopRunState, callbacks: AgentCallbacks): Promise<ToolExecutionResult> {
  throwIfAborted(state.abortSignal);

  if (state.toolPolicy === 'readonly') {
    const readonlyAssessment = classifyReadonlyToolCall(toolCall);
    if (readonlyAssessment.risk === 'rejected') {
      state.observation.toolRiskAssessed({scope: state.observationScope, call: toolCall, assessment: readonlyAssessment});
      return createRejectedToolResult(toolCall, readonlyAssessment.message);
    }
  }

  if (isTodoToolName(toolCall.toolName)) {
    const todoResult = executeTodoToolCall(toolCall, state.todoState);

    if (todoResult.ok) {
      state.todoState = todoResult.todoState;
      callbacks.onTodoStateChange?.(todoResult.todoState);
    }

    return todoResult.result;
  }

  if (toolCall.toolName === ASK_USER_QUESTIONS_TOOL_NAME) {
    return executeUserQuestionToolCall(toolCall, {
      abortSignal: state.abortSignal,
      executionMode: state.executionMode,
      onRequest: (call, request) => state.observation.userQuestionRequested({scope: state.observationScope, call, request}),
      onResponse: (call, result) => state.observation.userQuestionCompleted({scope: state.observationScope, call, result}),
      request: callbacks.onUserQuestionRequest
    });
  }

  const riskAssessment = classifyToolCallRisk(toolCall, state.interactionMode, (toolName) => getMcpToolApproval(state.mcpManager, toolName));
  state.observation.toolRiskAssessed({scope: state.observationScope, call: toolCall, assessment: riskAssessment});

  if (riskAssessment.risk === 'rejected') {
    return createRejectedToolResult(toolCall, riskAssessment.message);
  }

  const approval = riskAssessment.risk === 'approval_required' ? riskAssessment.approval : undefined;
  const approvalResolution = riskAssessment.risk === 'approval_required'
    ? await resolveToolApprovalDecision(toolCall, approval, state, callbacks)
    : undefined;
  const approvalDecision = approvalResolution?.decision;
  state.observation.toolApprovalResolved({
    scope: state.observationScope,
    call: toolCall,
    approval: {
      decision: approvalDecision,
      emitLifecycleEvent: approvalResolution?.emitLifecycleEvents === true,
      required: riskAssessment.risk === 'approval_required'
    }
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
 * 根据 execution mode 决定是否等待 UI；headless 策略永远不会触碰交互 callback。
 */
async function resolveToolApprovalDecision(toolCall: ToolCall, approval: ToolApprovalRequest | undefined, state: AgentLoopRunState, callbacks: AgentCallbacks): Promise<ToolApprovalResolution> {
  if (state.executionMode.kind === 'headless') {
    state.observation.toolApprovalRequested({scope: state.observationScope, call: toolCall, approval});

    if (state.executionMode.approvalPolicy === 'full-access') {
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

type AgentLoopRunState = {
  agent: ProviderAgent; // 已绑定本次工具目录的 provider adapter。
  agentInstructions: AgentInstruction[]; // 当前 cwd 适用的项目/用户指令链。
  providerType: LlmConfig['agentType']; // 当前 adapter 的 provider 协议类型。
  model: string; // 当前运行固定的 provider 模型名。
  reasoningEffort?: LlmConfig['reasoningEffort']; // 当前运行固定的推理强度。
  interactionMode: InteractionMode; // 父提交时捕获的 normal/plan 等模式。
  executor: ToolExecutor; // 与 provider definitions 共用 registry 的统一执行器。
  contextWindow: number; // 自动压缩和 skill 预算使用的模型窗口。
  compactionThresholdRatio: number; // 自动压缩触发占比。
  skillCatalog: SkillCatalogEntry[]; // 本次 system context 可见的有界 skill目录。
  skillCatalogTokens: number; // 当前 skill目录投影的估算 token数。
  skillCatalogProjection: Pick<SkillCatalogPromptProjection, 'budgetTokens' | 'mode' | 'originalTokens'>; // 调试使用的 skill预算事实。
  basePrompt?: string; // 用户 system prompt override，缺省使用内置主 prompt。
  todoState: TodoState | undefined; // 主运行的 open todo 状态。
  toolDefinitions: ToolDefinition[]; // 真正发送给当前 provider 的工具 schema。
  mcpManager?: McpManager; // 主运行可用的共享 MCP manager；子运行缺省。
  abortSignal?: AbortSignal; // 贯穿 provider、审批和工具执行的父级取消信号。
  executionMode: AgentExecutionMode; // interactive 或 headless 审批边界。
  observation: Observation; // 单一旁路观察边界。
  observationProvider: ProviderObservationConfig; // 从完整配置显式挑选的非敏感 provider 诊断事实。
  observationScope: AgentRunScope; // 当前运行复用的语义 scope。
  toolPolicy: AgentToolPolicy; // default 或 readonly 执行策略。
  registry: ToolRegistry; // provider schema 查询和 commit mode 查询的权威目录。
};

/**
 * 创建 provider-neutral agent loop runtime；该层拥有配置/工具加载和 tool-call continuation 状态机。
 */
function createAgentLoopRuntime(cwd: string, configContext: {capture(): AgentUserConfigSnapshot}, mcpManager?: McpManager, observation: Observation = disabledObservation, usageStore?: UsageStore): RunAgent {
  const cwdHash = createUsageCwdHash(cwd);
  if (!configContext) {
    throw new Error('Agent runtime 必须注入用户配置 Context');
  }

  /**
   * 初始化单次调用的 loop 状态；provider、配置和 registry 由统一装配入口提供。
   */
  function initializeRunState(interactionMode: InteractionMode, abortSignal: AbortSignal | undefined, executionMode: AgentExecutionMode, compactionThresholdRatio: number, skillCatalogContextRatio: number, agentInstructionFileName: AgentInstructionFileName, toolPolicy: AgentToolPolicy, conversationKind: AgentConversationKind, configSnapshot: AgentUserConfigSnapshot, modelProfileId?: string, reasoningEffortOverride?: LlmConfig['reasoningEffort'], subagentPort?: SubagentToolPort): AgentLoopRunState {
    const {agent, config, registry} = prepareAgent({
      configSnapshot,
      cwd,
      mcpManager,
      modelProfileId,
      reasoningEffortOverride,
      ...(subagentPort ? {subagentPort} : {})
    });
    const contextWindow = resolveContextWindow(config);
    const skillCatalogProjection = createSkillCatalogPromptProjection(registry.listSkillCatalog?.() || [], contextWindow, skillCatalogContextRatio);
    const basePrompt = loadSystemPromptOverride({cwd})?.content;

    return {
      agent,
      agentInstructions: loadAgentInstructions({cwd, fileName: agentInstructionFileName}),
      basePrompt,
      providerType: config.agentType,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      interactionMode,
      executor: createToolExecutor(registry),
      registry,
      contextWindow,
      compactionThresholdRatio,
      skillCatalog: skillCatalogProjection.catalog,
      skillCatalogTokens: skillCatalogProjection.estimatedTokens,
      skillCatalogProjection: {
        budgetTokens: skillCatalogProjection.budgetTokens,
        mode: skillCatalogProjection.mode,
        originalTokens: skillCatalogProjection.originalTokens
      },
      todoState: undefined,
      toolDefinitions: registry.listDefinitions(),
      mcpManager,
      abortSignal,
      executionMode,
      observation,
      observationProvider: {
        agentType: config.agentType,
        ...(config.baseURL ? {baseURL: config.baseURL} : {}),
        ...(typeof config.contextWindow === 'number' ? {contextWindow: config.contextWindow} : {}),
        model: config.model,
        ...(config.reasoningEffort ? {reasoningEffort: config.reasoningEffort} : {}),
        ...(config.reasoningSummary ? {reasoningSummary: config.reasoningSummary} : {})
      },
      observationScope: {conversationKind, interactionMode},
      toolPolicy,
    };
  }

  const runAgentLoop: RunAgent = async function runAgentLoop(session: AgentSessionInput, callbacks: AgentCallbacks = {}): Promise<string> {
    const abortSignal = session.abortSignal;
    const interactionMode = session.interactionMode || 'normal';
    const executionMode = session.executionMode || INTERACTIVE_EXECUTION_MODE;
    const toolPolicy = session.toolPolicy || 'default';
    const conversationKind = session.conversationKind || 'primary';
    const configSnapshot = session.userConfigSnapshot || configContext.capture();
    const appSettings = configSnapshot.getAppSettings() || DEFAULT_APP_SETTINGS;
    // 单次 assistant run 固定使用启动时设置，运行中配置变化只影响后续 turn。
    const compactionThresholdRatio = session.compactionThresholdRatio ?? appSettings.compactionThresholdRatio;
    const skillCatalogContextRatio = session.skillCatalogContextRatio ?? appSettings.skillCatalogContextRatio;

    throwIfAborted(abortSignal);
    // 运行态记录区先于 registry 创建，供 run_subagent Port 在外层 tool pair 提交前发布过程事件。
    const recordRegion: TranscriptRecord[] = [...session.records];
    let compactionState: CompactionState | undefined = session.compaction;
    let usageAnchor: TokenUsageAnchor | null = null;
    let currentMemoryPrompt: MemoryPromptResolution | undefined;
    let state: AgentLoopRunState;

    function publishSubagentRecords(records: SubagentTranscriptRecord[]): void {
      if (records.length === 0) {
        return;
      }
      recordRegion.push(...records);
      callbacks.onSubagentRecords?.(records);
    }

    const subagentPort: SubagentToolPort | undefined = conversationKind === 'primary'
      ? createSubagentToolPort({
          callbacks,
          configSnapshot,
          createRuntime: (inheritedContext, definition) => createSubagentLoopRuntime(cwd, inheritedContext, definition, observation, usageStore, mcpManager),
          executionMode,
          interactionMode,
          getInheritedContext: () => ({
            agentInstructions: state.agentInstructions,
            basePrompt: state.basePrompt,
            memoryPrompt: currentMemoryPrompt || resolveMemoryPrompt(cwd, state.contextWindow),
            skillCatalog: state.skillCatalog,
            skillCatalogProjection: state.skillCatalogProjection,
            skillCatalogTokens: state.skillCatalogTokens
          }),
          modelProfileId: session.modelProfileId,
          publishRecords: publishSubagentRecords,
          reasoningEffortOverride: session.reasoningEffortOverride
        })
      : undefined;

    try {
      state = initializeRunState(interactionMode, abortSignal, executionMode, compactionThresholdRatio, skillCatalogContextRatio, appSettings.agentInstructionFileName, toolPolicy, conversationKind, configSnapshot, session.modelProfileId, session.reasoningEffortOverride, subagentPort);
    } catch (error: unknown) {
      throw normalizeError(error, '无法加载 LLM 配置');
    }

    callbacks.onModelResolved?.({
      model: state.model,
      ...(state.reasoningEffort ? {reasoningEffort: state.reasoningEffort} : {})
    });
    callbacks.onThinking?.();
    throwIfAborted(abortSignal);

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
        thresholdRatio: state.compactionThresholdRatio,
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
      // app 会持久化同一 notice；runtime 同步追加以保持后续压缩索引与 session records 对齐。
      recordRegion.push(createCompactionNoticeRecord(compactionState));
      callbacks.onCompacted?.(compactionState);
      state.observation.compactionCompleted({scope: state.observationScope, compaction: compactionState});
    }

    function commitProviderRecords(records?: TranscriptRecord[]): void {
      if (!records || records.length === 0) {
        return;
      }

      callbacks.onProviderRecords?.(records);
      recordRegion.push(...records);
    }

    function commitProviderRetry(retry: ProviderRetry): void {
      recordRegion.push({role: 'local_notice', text: retry.message});
      callbacks.onProviderRetry?.(retry);
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
        state.observation.providerUsageStoreFailed({scope: state.observationScope, error});
      }
    }

    /**
     * ----------------------------
     *            主循环
     * ----------------------------
     */
    while (true) {
      await maybeCompact();
      throwIfAborted(abortSignal);

      const activeStartIndex = compactionState ? compactionState.activeStartIndex : 0;
      const activeRecords = recordRegion.slice(activeStartIndex);
      const memoryPrompt = resolveMemoryPrompt(cwd, state.contextWindow);
      currentMemoryPrompt = memoryPrompt;
      const providerRecords = buildProviderRecords(activeRecords, cwd, compactionState, state.skillCatalog, state.agentInstructions, state.todoState, memoryPrompt.sections, state.basePrompt, session.sessionJournalPath);
      state.observation.providerRequestBuilt({
        scope: state.observationScope,
        request: {
          activeRecordCount: activeRecords.length,
          activeStartIndex,
          agentInstructionsCount: state.agentInstructions.length,
          compaction: compactionState,
          memoryPrompt,
          provider: state.observationProvider,
          providerRecords,
          skillCatalog: state.skillCatalog,
          skillCatalogProjection: state.skillCatalogProjection,
          skillCatalogTokens: state.skillCatalogTokens,
          toolDefinitions: state.toolDefinitions
        }
      });
      throwIfAborted(abortSignal);
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
      const {draft, providerRecords: turnProviderRecords, toolCalls, usage, usageInputTokens} = await state.agent.runTurn(providerRecords, providerTurnCallbacks, {abortSignal});
      throwIfAborted(abortSignal);

      if (typeof usageInputTokens === 'number') {
        const estimatedUsageSegments = estimateContextUsageSegments(providerRecords, state.toolDefinitions, state.skillCatalogTokens, memoryPrompt.estimatedTokens);

        // 以本次真实 prompt token 为锚点，记下当时活跃记录数，供下一轮叠加字符增量。
        usageAnchor = {usageInputTokens, measuredAtRecordCount: recordRegion.length - activeStartIndex};
        callbacks.onContextUsage?.({
          usedTokens: usageInputTokens,
          contextWindow: state.contextWindow,
          source: 'provider',
          segments: calibrateContextUsageSegments(estimatedUsageSegments, usageInputTokens)
        });
      }
      state.observation.providerUsage({scope: state.observationScope, usage, usageInputTokens});
      recordProviderUsage(usage, usageInputTokens);

      if (toolCalls.length === 0) {
        // 没有 tool call 表示模型已经给出本轮最终 assistant 回复。
        commitProviderRecords(turnProviderRecords);

        throwIfAborted(abortSignal);
        callbacks.onComplete?.(draft);
        return draft;
      }

      commitProviderRecords(turnProviderRecords);

      if (draft.trim() !== '') {
        // tool call 前的文本是已完成 assistant segment，需要先交给 app 落盘但不释放响应锁。
        callbacks.onAssistantSegment?.(draft);
        recordRegion.push({role: 'assistant', text: draft});
      }

      for (const toolCall of toolCalls) {
        throwIfAborted(abortSignal);
        callbacks.onToolCall?.(toolCall);
        const callRecord = createToolCallTranscriptRecord(toolCall);
        const commitMode = state.registry.getHandler(toolCall.toolName)?.transcriptCommitMode || 'call_before_execute';
        if (commitMode === 'call_before_execute') {
          recordRegion.push(callRecord);
        }
        state.observation.toolStarted({scope: state.observationScope, call: toolCall});

        const result = await executeToolCall(toolCall, state, callbacks);
        throwIfAborted(abortSignal);
        const resultRecord = createToolResultTranscriptRecord(result);
        if (commitMode === 'pair_after_execute') {
          recordRegion.push(callRecord, resultRecord);
        } else {
          recordRegion.push(resultRecord);
        }
        callbacks.onToolResult?.(result);
        state.observation.toolCompleted({scope: state.observationScope, result});
      }

      throwIfAborted(abortSignal);
    }
  };

  return runAgentLoop;
}

export {buildProviderRecords, createAgentLoopRuntime};
