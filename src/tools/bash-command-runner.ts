import {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';

import {normalizePositiveInteger} from './tool-handler-utils';
import type {ToolResultStore, ToolResultStreamWriter} from './tool-result-offloading';

const DEFAULT_BASH_MAX_OUTPUT_BYTES = 65_536;
const TERMINATE_KILL_GRACE_MS = 500;

type BashCommandRunnerOptions = {
  abortSignal?: AbortSignal;
  command: string;
  cwd: string;
  maxOutputBytes?: number | null;
  onOutput?: (event: BashCommandOutputEvent) => void;
  shell?: string;
  timeoutMs?: number | null;
  toolResultStore?: ToolResultStore;
};

type BashCommandOutputEvent = {
  chunk: string;
  stream: 'stdout' | 'stderr';
};

type BashCommandRunResult = {
  command: string;
  durationMs: number;
  error?: string;
  exitCode: number | null;
  output: string;
  offloadFilePath?: string;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  truncated: boolean;
};

/**
 * 执行一条非交互 bash 命令，并同时保留结构化 stdout/stderr 与按到达顺序合并的终端输出。
 */
function runBashCommand(options: BashCommandRunnerOptions): Promise<BashCommandRunResult> {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const maxOutputBytes = options.maxOutputBytes === null
    ? null
    : normalizePositiveInteger(options.maxOutputBytes, DEFAULT_BASH_MAX_OUTPUT_BYTES);
  const shell = options.shell || '/bin/bash';
  const startedAt = Date.now();

  return new Promise((resolve) => {
    // 不提供 stdin/TTY，避免命令变成需要用户交互的悬挂进程。
    const child = spawn(shell, ['-lc', options.command], {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = createOutputCapture(maxOutputBytes);
    const stderr = createOutputCapture(maxOutputBytes);
    const output = createOutputCapture(maxOutputBytes);
    let offloadWriter: ToolResultStreamWriter | null = null;
    let offloadUnavailable = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let killFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
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

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout.append(chunk);
      const acceptedChunk = appendMergedOutput(chunk);
      if (acceptedChunk) {
        options.onOutput?.({chunk: acceptedChunk, stream: 'stdout'});
      }
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr.append(chunk);
      const acceptedChunk = appendMergedOutput(chunk);
      if (acceptedChunk) {
        options.onOutput?.({chunk: acceptedChunk, stream: 'stderr'});
      }
    });
    child.on('error', (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(createRunResult({command: options.command, durationMs: Date.now() - startedAt, error: error.message, exitCode: null, offloadWriter, output, stderr, stdout, timedOut}));
    });
    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(createRunResult({command: options.command, durationMs: Date.now() - startedAt, ...(aborted ? {error: 'Command interrupted'} : {}), exitCode: code, offloadWriter, output, stderr, stdout, timedOut}));
    });
  });
}

function createRunResult(options: {
  command: string;
  durationMs: number;
  error?: string;
  exitCode: number | null;
  offloadWriter: ToolResultStreamWriter | null;
  output: OutputCapture;
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
  runBashCommand
};

export type {
  BashCommandOutputEvent,
  BashCommandRunResult,
  BashCommandRunnerOptions
};
