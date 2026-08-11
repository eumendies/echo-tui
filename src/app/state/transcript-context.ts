import {
  createAppendRecordsOperation,
  createBatchOperation,
  createSetChangeHistoryOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation,
  createTruncateRecordsOperation
} from '../../persistence/transcript-journal';
import {createCompactionNoticeRecord} from '../../agent/context/context-compaction';
import {cloneChangeHistory} from './change-history-context';

import type {ChangeCheckpoint} from '../../types/change-history';
import type {
  CompactionState,
  ConversationReferenceSource,
  TodoState,
  TranscriptJournalOperation,
  TranscriptJournalSubOperation,
  TranscriptForkResult,
  TranscriptRecord,
  TranscriptSessionSummary,
  TranscriptSessionPreview,
  TranscriptSession,
  TranscriptSessionJournalReference,
  TranscriptStore
} from '../../types/transcript';

/**
 * 管理 transcript records、session journal 持久化和恢复。
 */
class TranscriptContext {
  transcriptStore: TranscriptStore;
  getCurrentCwd: () => string;
  records: TranscriptRecord[];
  currentSession: TranscriptSessionJournalReference | null;
  currentSessionId: string | null;
  private sessionPreviewCache = new Map<string, TranscriptSessionPreview>();
  private readonly sessionPreviewCacheLimit = 5;
  changeHistory: ChangeCheckpoint[];
  compaction: CompactionState | null;
  todoState: TodoState;
  pendingChangeHistory: ChangeCheckpoint[] | undefined;
  pendingCompaction: CompactionState | null | undefined;
  pendingTodoState: TodoState | undefined;

  constructor(transcriptStore: TranscriptStore, getCurrentCwd: () => string) {
    this.transcriptStore = transcriptStore;
    this.getCurrentCwd = getCurrentCwd;
    this.records = [];
    this.currentSession = null;
    this.currentSessionId = null;
    this.changeHistory = [];
    this.compaction = null;
    this.todoState = createEmptyTodoState();
    this.pendingChangeHistory = undefined;
    this.pendingCompaction = undefined;
    this.pendingTodoState = undefined;
  }

  /**
   * 返回当前 transcript records 引用，供 app 渲染层读取。
   */
  getRecords(): TranscriptRecord[] {
    return this.records;
  }

  /**
   * 返回当前持久化 session id；新会话尚未首次落盘时返回 null。
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 返回当前 session journal 的绝对路径；新会话尚未首次落盘时返回 undefined。
   */
  getCurrentSessionJournalPath(): string | undefined {
    return this.currentSessionId
      ? this.transcriptStore.getSessionFilePath(this.getCurrentCwd(), this.currentSessionId)
      : undefined;
  }

  /**
   * 列出当前 cwd 下供恢复和引用入口复用的轻量 session 摘要。
   */
  listSessionSummaries(): TranscriptSessionSummary[] {
    return this.transcriptStore.listSessionSummaries(this.getCurrentCwd()).map((session) => ({
      ...session,
      fingerprint: {...session.fingerprint}
    }));
  }

  /**
   * 列出可作为附件的历史会话；当前 session 不允许自引用。
   */
  listReferenceSessions(): TranscriptSessionSummary[] {
    return this.transcriptStore.listSessionSummaries(this.getCurrentCwd())
      .filter((session) => session.sessionId !== this.currentSessionId)
      .map((session) => ({
        ...session,
        fingerprint: {...session.fingerprint}
      }));
  }

  /**
   * 只读加载一个会话候选的有界预览，并按 cwd 与文件指纹共享 LRU 缓存。
   */
  async loadSessionPreview(candidate: TranscriptSessionSummary): Promise<TranscriptSessionPreview | null> {
    const cwd = this.getCurrentCwd();
    if (candidate.cwd !== cwd) {
      return null;
    }

    const cacheKey = `${cwd}:${candidate.sessionId}:${candidate.fingerprint.size}:${candidate.fingerprint.mtimeMs}`;
    const cached = this.sessionPreviewCache.get(cacheKey);
    if (cached) {
      this.sessionPreviewCache.delete(cacheKey);
      this.sessionPreviewCache.set(cacheKey, cached);
      return structuredClone(cached);
    }

    const preview = await this.transcriptStore.loadSessionPreview(cwd, candidate.sessionId);
    if (!preview || preview.sessionId !== candidate.sessionId) {
      return null;
    }

    this.sessionPreviewCache.set(cacheKey, structuredClone(preview));
    while (this.sessionPreviewCache.size > this.sessionPreviewCacheLimit) {
      const oldestKey = this.sessionPreviewCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.sessionPreviewCache.delete(oldestKey);
    }

    return structuredClone(preview);
  }

  /**
   * 只读加载历史会话，不改变当前 transcript、compaction 或 journal 指针。
   */
  loadReferenceSession(candidate: TranscriptSessionSummary): ConversationReferenceSource | null {
    if (candidate.sessionId === this.currentSessionId || candidate.cwd !== this.getCurrentCwd()) {
      return null;
    }

    const loaded = this.transcriptStore.loadSessionReadOnly(this.getCurrentCwd(), candidate.sessionId);

    if (!loaded || loaded.session.sessionId !== candidate.sessionId || loaded.session.cwd !== candidate.cwd) {
      return null;
    }

    return {
      session: structuredClone(loaded.session),
      sourcePath: this.transcriptStore.getSessionFilePath(this.getCurrentCwd(), candidate.sessionId),
      title: candidate.title
    };
  }

  /**
   * 将待写状态追加为单个 journal 操作；没有变化时不触发文件 I/O。
   */
  persistCurrentSession(): void {
    this.persistOperation([]);
  }

  /**
   * 将当前稳定会话保存为自包含快照，并在新 journal 原子创建成功后切换持久化指针。
   */
  forkSession(): TranscriptForkResult {
    if (!this.currentSession || this.records.length === 0) {
      return {ok: false, reason: 'empty'};
    }

    this.persistCurrentSession();
    const sourceSessionId = this.currentSession.sessionId;
    const operation = createBatchOperation([
      createAppendRecordsOperation(structuredClone(this.records)),
      createSetChangeHistoryOperation(cloneChangeHistory(this.changeHistory)),
      createSetCompactionOperation(this.compaction ? {...this.compaction} : null),
      createSetTodoStateOperation(cloneTodoState(this.todoState))
    ]);
    const nextSession = this.transcriptStore.createSession(this.getCurrentCwd(), operation);

    this.currentSession = nextSession;
    this.currentSessionId = nextSession.sessionId;
    this.clearPendingState();
    this.updateSessionIndex(nextSession, this.records);

    return {
      ok: true,
      sessionId: nextSession.sessionId,
      sourceSessionId
    };
  }

  /**
   * 从持久化存储加载 session，并用其 transcript records 替换当前可见 transcript。
   */
  loadSession(sessionId: string): TranscriptSession | null {
    const loaded = this.transcriptStore.loadSession(this.getCurrentCwd(), sessionId);

    if (!loaded) {
      return null;
    }

    const session = loaded.session;
    this.records.length = 0;
    this.records.push(...structuredClone(session.records || []));
    this.currentSession = loaded.reference;
    this.currentSessionId = loaded.reference.sessionId;
    this.changeHistory = cloneChangeHistory(session.changeHistory);
    this.compaction = session.compaction ? {...session.compaction} : null;
    this.todoState = cloneTodoState(session.todoState);
    this.clearPendingState();

    return structuredClone(session);
  }

  /**
   * 清空当前 transcript records，并把当前持久化 session 指针和压缩状态解绑。
   */
  clearRecords(): void {
    this.records.length = 0;
    this.currentSession = null;
    this.currentSessionId = null;
    this.changeHistory = [];
    this.compaction = null;
    this.todoState = createEmptyTodoState();
    this.clearPendingState();
  }

  /**
   * 把当前 transcript 回退到指定边界，并以单个 batch 同步保存 compaction 与 change history。
   */
  restoreToBoundary(recordCount: number, compaction: CompactionState | undefined, changeHistory = this.changeHistory): void {
    const nextCount = Math.min(Math.max(0, Math.floor(recordCount)), this.records.length);
    const nextCompaction = compaction ? {...compaction} : null;
    const nextChangeHistory = cloneChangeHistory(changeHistory);
    const operation = createBatchOperation([
      createTruncateRecordsOperation(nextCount),
      createSetCompactionOperation(nextCompaction),
      createSetChangeHistoryOperation(nextChangeHistory)
    ]);

    if (this.currentSession) {
      this.currentSession = this.transcriptStore.appendSession(this.getCurrentCwd(), this.currentSession, operation);
      this.currentSessionId = this.currentSession.sessionId;
      this.updateSessionIndex(this.currentSession, this.records.slice(0, nextCount));
    }

    this.records.length = nextCount;
    this.compaction = nextCompaction;
    this.changeHistory = nextChangeHistory;
    this.pendingCompaction = undefined;
    this.pendingChangeHistory = undefined;
  }

  /**
   * 仅更新内存中的压缩状态；紧随其后的 record append 会一起写入 batch。
   */
  setCompaction(compaction: CompactionState): void {
    this.compaction = {...compaction};
    this.pendingCompaction = {...compaction};
  }

  /**
   * 更新当前 session 关联的 change history；调用方决定何时追加独立状态操作。
   */
  setChangeHistory(changeHistory: ChangeCheckpoint[] | null | undefined): void {
    this.changeHistory = cloneChangeHistory(changeHistory);
    this.pendingChangeHistory = cloneChangeHistory(this.changeHistory);
  }

  /**
   * 更新当前会话的结构化 todo 状态；调用方决定何时追加独立状态操作。
   */
  setTodoState(todoState: TodoState | null | undefined): void {
    this.todoState = cloneTodoState(todoState);
    this.pendingTodoState = cloneTodoState(this.todoState);
  }

  /**
   * 更新 todo 状态并立即持久化独立 journal 操作，避免调用方拆开状态与落盘步骤。
   */
  updateTodoState(todoState: TodoState): void {
    this.setTodoState(todoState);
    this.persistCurrentSession();
  }

  /**
   * 应用压缩边界并将可见提示与状态写入同一个 journal batch。
   */
  applyCompaction(compaction: CompactionState): TranscriptRecord {
    this.setCompaction(compaction);
    return this.appendRecord(createCompactionNoticeRecord(compaction));
  }

  /**
   * 向当前 transcript 追加单条记录并立即同步当前 session journal。
   */
  appendRecord<Record extends TranscriptRecord>(record: Record): Record {
    this.appendRecords([record]);
    return record;
  }

  /**
   * 成组追加 records，供相邻 tool pair 和 provider records 共用一次 journal 写入。
   */
  appendRecords(records: TranscriptRecord[]): TranscriptRecord[] {
    if (records.length === 0) {
      return records;
    }

    this.persistOperation(records);
    this.records.push(...records);
    return records;
  }

  private persistOperation(records: TranscriptRecord[]): void {
    const operation = this.createPendingOperation(records);

    if (!operation) {
      return;
    }

    if (this.currentSession) {
      this.currentSession = this.transcriptStore.appendSession(this.getCurrentCwd(), this.currentSession, operation);
    } else if (records.length > 0) {
      this.currentSession = this.transcriptStore.createSession(this.getCurrentCwd(), operation);
    } else {
      return;
    }

    this.currentSessionId = this.currentSession.sessionId;
    this.updateSessionIndex(this.currentSession, records.length > 0 ? [...this.records, ...records] : this.records);
    this.clearPendingState();
  }

  /** index 是可重建缓存，维护失败不得改变已经提交的 journal 和内存状态。 */
  private updateSessionIndex(reference: TranscriptSessionJournalReference, records: TranscriptRecord[]): void {
    try {
      this.transcriptStore.updateSessionIndex(this.getCurrentCwd(), reference, records);
    } catch {
      // 下一次 /resume 会通过 journal 指纹重建缺失或过期条目。
    }
  }

  private createPendingOperation(records: TranscriptRecord[]): TranscriptJournalOperation | null {
    const operations: TranscriptJournalSubOperation[] = [];

    if (records.length > 0) {
      operations.push(createAppendRecordsOperation(records));
    }

    if (this.pendingChangeHistory !== undefined) {
      operations.push(createSetChangeHistoryOperation(this.pendingChangeHistory));
    }

    if (this.pendingCompaction !== undefined) {
      operations.push(createSetCompactionOperation(this.pendingCompaction));
    }

    if (this.pendingTodoState !== undefined) {
      operations.push(createSetTodoStateOperation(this.pendingTodoState));
    }

    if (operations.length === 0) {
      return null;
    }

    return operations.length === 1 ? operations[0] : createBatchOperation(operations);
  }

  private clearPendingState(): void {
    this.pendingChangeHistory = undefined;
    this.pendingCompaction = undefined;
    this.pendingTodoState = undefined;
  }
}

export {
  TranscriptContext,
  cloneTodoState,
  createEmptyTodoState
};

function createEmptyTodoState(): TodoState {
  return {
    items: [],
    updatedAt: ''
  };
}

function cloneTodoState(todoState: TodoState | null | undefined): TodoState {
  if (!todoState || !Array.isArray(todoState.items)) {
    return createEmptyTodoState();
  }

  return {
    updatedAt: typeof todoState.updatedAt === 'string' ? todoState.updatedAt : '',
    items: todoState.items
      .filter((item) => item && typeof item.id === 'string' && typeof item.text === 'string' && (item.status === 'open' || item.status === 'completed'))
      .map((item) => ({
        id: item.id,
        text: item.text,
        status: item.status
      }))
  };
}
