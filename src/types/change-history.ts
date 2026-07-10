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

export type ChangeFileRecorder = {
  captureFileBefore(filePath: string): void;
  captureFileAfter(filePath: string): void;
  invalidate(reason: string): void;
};
