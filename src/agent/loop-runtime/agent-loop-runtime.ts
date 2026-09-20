import {resolveContextWindow} from '../../config/llm-config';
import {DEFAULT_APP_SETTINGS} from '../../config/app-settings-config';
import {
  ASK_USER_QUESTIONS_TOOL_NAME
} from '../../tools/ask-user-questions-tool-handler';
import {classifyReadonlyToolCall, classifyToolCallRisk} from '../../tools/tool-risk-classifier';
import {createToolExecutor} from '../../tools/tool-executor';
import {classifyToolCallConcurrency} from '../../tools/tool-concurrency-classifier';
import {RUN_SUBAGENT_TOOL_NAME} from '../../tools/run-subagent-tool-handler';
import {createToolCallTranscriptRecord, createToolResultTranscriptRecord} from '../../tools/tool-transcript-record';
import {executeTodoToolCall, isTodoToolName} from '../../tools/todo-tool-handler';
import {createSkillCatalogPromptProjection} from '../../skills/skill-catalog-prompt';
import {createSkillManager} from '../../skills/skill-manager';
import {captureSkillSnapshot} from '../../skills/skill-snapshot';
import {throwIfAborted} from '../../types/agent';
import {normalizeError} from '../agent-errors';
import {loadAgentInstructions} from '../agent-instructions';
import {calibrateContextUsageSegments, estimateContextUsageSegments} from '../context/context-usage-breakdown';
import {resolveMemoryPrompt} from '../context/memory-prompt';
import {loadSystemPromptOverride} from '../context/system-prompt';
import {prepareAgent} from '../agent-setup';
import {createCompactionNoticeRecord, runCompaction} from '../context/context-compaction';
import {createUsageCwdHash} from '../../persistence/usage-store';
import {createSandboxRuntimeNote, isReadonlyBashSandboxEffective} from '../../sandbox/provider';
import {createSubagentToolPort} from '../subagent/runtime';
import {createSubagentLoopRuntime} from './subagent-loop-runtime';
import type {SandboxModeOverride} from '../../sandbox/types';
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
import type {SkillSnapshot} from '../../skills/skill-snapshot';
import type {ToolApprovalRequest, ToolCall, ToolDefinition, ToolExecutionResult, ToolExecutor, ToolRegistry, ToolRiskAssessment} from '../../types/tool';
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
async function executeToolCall(toolCall: ToolCall, state: AgentLoopRunState, callbacks: AgentCallbacks, subagentGroupSize?: number): Promise<ToolExecutionResult> {
  throwIfAborted(state.abortSignal);

  // 只读运行由 readonly classifier 一次性判定:rejected 立即短路,safe 直接沿用到执行链路,
  // 不再回落普通风险分类——否则 allowlist 内的只读命令会被启发式写风险规则二次误判为需要审批。
  // 只读运行里的 MCP 工具沿用同一判定:命中 run 启动时固定的只读集合才放行,不进入审批。
  const readonlyAssessment = state.toolPolicy === 'readonly'
    ? classifyReadonlyToolCall(toolCall, state.readonlySubagentNames, state.readonlyBashSandboxed, state.readonlyMcpToolNames)
    : null;

  if (readonlyAssessment !== null && readonlyAssessment.risk === 'rejected') {
    state.observation.toolRiskAssessed({scope: state.observationScope, call: toolCall, assessment: readonlyAssessment});
    return createRejectedToolResult(toolCall, readonlyAssessment.message);
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

  // 默认运行在这里执行普通风险分类;只读运行复用 readonly 判定结果,不进入审批分支。
  // plan 运行的 bash 分层事实由 runtime 初始化时一次性解析,分类器不自行读取配置。
  const riskAssessment: ToolRiskAssessment = readonlyAssessment
    ?? classifyToolCallRisk(toolCall, state.interactionMode, state.readonlyMcpToolNames, state.planBashSandboxed);
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

  const result = await state.executor.execute(toolCall, {
    abortSignal: state.abortSignal,
    changeRecorder: callbacks.changeRecorder,
    ...(subagentGroupSize === undefined ? {} : {subagentGroupSize})
  });
  throwIfAborted(state.abortSignal);
  return result;
}

/** 统计并行只读段内的 run_subagent 调用数量；达到两个才作为并行分组事实下行到委派端口。 */
function countRunSubagentGroupSize(toolCalls: ToolCall[]): number | undefined {
  const count = toolCalls.filter((toolCall) => toolCall.toolName === RUN_SUBAGENT_TOOL_NAME).length;
  return count >= 2 ? count : undefined;
}

/**
 * 同时执行整个连续只读段；结果槽位保持 provider 原始顺序，实际完成顺序不影响提交。
 */
async function executeConcurrentReadonlyCalls(toolCalls: ToolCall[], state: AgentLoopRunState, callbacks: AgentCallbacks): Promise<ToolExecutionResult[]> {
  throwIfAborted(state.abortSignal);
  const subagentGroupSize = countRunSubagentGroupSize(toolCalls);
  const settled = await Promise.allSettled(toolCalls.map(async (toolCall) => {
    state.observation.toolStarted({scope: state.observationScope, call: toolCall});
    const result = await executeToolCall(toolCall, state, callbacks, subagentGroupSize);
    state.observation.toolCompleted({scope: state.observationScope, result});
    return result;
  }));

  throwIfAborted(state.abortSignal);
  const rejected = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
  if (rejected) {
    throw rejected.reason;
  }

  return settled.map((entry) => (entry as PromiseFulfilledResult<ToolExecutionResult>).value);
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
  providerId?: string; // 当前解析配置的非敏感 provider 标识；写 usage 时保留归因。
  model: string; // 当前运行固定的 provider 模型名。
  reasoningEffort?: LlmConfig['reasoningEffort']; // 当前运行固定的推理强度。
  interactionMode: InteractionMode; // 父提交时捕获的 normal/plan 等模式。
  executor: ToolExecutor; // 与 provider definitions 共用 registry 的统一执行器。
  contextWindow: number; // 自动压缩和 skill 预算使用的模型窗口。
  compactionThresholdRatio: number; // 自动压缩触发占比。
  skillCatalog: SkillCatalogEntry[]; // 本次 system context 可见的有界 skill目录。
  skillCatalogTokens: number; // 当前 skill目录投影的估算 token数。
  skillCatalogProjection: Pick<SkillCatalogPromptProjection, 'budgetTokens' | 'mode' | 'originalTokens'>; // 调试使用的 skill预算事实。
  skillSnapshot: SkillSnapshot; // run 启动时捕获的不可变 enabled Skill 快照；primary 与全部子运行同源。
  basePrompt?: string; // 用户 system prompt override，缺省使用内置主 prompt。
  todoState: TodoState | undefined; // 主运行的 open todo 状态。
  toolDefinitions: ToolDefinition[]; // 真正发送给当前 provider 的工具 schema。
  mcpManager?: McpManager; // 主运行可用的共享 MCP manager；子运行缺省。
  abortSignal?: AbortSignal; // 贯穿 provider、审批和工具执行的父级取消信号。
  sessionId?: string; // 本次运行的会话稳定身份；provider 用它生成会话级缓存键。
  executionMode: AgentExecutionMode; // interactive 或 headless 审批边界。
  observation: Observation; // 单一旁路观察边界。
  observationProvider: ProviderObservationConfig; // 从完整配置显式挑选的非敏感 provider 诊断事实。
  observationScope: AgentRunScope; // 当前运行复用的语义 scope。
  toolPolicy: AgentToolPolicy; // default 或 readonly 执行策略。
  registry: ToolRegistry; // provider schema 查询和 commit mode 查询的权威目录。
  readonlySubagentNames?: ReadonlySet<string>; // run 启动时固定的 readonly 执行策略 agent 名称集合；无委派端口时缺省。
  readonlyMcpToolNames?: ReadonlySet<string>; // run 启动时固定的 MCP 只读工具名称集合；普通审批与只读运行准入共用，无 MCP manager 时缺省。
  readonlyBashSandboxed: boolean; // 只读运行且 bash 沙箱实际生效;true 时 bash 豁免文本白名单与审批,效果由内核边界保证。
  planBashSandboxed: boolean; // plan 运行(default 工具策略)且生效沙箱为可用 read-only 档;true 时 plan bash 由内核边界兜底。
  sandboxNote: string | null; // bash 沙箱生效时的 transient 边界说明;null 表示本次运行未包装沙箱。
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
  function initializeRunState(interactionMode: InteractionMode, abortSignal: AbortSignal | undefined, executionMode: AgentExecutionMode, compactionThresholdRatio: number, skillCatalogContextRatio: number, agentInstructionFileName: AgentInstructionFileName, toolPolicy: AgentToolPolicy, sandboxModeOverride: SandboxModeOverride | undefined, conversationKind: AgentConversationKind, configSnapshot: AgentUserConfigSnapshot, modelProfileId?: string, reasoningEffortOverride?: LlmConfig['reasoningEffort'], subagentPort?: SubagentToolPort, sessionId?: string): AgentLoopRunState {
    // 只读 subagent 名称集合在 run 启动时固定；并发分类不得在运行中重新读取目录。
    const readonlySubagentNames = subagentPort
      ? new Set(subagentPort.listDefinitions()
          .filter((descriptor) => descriptor.executionPolicy === 'readonly_investigation')
          .map((descriptor) => descriptor.name))
      : undefined;
    // MCP 只读工具名称集合同样在 run 启动时固定,与本次 registry 同源;普通审批与只读运行准入共用同一份事实。
    const readonlyMcpToolNames = mcpManager ? mcpManager.listReadonlyToolNames() : undefined;
    // 单次 assistant run 只在启动时物化 Skill 快照；primary catalog、use_skill 与全部子 scope 共用同源。
    const skillSnapshot = captureSkillSnapshot(createSkillManager({cwd}));
    const {agent, config, registry} = prepareAgent({
      configSnapshot,
      cwd,
      executionMode,
      mcpManager,
      modelProfileId,
      reasoningEffortOverride,
      skillRegistry: skillSnapshot,
      ...(sandboxModeOverride ? {sandboxModeOverride} : {}),
      ...(subagentPort ? {subagentPort} : {}),
      ...(sessionId ? {sessionId} : {})
    });
    const contextWindow = resolveContextWindow(config);
    const skillCatalogProjection = createSkillCatalogPromptProjection(registry.listSkillCatalog?.() || [], contextWindow, skillCatalogContextRatio);
    const basePrompt = loadSystemPromptOverride({cwd})?.content;
    // 执行链路、transient 注记与只读 bash 边界共用同一份沙箱解析输入。
    const sandboxResolutionOptions = sandboxModeOverride ? {modeOverride: sandboxModeOverride} : {};
    const bashSandboxEffective = isReadonlyBashSandboxEffective(config.tools.sandbox, executionMode, sandboxResolutionOptions);

    return {
      agent,
      agentInstructions: loadAgentInstructions({cwd, fileName: agentInstructionFileName}),
      basePrompt,
      providerType: config.agentType,
      ...(config.providerId ? {providerId: config.providerId} : {}),
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      interactionMode,
      executor: createToolExecutor(registry),
      registry,
      ...(readonlySubagentNames ? {readonlySubagentNames} : {}),
      ...(readonlyMcpToolNames ? {readonlyMcpToolNames} : {}),
      contextWindow,
      compactionThresholdRatio,
      skillCatalog: skillCatalogProjection.catalog,
      skillCatalogTokens: skillCatalogProjection.estimatedTokens,
      skillCatalogProjection: {
        budgetTokens: skillCatalogProjection.budgetTokens,
        mode: skillCatalogProjection.mode,
        originalTokens: skillCatalogProjection.originalTokens
      },
      skillSnapshot,
      todoState: undefined,
      toolDefinitions: registry.listDefinitions(),
      mcpManager,
      abortSignal,
      ...(sessionId ? {sessionId} : {}),
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
      readonlyBashSandboxed: toolPolicy === 'readonly' && bashSandboxEffective,
      // 收紧派生只发生在 default 工具策略的 plan 运行,因此该分层事实也只在同样的组合下成立。
      planBashSandboxed: toolPolicy === 'default' && interactionMode === 'plan' && bashSandboxEffective,
      sandboxNote: createSandboxRuntimeNote(config.tools.sandbox, executionMode, sandboxResolutionOptions),
    };
  }

  const runAgentLoop: RunAgent = async function runAgentLoop(session: AgentSessionInput, callbacks: AgentCallbacks = {}): Promise<string> {
    const abortSignal = session.abortSignal;
    const interactionMode = session.interactionMode || 'normal';
    const executionMode = session.executionMode || INTERACTIVE_EXECUTION_MODE;
    const toolPolicy = session.toolPolicy || 'default';
    // plan 运行默认派生运行级 read-only 收紧:plan 的 bash 分层需要该收紧作为主边界,
    // 否则沙箱生效后会放行工作区写入。显式声明优先,off 与 headless full-access 豁免仍由 resolver 统一收敛。
    const sandboxModeOverride = session.sandboxModeOverride
      ?? (interactionMode === 'plan' && toolPolicy === 'default' ? 'read-only' : undefined);
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

    // 只有主运行创建委派端口；端口在 provider schema 装配前自行固定目录快照。
    const subagentPort: SubagentToolPort | undefined = conversationKind === 'primary'
      ? createSubagentToolPort({
          callbacks,
          configSnapshot,
          createRuntime: (inheritedContext, definition) => createSubagentLoopRuntime(cwd, inheritedContext, definition, observation, usageStore, mcpManager),
          cwd,
          executionMode,
          interactionMode,
          getInheritedContext: () => ({
            agentInstructions: state.agentInstructions,
            basePrompt: state.basePrompt,
            memoryPrompt: currentMemoryPrompt || resolveMemoryPrompt(cwd, state.contextWindow),
            skillCatalogContextRatio,
            skillSnapshot: state.skillSnapshot
          }),
          modelProfileId: session.modelProfileId,
          observation,
          publishRecords: publishSubagentRecords,
          reasoningEffortOverride: session.reasoningEffortOverride,
          ...(sandboxModeOverride ? {sandboxModeOverride} : {}),
          toolPolicy,
          sessionId: session.sessionId
        })
      : undefined;

    try {
      state = initializeRunState(interactionMode, abortSignal, executionMode, compactionThresholdRatio, skillCatalogContextRatio, appSettings.agentInstructionFileName, toolPolicy, sandboxModeOverride, conversationKind, configSnapshot, session.modelProfileId, session.reasoningEffortOverride, subagentPort, session.sessionId);
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
          ...(state.providerId ? {providerId: state.providerId} : {}),
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
      const providerRecords = buildProviderRecords({
        activeRecords,
        agentInstructions: state.agentInstructions,
        basePrompt: state.basePrompt,
        compaction: compactionState,
        cwd,
        memoryPrompts: memoryPrompt.sections,
        sandboxNote: state.sandboxNote ?? undefined,
        sessionJournalPath: session.sessionJournalPath,
        skillCatalog: state.skillCatalog,
        todoState: state.todoState
      });
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
      const {draft, providerRecords: turnProviderRecords, toolCalls, usage, usageInputTokens} = await state.agent.runTurn(providerRecords, providerTurnCallbacks, {
        abortSignal,
        ...(state.sessionId ? {sessionId: state.sessionId} : {})
      });
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

      for (let toolIndex = 0; toolIndex < toolCalls.length;) {
        throwIfAborted(abortSignal);
        const toolCall = toolCalls[toolIndex];

        if (classifyToolCallConcurrency(toolCall, state.readonlySubagentNames) === 'parallel_read') {
          const readonlyCalls: ToolCall[] = [];
          while (toolIndex < toolCalls.length && classifyToolCallConcurrency(toolCalls[toolIndex], state.readonlySubagentNames) === 'parallel_read') {
            readonlyCalls.push(toolCalls[toolIndex]);
            toolIndex += 1;
          }

          for (const readonlyCall of readonlyCalls) {
            callbacks.onToolCall?.(readonlyCall);
          }
          const results = await executeConcurrentReadonlyCalls(readonlyCalls, state, callbacks);
          throwIfAborted(abortSignal);

          for (let resultIndex = 0; resultIndex < readonlyCalls.length; resultIndex += 1) {
            const readonlyCall = readonlyCalls[resultIndex];
            const result = results[resultIndex];
            recordRegion.push(createToolCallTranscriptRecord(readonlyCall), createToolResultTranscriptRecord(result));
            callbacks.onToolResult?.(result);
          }
          continue;
        }

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
        toolIndex += 1;
      }

      throwIfAborted(abortSignal);
    }
  };

  return runAgentLoop;
}

export {buildProviderRecords, createAgentLoopRuntime};
