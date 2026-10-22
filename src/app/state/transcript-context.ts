import {
  createAppendRecordsOperation,
  createBatchOperation,
  createPopChangeCheckpointOperation,
  createPushChangeCheckpointOperation,
  createSetChangeHistoryOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation,
  createTruncateRecordsOperation
} from '../../persistence/transcript-journal';
import {createCompactionNoticeRecord} from '../../agent/context/context-compaction';
import {cloneChangeHistory} from './change-history-context';
import {createSessionTitle} from '../../persistence/transcript-store';

import type {ChangeCheckpoint, ChangeHistoryDelta} from '../../types/change-history';
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
  TranscriptSessionJournalReference,
  TranscriptSessionDeleteResult,
  TranscriptStore
} from '../../types/transcript';

/**
 * 管理 transcript records、session journal 持久化和恢复。
 */
class TranscriptContext {
  transcriptStore: TranscriptStore;
  getCurrentCwd: () => string;
  private records: TranscriptRecord[]; // 完整有效历史的连续驻留后缀；完整历史只在显式历史操作中按需回读。
  baseRecordIndex = 0;
  private sessionTitle = '未命名对话';
  private firstUserRecordIndex: number | null = null; // 普通 Undo 按此完整位置判断缓存标题是否仍有效，无需回读旧原文。
  currentSession: TranscriptSessionJournalReference | null;
  currentSessionId: string | null;
  private sessionPreviewCache = new Map<string, TranscriptSessionPreview>();
  private readonly sessionPreviewCacheLimit = 5;
  changeHistory: ChangeCheckpoint[];
  compaction: CompactionState | null;
  todoState: TodoState;
  pendingChangeHistoryDeltas: ChangeHistoryDelta[]; // 尚未写出的增量，按应用顺序排列；写入失败时保留到下一次成功提交。
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
    this.pendingChangeHistoryDeltas = [];
    this.pendingTodoState = undefined;
  }

  /**
   * 返回当前驻留后缀引用，供 app 渲染层与 agent 输入快照读取；完整历史用 getCompleteRecords。
   */
  getResidentRecords(): TranscriptRecord[] {
    return this.records;
  }

  /** 返回完整有效历史的记录数；驻留数组只保存压缩边界之后的连续后缀。 */
  getRecordCount(): number {
    return this.baseRecordIndex + this.records.length;
  }

  /**
   * 显式历史操作按需回读完整 journal；结果由调用方临时持有，不重新装入驻留区。
   * 读不到、序列不一致或读取本身失败时返回 null，由调用方决定降级方式，且都不改写 journal。
   */
  getCompleteRecords(): TranscriptRecord[] | null {
    if (this.baseRecordIndex === 0) return this.records;
    if (!this.currentSessionId) return null;

    try {
      const loaded = this.transcriptStore.loadSessionReadOnly(this.getCurrentCwd(), this.currentSessionId);
      return loaded && loaded.reference.sequence === this.currentSession?.sequence ? loaded.session.records : null;
    } catch {
      // 展示与审批路径不应因历史读取失败崩溃；失败语义统一由 null 表达。
      return null;
    }
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
      // 调用方只把 session 投影成有界引用素材、不保留 session 本身，因此直接移交读取结果。
      session: loaded.session,
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
    if (!this.currentSession || this.getRecordCount() === 0) {
      return {ok: false, reason: 'empty'};
    }

    this.persistCurrentSession();
    const sourceSessionId = this.currentSession.sessionId;
    const completeRecords = this.getCompleteRecords();
    if (!completeRecords) {
      return {ok: false, reason: 'failed', error: '无法读取当前会话的完整历史'};
    }
    const operation = createBatchOperation([
      createAppendRecordsOperation(completeRecords),
      createSetChangeHistoryOperation(cloneChangeHistory(this.changeHistory)),
      createSetCompactionOperation(this.compaction ? {...this.compaction} : null),
      createSetTodoStateOperation(cloneTodoState(this.todoState))
    ]);
    const nextSession = this.transcriptStore.createSession(this.getCurrentCwd(), operation);

    this.currentSession = nextSession;
    this.currentSessionId = nextSession.sessionId;
    this.clearPendingState();
    this.updateSessionIndex(nextSession, this.getRecordCount(), this.sessionTitle);

    return {
      ok: true,
      sessionId: nextSession.sessionId,
      sourceSessionId
    };
  }

  /**
   * 从持久化历史恢复状态，只安装活跃后缀并返回是否成功，不额外复制会话作为返回值。
   */
  loadSession(sessionId: string): boolean {
    const loaded = this.transcriptStore.loadSession(this.getCurrentCwd(), sessionId);

    if (!loaded) {
      return false;
    }

    const session = loaded.session;
    this.baseRecordIndex = session.compaction?.activeStartIndex ?? 0;
    // 读取结果由本次恢复独占，直接安装活跃后缀即可，不需要再复制一份等量记录。
    this.records = session.records.slice(this.baseRecordIndex);
    this.sessionTitle = createSessionTitle(session.records);
    const firstUserIndex = session.records.findIndex((record) => record.role === 'user');
    this.firstUserRecordIndex = firstUserIndex < 0 ? null : firstUserIndex;
    this.currentSession = loaded.reference;
    this.currentSessionId = loaded.reference.sessionId;
    this.changeHistory = cloneChangeHistory(session.changeHistory);
    this.compaction = session.compaction ? {...session.compaction} : null;
    this.todoState = cloneTodoState(session.todoState);
    this.clearPendingState();

    return true;
  }

  /**
   * 删除当前 cwd 中的历史 session，并保护仍由当前 transcript 持有写入 reference 的 journal。
   */
  deleteSession(sessionId: string): TranscriptSessionDeleteResult {
    if (sessionId === this.currentSessionId) {
      return {ok: false, reason: 'current'};
    }

    const result = this.transcriptStore.deleteSession(this.getCurrentCwd(), sessionId);
    if (result.ok) {
      this.evictSessionPreview(result.sessionId);
    }

    return result;
  }

  /**
   * 清空当前 transcript records，并把当前持久化 session 指针和压缩状态解绑。
   */
  clearRecords(): void {
    this.records.length = 0;
    this.baseRecordIndex = 0;
    this.sessionTitle = '未命名对话';
    this.firstUserRecordIndex = null;
    this.currentSession = null;
    this.currentSessionId = null;
    this.changeHistory = [];
    this.compaction = null;
    this.todoState = createEmptyTodoState();
    this.clearPendingState();
  }

  /**
   * 按完整历史位置回退；目标后缀仍驻留时直接截取，跨边界时只使用调用方在恢复文件前预读的完整历史。
   * 跨边界却缺少完整历史时抛错，不隐式回读，也不把与起点不一致的后缀安装进状态。
   * change history 固定按"弹出栈顶一个 checkpoint"回退：唯一调用方 /undo 每次只回退一轮。
   */
  restoreToBoundary(recordCount: number, compaction: CompactionState | undefined, completeRecords?: TranscriptRecord[]): void {
    const nextCount = Math.min(Math.max(0, Math.floor(recordCount)), this.getRecordCount());
    const nextCompaction = compaction ? {...compaction} : null;
    const nextBase = nextCompaction?.activeStartIndex ?? 0;
    const needsHistory = nextBase < this.baseRecordIndex;
    let sourceRecords: TranscriptRecord[];
    let sourceBase: number;

    if (needsHistory) {
      if (!completeRecords) {
        throw new Error('回退到驻留边界之前需要调用方预读的完整历史');
      }
      sourceRecords = completeRecords;
      sourceBase = 0;
    } else {
      sourceRecords = this.records;
      sourceBase = this.baseRecordIndex;
    }

    const nextRecords = sourceRecords.slice(nextBase - sourceBase, nextCount - sourceBase);
    // 普通截尾不需要旧原文；用首条用户的完整位置判断缓存标题是否仍然有效。
    const firstUserIndex = needsHistory ? sourceRecords.findIndex((record) => record.role === 'user') : this.firstUserRecordIndex;
    const nextFirstUserIndex = firstUserIndex !== null && firstUserIndex >= 0 && firstUserIndex < nextCount ? firstUserIndex : null;
    const nextTitle = nextFirstUserIndex === null ? '未命名对话' : needsHistory ? createSessionTitle(sourceRecords) : this.sessionTitle;
    // 栈为空时"弹出栈顶"没有可回退的 checkpoint：内存上是空操作，写进 journal 却会让重放判定不可恢复。
    const popsChangeCheckpoint = this.changeHistory.length > 0;
    const nextOperations: TranscriptJournalSubOperation[] = [
      createTruncateRecordsOperation(nextCount),
      createSetCompactionOperation(nextCompaction)
    ];

    // 先补齐此前写入失败、尚未落盘的增量，再写弹出；顺序反了会让重放看到没有对应 checkpoint 的 pop。
    for (const delta of this.pendingChangeHistoryDeltas) {
      nextOperations.push(createChangeHistoryDeltaOperation(delta));
    }

    if (popsChangeCheckpoint) {
      nextOperations.push(createPopChangeCheckpointOperation());
    }

    const operation = createBatchOperation(nextOperations);

    if (this.currentSession) {
      this.currentSession = this.transcriptStore.appendSession(this.getCurrentCwd(), this.currentSession, operation);
      this.currentSessionId = this.currentSession.sessionId;
      this.updateSessionIndex(this.currentSession, nextCount, nextTitle);
    }

    this.baseRecordIndex = nextBase;
    this.records = nextRecords;
    this.sessionTitle = nextTitle;
    this.firstUserRecordIndex = nextFirstUserIndex;
    this.compaction = nextCompaction;

    if (popsChangeCheckpoint) {
      this.changeHistory.pop();
    }

    this.pendingChangeHistoryDeltas = [];
  }

  /**
   * 安装一次 change history 增量：同步镜像栈并记为待写操作，调用方决定何时追加独立状态操作。
   * 增量只在安装时应用一次，写入失败后的重试只重写 journal；失败期间又产生新增量时两者都保留，不会互相覆盖。
   */
  stageChangeHistoryDelta(delta: ChangeHistoryDelta): void {
    applyChangeHistoryDelta(this.changeHistory, delta);
    this.pendingChangeHistoryDeltas.push(delta);
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
   * 先提交压缩状态与提示，再释放已被摘要覆盖的前缀；写盘失败保持原驻留状态。
   */
  applyCompaction(compaction: CompactionState): TranscriptRecord {
    if (compaction.activeStartIndex < this.baseRecordIndex || compaction.activeStartIndex > this.getRecordCount()) {
      throw new Error('压缩边界不在当前驻留记录区内');
    }
    const notice = createCompactionNoticeRecord(compaction);
    this.persistOperation([notice], compaction);
    this.records.push(notice);
    this.records.splice(0, compaction.activeStartIndex - this.baseRecordIndex);
    this.baseRecordIndex = compaction.activeStartIndex;
    this.compaction = {...compaction};
    return notice;
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

  /** 增量提交新事实及本次采纳的摘要，成功后更新轻量索引并清空待写状态，不读取完整 journal。 */
  private persistOperation(records: TranscriptRecord[], compaction?: CompactionState): void {
    const operation = this.createPendingOperation(records, compaction);

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
    if (this.firstUserRecordIndex === null) {
      const firstUserIndex = records.findIndex((record) => record.role === 'user');
      if (firstUserIndex >= 0) {
        this.firstUserRecordIndex = this.getRecordCount() + firstUserIndex;
        this.sessionTitle = createSessionTitle(records);
      }
    }
    this.updateSessionIndex(this.currentSession, this.getRecordCount() + records.length, this.sessionTitle);
    this.clearPendingState();
  }

  /** index 是可重建缓存，维护失败不得改变已经提交的 journal 和内存状态。 */
  private updateSessionIndex(reference: TranscriptSessionJournalReference, messageCount: number, title: string): void {
    try {
      this.transcriptStore.updateSessionIndex(this.getCurrentCwd(), reference, {messageCount, title});
    } catch {
      // 下一次 /resume 会通过 journal 指纹重建缺失或过期条目。
    }
  }

  /** 删除指定 session 的所有缓存版本，防止已移除 journal 的预览被后续 surface 复用。 */
  private evictSessionPreview(sessionId: string): void {
    const cachePrefix = `${this.getCurrentCwd()}:${sessionId}:`;

    for (const cacheKey of this.sessionPreviewCache.keys()) {
      if (cacheKey.startsWith(cachePrefix)) {
        this.sessionPreviewCache.delete(cacheKey);
      }
    }
  }

  /** 合并新记录、当前摘要采纳和待写状态，确保一次追加使用同一个 journal batch。 */
  private createPendingOperation(records: TranscriptRecord[], compaction?: CompactionState): TranscriptJournalOperation | null {
    const operations: TranscriptJournalSubOperation[] = [];

    if (records.length > 0) {
      operations.push(createAppendRecordsOperation(records));
    }

    for (const delta of this.pendingChangeHistoryDeltas) {
      operations.push(createChangeHistoryDeltaOperation(delta));
    }

    if (compaction !== undefined) {
      operations.push(createSetCompactionOperation(compaction));
    }

    if (this.pendingTodoState !== undefined) {
      operations.push(createSetTodoStateOperation(this.pendingTodoState));
    }

    if (operations.length === 0) {
      return null;
    }

    return operations.length === 1 ? operations[0] : createBatchOperation(operations);
  }

  /** 已提交或切换会话后清空待写状态，不改变已安装的 transcript。 */
  private clearPendingState(): void {
    this.pendingChangeHistoryDeltas = [];
    this.pendingTodoState = undefined;
  }
}

export {
  TranscriptContext,
  cloneTodoState,
  createEmptyTodoState
};

/**
 * 把增量应用到镜像栈；与 journal 重放保持同一组语义，避免内存栈与已写操作分叉。
 */
function applyChangeHistoryDelta(history: ChangeCheckpoint[], delta: ChangeHistoryDelta): void {
  switch (delta.kind) {
    case 'push':
      history.push(delta.checkpoint);
      return;
    case 'pop':
      history.pop();
      return;
    case 'reset':
      history.length = 0;
      // 逐条 push：整份替换可能来自 fork 初始快照，展开参数会超出引擎的实参上限。
      for (const checkpoint of delta.history) {
        history.push(checkpoint);
      }
      return;
  }
}

/** 把 change history 增量映射为对应的 journal 子操作。 */
function createChangeHistoryDeltaOperation(delta: ChangeHistoryDelta): TranscriptJournalSubOperation {
  switch (delta.kind) {
    case 'push':
      return createPushChangeCheckpointOperation(delta.checkpoint);
    case 'pop':
      return createPopChangeCheckpointOperation();
    case 'reset':
      return createSetChangeHistoryOperation(delta.history);
  }
}

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
