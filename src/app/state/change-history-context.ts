import path from 'node:path';
import {getSnapshotFingerprint, readChangeFileState, restoreChangeFileSnapshot} from './change-file-state';

import type {CompactionState} from '../../types/transcript';
import type {
  ChangeCheckpoint,
  ChangeFileRecorder,
  ChangeFileSnapshot,
  ChangeHistoryDelta,
  UndoExecuteResult,
  UndoSummary,
  UndoUnavailableSummary
} from '../../types/change-history';

type BeginChangeCheckpointOptions = {
  compactionBefore?: CompactionState; // 本轮开始前的上下文压缩位置。
  cwd: string; // 受控编辑所属工作目录。
  transcriptStartIndex: number; // 本轮 user record 之前的完整历史边界。
};

type UndoAvailability = UndoUnavailableSummary | {
  status: 'ready'; // 栈顶符合恢复策略，展示投影和执行入口共用此资格。
  checkpoint: ChangeCheckpoint; // 通过策略核验的真实恢复目标。
};

const MAX_UNDO_CONFLICT_PATHS = 5;

/**
 * 管理 assistant loop 的文件变更 checkpoint；同一份 history 服务 `/undo` 和 `/diff` fallback。
 */
class ChangeHistoryContext {
  current: ChangeCheckpoint | null;
  history: ChangeCheckpoint[];

  constructor() {
    this.current = null;
    this.history = [];
  }

  /**
   * 返回当前可见的栈顶 checkpoint，供兼容旧调用点和测试断言使用。
   */
  get last(): ChangeCheckpoint | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  /**
   * 开始记录一轮 assistant loop，边界取调用时的 transcript 和 compaction 状态。
   */
  beginCheckpoint(options: BeginChangeCheckpointOptions): ChangeCheckpoint {
    const checkpoint: ChangeCheckpoint = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      cwd: options.cwd,
      transcriptStartIndex: options.transcriptStartIndex,
      ...(options.compactionBefore ? {compactionBefore: {...options.compactionBefore}} : {}),
      files: [],
      status: 'recording'
    };

    this.current = checkpoint;
    return checkpoint;
  }

  /**
   * 完成当前 checkpoint；ready 进入栈顶，invalid 则成为阻断更早历史的边界。
   * 返回值是本次栈改动的增量，供调用方写成 journal 操作；没有改动（例如重复调用）时返回 null。
   */
  finalizeCheckpoint(): ChangeHistoryDelta | null {
    if (!this.current) {
      return null;
    }

    const checkpoint = this.current;
    this.current = null;

    if (checkpoint.status === 'recording') {
      checkpoint.status = 'ready';
    }

    if (checkpoint.status === 'invalid') {
      this.history = [checkpoint];
      return {kind: 'reset', history: [...this.history]};
    }

    this.history.push(checkpoint);
    return {kind: 'push', checkpoint};
  }

  /**
   * 标记当前或栈顶 checkpoint 不可回退，并丢弃它之前的历史。
   * 不产生增量：清空后的栈由随后的 finalizeCheckpoint() 以 reset 增量表达。
   */
  invalidate(reason: string): void {
    const checkpoint = this.current || this.last;

    if (!checkpoint || checkpoint.status !== 'recording') {
      return;
    }

    checkpoint.status = 'invalid';
    checkpoint.invalidReason = reason;

    if (this.current) {
      this.history = [];
      return;
    }

    this.history = [checkpoint];
  }

  /**
   * 标记本轮存在范围外操作；继续收集受控编辑，后续回退按各轮文件指纹检查。
   */
  markUntracked(reason: string): void {
    if (this.current?.status === 'recording') {
      this.current.untrackedReason ??= reason;
    }
  }

  /**
   * 创建工具使用的记录器，区分快照失败与仍允许有限恢复的范围外操作。
   */
  createRecorder(): ChangeFileRecorder {
    return {
      captureFileBefore: (filePath: string) => this.captureFileBefore(filePath),
      captureFileAfter: (filePath: string) => this.captureFileAfter(filePath),
      invalidate: (reason: string) => this.invalidate(reason),
      markUntracked: (reason: string) => this.markUntracked(reason)
    };
  }

  /**
   * 用持久化历史恢复 checkpoint 栈；不包含 recording 状态。
   */
  restoreHistory(history: ChangeCheckpoint[] | null | undefined): void {
    this.current = null;
    this.history = cloneChangeHistory(history);
  }

  /**
   * 返回当前可持久化历史视图；调用方可用于 session 保存和 diff fallback。
   */
  getHistory(): ChangeCheckpoint[] {
    return cloneChangeHistory(this.history);
  }

  /**
   * 统一判断恢复资格；只有真实失效或未追踪影响下的旧记录缺失指纹时拒绝，不依赖展示字段。
   */
  private describeUndoAvailability(): UndoAvailability {
    const checkpoint = this.last;

    if (!checkpoint || checkpoint.status === 'used') {
      return {status: 'none'};
    }

    if (checkpoint.status === 'invalid') {
      return {status: 'invalid', reason: checkpoint.invalidReason || '上一轮包含不可安全回退的操作'};
    }

    if (checkpoint.status !== 'ready') {
      return {status: 'none'};
    }

    if ((checkpoint.untrackedReason || checkpoint.untrackedEffects) && checkpoint.files.some((file) => file.state !== 'pending' && file.afterFingerprint === undefined)) {
      return {status: 'invalid', reason: '旧记录无法检查 Shell 操作后的文件变化，无法回退。'};
    }
    return {status: 'ready', checkpoint};
  }

  /** 将恢复资格投影为确认面板摘要；不读文件系统，也不让文案参与执行策略。 */
  getSummary(): UndoSummary {
    const available = this.describeUndoAvailability();
    if (available.status !== 'ready') return available;
    const checkpoint = available.checkpoint;
    let fileCount = 0;
    let restoreFileCount = 0;
    let deleteFileCount = 0;
    let uncheckedFileCount = 0;
    for (const file of checkpoint.files) {
      if (file.state === 'pending') continue;
      fileCount += 1;
      if (file.state === 'created') deleteFileCount += 1;
      else restoreFileCount += 1;
      if (file.afterFingerprint === undefined) uncheckedFileCount += 1;
    }
    return {
      status: 'ready',
      checkpointId: checkpoint.id,
      deleteFileCount,
      fileCount,
      restoreFileCount,
      ...(checkpoint.untrackedReason ? {untrackedReason: checkpoint.untrackedReason} : {}),
      ...(checkpoint.untrackedEffects === 'notice' ? {undoneUntrackedNotice: '此前 Shell 操作的影响仍可能保留。'} : {}),
      ...(uncheckedFileCount > 0 ? {uncheckedFileCount} : {})
    };
  }

  /**
   * 先统一核验最后一次受控编辑后的指纹，再同步恢复文件；冲突时不写入任何路径。
   * 不依赖终端状态，transcript 回退由 AppContext 在文件恢复成功后串联执行。
   */
  executeUndo(): UndoExecuteResult {
    const available = this.describeUndoAvailability();
    if (available.status === 'invalid') {
      return {ok: false, reason: 'invalid', message: available.reason};
    }
    if (available.status === 'none') {
      return {ok: false, reason: 'none', message: '暂无可回退的上一轮修改'};
    }
    const checkpoint = available.checkpoint;

    const entries = checkpoint.files.filter((entry) => entry.state !== 'pending');
    let restoreBackup: Array<{path: string; snapshot: ChangeFileSnapshot}>;

    try {
      const currentStates = entries.map((entry) => readChangeFileState(entry.path));
      const conflicts = entries.filter((entry, index) => {
        if (entry.afterFingerprint === undefined) {
          return false;
        }
        const current = currentStates[index].fingerprint;
        // 文件已回到恢复基线时无需覆盖新内容，也允许 journal 提交失败后重试。
        const before = entry.beforeFingerprint ?? getSnapshotFingerprint(entry.snapshot);
        return current !== entry.afterFingerprint && current !== before;
      });
      if (conflicts.length > 0) {
        return {
          ok: false,
          reason: 'conflict',
          message: `${conflicts.length} 个文件已变化，未执行回退${conflicts.length > MAX_UNDO_CONFLICT_PATHS ? `（列出前 ${MAX_UNDO_CONFLICT_PATHS} 个，另有 ${conflicts.length - MAX_UNDO_CONFLICT_PATHS} 个）` : ''}。\n${conflicts.slice(0, MAX_UNDO_CONFLICT_PATHS).map((entry) => entry.path).join('\n')}`
        };
      }
      restoreBackup = entries.map((entry, index) => {
        const snapshot = currentStates[index].snapshot;
        if (!snapshot) throw new Error(`无法回退非普通文件：${entry.path}`);
        return {path: entry.path, snapshot};
      });
    } catch (error: unknown) {
      return {ok: false, reason: 'restore_failed', message: error instanceof Error ? error.message : '无法检查文件当前状态'};
    }

    try {
      for (const entry of entries) {
        restoreChangeFileSnapshot(entry.path, entry.snapshot);
      }
    } catch (error: unknown) {
      restoreSnapshots(restoreBackup);
      return {
        ok: false,
        reason: 'restore_failed',
        message: error instanceof Error && error.message.trim() !== '' ? error.message : '文件恢复失败'
      };
    }

    return {ok: true, checkpoint};
  }

  /**
   * 在 transcript 回退成功后移除栈顶，并向剩余历史传递仍存在的未追踪影响提示。
   * 对应 journal 操作由 transcript 回退 batch 一并提交，此处只同步内存栈。
   */
  markLastUsed(): void {
    const checkpoint = this.last;

    if (checkpoint) {
      const continuation = createUndoContinuation(checkpoint, this.history[this.history.length - 2]);
      checkpoint.status = 'used';
      this.history.pop();
      if (continuation) {
        this.history[this.history.length - 1] = continuation;
      }
    }
  }

  /** 受控工具写盘前保留本轮首次快照；失败会中止恢复，以免生成缺少基线的记录。 */
  private captureFileBefore(filePath: string): void {
    const checkpoint = this.current;

    if (!checkpoint || checkpoint.status !== 'recording') {
      return;
    }

    const absolutePath = path.resolve(filePath);

    if (checkpoint.files.some((entry) => entry.path === absolutePath)) {
      return;
    }

    try {
      const state = readChangeFileState(absolutePath);
      if (!state.snapshot) {
        this.invalidate(`无法记录非普通文件的回退快照：${absolutePath}`);
        return;
      }
      checkpoint.files.push({
        path: absolutePath,
        snapshot: state.snapshot,
        beforeFingerprint: state.fingerprint,
        state: 'pending'
      });
    } catch (error: unknown) {
      this.invalidate(error instanceof Error ? error.message : '无法记录文件回退快照');
    }
  }

  /** 成功写盘后保存存在性、内容和权限指纹；同路径后续编辑更新指纹但保留首次基线。 */
  private captureFileAfter(filePath: string): void {
    const checkpoint = this.current;

    if (!checkpoint || checkpoint.status !== 'recording') {
      return;
    }

    const absolutePath = path.resolve(filePath);
    const entry = checkpoint.files.find((item) => item.path === absolutePath);

    if (!entry) {
      return;
    }

    try {
      const state = readChangeFileState(absolutePath);
      if (!state.snapshot) {
        this.invalidate(`无法记录非普通文件的编辑后状态：${absolutePath}`);
        return;
      }
      entry.afterFingerprint = state.fingerprint;
      entry.state = entry.snapshot.exists ? 'updated' : 'created';
    } catch (error: unknown) {
      this.invalidate(error instanceof Error ? error.message : '无法记录编辑后的文件状态');
    }
  }

}

/**
 * 只提醒紧接有限恢复的历史目标；后续保留旧记录核验标记。
 * 独立撤销序列可留下相邻 notice，不能覆盖剩余栈顶尚未展示的另一条提醒。
 */
function createUndoContinuation(checkpoint: ChangeCheckpoint, previous: ChangeCheckpoint | undefined): ChangeCheckpoint | undefined {
  if ((!checkpoint.untrackedReason && !checkpoint.untrackedEffects) || !previous) {
    return undefined;
  }
  return {
    ...previous,
    untrackedEffects: checkpoint.untrackedReason ? 'notice' : previous.untrackedEffects ?? 'retained'
  };
}

function cloneChangeHistory(history: ChangeCheckpoint[] | null | undefined): ChangeCheckpoint[] {
  return (history || []).map((checkpoint) => ({
    ...checkpoint,
    ...(checkpoint.compactionBefore ? {compactionBefore: {...checkpoint.compactionBefore}} : {}),
    files: checkpoint.files.map((entry) => ({
      ...entry,
      snapshot: {...entry.snapshot}
    }))
  }));
}

/** 恢复中途写盘失败时尽力还原进入恢复前的全部路径；错误仍由执行入口报告。 */
function restoreSnapshots(snapshots: Array<{path: string; snapshot: ChangeFileSnapshot}>): void {
  for (const item of snapshots) {
    try {
      restoreChangeFileSnapshot(item.path, item.snapshot);
    } catch (_error: unknown) {
      // 尽力回滚恢复过程中的部分写入；最终错误由 executeUndo() 返回。
    }
  }
}

export {
  ChangeHistoryContext,
  cloneChangeHistory,
  createUndoContinuation
};

export type {
  BeginChangeCheckpointOptions
};
