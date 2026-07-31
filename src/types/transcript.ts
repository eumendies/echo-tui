import type {ApplyPatchDisplayMetadata, EditFileDisplayMetadata, GrepDisplayMetadata, ToolResultAttachment} from './tool';
import type {ChangeCheckpoint} from './change-history';
import type {InteractionMode} from './agent';
import type {SkillSourceKind} from './skill';

export const OPENAI_REASONING_EXTENSION_KIND = 'openai_reasoning';
export const OPENAI_CHAT_REASONING_EXTENSION_KIND = 'openai_chat_reasoning';
export const ANTHROPIC_THINKING_EXTENSION_KIND = 'anthropic_thinking';

export type KnownTranscriptRole = 'user' | 'assistant' | 'system' | 'error' | 'compaction_notice' | 'local_notice' | 'reasoning_summary' | 'shell' | 'tool_call' | 'tool_result';

export type TranscriptRole = KnownTranscriptRole | 'extension';

type TranscriptRecordBase = {
  text: string;
  createdAt?: string;
};

export type UserTranscriptMetadata = {
  agentWorkflow?: {
    source: 'builtin';
    name: string;
    argumentsText?: string;
  };
  interactionMode?: InteractionMode;
  modeTransition?: {
    from: 'normal' | 'plan';
    to: 'normal' | 'plan';
  };
  skillInvocation?: {
    source: 'slash';
    skillName: string;
    argumentsText?: string;
    userRequestText?: string;
    sourceKind: SkillSourceKind;
    sourcePath: string;
  };
  conversationReference?: ConversationReferenceMetadata; // 标识该用户消息附加了一段历史会话引用。
};

export type ConversationReferenceProjectionMode = 'full' | 'summary';

export type ConversationReferenceMetadata = {
  projectionMode: ConversationReferenceProjectionMode; // 记录该引用最终使用全文还是模型总结。
  sourcePath: string; // 指向被引用会话的源 journal，供精确细节回读。
  sourceSessionId: string; // 标识被引用会话，但不展示在引用卡片中。
  title: string; // 供引用卡片和 provider 上下文识别历史会话。
};

export type PendingConversationReference = ConversationReferenceMetadata & {
  materialText: string; // 已完成角色过滤、等待在下一条消息发送前按预算处理的中立历史文本。
};

export type PreparedConversationReference = ConversationReferenceMetadata & {
  projectionText: string; // 已按预算保留全文或生成总结的 provider-facing 文本。
};

export type UserTranscriptRecord = TranscriptRecordBase & {
  role: 'user';
  displayText?: string;
  attachments?: ToolResultAttachment[];
  metadata?: UserTranscriptMetadata;
};

type PlainTextTranscriptRole = 'assistant' | 'system' | 'error' | 'compaction_notice' | 'local_notice' | 'reasoning_summary';

export type PlainTextTranscriptRecord = {
  [Role in PlainTextTranscriptRole]: TranscriptRecordBase & {role: Role};
}[PlainTextTranscriptRole];

export type ToolCallTranscriptRecord = TranscriptRecordBase & {
  role: 'tool_call';
  toolCallId: string;
  toolName: string;
  argumentsText: string;
};

type ToolResultTranscriptRecordBase = TranscriptRecordBase & {
  role: 'tool_result';
  toolCallId: string;
  toolName: string;
  ok: boolean;
  attachments?: ToolResultAttachment[];
};

export type ToolResultTranscriptDetails =
  | {kind: 'generic'}
  | {
      kind: 'bash';
      exitCode?: number | null;
      timedOut?: boolean;
      truncated?: boolean;
      durationMs?: number;
    }
  | {
      kind: 'glob';
      exitCode?: number | null;
      truncated: boolean;
    }
  | {
      kind: 'grep';
      exitCode?: number | null;
      truncated: boolean;
      display?: GrepDisplayMetadata; // 持久化 grep handler 已保留的匹配事实，供重放专属 renderer。
    }
  | {
      kind: 'read_files';
      truncated: boolean;
    }
  | {
      kind: 'web_fetch' | 'web_search';
      timedOut: boolean;
      truncated: boolean;
    }
  | {
      kind: 'apply_patch';
      display?: ApplyPatchDisplayMetadata;
    }
  | {
      kind: 'edit_file';
      display?: EditFileDisplayMetadata;
    };

export type ToolResultTranscriptRecord = ToolResultTranscriptRecordBase & {
  details: ToolResultTranscriptDetails;
};

export type ShellTranscriptRecord = TranscriptRecordBase & {
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

export type TranscriptExtension =
  | {
      kind: typeof OPENAI_REASONING_EXTENSION_KIND;
      item: {
        type: 'reasoning';
        encrypted_content: string;
        [key: string]: unknown;
      };
    }
  | {
      kind: typeof OPENAI_CHAT_REASONING_EXTENSION_KIND;
      reasoningContent: string;
    }
  | {
      kind: typeof ANTHROPIC_THINKING_EXTENSION_KIND;
      block:
        | {type: 'thinking'; thinking: string; signature: string}
        | {type: 'redacted_thinking'; data: string};
    }
  | {
      kind: 'unknown';
      name: string;
      payload: Record<string, unknown>;
    };

export type TranscriptExtensionRecord = TranscriptRecordBase & {
  role: 'extension';
  extension: TranscriptExtension;
};

export type TranscriptRecord =
  | UserTranscriptRecord
  | PlainTextTranscriptRecord
  | ShellTranscriptRecord
  | ToolCallTranscriptRecord
  | ToolResultTranscriptRecord
  | TranscriptExtensionRecord;

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
  sourcePath: string; // 当前 session 对应 journal 的绝对路径。
  title: string; // 从首条用户消息派生的稳定会话标题。
};

export type ConversationReferenceSource = {
  session: TranscriptSession; // 从源 journal 重放得到且不会替换当前 transcript 的会话。
  sourcePath: string; // 供最终引用暴露给 read_files 的 journal 路径。
  title: string; // 与候选 metadata 保持一致的会话标题。
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
  loadSessionReadOnly: (cwd: string, sessionId: string) => LoadedTranscriptSession | null; // 重放 journal 但绝不修复或改写源文件。
};
