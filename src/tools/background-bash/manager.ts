import crypto from 'node:crypto';

import {startBashProcess} from '../bash-command-runner';
import {isChangeHistoryReadonlyBashCommand} from '../readonly-bash-command';
import {createBackgroundTaskFiles, readBackgroundTaskLogTail, writeBackgroundTaskStatus} from './task-files';

import type {BashProcessHandle, BashCommandRunResult} from '../bash-command-runner';
import type {BackgroundLogSink, BackgroundTaskFiles} from './task-files';
import type {
  BackgroundTaskManager,
  BackgroundTaskReference,
  BackgroundTaskStartOptions,
  BackgroundTaskStartResult,
  BackgroundTaskState,
  BackgroundTaskStatusSnapshot,
  BackgroundTaskStopReason,
  BackgroundTaskView
} from '../../types/background-task';

const MAX_CONCURRENT_BACKGROUND_TASKS = 16;
const MAX_BACKGROUND_LOG_BYTES = 8 * 1024 * 1024;
const CLEANUP_DEADLINE_MS = 2000;
const STATUS_VERSION = 1;

/** 管理器内部任务记录;句柄与内存状态是停止、计数和 undo 保护的唯一权威。 */
type ManagedTask = {
  reference: BackgroundTaskReference; // 对外稳定身份与文件位置。
  command: string; // 原始命令文本。
  cwd: string; // 启动时固定的工作目录。
  state: BackgroundTaskState; // 当前状态。
  reason: BackgroundTaskStopReason | null; // 结束原因。
  startedAt: string; // 启动时间。
  finishedAt: string | null; // 结束时间。
  exitCode: number | null; // 真实退出码。
  signal: string | null; // 终止信号名。
  mayWrite: boolean; // 启动时判定可能写入工作区。
  stopRequested: boolean; // 是否已由管理器请求终止。
  settled: boolean; // 是否已发布唯一终态。
  processFinished: boolean; // 只有真实 close 或未分配 PID 的启动失败才确认进程不再写入。
  log: BackgroundLogSink; // 增量日志写入器。
  files: Pick<BackgroundTaskFiles, 'outputPath' | 'statusPath'>; // 文件位置。
  handle: BashProcessHandle | null; // 子进程句柄;文件准备或 spawn 失败时为空。
  settledPromise: Promise<void>; // 终态决议,供停止与清理等待。
  resolveSettled: () => void; // 终态决议函数。
  cleanupTimer: ReturnType<typeof setTimeout> | null; // 有界清理兜底定时器。
  detachAbort: () => void; // 解除交接前取消监听。
};

type BackgroundTaskManagerOptions = {
  onRuntimeError?: (message: string, sessionId: string, taskId: string) => void; // 文件写入等运行时故障;携带来源任务身份供 app 过滤会话。
  onSettled?: (view: BackgroundTaskView) => void; // 任务终态回调;每个任务最多一次。
  ownerInstanceId?: string; // 覆盖实例身份;缺省为随机 UUID。
  rootDir?: string; // 覆盖用户级根目录;仅测试使用。
};

/**
 * 创建会话级后台任务管理器;实例身份在构造时固定,跨 turn 复用。
 */
function createBackgroundTaskManager(options: BackgroundTaskManagerOptions = {}): BackgroundTaskManager {
  const ownerInstanceId = options.ownerInstanceId || crypto.randomUUID();
  const tasks = new Map<string, ManagedTask>();
  let nextTaskNumber = 1;
  // 退出清理开始后不再接受新启动,避免迟到工具调用漏过清理快照。
  let closed = false;

  function createTaskId(): string {
    const taskId = `bash-${nextTaskNumber}`;
    nextTaskNumber += 1;
    return taskId;
  }

  function countActive(sessionId: string): number {
    let count = 0;

    for (const task of tasks.values()) {
      if (task.reference.sessionId === sessionId && !task.processFinished) {
        count += 1;
      }
    }

    return count;
  }

  function snapshotOf(task: ManagedTask): BackgroundTaskStatusSnapshot {
    return {
      version: STATUS_VERSION,
      taskId: task.reference.taskId,
      sessionId: task.reference.sessionId,
      ownerInstanceId: task.reference.ownerInstanceId,
      command: task.command,
      cwd: task.cwd,
      state: task.state,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      exitCode: task.exitCode,
      signal: task.signal,
      reason: task.reason,
      outputPath: task.files.outputPath,
      outputTruncated: task.log.isSaturated()
    };
  }

  /** 写入当前状态快照;失败只记录磁盘过期,不改变内存事实。 */
  function publishStatus(task: ManagedTask, terminal: boolean): void {
    const written = writeBackgroundTaskStatus(task.files.statusPath, snapshotOf(task));

    if (!written.ok) {
      if (terminal) {
        // 已确认的进程结果不因磁盘写失败而改变;这里只提示快照可能过期。
        options.onRuntimeError?.(`后台任务 ${task.reference.taskId} 状态写入失败。`, task.reference.sessionId, task.reference.taskId);
        return;
      }

      // 运行中状态无法维护时不再让文件冒充可用查询协议,立即终止任务。
      options.onRuntimeError?.(written.reason, task.reference.sessionId, task.reference.taskId);
      requestStop(task, 'runtime_error');
    }
  }

  function toView(task: ManagedTask): BackgroundTaskView {
    return {
      reference: task.reference,
      managed: true,
      state: task.state,
      command: task.command,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      exitCode: task.exitCode,
      reason: task.reason,
      elapsedMs: calculateElapsedMs(task.startedAt, task.finishedAt),
      outputTruncated: task.log.isSaturated()
    };
  }

  /** 幂等收尾:先排空日志再发布终态,每个任务只产生一次终态与一次通知。 */
  function finalize(task: ManagedTask, outcome: {state: BackgroundTaskState; reason?: BackgroundTaskStopReason | null; exitCode?: number | null; signal?: string | null}): void {
    if (task.settled) {
      return;
    }

    task.settled = true;

    if (task.cleanupTimer) {
      clearTimeout(task.cleanupTimer);
      task.cleanupTimer = null;
    }

    task.detachAbort();
    task.log.finish();
    task.state = outcome.state;
    task.reason = outcome.reason ?? null;
    task.exitCode = outcome.exitCode ?? null;
    task.signal = outcome.signal ?? null;
    task.finishedAt = new Date().toISOString();
    publishStatus(task, true);
    task.resolveSettled();
    options.onSettled?.(toView(task));
  }

  /** 请求终止:同步进入 stopping 并启动兜底期限,重复调用只保留首个原因。 */
  function requestStop(task: ManagedTask, reason: BackgroundTaskStopReason): void {
    if (task.settled || task.stopRequested) {
      return;
    }

    task.stopRequested = true;
    task.reason = reason;
    task.state = 'stopping';
    publishStatus(task, false);
    if (!task.handle) {
      // 进程尚未启动就没有需要终止的对象,直接按原因收尾。
      finalize(task, {state: 'failed', exitCode: null, reason, signal: null});
      return;
    }

    task.handle.stop();

    if (!task.cleanupTimer) {
      // 子进程忽略 TERM/KILL 时不能让停止流程永久悬挂,超期按未知结果收尾。
      task.cleanupTimer = setTimeout(() => {
        finalize(task, {state: 'failed', exitCode: null, reason: 'cleanup_timeout', signal: null});
      }, CLEANUP_DEADLINE_MS);
    }
  }

  /** 把进程真实结局映射为唯一终态,区分管理器主动终止与自然退出。 */
  function settleFromProcess(task: ManagedTask, result: BashCommandRunResult): void {
    task.processFinished = true;
    if (task.settled) {
      return;
    }

    if (task.stopRequested) {
      finalize(task, {
        state: task.reason === 'runtime_error' ? 'failed' : 'stopped',
        exitCode: result.exitCode,
        reason: task.reason,
        signal: result.signal
      });
      return;
    }

    if (result.timedOut) {
      finalize(task, {state: 'stopped', exitCode: result.exitCode, reason: 'timeout', signal: result.signal});
      return;
    }

    if (result.error) {
      finalize(task, {state: 'failed', exitCode: result.exitCode, reason: 'runtime_error', signal: result.signal});
      return;
    }

    finalize(task, {state: 'exited', exitCode: result.exitCode, signal: result.signal});
  }

  function isEffectivelyReadonlySandbox(sandbox: BackgroundTaskStartOptions['sandbox']): boolean {
    return sandbox !== undefined && sandbox.policy.mode === 'read-only' && sandbox.provider.isAvailable();
  }

  async function start(startOptions: BackgroundTaskStartOptions): Promise<BackgroundTaskStartResult> {
    if (closed) {
      return {ok: false, message: '应用正在退出，不再接受新的后台任务。'};
    }

    if (countActive(startOptions.sessionId) >= MAX_CONCURRENT_BACKGROUND_TASKS) {
      const hasUnknownProcess = [...tasks.values()].some((task) => task.reference.sessionId === startOptions.sessionId && task.settled && !task.processFinished);
      if (hasUnknownProcess) {
        return {ok: false, message: `当前会话已达到 ${MAX_CONCURRENT_BACKGROUND_TASKS} 个后台进程上限，其中有进程尚未确认结束；请等待实际退出后再启动。`};
      }
      return {ok: false, message: `当前会话已有 ${MAX_CONCURRENT_BACKGROUND_TASKS} 个后台任务在运行，请先停止一个再启动。`};
    }

    const taskId = createTaskId();
    const reference: BackgroundTaskReference = {
      taskId,
      sessionId: startOptions.sessionId,
      ownerInstanceId,
      outputPath: '',
      statusPath: ''
    };
    let task!: ManagedTask;
    const files = createBackgroundTaskFiles({
      maxLogBytes: MAX_BACKGROUND_LOG_BYTES,
      onSaturated: () => requestStop(task, 'output_limit'),
      onWriteError: (reason) => {
        options.onRuntimeError?.(reason, task.reference.sessionId, task.reference.taskId);
        requestStop(task, 'runtime_error');
      },
      ownerInstanceId,
      projectCwd: startOptions.cwd,
      rootDir: options.rootDir,
      sessionId: startOptions.sessionId,
      taskId
    });

    if (!files.ok) {
      return {ok: false, message: files.reason};
    }

    reference.outputPath = files.value.outputPath;
    reference.statusPath = files.value.statusPath;
    task = {
      reference,
      command: startOptions.command,
      cwd: startOptions.cwd,
      state: 'running',
      reason: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      signal: null,
      mayWrite: !isEffectivelyReadonlySandbox(startOptions.sandbox) && !isChangeHistoryReadonlyBashCommand(startOptions.command),
      stopRequested: false,
      settled: false,
      processFinished: false,
      log: files.value.log,
      files: {outputPath: files.value.outputPath, statusPath: files.value.statusPath},
      handle: null,
      settledPromise: Promise.resolve(),
      resolveSettled: () => {},
      cleanupTimer: null,
      detachAbort: () => {}
    };
    task.settledPromise = new Promise<void>((resolve) => {
      task.resolveSettled = resolve;
    });
    tasks.set(taskId, task);
    publishStatus(task, false);

    if (task.settled) {
      tasks.delete(taskId);
      return {ok: false, message: '无法写入后台任务状态，任务未启动。'};
    }

    const handle = startBashProcess({
      capture: false,
      command: startOptions.command,
      cwd: startOptions.cwd,
      onRawOutput: (event) => task.log.append(event.stream, event.chunk),
      sandbox: startOptions.sandbox,
      shell: startOptions.shell,
      timeoutMs: startOptions.timeoutMs
    });
    task.handle = handle;

    const abortListener = () => requestStop(task, 'user_stop');

    if (startOptions.abortSignal?.aborted) {
      abortListener();
    } else {
      startOptions.abortSignal?.addEventListener('abort', abortListener, {once: true});
      task.detachAbort = () => startOptions.abortSignal?.removeEventListener('abort', abortListener);
    }

    void handle.wait().then((result) => settleFromProcess(task, result));

    try {
      await handle.started;
    } catch (error: unknown) {
      const message = error instanceof Error && error.message.trim() !== '' ? error.message : '无法启动后台命令';
      const mayHaveExecuted = handle.pid !== undefined;
      if (mayHaveExecuted) {
        requestStop(task, 'runtime_error');
        await task.settledPromise;
      } else {
        task.processFinished = true;
        finalize(task, {state: 'failed', exitCode: null, reason: 'runtime_error', signal: null});
      }
      return {
        ok: false,
        message: `后台命令启动交接失败：${message}${task.processFinished ? '' : '；尚未确认进程结束，请在 /tasks 查看，期间不能回退。'}`,
        mayHaveExecuted
      };
    }

    // 交接完成:此后 turn 取消不再影响该任务。
    task.detachAbort();

    if (startOptions.abortSignal?.aborted) {
      requestStop(task, 'user_stop');
      await task.settledPromise;
      return {ok: false, message: '后台任务在完成启动交接前被取消。', mayHaveExecuted: handle.pid !== undefined};
    }

    return {ok: true, reference: {...reference}, state: task.state};
  }

  return {
    ownerInstanceId,
    start,
    listManaged(sessionId: string): BackgroundTaskView[] {
      return [...tasks.values()]
        .filter((task) => task.reference.sessionId === sessionId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.reference.taskId.localeCompare(right.reference.taskId))
        .map(toView);
    },
    getManaged(taskId: string): BackgroundTaskView | null {
      const task = tasks.get(taskId);
      return task ? toView(task) : null;
    },
    async stop(taskId: string): Promise<boolean> {
      const task = tasks.get(taskId);

      if (!task || task.settled) {
        return false;
      }

      requestStop(task, 'user_stop');
      await task.settledPromise;
      return true;
    },
    hasActiveWriteTask(sessionId: string): boolean {
      for (const task of tasks.values()) {
        if (task.reference.sessionId !== sessionId || !task.mayWrite) {
          continue;
        }

        // 清理超期或信号错误不能证明进程结束；真实 close 到达后才释放保护。
        if (!task.processFinished) {
          return true;
        }
      }

      return false;
    },
    async stopSessionTasks(sessionId: string): Promise<void> {
      await stopAndWait([...tasks.values()].filter((task) => task.reference.sessionId === sessionId && !task.settled), 'session_cleanup');
    },
    readTaskLog(taskId: string, maxBytes: number): string | null {
      const task = tasks.get(taskId);
      return task ? readBackgroundTaskLogTail(task.files.outputPath, maxBytes) : null;
    },
    readReferenceLog(reference: BackgroundTaskReference, maxBytes: number): string | null {
      return readBackgroundTaskLogTail(reference.outputPath, maxBytes);
    },
    async shutdown(): Promise<void> {
      closed = true;
      await stopAndWait([...tasks.values()].filter((task) => !task.settled), 'app_exit');
    }
  };

  /** 并发请求终止并共享一个有界清理期限;超期任务按未知结果收尾。 */
  async function stopAndWait(targets: ManagedTask[], reason: BackgroundTaskStopReason): Promise<void> {
    if (targets.length === 0) {
      return;
    }

    for (const task of targets) {
      requestStop(task, reason);
    }

    // 每个任务自带 CLEANUP_DEADLINE_MS 兜底收尾,批量清理直接等待即可,无需再叠一层期限。
    await Promise.all(targets.map((task) => task.settledPromise));
  }
}

/** 计算快照耗时;未结束任务取当前时间与启动时间之差。 */
function calculateElapsedMs(startedAt: string, finishedAt: string | null): number | null {
  const startedMs = Date.parse(startedAt);

  if (!Number.isFinite(startedMs)) {
    return null;
  }

  const endMs = finishedAt ? Date.parse(finishedAt) : Date.now();
  return Number.isFinite(endMs) ? Math.max(0, endMs - startedMs) : null;
}

export {
  CLEANUP_DEADLINE_MS,
  MAX_BACKGROUND_LOG_BYTES,
  MAX_CONCURRENT_BACKGROUND_TASKS,
  calculateElapsedMs,
  createBackgroundTaskManager
};

export type {
  BackgroundTaskManagerOptions
};
