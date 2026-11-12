export {
  CLEANUP_DEADLINE_MS,
  MAX_BACKGROUND_LOG_BYTES,
  MAX_CONCURRENT_BACKGROUND_TASKS,
  calculateElapsedMs,
  createBackgroundTaskManager
} from './manager';
export {formatBackgroundTaskNotice, formatStopReason} from './notice';
export {
  BACKGROUND_TASK_STATUS_VERSION,
  normalizeLogText,
  readBackgroundTaskLogTail,
  readBackgroundTaskStatus,
  writeBackgroundTaskStatus
} from './task-files';

export type {BackgroundTaskManagerOptions} from './manager';
export type {BackgroundLogSink, BackgroundTaskFiles} from './task-files';
export type {
  BackgroundTaskManager,
  BackgroundTaskReference,
  BackgroundTaskStartOptions,
  BackgroundTaskStartResult,
  BackgroundTaskState,
  BackgroundTaskStatusSnapshot,
  BackgroundTaskStopReason,
  BackgroundTaskView
} from '../../types/background-task';
