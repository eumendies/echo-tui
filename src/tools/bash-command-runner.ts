import {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';

import {normalizePositiveInteger} from './tool-handler-utils';

const DEFAULT_BASH_TIMEOUT_MS = 30_000;
const DEFAULT_BASH_MAX_OUTPUT_BYTES = 65_536;
const TERMINATE_KILL_GRACE_MS = 500;

type BashCommandRunnerOptions = {
  abortSignal?: AbortSignal;
  command: string;
  cwd: string;
  maxOutputBytes?: number;
  onOutput?: (event: BashCommandOutputEvent) => void;
  shell?: string;
  timeoutMs?: number | null;
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
  stderr: string;
  stdout: string;
  timedOut: boolean;
  truncated: boolean;
};

/**
 * 执行一条非交互 bash 命令，并同时保留结构化 stdout/stderr 与按到达顺序合并的终端输出。
 */
function runBashCommand(options: BashCommandRunnerOptions): Promise<BashCommandRunResult> {
  const timeoutMs = options.timeoutMs === null ? null : normalizePositiveInteger(options.timeoutMs, DEFAULT_BASH_TIMEOUT_MS);
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_BASH_MAX_OUTPUT_BYTES);
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
      const acceptedChunk = output.append(chunk);
      if (acceptedChunk) {
        options.onOutput?.({chunk: acceptedChunk, stream: 'stdout'});
      }
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr.append(chunk);
      const acceptedChunk = output.append(chunk);
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
      resolve(createRunResult({command: options.command, durationMs: Date.now() - startedAt, error: error.message, exitCode: null, output, stderr, stdout, timedOut}));
    });
    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(createRunResult({command: options.command, durationMs: Date.now() - startedAt, ...(aborted ? {error: 'Command interrupted'} : {}), exitCode: code, output, stderr, stdout, timedOut}));
    });
  });
}

function createRunResult(options: {
  command: string;
  durationMs: number;
  error?: string;
  exitCode: number | null;
  output: OutputCapture;
  stderr: OutputCapture;
  stdout: OutputCapture;
  timedOut: boolean;
}): BashCommandRunResult {
  return {
    command: options.command,
    durationMs: options.durationMs,
    ...(options.error ? {error: options.error} : {}),
    exitCode: options.exitCode,
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
  isTruncated: () => boolean;
};

/**
 * 捕获有限大小的输出，保证 stdout/stderr 不会无限进入 transcript 和 provider input。
 */
function createOutputCapture(maxBytes: number): OutputCapture {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;

  return {
    append(chunk: Buffer | string) {
      if (bytes >= maxBytes) {
        truncated = true;
        return '';
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = maxBytes - bytes;

      if (buffer.length > remaining) {
        const accepted = buffer.subarray(0, remaining);
        chunks.push(accepted);
        bytes += remaining;
        truncated = true;
        return accepted.toString('utf8');
      }

      chunks.push(buffer);
      bytes += buffer.length;
      return buffer.toString('utf8');
    },
    get() {
      return Buffer.concat(chunks).toString('utf8');
    },
    isTruncated() {
      return truncated;
    }
  };
}

export {
  DEFAULT_BASH_MAX_OUTPUT_BYTES,
  DEFAULT_BASH_TIMEOUT_MS,
  runBashCommand
};

export type {
  BashCommandOutputEvent,
  BashCommandRunResult,
  BashCommandRunnerOptions
};
