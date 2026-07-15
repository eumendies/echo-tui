import type {ToolResultAttachment, ToolResultDisplayMetadata} from './tool';
import type {ChangeCheckpoint} from './change-history';

export const OPENAI_REASONING_TRANSCRIPT_ROLE = 'openai_reasoning';
export const OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE = 'openai_chat_reasoning';
export const ANTHROPIC_THINKING_TRANSCRIPT_ROLE = 'anthropic_thinking';

export type KnownTranscriptRole = 'user' | 'assistant' | 'system' | 'error' | 'local_notice' | 'reasoning_summary' | 'shell' | 'tool_call' | 'tool_result' | typeof OPENAI_REASONING_TRANSCRIPT_ROLE | typeof OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE | typeof ANTHROPIC_THINKING_TRANSCRIPT_ROLE;

export type TranscriptRole = KnownTranscriptRole | (string & {});

export type TranscriptRecord = {
  role: TranscriptRole;
  text: string;
  createdAt?: string;
  interactionMode?: string;
  [key: string]: unknown;
};

export type ToolCallTranscriptRecord = TranscriptRecord & {
  role: 'tool_call';
  toolCallId: string;
  toolName: string;
  argumentsText: string;
};

export type BaseToolResultTranscriptRecord = TranscriptRecord & {
  role: 'tool_result';
  toolCallId: string;
  toolName: string;
  ok: boolean;
  attachments?: ToolResultAttachment[];
};

export type BashToolResultTranscriptRecord = BaseToolResultTranscriptRecord & {
  toolName: 'run_bash_command';
  exitCode?: number | null;
  timedOut?: boolean;
  truncated?: boolean;
  durationMs?: number;
};

export type ShellTranscriptRecord = TranscriptRecord & {
  role: 'shell';
  command: string;
  durationMs?: number;
  error?: string;
  exitCode?: number | null;
  includeInContext?: boolean;
  output: string;
  timedOut?: boolean;
  truncated?: boolean;
};

export type GlobToolResultTranscriptRecord = BaseToolResultTranscriptRecord & {
  toolName: 'glob';
  exitCode?: number | null;
  truncated: boolean;
};

export type GrepToolResultTranscriptRecord = BaseToolResultTranscriptRecord & {
  toolName: 'grep';
  exitCode?: number | null;
  truncated: boolean;
};

export type ReadFilesToolResultTranscriptRecord = BaseToolResultTranscriptRecord & {
  toolName: 'read_files';
  truncated: boolean;
};

export type WebFetchToolResultTranscriptRecord = BaseToolResultTranscriptRecord & {
  toolName: 'web_fetch';
  timedOut: boolean;
  truncated: boolean;
};

export type WebSearchToolResultTranscriptRecord = BaseToolResultTranscriptRecord & {
  toolName: 'web_search';
  timedOut: boolean;
  truncated: boolean;
};

export type ApplyPatchToolResultTranscriptRecord = BaseToolResultTranscriptRecord & {
  toolName: 'apply_patch';
  display?: ToolResultDisplayMetadata;
};

export type ToolResultTranscriptRecord =
  | BaseToolResultTranscriptRecord
  | BashToolResultTranscriptRecord
  | GlobToolResultTranscriptRecord
  | GrepToolResultTranscriptRecord
  | ReadFilesToolResultTranscriptRecord
  | WebFetchToolResultTranscriptRecord
  | WebSearchToolResultTranscriptRecord
  | ApplyPatchToolResultTranscriptRecord;

export type CompactionState = {
  summaryText: string;
  activeStartIndex: number;
  createdAt: string;
};

export type TodoItemStatus = 'open' | 'completed';

export type TodoItem = {
  id: string;
  text: string;
  status: TodoItemStatus;
};

export type TodoState = {
  items: TodoItem[];
  updatedAt: string;
};

export type TranscriptSession = {
  schemaVersion: number;
  sessionId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  records: TranscriptRecord[];
  changeHistory?: ChangeCheckpoint[];
  compaction?: CompactionState;
  todoState?: TodoState;
};

export type TranscriptSessionPreviewRecord = {
  role: TranscriptRole;
  text: string;
  createdAt?: string;
};

export type TranscriptSessionMetadata = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  messageCount: number;
  lastMessagePreview: string;
  previewRecords: TranscriptSessionPreviewRecord[];
};

export type TranscriptJournalStart = {
  schemaVersion: 1;
  op: 'session_start';
  sessionId: string;
  cwd: string;
  createdAt: string;
};

export type AppendRecordsJournalOperation = {
  op: 'append_records';
  records: TranscriptRecord[];
};

export type TruncateRecordsJournalOperation = {
  op: 'truncate_records';
  recordCount: number;
};

export type SetChangeHistoryJournalOperation = {
  op: 'set_change_history';
  changeHistory: ChangeCheckpoint[];
};

export type SetCompactionJournalOperation = {
  op: 'set_compaction';
  compaction: CompactionState | null;
};

export type SetTodoStateJournalOperation = {
  op: 'set_todo_state';
  todoState: TodoState;
};

export type TranscriptJournalSubOperation =
  | AppendRecordsJournalOperation
  | TruncateRecordsJournalOperation
  | SetChangeHistoryJournalOperation
  | SetCompactionJournalOperation
  | SetTodoStateJournalOperation;

export type BatchJournalOperation = {
  op: 'batch';
  operations: TranscriptJournalSubOperation[];
};

export type TranscriptJournalOperation = TranscriptJournalSubOperation | BatchJournalOperation;

export type TranscriptJournalEntry = TranscriptJournalOperation & {
  schemaVersion: 1;
  seq: number;
  updatedAt: string;
};

export type TranscriptSessionJournalReference = {
  sessionId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  sequence: number;
};

export type LoadedTranscriptSession = {
  session: TranscriptSession;
  reference: TranscriptSessionJournalReference;
};

export type TranscriptProjectMetadata = {
  schemaVersion: number;
  cwd: string;
  cwdHash: string;
};

export type TranscriptStore = {
  createSession: (cwd: string, operation: TranscriptJournalOperation, now?: string) => TranscriptSessionJournalReference;
  appendSession: (cwd: string, reference: TranscriptSessionJournalReference, operation: TranscriptJournalOperation, now?: string) => TranscriptSessionJournalReference;
  getDefaultRootDir: () => string;
  getProjectDir: (cwd: string) => string;
  getProjectMetadata: (cwd: string) => TranscriptProjectMetadata;
  getSessionFilePath: (cwd: string, sessionId: string) => string;
  listSessions: (cwd: string) => TranscriptSessionMetadata[];
  loadSession: (cwd: string, sessionId: string) => LoadedTranscriptSession | null;
};
