import {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import path from 'node:path';

import {normalizePositiveInteger} from './tool-handler-utils';
import type {ToolResultStore, ToolResultStreamWriter} from './tool-result-offloading';
import type {SandboxRuntimeContext} from '../sandbox/types';

const DEFAULT_BASH_MAX_OUTPUT_BYTES = 65_536;
const TERMINATE_KILL_GRACE_MS = 500;
const FOREGROUND_TERMINATION_CONFIRM_MS = 1000;
const UNCONFIRMED_BASH_UNDO_REASON = '尚未确认命令结束，请稍后重试。';
const unconfirmedProcesses = new Map<string, Set<BashProcessHandle>>();

type BashCommandRunnerOptions = {
  abortSignal?: AbortSignal;
  capture?: boolean; // 是否在内存保留输出;后台任务只写文件,置 false 以保持内存有界。
  command: string;
  cwd: string;
  maxOutputBytes?: number | null;
  onOutput?: (event: BashCommandOutputEvent) => void;
  onRawOutput?: (event: BashCommandRawOutputEvent) => void; // 未解码的原始分块;供后台日志写入器自行按流解码。
  sandbox?: SandboxRuntimeContext; // 存在且 provider 可用时以平台沙箱包装 spawn argv;缺省按无沙箱执行。
  shell?: string;
  timeoutMs?: number | null;
  toolResultStore?: ToolResultStore;
};

type BashCommandOutputEvent = {
  chunk: string;
  stream: 'stdout' | 'stderr';
};

type BashCommandRawOutputEvent = {
  chunk: Buffer;
  stream: 'stdout' | 'stderr';
};

type BashCommandRunResult = {
  command: string;
  durationMs: number;
  error?: string;
  exitCode: number | null;
  output: string;
  offloadFilePath?: string;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  truncated: boolean;
  terminationUnconfirmed?: boolean; // 前台仅结束了本地等待，进程尚无真实 close 结果。
};

/** 已启动子进程的可持有句柄；真实结束与前台放弃等待分别管理。 */
type BashProcessHandle = {
  pid: number | undefined; // 子进程 PID;同步 spawn 失败时为 undefined。
  started: Promise<void>; // 'spawn' 事件决议成功；交接前 error 可拒绝，PID 存在时不代表进程未执行。
  stop: () => void; // 进程组 SIGTERM,宽限期后补 SIGKILL;重复调用无副作用。
  wait: () => Promise<BashCommandRunResult>; // 等待真实 close；只有未取得 PID 的启动错误可提前完成。
  detachOutput: () => BashCommandRunResult; // 调用方放弃等待时封闭输出并取消事件循环引用；不决议 wait。
};

/**
 * 启动非交互 bash 并提供真实结束句柄；前台通过 runBashCommand 管理终止确认期限。
 */
function startBashProcess(options: BashCommandRunnerOptions): BashProcessHandle {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const maxOutputBytes = options.maxOutputBytes === null
    ? null
    : normalizePositiveInteger(options.maxOutputBytes, DEFAULT_BASH_MAX_OUTPUT_BYTES);
  const shell = options.shell || '/bin/bash';
  const captureEnabled = options.capture !== false;
  const startedAt = Date.now();
  const stdout = captureEnabled ? createOutputCapture(maxOutputBytes) : createDisabledCapture();
  const stderr = captureEnabled ? createOutputCapture(maxOutputBytes) : createDisabledCapture();
  const output = captureEnabled ? createOutputCapture(maxOutputBytes) : createDisabledCapture();
  let offloadWriter: ToolResultStreamWriter | null = null;
  let offloadUnavailable = false;
  let timedOut = false;
  let aborted = false;
  let settled = false;
  let stopped = false;
  let processError: string | undefined;
  let outputDetached = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let killFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
  let resolveResult: (result: BashCommandRunResult) => void = () => {};
  // 用 holder 持有 executor 回填的决议函数,避免闭包赋值被控制流窄化成 null。
  const startedControl: {resolve?: () => void; reject?: (error: Error) => void} = {};
  const started = new Promise<void>((resolve, reject) => {
    startedControl.resolve = resolve;
    startedControl.reject = reject;
  });
  // 前台调用只等 wait(),不会消费 started;提前挂空 catch 避免 spawn 失败变成未处理拒绝。
  void started.catch(() => {});
  const finished = new Promise<BashCommandRunResult>((resolve) => {
    resolveResult = resolve;
  });

  // 沙箱生效时以 sandbox-exec 包装同一 shell 调用;包装不改变进程组、stdio 与终止语义。
  const sandboxArgv = options.sandbox
    ? options.sandbox.provider.wrapCommand({command: options.command, shell, cwd: options.cwd}, options.sandbox.policy)
    : null;
  let child: ReturnType<typeof spawn>;

  try {
    // 不提供 stdin/TTY，避免命令变成需要用户交互的悬挂进程。
    child = spawn(
      sandboxArgv ? sandboxArgv[0] : shell,
      sandboxArgv ? sandboxArgv.slice(1) : ['-lc', options.command],
      {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.trim() !== '' ? error.message : 'failed to start process';
    startedControl.reject?.(new Error(message));
    settled = true;
    return {
      pid: undefined,
      started,
      stop: () => {},
      detachOutput: () => createRunResult({command: options.command, durationMs: 0, exitCode: null, offloadWriter: null, output, signal: null, stderr, stdout, timedOut: false}),
      wait: () => Promise.resolve(createRunResult({
        command: options.command,
        durationMs: 0,
        error: message,
        exitCode: null,
        offloadWriter: null,
        output,
        signal: null,
        stderr,
        stdout,
        timedOut: false
      }))
    };
  }

  const cleanup = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (killFallbackTimeout) {
      clearTimeout(killFallbackTimeout);
      killFallbackTimeout = null;
    }
    options.abortSignal?.removeEventListener('abort', handleAbort);
  };
  const appendMergedOutput = (chunk: Buffer | string): string => {
    if (!captureEnabled) {
      return '';
    }

    if (!offloadWriter && !offloadUnavailable && output.wouldTruncate(chunk)) {
      offloadWriter = options.toolResultStore?.createStreamWriter() || null;

      if (offloadWriter) {
        offloadWriter.append(output.getBuffer());
      } else {
        offloadUnavailable = true;
      }
    }

    offloadWriter?.append(chunk);
    return output.append(chunk);
  };
  const signalChild = (signal: NodeJS.Signals) => {
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // process group 不存在时回退到直接终止 shell 进程。
      }
    }

    child.kill(signal);
  };
  const terminateChild = () => {
    signalChild('SIGTERM');
    if (!killFallbackTimeout) {
      // 有些命令会忽略 SIGTERM；宽限期后补 SIGKILL，但信号失败不能作为结束证据。
      killFallbackTimeout = setTimeout(() => {
        signalChild('SIGKILL');
      }, TERMINATE_KILL_GRACE_MS);
    }
  };
  const handleAbort = () => {
    aborted = true;
    terminateChild();
  };

  child.on('spawn', () => {
    startedControl.resolve?.();
  });
  child.stdout?.on('data', (chunk: Buffer | string) => {
    if (outputDetached) return;
    if (captureEnabled) {
      stdout.append(chunk);
    }
    const acceptedChunk = appendMergedOutput(chunk);
    if (acceptedChunk) {
      options.onOutput?.({chunk: acceptedChunk, stream: 'stdout'});
    }
    options.onRawOutput?.({chunk: Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'), stream: 'stdout'});
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    if (outputDetached) return;
    if (captureEnabled) {
      stderr.append(chunk);
    }
    const acceptedChunk = appendMergedOutput(chunk);
    if (acceptedChunk) {
      options.onOutput?.({chunk: acceptedChunk, stream: 'stderr'});
    }
    options.onRawOutput?.({chunk: Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'), stream: 'stderr'});
  });
  child.on('error', (error: Error) => {
    startedControl.reject?.(error);
    processError ??= error.message;

    if (settled) {
      return;
    }

    // kill 失败也会产生 error；已经取得 PID 时必须等待 close，不能据此释放后台写保护。
    if (child.pid !== undefined) {
      return;
    }

    settled = true;
    cleanup();
    resolveResult(createRunResult({
      command: options.command,
      durationMs: Date.now() - startedAt,
      error: error.message,
      exitCode: null,
      offloadWriter,
      output,
      signal: null,
      stderr,
      stdout,
      timedOut
    }));
  });
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    if (settled) {
      return;
    }

    settled = true;
    cleanup();
    resolveResult(createRunResult({
      command: options.command,
      durationMs: Date.now() - startedAt,
      ...(processError ? {error: processError} : aborted ? {error: 'Command interrupted'} : {}),
      exitCode: code,
      offloadWriter,
      output,
      signal,
      stderr,
      stdout,
      timedOut
    }));
  });

  // 先安装 error/close 监听，再处理已取消信号；child.kill 可能同步触发 error。
  if (timeoutMs !== null) {
    timeout = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, timeoutMs);
  }
  if (options.abortSignal?.aborted) {
    handleAbort();
  } else {
    options.abortSignal?.addEventListener('abort', handleAbort, {once: true});
  }

  return {
    pid: child.pid ?? undefined,
    started,
    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;
      terminateChild();
    },
    wait: () => {
      return finished;
    },
    detachOutput: () => {
      outputDetached = true;
      cleanup();
      const result = createRunResult({
        command: options.command, durationMs: Date.now() - startedAt,
        ...(processError ? {error: processError} : {}), exitCode: null,
        offloadWriter, output, signal: null, stderr, stdout, timedOut
      });
      offloadWriter = null;
      // 前台不再观察输出；不让无法终止的子进程或管道阻止 headless CLI 退出。
      child.unref();
      child.stdout?.destroy();
      child.stderr?.destroy();
      return result;
    }
  };
}

/**
 * 底层负责启动进程和发送终止信号；此处分别管理前台等待期限与进程真实结束。
 * 取消或超时后最多再等待一段确认时间，届时仍无 close 就返回终止未确认结果。
 * 前台返回后，尚未确认结束的进程继续阻止本工作目录的 undo，直到真实 close 才解除。
 */
function runBashCommand(options: BashCommandRunnerOptions): Promise<BashCommandRunResult> {
  const handle = startBashProcess(options);
  // 取消事件和确认期限都可能要求登记保护，每个进程只登记一次。
  let undoProtected = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  // 超时与取消可以先后到达；只保留最早的截止时间，避免后一次请求延长等待。
  let deadlineAt = Infinity;
  let resolveUnconfirmed: (result: BashCommandRunResult) => void = () => {};
  // 这个 Promise 只表示前台放弃等待，不改变 handle.wait() 所代表的真实进程状态。
  const unconfirmed = new Promise<BashCommandRunResult>((resolve) => { resolveUnconfirmed = resolve; });

  /** 按工作目录保留仍可能写文件的进程；未取得 PID 的启动失败无需登记。 */
  const retainUndoProtection = () => {
    if (undoProtected || handle.pid === undefined) return;
    undoProtected = true;
    const cwd = path.resolve(options.cwd);
    const processes = unconfirmedProcesses.get(cwd) ?? new Set<BashProcessHandle>();
    processes.add(handle);
    unconfirmedProcesses.set(cwd, processes);
    // wait() 的多次调用共用同一完成 Promise；前台超期返回后，仍由真实结束释放保护。
    // 因此保护不能在下方的 finally 中提前清除。
    void handle.wait().then(() => {
      processes.delete(handle);
      if (processes.size === 0) unconfirmedProcesses.delete(cwd);
    });
  };

  /** 从当前时刻安排终止确认期限；它限制本地等待，不作为进程已经退出的证据。 */
  const armDeadline = (delayMs: number) => {
    const nextAt = Date.now() + delayMs;
    if (nextAt >= deadlineAt) return;
    deadlineAt = nextAt;
    if (deadline) clearTimeout(deadline);
    deadline = setTimeout(() => {
      retainUndoProtection();
      // 保留已捕获输出并封闭后续输出，解除事件循环引用，让调用方及 headless CLI 能收尾。
      const partial = handle.detachOutput();
      resolveUnconfirmed({
        ...partial,
        error: `无法确认进程终止（PID ${handle.pid ?? '未知'}）${partial.error ? `：${partial.error}` : ''}`,
        terminationUnconfirmed: true
      });
    }, delayMs);
  };

  const onAbort = () => {
    // Esc 的 turn 可以先于工具 Promise 收尾；取消事件内立即保护，不能等确认期限才阻止恢复。
    retainUndoProtection();
    armDeadline(FOREGROUND_TERMINATION_CONFIRM_MS);
  };
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  // 底层在 timeoutMs 时尝试终止；前台再留一段确认时间。没有超时或取消时不加额外期限。
  if (timeoutMs !== null) armDeadline(timeoutMs + FOREGROUND_TERMINATION_CONFIRM_MS);
  // 信号可能在启动前已取消，此时也必须登记保护并安排确认期限。
  if (options.abortSignal?.aborted) onAbort();
  else options.abortSignal?.addEventListener('abort', onAbort, {once: true});
  // 真实结束与等待超期谁先发生就返回谁；race 不会取消另一个 Promise，真实结束仍可释放保护。
  return Promise.race([handle.wait(), unconfirmed]).finally(() => {
    // 这里只清理本次前台等待的定时器与监听器，不改写进程状态或 undo 保护集合。
    if (deadline) clearTimeout(deadline);
    options.abortSignal?.removeEventListener('abort', onAbort);
  });
}

/** 仅用于撤销安全核验；被前台放弃等待的进程真实 close 后自动释放本工作目录保护。 */
function hasUnconfirmedBashCommands(cwd: string): boolean {
  return (unconfirmedProcesses.get(path.resolve(cwd))?.size ?? 0) > 0;
}

function createRunResult(options: {
  command: string;
  durationMs: number;
  error?: string;
  exitCode: number | null;
  offloadWriter: ToolResultStreamWriter | null;
  output: OutputCapture;
  signal: NodeJS.Signals | null;
  stderr: OutputCapture;
  stdout: OutputCapture;
  timedOut: boolean;
}): BashCommandRunResult {
  const offloadResult = options.offloadWriter?.finish();

  return {
    command: options.command,
    durationMs: options.durationMs,
    ...(options.error ? {error: options.error} : {}),
    exitCode: options.exitCode,
    ...(offloadResult?.ok ? {offloadFilePath: offloadResult.path} : {}),
    output: options.output.get(),
    signal: options.signal,
    stderr: options.stderr.get(),
    stdout: options.stdout.get(),
    timedOut: options.timedOut,
    truncated: options.stdout.isTruncated() || options.stderr.isTruncated() || options.output.isTruncated()
  };
}

type OutputCapture = {
  append: (chunk: Buffer | string) => string;
  get: () => string;
  getBuffer: () => Buffer;
  isTruncated: () => boolean;
  wouldTruncate: (chunk: Buffer | string) => boolean;
};

/** 后台任务不保留内存输出,只保留句柄、终止与结果语义。 */
function createDisabledCapture(): OutputCapture {
  return {
    append: () => '',
    get: () => '',
    getBuffer: () => Buffer.alloc(0),
    isTruncated: () => false,
    wouldTruncate: () => false
  };
}

/**
 * 捕获命令输出；有限模式超限后保留尾部，显式 null 用于只写本地 transcript 的完整输出。
 */
function createOutputCapture(maxBytes: number | null): OutputCapture {
  const chunks: Buffer[] = [];
  const visibleDecoder = new StringDecoder('utf8');
  let totalBytes = 0;
  let bytes = 0;
  let truncated = false;
  const getBuffer = () => Buffer.concat(chunks);

  return {
    append(chunk: Buffer | string) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const previousTotalBytes = totalBytes;

      if (buffer.length === 0) {
        return '';
      }

      totalBytes += buffer.length;
      chunks.push(buffer);
      bytes += buffer.length;

      while (maxBytes !== null && bytes > maxBytes && chunks.length > 0) {
        truncated = true;
        const overflow = bytes - maxBytes;
        const first = chunks[0];

        if (first.length <= overflow) {
          chunks.shift();
          bytes -= first.length;
          continue;
        }

        chunks[0] = first.subarray(overflow);
        bytes -= overflow;
      }

      const visibleBytes = maxBytes === null
        ? buffer.length
        : Math.max(0, Math.min(buffer.length, maxBytes - previousTotalBytes));
      return visibleDecoder.write(buffer.subarray(0, visibleBytes));
    },
    get() {
      const buffer = getBuffer();
      let start = 0;

      while (start < buffer.length && buffer[start] >= 0x80 && buffer[start] <= 0xbf) {
        start += 1;
      }

      return buffer.subarray(start).toString('utf8');
    },
    getBuffer,
    isTruncated() {
      return truncated;
    },
    wouldTruncate(chunk: Buffer | string) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      return maxBytes !== null && totalBytes + buffer.length > maxBytes;
    }
  };
}

function normalizeTimeoutMs(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export {
  DEFAULT_BASH_MAX_OUTPUT_BYTES,
  UNCONFIRMED_BASH_UNDO_REASON,
  hasUnconfirmedBashCommands,
  runBashCommand,
  startBashProcess
};

export type {
  BashCommandOutputEvent,
  BashCommandRawOutputEvent,
  BashCommandRunResult,
  BashCommandRunnerOptions,
  BashProcessHandle
};
