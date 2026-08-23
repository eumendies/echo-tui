import type {MemoryPromptResolution} from '../agent/context/memory-prompt';
import type {SkillCatalogPromptProjection} from '../skills/skill-catalog-prompt';
import type {
  AgentConversationKind,
  AgentType,
  InteractionMode,
  ProviderUsage,
  ReasoningEffort,
  ReasoningSummary,
  SubagentRunMetadata,
  ToolApprovalDecision
} from '../types/agent';
import type {TerminalSize} from '../types/render';
import type {SkillCatalogEntry} from '../types/skill';
import type {AskUserQuestionsRequest, ToolApprovalRequest, ToolCall, ToolDefinition, ToolExecutionResult, ToolRiskAssessment} from '../types/tool';
import type {CompactionState, TranscriptRecord} from '../types/transcript';
import type {SubagentCatalogDiagnostic} from '../agent/subagent/catalog';

type AppScope = {
  cwd: string; // TUI 启动时的项目工作目录。
  nodeVersion: string; // 当前 Node.js runtime 版本。
  pid: number; // 当前进程标识。
};

type AssistantTurnScope = {
  interactionMode: InteractionMode; // 回合启动时固定的交互模式。
  runtimeKind: 'tui' | 'headless'; // 回合是否属于交互式 TUI。
};

type AgentRunScope = {
  conversationKind: AgentConversationKind; // 当前运行是主对话、BTW 对话还是子 Agent。
  interactionMode: InteractionMode; // 父提交时固定的交互模式。
  subagent?: SubagentRunMetadata; // 子运行的稳定身份；主运行不设置。
};

type ProviderObservationConfig = {
  agentType: AgentType; // 当前请求使用的 provider 协议类型。
  baseURL?: string; // 当前请求使用的非凭据 provider 地址。
  contextWindow?: number; // 配置声明的模型上下文窗口。
  model: string; // 当前请求使用的模型名。
  reasoningEffort?: ReasoningEffort; // 当前请求使用的推理强度。
  reasoningSummary?: ReasoningSummary; // 当前请求使用的推理摘要策略。
};

type ProviderRequestObservationInput = {
  activeRecordCount: number; // 本轮 compaction 边界后的活跃记录数量。
  activeStartIndex: number; // provider 活跃区间在运行记录中的起点。
  agentInstructionsCount: number; // 当前 system context 使用的指令文件数量。
  compaction?: CompactionState; // 当前有效压缩状态，未压缩时缺省。
  memoryPrompt: MemoryPromptResolution; // 本轮已解析的用户与 Agent memory 投影。
  provider: ProviderObservationConfig; // 显式挑选的非敏感 provider 事实，禁止携带密钥或请求头。
  providerRecords: readonly TranscriptRecord[]; // 真正交给 provider 的记录，只供只读诊断投影。
  skillCatalog: readonly SkillCatalogEntry[]; // 本轮预算裁剪后的 skill 目录。
  skillCatalogProjection: Pick<SkillCatalogPromptProjection, 'budgetTokens' | 'mode' | 'originalTokens'>; // skill 预算诊断事实。
  skillCatalogTokens: number; // skill 目录投影的估算 token 数。
  toolDefinitions: readonly ToolDefinition[]; // 真正交给 provider 的工具定义，只供只读诊断投影。
};

type ToolApprovalObservation = {
  decision?: ToolApprovalDecision; // 实际审批决策；无需审批或缺失时为空。
  emitLifecycleEvent: boolean; // 是否发布审批 response hook。
  required: boolean; // 当前风险分类是否要求审批。
};

type ToolApprovalReviewObservation = {
  actionCharacters: number; // reviewer 动作投影字符数。
  actionProjection: 'exact' | 'summarized' | 'manual_only'; // 动作投影采用的安全有界策略。
  call: Readonly<ToolCall>; // 被 reviewer 判断的原始调用，仅供按需 hash。
  errorName?: string; // reviewer 失败时的错误类型，不含错误正文。
  fallbackReason?: string; // manual-only 投影的回退原因。
  hasClarifications: boolean; // prompt 是否包含可信澄清回答。
  hasPriorExchange: boolean; // prompt 是否包含当前回合之前的有界上下文。
  latencyMs: number; // reviewer 端到端耗时。
  model?: string; // 实际 reviewer 模型，配置失败时可能缺省。
  promptCharacters: number; // reviewer prompt 的字符数。
  result: 'yes' | 'no' | 'timeout' | 'error' | 'manual_only'; // reviewer 的有界结果。
};

type Observation = {
  appStarted: (input: {scope: AppScope; terminalSize: TerminalSize}) => void; // 发布 TUI watcher 初始化后的启动事实。
  appExiting: (input: {cwd: string; interactionMode: InteractionMode}) => void; // 发布终端清理前的退出事实。
  close: () => void; // 关闭 observation 拥有的旁路资源。
  configurationWatchFailed: (input: {error: unknown}) => void; // 发布用户配置 watcher 失败事实。
  resizeRecovered: (input: {recordCount: number; terminalSize: TerminalSize}) => void; // 发布 destructive resize 恢复事实。
  transcriptBatchRendered: (input: {records: readonly TranscriptRecord[]}) => void; // 发布主 transcript 批量渲染事实。
  userSubmitted: (input: {attachmentCount: number; displayText?: string; interactionMode: InteractionMode; recordCount: number; text: string}) => void; // 发布 composer 已路由到 assistant turn 的提交事实。

  assistantTurnStarted: (input: {scope: AssistantTurnScope; userText: string; recordCount: number}) => void; // 发布 user record 已提交后的回合启动事实。
  assistantTurnCompleted: (input: {scope: AssistantTurnScope; finalText: string}) => void; // 发布回合正常完成事实。
  assistantTurnCancelled: (input: {scope: AssistantTurnScope}) => void; // 发布回合取消事实。
  assistantTurnFailed: (input: {scope: AssistantTurnScope; error: unknown}) => void; // 发布回合失败事实。
  manualApprovalRequested: (input: {scope: AssistantTurnScope; call: Readonly<ToolCall>; request?: Readonly<ToolApprovalRequest>}) => void; // 发布人工审批 surface 已打开事实。
  manualApprovalCompleted: (input: {scope: AssistantTurnScope; call: Readonly<ToolCall>; decision: ToolApprovalDecision; request?: Readonly<ToolApprovalRequest>}) => void; // 发布人工审批结果事实。
  toolApprovalReviewed: (input: ToolApprovalReviewObservation) => void; // 发布自动审批 reviewer 的有界判断事实。
  toolApprovalUsageStoreFailed: (input: {call: Readonly<ToolCall>; error: unknown; model: string}) => void; // 发布 reviewer usage 持久化失败事实。

  compactionCompleted: (input: {scope: AgentRunScope; compaction: Readonly<CompactionState>}) => void; // 发布压缩完成事实。
  providerRequestBuilt: (input: {scope: AgentRunScope; request: ProviderRequestObservationInput}) => void; // 发布 provider 请求已构造事实。
  providerUsage: (input: {scope: AgentRunScope; usage?: ProviderUsage; usageInputTokens?: number}) => void; // 发布 provider usage 事实。
  providerUsageStoreFailed: (input: {scope: AgentRunScope; error: unknown}) => void; // 发布 provider usage 持久化失败事实。
  subagentCatalogLoaded: (diagnostics: readonly Readonly<SubagentCatalogDiagnostic>[]) => void; // 发布主运行加载目录时形成的完整有界诊断快照。
  toolApprovalRequested: (input: {scope: AgentRunScope; call: Readonly<ToolCall>; approval?: Readonly<ToolApprovalRequest>}) => void; // 发布 runtime 拥有的审批请求事实。
  toolApprovalResolved: (input: {scope: AgentRunScope; call: Readonly<ToolCall>; approval: ToolApprovalObservation}) => void; // 发布 runtime 审批结果事实。
  toolCompleted: (input: {scope: AgentRunScope; result: Readonly<ToolExecutionResult>}) => void; // 发布工具结果已提交事实。
  toolRiskAssessed: (input: {scope: AgentRunScope; call: Readonly<ToolCall>; assessment: Readonly<ToolRiskAssessment>}) => void; // 发布工具风险分类事实。
  toolStarted: (input: {scope: AgentRunScope; call: Readonly<ToolCall>}) => void; // 发布工具开始处理事实。
  userQuestionCompleted: (input: {scope: AgentRunScope; call: Readonly<ToolCall>; result: Readonly<ToolExecutionResult>}) => void; // 发布用户问题结束事实。
  userQuestionRequested: (input: {scope: AgentRunScope; call: Readonly<ToolCall>; request: Readonly<AskUserQuestionsRequest>}) => void; // 发布用户问题请求事实。
};

const disabledObservation: Observation = {
  appStarted() {}, appExiting() {}, close() {}, configurationWatchFailed() {}, resizeRecovered() {},
  transcriptBatchRendered() {}, userSubmitted() {}, assistantTurnStarted() {}, assistantTurnCompleted() {},
  assistantTurnCancelled() {}, assistantTurnFailed() {}, manualApprovalRequested() {}, manualApprovalCompleted() {},
  toolApprovalReviewed() {}, toolApprovalUsageStoreFailed() {}, compactionCompleted() {}, providerRequestBuilt() {},
  providerUsage() {}, providerUsageStoreFailed() {}, subagentCatalogLoaded() {}, toolApprovalRequested() {}, toolApprovalResolved() {},
  toolCompleted() {}, toolRiskAssessed() {}, toolStarted() {}, userQuestionCompleted() {}, userQuestionRequested() {}
};

/** 组合多个完整 observation；每个消费者逐事件隔离，任何同步异常都不进入产品控制流。 */
function createCompositeObservation(observations: Observation[]): Observation {
  if (observations.length === 0) return disabledObservation;
  const reverse = [...observations].reverse();
  return {
    appStarted: (input) => notify(observations, (observation) => observation.appStarted(input)),
    appExiting: (input) => notify(observations, (observation) => observation.appExiting(input)),
    close: () => notify(observations, (observation) => observation.close()),
    configurationWatchFailed: (input) => notify(observations, (observation) => observation.configurationWatchFailed(input)),
    resizeRecovered: (input) => notify(observations, (observation) => observation.resizeRecovered(input)),
    transcriptBatchRendered: (input) => notify(observations, (observation) => observation.transcriptBatchRendered(input)),
    userSubmitted: (input) => notify(observations, (observation) => observation.userSubmitted(input)),
    assistantTurnStarted: (input) => notify(observations, (observation) => observation.assistantTurnStarted(input)),
    assistantTurnCompleted: (input) => notify(reverse, (observation) => observation.assistantTurnCompleted(input)),
    assistantTurnCancelled: (input) => notify(reverse, (observation) => observation.assistantTurnCancelled(input)),
    assistantTurnFailed: (input) => notify(reverse, (observation) => observation.assistantTurnFailed(input)),
    manualApprovalRequested: (input) => notify(observations, (observation) => observation.manualApprovalRequested(input)),
    manualApprovalCompleted: (input) => notify(observations, (observation) => observation.manualApprovalCompleted(input)),
    toolApprovalReviewed: (input) => notify(observations, (observation) => observation.toolApprovalReviewed(input)),
    toolApprovalUsageStoreFailed: (input) => notify(observations, (observation) => observation.toolApprovalUsageStoreFailed(input)),
    compactionCompleted: (input) => notify(observations, (observation) => observation.compactionCompleted(input)),
    providerRequestBuilt: (input) => notify(observations, (observation) => observation.providerRequestBuilt(input)),
    providerUsage: (input) => notify(observations, (observation) => observation.providerUsage(input)),
    providerUsageStoreFailed: (input) => notify(observations, (observation) => observation.providerUsageStoreFailed(input)),
    subagentCatalogLoaded: (diagnostics) => notify(observations, (observation) => observation.subagentCatalogLoaded(diagnostics)),
    toolApprovalRequested: (input) => notify(observations, (observation) => observation.toolApprovalRequested(input)),
    toolApprovalResolved: (input) => notify(reverse, (observation) => observation.toolApprovalResolved(input)),
    toolCompleted: (input) => notify(observations, (observation) => observation.toolCompleted(input)),
    toolRiskAssessed: (input) => notify(observations, (observation) => observation.toolRiskAssessed(input)),
    toolStarted: (input) => notify(observations, (observation) => observation.toolStarted(input)),
    userQuestionCompleted: (input) => notify(observations, (observation) => observation.userQuestionCompleted(input)),
    userQuestionRequested: (input) => notify(observations, (observation) => observation.userQuestionRequested(input))
  };
}

function notify(observations: Observation[], operation: (observation: Observation) => void): void {
  for (const observation of observations) {
    try {
      operation(observation);
    } catch {
      // observation 不拥有 app、turn 或 Agent run 的控制权。
    }
  }
}

export {createCompositeObservation, disabledObservation};
export type {
  AgentRunScope,
  AppScope,
  AssistantTurnScope,
  Observation,
  ProviderObservationConfig,
  ProviderRequestObservationInput,
  ToolApprovalObservation,
  ToolApprovalReviewObservation
};
