import type {ChangeCheckpoint} from '../types/change-history';
import {StringDecoder} from 'node:string_decoder';

import type {
  AppendRecordsJournalOperation,
  BatchJournalOperation,
  CompactionState,
  LoadedTranscriptSession,
  PopChangeCheckpointJournalOperation,
  PushChangeCheckpointJournalOperation,
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
const JOURNAL_READ_CHUNK_BYTES = 64 * 1024;

/** 同步分块读取只需要 descriptor 级别的原语，便于测试注入计数或故障。 */
type JournalFileReader = Pick<typeof import('node:fs'), 'closeSync' | 'openSync' | 'readSync'>;

type ReplayState = {
  records: TranscriptRecord[];
  changeHistory: ChangeCheckpoint[];
  compaction: CompactionState | null;
  todoState: TodoState;
  updatedAt: string;
};

type TranscriptJournalReplayResult = LoadedTranscriptSession & {
  requiresRepair: boolean; // 尾部需要修复：结构无效尾行或文件缺少结尾换行。
};

type JournalReplay = {
  feed: (line: string) => boolean; // 返回 false 表示已判定不可恢复，调用方可以停止读取剩余内容。
  finish: (endedWithNewline: boolean) => TranscriptJournalReplayResult | null;
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

function createPushChangeCheckpointOperation(checkpoint: ChangeCheckpoint): PushChangeCheckpointJournalOperation {
  return {op: 'push_change_checkpoint', checkpoint};
}

function createPopChangeCheckpointOperation(): PopChangeCheckpointJournalOperation {
  return {op: 'pop_change_checkpoint'};
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
 * 增量重放核心：逐行喂入 journal 内容，由调用方决定读取方式与修复时机；核心不接触文件与 I/O。
 * 只有"结构无效或未知操作"出现在最后一行时才按中断写入残留忽略；seq 不连续与越界截断即使出现在最后一行也不可恢复。
 */
function createJournalReplay(): JournalReplay {
  let journal: {sequence: number; start: TranscriptJournalStart; state: ReplayState} | null = null;
  let failed = false;
  // 结构无效行先按"可能是中断写入的尾行"处理；若之后仍有非空行，即判定为中间损坏。
  let pendingTail = false;

  return {
    feed(line: string): boolean {
      if (failed) {
        return false;
      }

      const normalized = line.trim();
      if (normalized === '') {
        // 空行既不参与"是否为最后一行"的判定，也不推进任何状态。
        return true;
      }

      if (pendingTail) {
        failed = true;
        return false;
      }

      if (!journal) {
        const start = parseTranscriptJournalStart(normalized);
        if (!start) {
          failed = true;
          return false;
        }

        journal = {
          sequence: 0,
          start,
          state: {
            records: [],
            changeHistory: [],
            compaction: null,
            todoState: createEmptyTodoState(),
            updatedAt: start.createdAt
          }
        };
        return true;
      }

      const parsed = parseJson(normalized);
      const entry = parsed !== undefined && isTranscriptJournalEntry(parsed) ? parsed : null;
      if (!entry) {
        pendingTail = true;
        return true;
      }

      if (entry.seq !== journal.sequence + 1 || !applyTranscriptJournalOperation(entry, journal.state)) {
        failed = true;
        return false;
      }

      journal.sequence = entry.seq;
      journal.state.updatedAt = entry.updatedAt;
      return true;
    },
    finish(endedWithNewline: boolean): TranscriptJournalReplayResult | null {
      if (failed || !journal) {
        return null;
      }

      const {sequence, start, state} = journal;

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
        requiresRepair: pendingTail || !endedWithNewline
      };
    }
  };
}

/**
 * 顺序重放一个 session journal 文本；只允许最后一条非空行作为中断写入残留被忽略。
 */
function replayTranscriptJournal(text: string): TranscriptJournalReplayResult | null {
  const replay = createJournalReplay();

  for (const line of text.split('\n')) {
    if (!replay.feed(line)) {
      break;
    }
  }

  return replay.finish(text.endsWith('\n'));
}

/**
 * 同步分块读取一个 journal 文件并按行喂入重放核心；内存由读取缓冲与当前行决定，不构造整文件副本。
 * 返回文件是否以换行结尾；调用方需要修复尾部时由 createRepairedJournalText 按需重建文本。
 */
function replayTranscriptJournalFile(filePath: string, fsImpl: JournalFileReader): TranscriptJournalReplayResult | null {
  const replay = createJournalReplay();
  const endedWithNewline = readJournalFileLines(filePath, fsImpl, (line) => replay.feed(line));

  return replay.finish(endedWithNewline);
}

/**
 * 异步分块读取并按行喂入重放核心，供不能阻塞事件循环的调用方使用。
 * 用 for await 而不是事件回调：回调里抛出的同步异常不会进入 Promise 的 catch，会直接终结进程。
 * 读取失败、不可恢复与重放异常都统一降级为 null。
 */
async function replayTranscriptJournalStream(stream: AsyncIterable<string | Buffer>): Promise<TranscriptJournalReplayResult | null> {
  const replay = createJournalReplay();
  const splitter = createJournalLineSplitter((line) => replay.feed(line));

  try {
    for await (const chunk of stream) {
      if (!splitter.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)) {
        break;
      }
    }

    return replay.finish(splitter.end());
  } catch {
    return null;
  }
}

/**
 * 逐行读取 journal 文件；`onLine` 返回 false 时立即停止读取剩余内容。
 * 跨 chunk 的多字节字符由 StringDecoder 处理，调用方拿到的行不包含行尾换行。
 */
function readJournalFileLines(filePath: string, fsImpl: JournalFileReader, onLine: (line: string) => boolean): boolean {
  const buffer = Buffer.alloc(JOURNAL_READ_CHUNK_BYTES);
  const splitter = createJournalLineSplitter(onLine);
  let descriptor: number | undefined;

  try {
    descriptor = fsImpl.openSync(filePath, 'r');

    for (;;) {
      const bytesRead = fsImpl.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) {
        break;
      }

      if (!splitter.push(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead))) {
        break;
      }
    }

    return splitter.end();
  } finally {
    if (descriptor !== undefined) {
      try {
        fsImpl.closeSync(descriptor);
      } catch {
        // 关闭 descriptor 失败不得改变读取结果。
      }
    }
  }
}

/**
 * 按既有规范化规则重建仅包含有效前缀的修复文本：逐行 trim、丢弃空行、保留 header 与前 `sequence` 条操作。
 * 仅在尾部确实需要修复时调用，代价是重读一次文件；计数单位是非空逻辑行，与物理行数无关。
 */
function createRepairedJournalText(filePath: string, fsImpl: JournalFileReader, sequence: number): string {
  const lines: string[] = [];

  readJournalFileLines(filePath, fsImpl, (line) => {
    const normalized = line.trim();
    if (normalized === '') {
      return true;
    }

    lines.push(normalized);
    // 收齐 header 与前 sequence 条操作后立即停止读取，不再等待下一条非空行。
    return lines.length < sequence + 1;
  });

  return `${lines.join('\n')}\n`;
}

/**
 * 把字节流切成行：跨 chunk 的残行以片段数组暂存、成行时一次性拼接，避免超长行反复拼接字符串。
 * `push` 返回 false 表示 `onLine` 要求停止（已判定结果或已收齐所需前缀），调用方应立即结束读取；
 * `stopped` 之后不再产出任何行，因此 `end()` 的结尾换行判定在该路径上不再代表真实结尾。
 */
function createJournalLineSplitter(onLine: (line: string) => boolean): {end: () => boolean; push: (chunk: Buffer) => boolean} {
  const decoder = new StringDecoder('utf8');
  let pending: string[] = [];
  let stopped = false;

  return {
    push(chunk: Buffer): boolean {
      if (stopped) {
        return false;
      }

      let rest = decoder.write(chunk);

      let lineEnd = rest.indexOf('\n');
      while (lineEnd >= 0) {
        const head = rest.slice(0, lineEnd);
        const line = pending.length === 0 ? head : `${pending.join('')}${head}`;
        pending = [];
        rest = rest.slice(lineEnd + 1);

        if (!onLine(line)) {
          stopped = true;
          return false;
        }

        lineEnd = rest.indexOf('\n');
      }

      if (rest !== '') {
        pending.push(rest);
      }

      return true;
    },
    end(): boolean {
      if (stopped) {
        return true;
      }

      const tail = decoder.end();
      if (tail !== '') {
        pending.push(tail);
      }

      if (pending.length === 0) {
        return true;
      }

      const line = pending.join('');
      pending = [];
      onLine(line);
      return false;
    }
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
    case 'push_change_checkpoint':
      return isChangeCheckpoint(value.checkpoint);
    case 'pop_change_checkpoint':
      return true;
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
  if (!isRecord(value) || typeof value.text !== 'string' || (value.createdAt !== undefined && typeof value.createdAt !== 'string')) {
    return false;
  }

  switch (value.role) {
    case 'user':
      return (value.displayText === undefined || typeof value.displayText === 'string') &&
        (value.attachments === undefined || Array.isArray(value.attachments)) &&
        (value.metadata === undefined || isUserTranscriptMetadata(value.metadata));
    case 'assistant':
    case 'system':
    case 'error':
    case 'compaction_notice':
    case 'local_notice':
    case 'reasoning_summary':
      return true;
    case 'shell':
      return typeof value.command === 'string' &&
        typeof value.output === 'string' &&
        (value.includeInContext === undefined || typeof value.includeInContext === 'boolean');
    case 'tool_call':
      return isNonEmptyString(value.toolCallId) &&
        isNonEmptyString(value.toolName) &&
        typeof value.argumentsText === 'string';
    case 'tool_result':
      return isNonEmptyString(value.toolCallId) &&
        isNonEmptyString(value.toolName) &&
        typeof value.ok === 'boolean' &&
        (value.attachments === undefined || Array.isArray(value.attachments)) &&
        isToolResultDetails(value.details);
    case 'subagent':
      return isSubagentTranscriptRecord(value);
    case 'code_execution':
      return isNonEmptyString(value.toolCallId) &&
        isNonEmptyString(value.executionId) &&
        isNonNegativeInteger(value.sequence) &&
        (value.event === 'start' || value.event === 'call_start' || value.event === 'call_end' || value.event === 'end') &&
        (value.childCallId === undefined || isNonEmptyString(value.childCallId)) &&
        (value.toolName === undefined || typeof value.toolName === 'string') &&
        (value.status === undefined || typeof value.status === 'string') &&
        (value.durationMs === undefined || (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0));
    case 'extension':
      return isTranscriptExtension(value.extension);
    default:
      return false;
  }
}

/** 校验持久化子 Agent 事件的身份与判别式 payload，避免恢复时接收半结构记录。 */
function isSubagentTranscriptRecord(value: Record<string, unknown>): boolean {
  if (!isNonEmptyString(value.runId) || !isNonEmptyString(value.parentToolCallId) || !isNonEmptyString(value.agentName) || !isRecord(value.event)) {
    return false;
  }

  switch (value.event.kind) {
    case 'start':
      return isNonEmptyString(value.event.task);
    case 'reasoning_summary':
    case 'assistant':
      return true;
    case 'tool_call':
      return isNonEmptyString(value.event.toolCallId) && isNonEmptyString(value.event.toolName) && typeof value.event.argumentsText === 'string';
    case 'tool_result':
      return isNonEmptyString(value.event.toolCallId) &&
        isNonEmptyString(value.event.toolName) &&
        typeof value.event.ok === 'boolean' &&
        isToolResultDetails(value.event.details) &&
        (value.event.attachments === undefined || Array.isArray(value.event.attachments));
    case 'completed':
    case 'failed':
    case 'cancelled':
      return typeof value.event.durationMs === 'number' && Number.isFinite(value.event.durationMs) && value.event.durationMs >= 0;
    default:
      return false;
  }
}

function isUserTranscriptMetadata(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (value.interactionMode === undefined || isInteractionMode(value.interactionMode)) &&
    (value.modeTransition === undefined || isModeTransition(value.modeTransition)) &&
    (value.agentWorkflow === undefined || (isRecord(value.agentWorkflow) && value.agentWorkflow.source === 'builtin' && isNonEmptyString(value.agentWorkflow.name))) &&
    (value.skillInvocation === undefined || (isRecord(value.skillInvocation) && value.skillInvocation.source === 'slash' && isNonEmptyString(value.skillInvocation.skillName)));
}

function isModeTransition(value: unknown): boolean {
  return isRecord(value) &&
    (value.from === 'normal' || value.from === 'plan') &&
    (value.to === 'normal' || value.to === 'plan');
}

function isInteractionMode(value: unknown): boolean {
  return value === 'normal' || value === 'plan' || value === 'shell' || value === 'shell-local';
}

function isToolResultDetails(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.kind) {
    case 'generic':
    case 'apply_patch':
    case 'edit_file':
      return true;
    case 'bash':
      return true;
    case 'glob':
    case 'grep':
      return typeof value.truncated === 'boolean';
    case 'read_files':
      return typeof value.truncated === 'boolean';
    case 'web_fetch':
    case 'web_search':
      return typeof value.timedOut === 'boolean' &&
        typeof value.truncated === 'boolean';
    default:
      return false;
  }
}

function isTranscriptExtension(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.kind) {
    case 'openai_reasoning':
      return isRecord(value.item) && value.item.type === 'reasoning' && isNonEmptyString(value.item.encrypted_content);
    case 'openai_chat_reasoning':
      return typeof value.reasoningContent === 'string';
    case 'anthropic_thinking':
      return isAnthropicThinkingBlock(value.block);
    case 'unknown':
      return isNonEmptyString(value.name) && isRecord(value.payload);
    default:
      return false;
  }
}

function isAnthropicThinkingBlock(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === 'thinking') {
    return typeof value.thinking === 'string' && typeof value.signature === 'string';
  }

  return value.type === 'redacted_thinking' && typeof value.data === 'string';
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
      // 操作对象来自本次读取的解析产物，由重放核心独占，不需要再复制一份。
      // 逐条 push：单次操作可能包含整段历史（例如 fork 的初始快照），展开参数会超出引擎的实参上限。
      for (const record of operation.records) {
        state.records.push(record);
      }
      return true;
    case 'truncate_records':
      if (operation.recordCount > state.records.length) {
        return false;
      }

      state.records.length = operation.recordCount;
      return true;
    case 'set_change_history':
      state.changeHistory = operation.changeHistory;
      return true;
    case 'push_change_checkpoint':
      state.changeHistory.push(operation.checkpoint);
      return true;
    case 'pop_change_checkpoint':
      // 栈为空说明操作序列与 change history 起点不一致，按不可恢复处理而不是静默忽略。
      if (state.changeHistory.length === 0) {
        return false;
      }

      state.changeHistory.pop();
      return true;
    case 'set_compaction':
      state.compaction = operation.compaction;
      return true;
    case 'set_todo_state':
      state.todoState = operation.todoState;
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
  createPopChangeCheckpointOperation,
  createPushChangeCheckpointOperation,
  createRepairedJournalText,
  createSetChangeHistoryOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation,
  createTranscriptJournalEntry,
  createTranscriptJournalStart,
  createTruncateRecordsOperation,
  parseTranscriptJournalStart,
  replayTranscriptJournal,
  replayTranscriptJournalFile,
  replayTranscriptJournalStream,
  serializeTranscriptJournalLine
};
