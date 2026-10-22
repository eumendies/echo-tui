import type {CompactionState} from './transcript';

export type ChangeCheckpointStatus = 'recording' | 'ready' | 'used' | 'invalid';

export type ChangeFileSnapshot = {
  exists: boolean;
  content?: string;
  mode?: number;
};

export type ChangeFileEntryState = 'pending' | 'created' | 'updated';

export type ChangeFileEntry = {
  path: string;
  snapshot: ChangeFileSnapshot;
  state: ChangeFileEntryState;
};

export type ChangeCheckpoint = {
  id: string;
  createdAt: string;
  cwd: string;
  transcriptStartIndex: number;
  compactionBefore?: CompactionState;
  files: ChangeFileEntry[];
  status: ChangeCheckpointStatus;
  invalidReason?: string;
};

export type UndoReadySummary = {
  status: 'ready';
  checkpointId: string;
  fileCount: number;
  restoreFileCount: number;
  deleteFileCount: number;
};

export type UndoUnavailableSummary =
  | {status: 'none'}
  | {status: 'invalid'; reason: string};

export type UndoSummary = UndoReadySummary | UndoUnavailableSummary;

export type UndoExecuteResult =
  | {ok: true; checkpoint: ChangeCheckpoint}
  | {ok: false; reason: 'none' | 'invalid' | 'restore_failed'; message: string};

/**
 * change history 栈的一次改动；写入侧据此生成增量 journal 操作，避免每轮重写整份栈。
 */
export type ChangeHistoryDelta =
  | {
    kind: 'push'; // 一轮 loop 结束时新增一个 ready checkpoint。
    checkpoint: ChangeCheckpoint; // 本轮新增的栈顶 checkpoint，创建后不再被改动。
  }
  | {
    kind: 'pop'; // /undo 成功回退一个栈顶 checkpoint。
  }
  | {
    kind: 'reset'; // 失效边界：栈被整份替换，只用于自包含语义必需的场合。
    history: ChangeCheckpoint[]; // 替换后的完整栈，通常只含单个 invalid checkpoint。
  };

export type ChangeFileRecorder = {
  captureFileBefore(filePath: string): void;
  captureFileAfter(filePath: string): void;
  invalidate(reason: string): void;
};
