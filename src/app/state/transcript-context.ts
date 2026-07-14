import {cloneChangeHistory} from './change-history-context';
import type {ChangeCheckpoint} from '../../types/change-history';
import type {
  CompactionState,
  TodoState,
  TranscriptRecord,
  TranscriptSession,
  TranscriptSessionMetadata,
  TranscriptStore
} from '../../types/transcript';

/**
 * 管理 transcript records、session 持久化和恢复。
 */
class TranscriptContext {
  transcriptStore: TranscriptStore;
  getCurrentCwd: () => string;
  records: TranscriptRecord[];
  currentSession: TranscriptSession | null;
  currentSessionId: string | null;
  changeHistory: ChangeCheckpoint[];
  compaction: CompactionState | null;
  todoState: TodoState;

  constructor(transcriptStore: TranscriptStore, getCurrentCwd: () => string) {
    this.transcriptStore = transcriptStore;
    this.getCurrentCwd = getCurrentCwd;
    this.records = [];
    this.currentSession = null;
    this.currentSessionId = null;
    this.changeHistory = [];
    this.compaction = null;
    this.todoState = createEmptyTodoState();
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
   * 列出当前 cwd 下可恢复的会话 metadata。
   */
  listResumeSessions(): TranscriptSessionMetadata[] {
    return this.transcriptStore.listSessions(this.getCurrentCwd()).map((session) => ({
      ...session,
      previewRecords: session.previewRecords.map((record) => ({...record}))
    }));
  }

  /**
   * 把当前可见 transcript records 保存到当前持久化 session；空 transcript 不落盘。
   */
  persistCurrentSession(): TranscriptSession | null {
    if (this.records.length === 0 && !this.currentSession) {
      return null;
    }

    const currentCwd = this.getCurrentCwd();
    const records = structuredClone(this.records);
    const changeHistory = cloneChangeHistory(this.changeHistory);
    const compaction = this.compaction ? {...this.compaction} : undefined;
    const todoState = cloneTodoState(this.todoState);
    const nextSession = this.currentSession && this.currentSessionId
      ? {
        ...this.currentSession,
        sessionId: this.currentSessionId,
        cwd: currentCwd,
        updatedAt: new Date().toISOString(),
        records,
        ...(changeHistory.length > 0 ? {changeHistory} : {}),
        ...(compaction ? {compaction} : {}),
        todoState
      }
      : {
        ...this.transcriptStore.createSession(currentCwd, records),
        ...(changeHistory.length > 0 ? {changeHistory} : {}),
        ...(compaction ? {compaction} : {}),
        todoState
      };

    if (changeHistory.length === 0) {
      delete (nextSession as {changeHistory?: ChangeCheckpoint[]}).changeHistory;
    }

    const savedSession = this.transcriptStore.saveSession(currentCwd, nextSession);

    this.currentSession = {
      ...savedSession,
      records: structuredClone(savedSession.records || [])
    };
    this.currentSessionId = this.currentSession.sessionId;
    this.changeHistory = cloneChangeHistory(savedSession.changeHistory);
    this.compaction = savedSession.compaction ? {...savedSession.compaction} : null;
    this.todoState = cloneTodoState(savedSession.todoState);

    return this.currentSession;
  }

  /**
   * 从持久化存储加载 session，并用其 transcript records 替换当前可见 transcript。
   */
  loadSession(sessionId: string): TranscriptSession | null {
    const loadedSession = this.transcriptStore.loadSession(this.getCurrentCwd(), sessionId);

    if (!loadedSession) {
      return null;
    }

    this.records.length = 0;
    this.records.push(...structuredClone(loadedSession.records || []));
    this.currentSession = {
      ...loadedSession,
      records: structuredClone(this.records)
    };
    this.currentSessionId = this.currentSession.sessionId;
    this.changeHistory = cloneChangeHistory(loadedSession.changeHistory);
    this.compaction = loadedSession.compaction ? {...loadedSession.compaction} : null;
    this.todoState = cloneTodoState(loadedSession.todoState);

    return this.currentSession;
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
  }

  /**
   * 把当前 transcript 恢复到指定记录边界，并同步恢复压缩状态。
   */
  restoreToBoundary(recordCount: number, compaction: CompactionState | undefined): TranscriptSession | null {
    const nextCount = Math.min(Math.max(0, Math.floor(recordCount)), this.records.length);
    this.records.length = nextCount;
    this.compaction = compaction ? {...compaction} : null;

    if (!this.currentSession || !this.currentSessionId) {
      return this.persistCurrentSession();
    }

    const currentCwd = this.getCurrentCwd();
    const changeHistory = cloneChangeHistory(this.changeHistory);
    const nextSession = {
      ...this.currentSession,
      sessionId: this.currentSessionId,
      cwd: currentCwd,
      updatedAt: new Date().toISOString(),
      records: structuredClone(this.records),
      ...(changeHistory.length > 0 ? {changeHistory} : {}),
      ...(this.compaction ? {compaction: {...this.compaction}} : {}),
      todoState: cloneTodoState(this.todoState)
    };

    if (changeHistory.length === 0) {
      delete (nextSession as {changeHistory?: ChangeCheckpoint[]}).changeHistory;
    }

    if (!this.compaction) {
      delete (nextSession as {compaction?: CompactionState}).compaction;
    }

    const savedSession = this.transcriptStore.saveSession(currentCwd, nextSession);
    this.currentSession = {
      ...savedSession,
      records: structuredClone(savedSession.records || [])
    };
    this.currentSessionId = this.currentSession.sessionId;
    this.changeHistory = cloneChangeHistory(savedSession.changeHistory);
    this.compaction = savedSession.compaction ? {...savedSession.compaction} : null;
    this.todoState = cloneTodoState(savedSession.todoState);

    return this.currentSession;
  }

  /**
   * 仅更新内存中的压缩状态，不单独落盘；由紧随的 appendRecord 一次性把
   * compaction 与 compaction_notice 记录原子持久化，避免重复全量写。
   */
  setCompaction(compaction: CompactionState): void {
    this.compaction = {...compaction};
  }

  /**
   * 更新当前 session 关联的 change history；调用方决定是否立即持久化。
   */
  setChangeHistory(changeHistory: ChangeCheckpoint[] | null | undefined): void {
    this.changeHistory = cloneChangeHistory(changeHistory);
  }

  /**
   * 更新当前会话的结构化 todo 状态；调用方决定是否需要立即持久化。
   */
  setTodoState(todoState: TodoState | null | undefined): void {
    this.todoState = cloneTodoState(todoState);
  }

  /**
   * 向当前 transcript 追加记录并立即同步当前 session。
   */
  appendRecord(record: TranscriptRecord): TranscriptRecord {
    this.records.push(record);
    this.persistCurrentSession();
    return record;
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
