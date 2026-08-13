import type {ApplyPatchDisplayMetadata, EditFileDisplayMetadata, GlobDisplayMetadata, GrepDisplayMetadata, ToolResultAttachment} from './tool';
import type {ChangeCheckpoint} from './change-history';
import type {InteractionMode} from './agent';
import type {SkillSourceKind} from './skill';

export const OPENAI_REASONING_EXTENSION_KIND = 'openai_reasoning';
export const OPENAI_CHAT_REASONING_EXTENSION_KIND = 'openai_chat_reasoning';
export const ANTHROPIC_THINKING_EXTENSION_KIND = 'anthropic_thinking';

export type KnownTranscriptRole = 'user' | 'assistant' | 'system' | 'error' | 'compaction_notice' | 'local_notice' | 'reasoning_summary' | 'shell' | 'tool_call' | 'tool_result' | 'subagent';

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
      display?: GlobDisplayMetadata; // 持久化 glob handler 已保留的路径事实，供重放专属 renderer。
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

export type SubagentTranscriptEvent =
  | {
      kind: 'start'; // 子 Agent 已通过校验并开始运行。
      task: string; // 外层 handler 交付的完整调查任务。
    }
  | {
      kind: 'reasoning_summary'; // Provider 已确认稳定的可见推理摘要。
    }
  | {
      kind: 'assistant'; // 工具前段落或最终回答的稳定文本。
    }
  | {
      kind: 'tool_call'; // 子 Agent 内部工具调用事实。
      toolCallId: string; // 内部 provider tool call id。
      toolName: string; // 内部 provider-neutral 工具名。
      argumentsText: string; // 内部工具原始 JSON 参数文本。
    }
  | {
      kind: 'tool_result'; // 子 Agent 内部工具执行结果事实。
      toolCallId: string; // 与内部 tool_call 配对的 call id。
      toolName: string; // 内部 provider-neutral 工具名。
      ok: boolean; // 内部工具是否成功完成。
      details: ToolResultTranscriptDetails; // 供恢复后复用专属工具 renderer 的结构化事实。
      attachments?: ToolResultAttachment[]; // 内部工具产生的受支持附件。
    }
  | {
      kind: 'completed'; // 子 Agent 已成功返回最终回答。
      durationMs: number; // 从 start 到成功完成的墙钟耗时。
    }
  | {
      kind: 'failed'; // 子 Agent 因非父级取消错误结束。
      durationMs: number; // 从 start 到失败的墙钟耗时。
    }
  | {
      kind: 'cancelled'; // 子 Agent 随父 turn 主动取消。
      durationMs: number; // 从 start 到取消的墙钟耗时。
    };

export type SubagentTranscriptRecord = TranscriptRecordBase & {
  role: 'subagent';
  agentName: string; // 内置或自定义子 Agent 的稳定目录名称。
  parentToolCallId: string; // 外层 run_subagent 调用身份。
  runId: string; // 同一次子 Agent 过程记录的分组身份。
  event: SubagentTranscriptEvent; // 当前稳定过程事件。
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
  | SubagentTranscriptRecord
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

export type TranscriptJournalFingerprint = {
  size: number; // journal 当前字节数，用于发现追加、修复或替换。
  mtimeMs: number; // journal 最近修改时间，用于发现同尺寸外部改写。
};

export type TranscriptSessionSummary = {
  sessionId: string; // 左侧列表候选对应的持久化 session 身份。
  createdAt: string; // session 首次创建时间，仅来自 journal header。
  updatedAt: string; // journal 最后一个有效操作的语义更新时间。
  cwd: string; // session 所属工作目录，必须与当前项目分区一致。
  messageCount: number; // replay 最终状态中仍然存在的 record 数量。
  title: string; // 从 replay 后第一条用户消息派生的稳定列表标题。
  fingerprint: TranscriptJournalFingerprint; // 生成该摘要时对应的 journal 文件版本。
};

export type TranscriptSessionIndex = {
  schemaVersion: 1; // session index 的持久化 schema 版本。
  sessions: TranscriptSessionSummary[]; // 当前项目下按 sessionId 唯一的轻量摘要集合。
};

export type TranscriptSessionPreview = {
  sessionId: string; // 本次预览所属 session，用于隔离迟到异步结果。
  previewRecords: TranscriptSessionPreviewRecord[]; // replay 最终状态派生的有界右栏记录。
};

export type ConversationReferenceSource = {
  session: TranscriptSession; // 从源 journal 重放得到且不会替换当前 transcript 的会话。
  sourcePath: string; // 供最终引用暴露给 read_files 的 journal 路径。
  title: string; // 与候选 summary 保持一致的会话标题。
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

export type TranscriptForkResult =
  | {
      ok: true; // 标识新 journal 已创建且当前 session 已切换。
      sessionId: string; // 新分叉 session 的持久化 id。
      sourceSessionId: string; // 分叉前源 session 的持久化 id。
    }
  | {
      ok: false; // 标识当前 session 未发生切换。
      reason: 'empty' | 'failed'; // 区分无可分叉会话与持久化失败。
      error?: string; // 可直接展示给用户的脱敏失败说明。
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
  getSessionIndexFilePath: (cwd: string) => string;
  listSessionSummaries: (cwd: string) => TranscriptSessionSummary[];
  loadSession: (cwd: string, sessionId: string) => LoadedTranscriptSession | null;
  loadSessionReadOnly: (cwd: string, sessionId: string) => LoadedTranscriptSession | null; // 重放 journal 但绝不修复或改写源文件。
  loadSessionPreview: (cwd: string, sessionId: string) => Promise<TranscriptSessionPreview | null>;
  updateSessionIndex: (cwd: string, reference: TranscriptSessionJournalReference, records: TranscriptRecord[]) => void;
};
