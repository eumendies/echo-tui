import type {InteractionMode} from './agent';

const LIFECYCLE_HOOK_EVENTS = [
  'assistant_turn_start',
  'assistant_turn_end',
  'assistant_turn_error',
  'assistant_turn_cancelled',
  'tool_call_start',
  'tool_call_end',
  'tool_approval_request',
  'tool_approval_response',
  'user_question_request',
  'user_question_response',
  'compaction_end'
] as const;

type LifecycleHookEventName = typeof LIFECYCLE_HOOK_EVENTS[number];

type LifecycleHookEntry = {
  command: string;
  enabled?: boolean;
  timeoutMs: number;
};

type LifecycleHookConfig = Partial<Record<LifecycleHookEventName, LifecycleHookEntry[]>>;

type LifecycleHookConfigDiagnostic = {
  event?: string;
  index?: number;
  message: string;
};

type LifecycleHookDraftEntry = {
  command: string;
  enabled: boolean;
  timeoutMs: number;
};

type LifecycleHookDraftEvent = {
  entries: LifecycleHookDraftEntry[];
  event: LifecycleHookEventName;
};

type LifecycleHookConfigDraft = {
  configPath: string;
  diagnostics: LifecycleHookConfigDiagnostic[];
  events: LifecycleHookDraftEvent[];
};

type LifecycleHookPayload = {
  event: LifecycleHookEventName;
  timestamp: string;
  cwd: string;
  interactionMode?: InteractionMode;
  status?: string;
  toolCallId?: string;
  toolName?: string;
  argumentsText?: string;
  ok?: boolean;
  preview?: string;
  previewTitle?: string;
  decision?: string;
  feedbackText?: string;
  approvedCommand?: string;
  questionCount?: number;
  questionsText?: string;
  answerCount?: number;
  resultText?: string;
  activeStartIndex?: number;
  createdAt?: string;
  errorName?: string;
  errorMessage?: string;
};

type LifecycleHookPayloadData = Omit<LifecycleHookPayload, 'event' | 'timestamp' | 'cwd'>;

type LifecycleHookExecutorInput = {
  entry: LifecycleHookEntry;
  payload: LifecycleHookPayload;
  cwd: string;
};

type LifecycleHookExecutorResult = {
  ok: boolean;
  exitCode?: number | null;
  timedOut?: boolean;
  error?: string;
};

type LifecycleHookSyntheticPayloadOptions = {
  cwd: string;
  event: LifecycleHookEventName;
  interactionMode?: InteractionMode;
  now?: () => Date;
};

type LifecycleHookTestResult = LifecycleHookExecutorResult & {
  durationMs: number;
  stderr: string;
  stderrTruncated: boolean;
  stdout: string;
  stdoutTruncated: boolean;
};

type LifecycleHookExecutor = (input: LifecycleHookExecutorInput) => Promise<LifecycleHookExecutorResult>;

type LifecycleHookDispatcher = {
  emit: (event: LifecycleHookEventName, data?: LifecycleHookPayloadData) => void;
  flush: () => Promise<void>;
  updateConfig: (config: LifecycleHookConfig) => void;
};

export {
  LIFECYCLE_HOOK_EVENTS
};

export type {
  LifecycleHookConfig,
  LifecycleHookConfigDiagnostic,
  LifecycleHookConfigDraft,
  LifecycleHookDispatcher,
  LifecycleHookDraftEntry,
  LifecycleHookDraftEvent,
  LifecycleHookEntry,
  LifecycleHookEventName,
  LifecycleHookExecutor,
  LifecycleHookExecutorInput,
  LifecycleHookExecutorResult,
  LifecycleHookPayload,
  LifecycleHookPayloadData,
  LifecycleHookSyntheticPayloadOptions,
  LifecycleHookTestResult
};
