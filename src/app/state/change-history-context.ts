import fs from 'node:fs';
import path from 'node:path';

import type {CompactionState} from '../../types/transcript';
import type {
  ChangeCheckpoint,
  ChangeFileEntry,
  ChangeFileRecorder,
  ChangeFileSnapshot,
  UndoExecuteResult,
  UndoSummary
} from '../../types/change-history';

type BeginChangeCheckpointOptions = {
  compactionBefore?: CompactionState;
  cwd: string;
  transcriptStartIndex: number;
};

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
   */
  finalizeCheckpoint(): void {
    if (!this.current) {
      return;
    }

    const checkpoint = this.current;
    this.current = null;

    if (checkpoint.status === 'recording') {
      checkpoint.status = 'ready';
    }

    if (checkpoint.status === 'invalid') {
      this.history = [checkpoint];
      return;
    }

    this.history.push(checkpoint);
  }

  /**
   * 标记当前或栈顶 checkpoint 不可回退，并丢弃它之前的历史。
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
   * 创建受控工具使用的记录器，只暴露 snapshot 快照、写入成功标记和失效入口。
   */
  createRecorder(): ChangeFileRecorder {
    return {
      captureFileBefore: (filePath: string) => this.captureFileBefore(filePath),
      captureFileAfter: (filePath: string) => this.captureFileAfter(filePath),
      invalidate: (reason: string) => this.invalidate(reason)
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
   * 返回栈顶 checkpoint 的展示摘要；invalid 边界会直接阻止继续回退。
   */
  getSummary(): UndoSummary {
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

    const files = checkpoint.files.filter((file) => file.state !== 'pending');
    return {
      status: 'ready',
      checkpointId: checkpoint.id,
      deleteFileCount: files.filter((file) => file.state === 'created').length,
      fileCount: files.length,
      restoreFileCount: files.filter((file) => file.state === 'updated').length
    };
  }

  /**
   * 恢复栈顶 ready checkpoint 的文件状态；transcript 回退由 AppContext 串联执行。
   */
  executeUndo(): UndoExecuteResult {
    const checkpoint = this.last;

    if (!checkpoint || checkpoint.status === 'used') {
      return {ok: false, reason: 'none', message: '暂无可回退的上一轮修改'};
    }

    if (checkpoint.status === 'invalid') {
      return {ok: false, reason: 'invalid', message: checkpoint.invalidReason || '上一轮包含不可安全回退的操作'};
    }

    if (checkpoint.status !== 'ready') {
      return {ok: false, reason: 'none', message: '暂无可回退的上一轮修改'};
    }

    const entries = checkpoint.files.filter((entry) => entry.state !== 'pending');
    const restoreBackup = entries.map((entry) => ({path: entry.path, snapshot: readFileSnapshot(entry.path)}));

    try {
      for (const entry of entries) {
        restoreEntry(entry);
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
   * 在 transcript 回退成功后移除已使用的栈顶 checkpoint。
   */
  markLastUsed(): void {
    const checkpoint = this.last;

    if (checkpoint) {
      checkpoint.status = 'used';
      this.history.pop();
    }
  }

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
      checkpoint.files.push({
        path: absolutePath,
        snapshot: readFileSnapshot(absolutePath),
        state: 'pending'
      });
    } catch (error: unknown) {
      this.invalidate(error instanceof Error ? error.message : '无法记录文件回退快照');
    }
  }

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

    entry.state = entry.snapshot.exists ? 'updated' : 'created';
  }

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

function readFileSnapshot(filePath: string): ChangeFileSnapshot {
  if (!fs.existsSync(filePath)) {
    return {exists: false};
  }

  const stat = fs.statSync(filePath);

  if (!stat.isFile()) {
    throw new Error(`无法回退非普通文件：${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return {
    exists: true,
    content,
    mode: stat.mode & 0o777
  };
}

function restoreEntry(entry: ChangeFileEntry): void {
  if (!entry.snapshot.exists) {
    if (fs.existsSync(entry.path)) {
      fs.unlinkSync(entry.path);
    }
    return;
  }

  fs.mkdirSync(path.dirname(entry.path), {recursive: true});
  fs.writeFileSync(entry.path, entry.snapshot.content || '', 'utf8');

  if (typeof entry.snapshot.mode === 'number') {
    fs.chmodSync(entry.path, entry.snapshot.mode);
  }
}

function restoreSnapshots(snapshots: Array<{path: string; snapshot: ChangeFileSnapshot}>): void {
  for (const item of snapshots) {
    try {
      if (!item.snapshot.exists) {
        if (fs.existsSync(item.path)) {
          fs.unlinkSync(item.path);
        }
      } else {
        fs.mkdirSync(path.dirname(item.path), {recursive: true});
        fs.writeFileSync(item.path, item.snapshot.content || '', 'utf8');
        if (typeof item.snapshot.mode === 'number') {
          fs.chmodSync(item.path, item.snapshot.mode);
        }
      }
    } catch (_error: unknown) {
      // 尽力回滚恢复过程中的部分写入；最终错误由 executeUndo() 返回。
    }
  }
}

export {
  ChangeHistoryContext,
  cloneChangeHistory,
  readFileSnapshot
};

export type {
  BeginChangeCheckpointOptions
};
