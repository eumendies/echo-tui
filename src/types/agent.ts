import type {CompactionState, SubagentTranscriptRecord, TodoState, TranscriptRecord} from './transcript';
import type {AskUserQuestionsRequest, ToolApprovalRequest, ToolCall, ToolExecutionOptions, ToolExecutionResult} from './tool';
import type {ChangeFileRecorder} from './change-history';

export type InteractionMode = 'normal' | 'plan' | 'shell' | 'shell-local';

export type AgentExecutionMode =
  | {kind: 'interactive'}
  | {kind: 'headless'; approvalPolicy: 'deny' | 'full-access'};

export type AgentToolPolicy = 'default' | 'readonly';
export type AgentConversationKind = 'primary' | 'btw' | 'subagent';

export type SubagentRunMetadata = {
  agentName: string; // 当前内置或自定义子 Agent 名称，用于 prompt、审批和可见投影。
  depth: number; // 当前嵌套深度；主 run 为 0，第一版子 Agent 为 1。
  parentToolCallId: string; // 触发本次运行的外层 run_subagent call id。
  runId: string; // 当前子 Agent 运行的进程内稳定身份。
};

export type SubagentActivityPhase = 'thinking' | 'reasoning' | 'streaming' | 'tool' | 'waiting_approval' | 'waiting_question';

export type SubagentActivity = {
  agentName: string; // 当前活动的子 Agent 名称。
  argumentsText?: string; // tool 阶段的原始参数，供现有 pending renderer 投影。
  draft?: string; // reasoning 或 assistant 的完整 transient 草稿。
  phase: SubagentActivityPhase; // 当前可见活动阶段。
  runId: string; // 用于 app 隔离迟到活动更新。
  task: string; // 当前委派任务，供 footer 和恢复边界识别。
  toolName?: string; // tool 阶段的 provider-neutral 工具名。
};

export type SubagentRunResult =
  | {
      ok: true; // 表示子 Agent 已生成可返回父 Agent 的最终报告。
      text: string; // 成功时返回父 Agent 的最终调查报告。
    }
  | {
      ok: false; // 表示子运行非取消失败或预算/参数边界拒绝。
      text: string; // 进入外层 tool result 的失败交接；runtime 启动前拒绝保持简洁诊断。
    };

export type SubagentDescriptor = {
  description: string; // 主 Agent工具目录中展示的子 Agent能力说明。
  name: string; // `run_subagent` 参数使用的稳定子 Agent名称。
};

export type SubagentToolPort = {
  listDefinitions(): readonly SubagentDescriptor[]; // 返回当前父 run可委派的子 Agent目录。
  run(agentName: string, task: string, call: ToolCall, options?: ToolExecutionOptions): Promise<SubagentRunResult>; // 按名称在父 run边界内同步执行隔离子 Agent。
};

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

export type ProviderRetry = {
  retryCount: number; // 当前重试次数，从 1 开始。
  maxRetries: number; // 当前 provider turn 允许的最大重试次数。
  delayMs: number; // 发起下一次请求前等待的退避毫秒数。
  message: string; // 可直接展示给用户的本地提示文案。
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
  onReasoningUpdate?: (update: ReasoningUpdate) => void; // provider turn 的可读 reasoning 草稿与完成边界。
  onProviderRetry?: (retry: ProviderRetry) => void;
  onProviderRecords?: (records: TranscriptRecord[]) => void;
  onAssistantSegment?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolApprovalRequest?: (call: ToolCall, request?: ToolApprovalRequest) => Promise<ToolApprovalDecision> | ToolApprovalDecision;
  onUserQuestionRequest?: (call: ToolCall, request: AskUserQuestionsRequest) => Promise<ToolExecutionResult> | ToolExecutionResult;
  onToolResult?: (result: ToolExecutionResult) => void;
  onSubagentRecords?: (records: SubagentTranscriptRecord[]) => void; // 发布已进入父 runtime record region 的稳定子 Agent 过程。
  onSubagentActivity?: (activity: SubagentActivity | null) => void; // 更新或清空不持久化的子 Agent footer 活动。
  onSubagentUserQuestionRequest?: (metadata: SubagentRunMetadata, call: ToolCall, request: AskUserQuestionsRequest) => Promise<ToolExecutionResult> | ToolExecutionResult; // 把受 run identity 保护的子 Agent 问题桥接到共享交互 surface。
  onTodoStateChange?: (todoState: TodoState) => void;
  onComplete?: (finalText: string) => void;
  onCompacted?: (next: CompactionState) => void;
  onContextUsage?: (usage: ContextUsage) => void;
};

export type AgentSessionInput = {
  records: TranscriptRecord[]; // 当前回合开始时提供给 agent 的完整 transcript 快照。
  compaction?: CompactionState; // 已持久化的上下文压缩状态，缺省时从未压缩状态开始。
  todoState?: TodoState; // 当前会话的待办状态，供 agent 在工具调用间延续。
  sessionJournalPath?: string; // 当前 session 的 transcript journal 文件绝对路径，供压缩后模型按需回读原始记录；headless 无 session 时缺省。
  abortSignal?: AbortSignal; // 取消当前 agent 运行及其可中断下游操作的信号。
  interactionMode?: InteractionMode; // 本回合的 normal、plan 或 shell 等交互模式。
  executionMode?: AgentExecutionMode; // 本回合的 interactive 或 headless 执行与审批策略。
  modelProfileId?: string; // 本回合已解析并验证的最终模型 profile，不是未验证的 skill override。
  reasoningEffortOverride?: ReasoningEffort; // 仅本回合生效的推理强度覆盖，包含显式 none。
  compactionThresholdRatio?: number; // 触发自动上下文压缩时占模型窗口的比例覆盖。
  skillCatalogContextRatio?: number; // 技能目录 prompt 可占模型上下文窗口的比例覆盖。
  toolPolicy?: AgentToolPolicy; // 本次运行的工具执行边界；readonly 保持 schema 但拒绝副作用调用。
  conversationKind?: AgentConversationKind; // 本地生命周期标识，不得改变 built-in system prompt。
  userConfigSnapshot?: AgentUserConfigSnapshot; // 本回合捕获的用户配置 revision；仅驻留内存，不得持久化到 transcript。
};

export type AgentUserConfigSnapshot = {
  revision: number; // 本回合使用的用户配置 revision，仅用于一致性与诊断。
  getAppSettings(): {
    agentInstructionFileName: AgentInstructionFileName; // 本回合加载项目指令时使用的文件名。
    compactionThresholdRatio: number; // 本回合自动压缩触发比例。
    skillCatalogContextRatio: number; // 本回合 skill catalog 的上下文预算比例。
    toolApprovalMode: 'manual' | 'auto'; // 本回合工具审批策略。
    toolApprovalModelProfileId?: string; // 本回合自动审批严格引用的 profile。
  };
  getLlmModelConfigInfo(): {
    kind: 'profiles'; // 当前配置使用 profile 目录模型。
    selectedModelId: string; // 宽松主运行选择最终命中的 profile id。
    models: readonly {
      id: string; // manifest 和内置 override 可持久化引用的稳定 profile id。
      provider: string; // 非敏感 provider 配置 id，不包含凭据和 headers。
      model: string; // provider 接收的模型名称。
      reasoningEffort?: ReasoningEffort; // profile 自身配置的默认推理强度。
      reasoningSummary?: ReasoningSummary; // profile 自身配置的 reasoning summary 策略。
      contextWindow?: number; // profile 显式配置的上下文窗口。
    }[];
  };
  resolveLlmConfig(options?: {
    modelProfileId?: string; // 当前 session 或 skill 已解析出的 profile id。
    reasoningEffortOverride?: ReasoningEffort; // 当前回合显式 effort 覆盖。
  }): LlmConfig;
  resolveLlmConfigStrict(options: {
    modelProfileId: string; // 必须存在于当前 revision 的 profile id，失效时禁止回退。
    reasoningEffortOverride?: ReasoningEffort; // 若提供则覆盖目标 profile 默认 effort，包含 none。
  }): LlmConfig;
  resolveLlmConfigForProfile(modelProfileId: string): LlmConfig; // 严格解析同一 revision 内的指定 profile。
};

export type AgentInstructionSourceKind = 'global' | 'project';

export type AgentInstructionFileName = 'AGENTS.md' | 'CLAUDE.md';

export type AgentInstruction = {
  content: string;
  filePath: string;
  label: string;
  sourceKind: AgentInstructionSourceKind;
};

export type RunAgent = (session: AgentSessionInput, callbacks?: AgentCallbacks) => Promise<unknown>;

export type ReasoningUpdate =
  | {
      kind: 'draft'; // 表示当前文本仍是可变的 transient reasoning preview。
      text: string; // provider turn 内按协议顺序合并后的最新可见 reasoning 全文。
    }
  | {
      kind: 'complete'; // 表示 provider 已确认当前可见 reasoning 不会再被后续事件修改。
      text: string; // 可以立即提交为 reasoning_summary transcript 的权威全文。
    };

export type AgentTurnCallbacks = Pick<AgentCallbacks, 'onProviderRetry' | 'onReasoningUpdate' | 'onToken'>;

export type AgentTurnOptions = {
  abortSignal?: AbortSignal;
  isCompaction?: boolean;
};

export type AgentTurnResult = {
  draft: string;
  providerRecords?: TranscriptRecord[];
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

export type FileEditToolMode = 'apply_patch' | 'edit_file';

export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

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
  autoCompressImages: boolean; // 控制 read_files 是否把超限图片缩小到最终附件上限内。
  bash: BashToolConfig;
  fileEditMode: FileEditToolMode;
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
