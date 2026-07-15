import type {ChangeCheckpoint} from '../types/change-history';
import type {
  AppendRecordsJournalOperation,
  BatchJournalOperation,
  CompactionState,
  LoadedTranscriptSession,
  SetChangeHistoryJournalOperation,
  SetCompactionJournalOperation,
  SetTodoStateJournalOperation,
  TodoState,
  TranscriptJournalEntry,
  TranscriptJournalOperation,
  TranscriptJournalStart,
  TranscriptJournalSubOperation,
  TranscriptRecord,
  TruncateRecordsJournalOperation
} from '../types/transcript';

const TRANSCRIPT_JOURNAL_SCHEMA_VERSION = 1 as const;

type ReplayState = {
  records: TranscriptRecord[];
  changeHistory: ChangeCheckpoint[];
  compaction: CompactionState | null;
  todoState: TodoState;
  updatedAt: string;
};

type TranscriptJournalReplayResult = LoadedTranscriptSession & {
  repairedJournalText: string;
  requiresRepair: boolean;
};

/**
 * 创建 journal 首行，后续操作依靠此行恢复 session 身份和所属 cwd。
 */
function createTranscriptJournalStart(sessionId: string, cwd: string, createdAt: string): TranscriptJournalStart {
  return {
    schemaVersion: TRANSCRIPT_JOURNAL_SCHEMA_VERSION,
    op: 'session_start',
    sessionId,
    cwd,
    createdAt
  };
}

function createAppendRecordsOperation(records: TranscriptRecord[]): AppendRecordsJournalOperation {
  return {op: 'append_records', records};
}

function createTruncateRecordsOperation(recordCount: number): TruncateRecordsJournalOperation {
  return {op: 'truncate_records', recordCount};
}

function createSetChangeHistoryOperation(changeHistory: ChangeCheckpoint[]): SetChangeHistoryJournalOperation {
  return {op: 'set_change_history', changeHistory};
}

function createSetCompactionOperation(compaction: CompactionState | null): SetCompactionJournalOperation {
  return {op: 'set_compaction', compaction};
}

function createSetTodoStateOperation(todoState: TodoState): SetTodoStateJournalOperation {
  return {op: 'set_todo_state', todoState};
}

function createBatchOperation(operations: TranscriptJournalSubOperation[]): BatchJournalOperation {
  return {op: 'batch', operations};
}

function createTranscriptJournalEntry(operation: TranscriptJournalOperation, seq: number, updatedAt: string): TranscriptJournalEntry {
  return {
    ...operation,
    schemaVersion: TRANSCRIPT_JOURNAL_SCHEMA_VERSION,
    seq,
    updatedAt
  } as TranscriptJournalEntry;
}

function serializeTranscriptJournalLine(entry: TranscriptJournalStart | TranscriptJournalEntry): string {
  return JSON.stringify(entry);
}

/**
 * 顺序重放一个 session journal；只允许最后一条非空行作为中断写入残留被忽略。
 */
function replayTranscriptJournal(text: string): TranscriptJournalReplayResult | null {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const start = parseTranscriptJournalStart(lines[0]);

  if (!start) {
    return null;
  }

  const state: ReplayState = {
    records: [],
    changeHistory: [],
    compaction: null,
    todoState: createEmptyTodoState(),
    updatedAt: start.createdAt
  };
  let sequence = 0;
  let recoveredTail = false;

  for (let index = 1; index < lines.length; index += 1) {
    const isLastLine = index === lines.length - 1;
    const parsed = parseJson(lines[index]);

    if (parsed === undefined) {
      if (isLastLine) {
        recoveredTail = true;
        break;
      }

      return null;
    }

    const entry = isTranscriptJournalEntry(parsed) ? parsed : null;

    if (!entry) {
      if (isLastLine) {
        recoveredTail = true;
        break;
      }

      return null;
    }

    if (entry.seq !== sequence + 1 || !applyTranscriptJournalOperation(entry, state)) {
      return null;
    }

    sequence = entry.seq;
    state.updatedAt = entry.updatedAt;
  }

  return {
    session: {
      schemaVersion: TRANSCRIPT_JOURNAL_SCHEMA_VERSION,
      sessionId: start.sessionId,
      cwd: start.cwd,
      createdAt: start.createdAt,
      updatedAt: state.updatedAt,
      records: state.records,
      ...(state.changeHistory.length > 0 ? {changeHistory: state.changeHistory} : {}),
      ...(state.compaction ? {compaction: state.compaction} : {}),
      todoState: state.todoState
    },
    reference: {
      sessionId: start.sessionId,
      cwd: start.cwd,
      createdAt: start.createdAt,
      updatedAt: state.updatedAt,
      sequence
    },
    repairedJournalText: `${lines.slice(0, sequence + 1).join('\n')}\n`,
    requiresRepair: recoveredTail || !text.endsWith('\n')
  };
}

function parseTranscriptJournalStart(line: string): TranscriptJournalStart | null {
  const parsed = parseJson(line);

  return isTranscriptJournalStart(parsed) ? parsed : null;
}

function parseJson(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function isTranscriptJournalStart(value: unknown): value is TranscriptJournalStart {
  if (!isRecord(value)) {
    return false;
  }

  return value.schemaVersion === TRANSCRIPT_JOURNAL_SCHEMA_VERSION &&
    value.op === 'session_start' &&
    isNonEmptyString(value.sessionId) &&
    typeof value.cwd === 'string' &&
    isNonEmptyString(value.createdAt);
}

function isTranscriptJournalEntry(value: unknown): value is TranscriptJournalEntry {
  if (!isRecord(value) || value.schemaVersion !== TRANSCRIPT_JOURNAL_SCHEMA_VERSION || !isPositiveInteger(value.seq) || !isNonEmptyString(value.updatedAt)) {
    return false;
  }

  return isTranscriptJournalOperation(value);
}

function isTranscriptJournalOperation(value: unknown): value is TranscriptJournalOperation {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.op) {
    case 'append_records':
      return Array.isArray(value.records) && value.records.every(isTranscriptRecord);
    case 'truncate_records':
      return isNonNegativeInteger(value.recordCount);
    case 'set_change_history':
      return Array.isArray(value.changeHistory) && value.changeHistory.every(isChangeCheckpoint);
    case 'set_compaction':
      return value.compaction === null || isCompactionState(value.compaction);
    case 'set_todo_state':
      return isTodoState(value.todoState);
    case 'batch':
      return Array.isArray(value.operations) && value.operations.length > 0 && value.operations.every(isTranscriptJournalSubOperation);
    default:
      return false;
  }
}

function isTranscriptJournalSubOperation(value: unknown): value is TranscriptJournalSubOperation {
  return isTranscriptJournalOperation(value) && value.op !== 'batch';
}

function isTranscriptRecord(value: unknown): value is TranscriptRecord {
  return isRecord(value) && typeof value.role === 'string' && typeof value.text === 'string';
}

function isChangeCheckpoint(value: unknown): value is ChangeCheckpoint {
  return isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.createdAt) &&
    typeof value.cwd === 'string' &&
    isNonNegativeInteger(value.transcriptStartIndex) &&
    Array.isArray(value.files) &&
    (value.status === 'recording' || value.status === 'ready' || value.status === 'used' || value.status === 'invalid');
}

function isCompactionState(value: unknown): value is CompactionState {
  return isRecord(value) &&
    typeof value.summaryText === 'string' &&
    typeof value.activeStartIndex === 'number' &&
    Number.isFinite(value.activeStartIndex) &&
    typeof value.createdAt === 'string';
}

function isTodoState(value: unknown): value is TodoState {
  return isRecord(value) &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.items) &&
    value.items.every((item) => isRecord(item) && isNonEmptyString(item.id) && isNonEmptyString(item.text) && (item.status === 'open' || item.status === 'completed'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function applyTranscriptJournalOperation(operation: TranscriptJournalOperation, state: ReplayState): boolean {
  if (operation.op === 'batch') {
    // 任一子操作失败都会让整个 replay 返回 null，局部 state 不会暴露，无需克隆完整 transcript 回滚。
    return operation.operations.every((item) => applyTranscriptJournalOperation(item, state));
  }

  switch (operation.op) {
    case 'append_records':
      state.records.push(...operation.records.map((record) => structuredClone(record)));
      return true;
    case 'truncate_records':
      if (operation.recordCount > state.records.length) {
        return false;
      }

      state.records.length = operation.recordCount;
      return true;
    case 'set_change_history':
      state.changeHistory = structuredClone(operation.changeHistory);
      return true;
    case 'set_compaction':
      state.compaction = operation.compaction ? {...operation.compaction} : null;
      return true;
    case 'set_todo_state':
      state.todoState = structuredClone(operation.todoState);
      return true;
  }
}

function createEmptyTodoState(): TodoState {
  return {items: [], updatedAt: ''};
}

export {
  TRANSCRIPT_JOURNAL_SCHEMA_VERSION,
  createAppendRecordsOperation,
  createBatchOperation,
  createSetChangeHistoryOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation,
  createTranscriptJournalEntry,
  createTranscriptJournalStart,
  createTruncateRecordsOperation,
  replayTranscriptJournal,
  serializeTranscriptJournalLine
};
