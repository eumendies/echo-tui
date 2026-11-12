import {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';

import {normalizePositiveInteger} from './tool-handler-utils';
import type {ToolResultStore, ToolResultStreamWriter} from './tool-result-offloading';
import type {SandboxRuntimeContext} from '../sandbox/types';

const DEFAULT_BASH_MAX_OUTPUT_BYTES = 65_536;
const TERMINATE_KILL_GRACE_MS = 500;

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
};

/** 已启动子进程的可持有句柄;后台任务跨轮持有它,前台调用只等 wait()。 */
type BashProcessHandle = {
  pid: number | undefined; // 子进程 PID;同步 spawn 失败时为 undefined。
  started: Promise<void>; // 'spawn' 事件决议成功,spawn 失败时以 Error 拒绝。
  stop: () => void; // 进程组 SIGTERM,宽限期后补 SIGKILL;重复调用无副作用。
  wait: () => Promise<BashCommandRunResult>; // 子进程 close/error 后的最终结果;可重复调用。
};

/**
 * 启动一条非交互 bash 命令并返回可持有句柄;调用方可只等 wait() 恢复前台语义。
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
      // 有些命令会忽略 SIGTERM；补一段强制终止兜底，避免 timeout/Esc 后 Promise 永久不结束。
      killFallbackTimeout = setTimeout(() => {
        signalChild('SIGKILL');
      }, TERMINATE_KILL_GRACE_MS);
    }
  };
  const handleAbort = () => {
    aborted = true;
    terminateChild();
  };

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

  child.on('spawn', () => {
    startedControl.resolve?.();
  });
  child.stdout?.on('data', (chunk: Buffer | string) => {
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

    if (settled) {
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
      ...(aborted ? {error: 'Command interrupted'} : {}),
      exitCode: code,
      offloadWriter,
      output,
      signal,
      stderr,
      stdout,
      timedOut
    }));
  });

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
    }
  };
}

/**
 * 前台执行一条非交互 bash 命令,等待进程结束后一次性返回结果。
 */
function runBashCommand(options: BashCommandRunnerOptions): Promise<BashCommandRunResult> {
  return startBashProcess(options).wait();
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
