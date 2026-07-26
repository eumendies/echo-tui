import type {CompactionState, TodoState, TranscriptRecord} from './transcript';
import type {AskUserQuestionsRequest, ToolApprovalRequest, ToolCall, ToolExecutionResult} from './tool';
import type {ChangeFileRecorder} from './change-history';

export type InteractionMode = 'normal' | 'plan' | 'shell' | 'shell-local';

export type AgentExecutionMode =
  | {kind: 'interactive'}
  | {kind: 'headless'; approvalPolicy: 'deny' | 'full-access'};

export function isShellInteractionMode(mode: InteractionMode): boolean {
  return mode === 'shell' || mode === 'shell-local';
}

export type ContextUsage = {
  usedTokens: number;
  contextWindow: number;
  source: 'provider';
  segments?: ContextUsageSegment[];
};

export type ProviderUsage = {
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
};

export type ResolvedAgentModel = {
  model: string;
  reasoningEffort?: ReasoningEffort;
};

export type ContextUsageSegmentCategory = 'system' | 'memory' | 'skills' | 'tools' | 'messages' | 'reasoning';

export type ContextUsageSegment = {
  category: ContextUsageSegmentCategory;
  tokens: number;
};

export type ToolApprovalDecision =
  | {kind: 'allow_once'}
  | {kind: 'deny'; message?: string}
  | {kind: 'allow_tool_for_session'; toolName: string}
  | {kind: 'allow_command_for_session'; toolName: 'run_bash_command'; command: string}
  | {kind: 'allow_all_for_session'}
  | {kind: 'provide_feedback'; message: string};

export type AgentCallbacks = {
  changeRecorder?: ChangeFileRecorder;
  onModelResolved?: (model: ResolvedAgentModel) => void;
  onThinking?: () => void;
  onToken?: (token: string, draft: string) => void;
  onReasoningSummary?: (text: string) => void;
  onProviderRecords?: (records: TranscriptRecord[]) => void;
  onAssistantSegment?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolApprovalRequest?: (call: ToolCall, request?: ToolApprovalRequest) => Promise<ToolApprovalDecision> | ToolApprovalDecision;
  onUserQuestionRequest?: (call: ToolCall, request: AskUserQuestionsRequest) => Promise<ToolExecutionResult> | ToolExecutionResult;
  onToolResult?: (result: ToolExecutionResult) => void;
  onTodoStateChange?: (todoState: TodoState) => void;
  onComplete?: (finalText: string) => void;
  onCompacted?: (next: CompactionState) => void;
  onContextUsage?: (usage: ContextUsage) => void;
};

export type AgentSessionInput = {
  records: TranscriptRecord[];
  compaction?: CompactionState;
  todoState?: TodoState;
  abortSignal?: AbortSignal;
  interactionMode?: InteractionMode;
  executionMode?: AgentExecutionMode;
  modelProfileId?: string;
  reasoningEffortOverride?: ReasoningEffort;
  compactionThresholdRatio?: number;
};

export type AgentInstructionSourceKind = 'global' | 'project';

export type AgentInstruction = {
  content: string;
  filePath: string;
  label: string;
  sourceKind: AgentInstructionSourceKind;
};

export type RunAgent = (session: AgentSessionInput, callbacks?: AgentCallbacks) => Promise<unknown>;

export type AgentTurnCallbacks = Pick<AgentCallbacks, 'onToken'>;

export type AgentTurnOptions = {
  abortSignal?: AbortSignal;
  isCompaction?: boolean;
};

export type AgentTurnResult = {
  draft: string;
  providerRecords?: TranscriptRecord[];
  reasoningSummary?: string;
  toolCalls: ToolCall[];
  usage?: ProviderUsage;
  usageInputTokens?: number;
};

export type ProviderAgent = {
  runTurn: (records: TranscriptRecord[], callbacks?: AgentTurnCallbacks, options?: AgentTurnOptions) => Promise<AgentTurnResult>;
};

export class AgentAbortError extends Error {
  constructor(message = '模型回答已中断') {
    super(message);
    this.name = 'AgentAbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof AgentAbortError) {
    return true;
  }

  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as {name?: unknown; code?: unknown};
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AgentAbortError();
  }
}

export type AgentType = 'openai' | 'openai-chat' | 'anthropic' | 'codex' | 'fake';

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export const REASONING_SUMMARIES = ['auto', 'concise', 'detailed'] as const;

export type ReasoningSummary = typeof REASONING_SUMMARIES[number];

export type LlmConfig = {
  agentType: AgentType;
  apiKey: string;
  baseURL?: string;
  codexOAuth?: CodexOAuthRuntimeConfig;
  headers?: Record<string, string>;
  model: string;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummary;
  contextWindow?: number;
  tools: ToolRuntimeConfig;
};

export type ToolRuntimeConfig = {
  bash: BashToolConfig;
};

export type BashToolConfig = {
  timeoutMs: number | null;
  maxOutputBytes: number;
};

export type CodexOAuthRuntimeConfig = {
  authFilePath?: string;
};

export type CodexOAuthCredential = {
  accessToken: string;
  accountId?: string;
  expiresAt?: number;
  refreshToken?: string;
};

export type OpenAiAgentDependencies = {
  createClient?: (config: LlmConfig) => unknown;
  OpenAIClient?: new (options: {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number}) => unknown;
};

export type CodexAgentDependencies = {
  createClient?: (config: LlmConfig) => unknown;
  OpenAIClient?: new (options: {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number}) => unknown;
  resolveCodexOAuthCredential?: (config: CodexOAuthRuntimeConfig) => Promise<CodexOAuthCredential>;
};

export type OpenAiChatAgentDependencies = {
  createClient?: (config: LlmConfig) => unknown;
  OpenAIClient?: new (options: {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number}) => unknown;
};

export type AnthropicAgentDependencies = {
  AnthropicClient?: new (options: {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number}) => unknown;
  createClient?: (config: LlmConfig) => unknown;
};
