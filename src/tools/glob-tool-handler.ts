import {spawn} from 'node:child_process';
import * as path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

import {projectScriptList, scriptFailure, validateScriptInput} from './code-mode/contracts';
import type {ScriptToolEnvelope} from './code-mode/contracts';

import {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES, capUtf8Text, isGitPath, normalizePositiveInteger, resolveCwd} from './tool-handler-utils';

import type {GlobDisplayMetadata, GlobToolExecutionResult, ToolCall, ToolExecutionOptions, ToolHandler} from '../types/tool';
import type {Result} from './tool-handler-utils';

const GLOB_TOOL_NAME = 'glob';
const DEFAULT_MAX_PATHS = 200;
const MAX_PARSER_PENDING_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;

type GlobToolHandlerOptions = {
  cwd?: string | (() => string); // 本次调用解析相对路径的基准目录。
  maxOutputBytes?: number; // 原生结果和采集的字节上限。
  maxPaths?: number; // 保留路径项数量上限。
  rgPath?: string; // 受信任的 ripgrep 可执行文件路径。
};

type NormalizedGlobRequest = {
  paths: string[]; // 按原生口径保留的有序路径。
  pattern: string; // 不经 shell 展开的查询模式。
};

type GlobRunResult = {
  error?: string; // 采集失败的有界诊断。
  exitCode: number | null; // 子进程的真实退出码或上限中止后的成功码。
  hasMore: boolean; // 已知或可能存在未保留的结果。
  limitReason?: 'bytes' | 'count'; // 决定原生截断提示的预算种类。
  paths: string[]; // 按原生口径保留的有序路径。
  stderr: string; // 有界标准错误输出。
  truncated: boolean; // 采集预算是否导致信息缺失。
};

/**
 * 创建本地 glob 工具；用于先按路径模式发现文件，再交给 read_files 或 grep 继续观察。
 */
function createGlobToolHandler(options: GlobToolHandlerOptions = {}): ToolHandler {
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
  const maxPaths = normalizePositiveInteger(options.maxPaths, DEFAULT_MAX_PATHS);
  const rgPath = options.rgPath || 'rg';

  return {
    definition: {
      name: GLOB_TOOL_NAME,
      // 字节上限的细节属于运行时截断通知，不占常态 schema 上下文；这里只声明截断可能发生。
      description: `Find local file paths by glob pattern using ripgrep file listing. Omit paths to search from the current working directory. Returns files only, includes hidden files, excludes .git internals, and caps results at ${maxPaths} paths and may be truncated when output is large; narrow pattern or paths when has_more is true.`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern'],
        properties: {
          pattern: {
            type: 'string'
          },
          paths: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        }
      }
    },
    async execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): Promise<GlobToolExecutionResult> {
      const result = await glob(args, {
        cwd: resolveCwd(options.cwd),
        maxOutputBytes,
        maxPaths,
        rgPath,
        abortSignal: executionOptions?.abortSignal
      });

      return {
        callId: call.callId,
        toolName: GLOB_TOOL_NAME,
        ok: result.ok,
        text: result.text,
        details: {
          kind: 'glob',
          exitCode: result.exitCode,
          truncated: result.truncated,
          ...(result.display ? {display: result.display} : {})
        }
      };
    },
    async executeScript(args, _call, executionOptions): Promise<ScriptToolEnvelope> {
      if (executionOptions?.abortSignal?.aborted) {
        return scriptFailure('cancelled', 'Tool call cancelled');
      }
      const input = validateScriptInput('glob', args);
      if (!input.ok) {
        return scriptFailure('invalid_arguments', input.reason);
      }
      const cwd = resolveCwd(options.cwd);
      const normalized = normalizeRequest(input.value, cwd);
      if (!normalized.ok) {
        return scriptFailure('invalid_arguments', normalized.reason);
      }
      const result = await runRipgrepFiles(normalized.value, {
        cwd,
        maxPaths,
        maxOutputBytes,
        rgPath,
        abortSignal: executionOptions?.abortSignal
      });
      if (executionOptions?.abortSignal?.aborted) {
        return scriptFailure('cancelled', 'Tool call cancelled');
      }
      if (result.error !== undefined || (result.exitCode !== 0 && result.exitCode !== 1)) {
        return scriptFailure('tool_failed', result.error || cleanStderr(result.stderr) || 'ripgrep failed');
      }
      return projectScriptList('glob', result.paths, result.hasMore, result.truncated);
    }
  };
}

async function glob(args: Record<string, unknown>, options: {
  cwd: string;
  maxOutputBytes: number;
  maxPaths: number;
  rgPath: string;
  abortSignal?: AbortSignal
}): Promise<{
  ok: boolean;
  text: string;
  display?: GlobDisplayMetadata;
  exitCode?: number | null;
  truncated: boolean
}> {
  const normalized = normalizeRequest(args, options.cwd);

  if (!normalized.ok) {
    return {
      ok: false,
      text: formatGlobFailure(normalized.reason, options.maxOutputBytes),
      truncated: false
    };
  }

  const runResult = await runRipgrepFiles(normalized.value, options);
  const ok = runResult.error === undefined && (runResult.exitCode === 0 || runResult.exitCode === 1);

  return {
    ok,
    exitCode: runResult.exitCode,
    text: ok ? formatGlobSuccess(runResult, options.maxPaths, options.maxOutputBytes) : formatGlobFailure(runResult.error || cleanStderr(runResult.stderr) || 'ripgrep file listing failed', options.maxOutputBytes),
    truncated: runResult.truncated,
    ...(ok ? {display: {kind: 'glob', paths: runResult.paths}} : {})
  };
}

function normalizeRequest(args: Record<string, unknown>, cwd: string): Result<NormalizedGlobRequest> {
  const pattern = args.pattern;

  if (typeof pattern !== 'string' || pattern.trim() === '') {
    return {ok: false, reason: 'pattern must be a non-empty string'};
  }

  if (pattern.includes('\0')) {
    return {ok: false, reason: 'pattern must not contain NUL'};
  }

  if (containsGitSegment(pattern)) {
    return {ok: false, reason: '.git paths are not allowed'};
  }

  const paths = normalizePaths(args.paths, cwd);

  if (!paths.ok) {
    return paths;
  }

  return {
    ok: true,
    value: {
      paths: paths.value,
      pattern
    }
  };
}

function normalizePaths(paths: unknown, cwd: string): Result<string[]> {
  if (paths === undefined || paths === null) {
    return {ok: true, value: ['.']};
  }

  if (!Array.isArray(paths)) {
    return {ok: false, reason: 'paths must be an array of strings or null'};
  }

  if (paths.length === 0) {
    return {ok: false, reason: 'paths must not be empty'};
  }

  const normalized: string[] = [];

  for (const [index, candidate] of paths.entries()) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      return {ok: false, reason: `paths[${index}] must be a non-empty string`};
    }

    const resolved = resolveSearchPath(candidate, cwd);

    if (!resolved.ok) {
      return {ok: false, reason: `paths[${index}]: ${resolved.reason}`};
    }

    normalized.push(candidate);
  }

  return {ok: true, value: normalized};
}

function resolveSearchPath(searchPath: string, cwd: string): Result<string> {
  if (searchPath.includes('\0')) {
    return {ok: false, reason: 'path must not contain NUL'};
  }

  const absolutePath = path.resolve(cwd, searchPath);

  if (isGitPath(absolutePath)) {
    return {ok: false, reason: '.git paths are not allowed'};
  }

  return {ok: true, value: absolutePath};
}

function runRipgrepFiles(request: NormalizedGlobRequest, options: {
  cwd: string;
  maxOutputBytes: number;
  maxPaths: number;
  rgPath: string;
  abortSignal?: AbortSignal
}): Promise<GlobRunResult> {
  if (options.abortSignal?.aborted) {
    return Promise.resolve({
      error: 'Tool call cancelled',
      exitCode: null,
      hasMore: false,
      paths: [],
      stderr: '',
      truncated: false
    });
  }
  return new Promise((resolve) => {
    // 文件发现仍通过参数数组调用 rg，避免把 pattern 或 paths 拼进 shell 命令。
    const child = spawn(options.rgPath, buildRipgrepArgs(request), {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const parser = createNullPathParser((filePath) => {
      if (limitReached) {
        return;
      }
      const absolutePath = path.resolve(options.cwd, filePath);

      if (isGitPath(absolutePath)) {
        return;
      }

      if (paths.length >= options.maxPaths) {
        // 路径发现不分页；超过上限时终止 rg 并提示模型收窄查询。
        hasMore = true;
        limitReason = 'count';
        truncated = true;
        limitReached = true;
        stop();
        return;
      }

      const separatorBytes = paths.length === 0 ? 0 : 1;
      const pathBytes = Buffer.byteLength(filePath, 'utf8');
      const noticeBytes = Buffer.byteLength(`\n\n${formatGlobLimitNotice('bytes', options.maxPaths, options.maxOutputBytes)}`, 'utf8');
      if (outputBytes + separatorBytes + pathBytes + noticeBytes > options.maxOutputBytes) {
        hasMore = true;
        limitReason = 'bytes';
        truncated = true;
        limitReached = true;
        stop();
        return;
      }

      paths.push(filePath);
      outputBytes += separatorBytes + pathBytes;
    }, MAX_PARSER_PENDING_BYTES, () => {
      if (!limitReached) {
        parserError = `ripgrep NUL path exceeded ${MAX_PARSER_PENDING_BYTES} bytes without a delimiter`;
        limitReached = true;
        stop();
      }
    });

    const paths: string[] = [];
    const stderrDecoder = new StringDecoder('utf8');
    let stderr = '';
    let hasMore = false;
    let limitReason: 'bytes' | 'count' | undefined;
    let limitReached = false;
    let outputBytes = 0;
    let parserError: string | undefined;
    let truncated = false;
    let processError: string | undefined;
    let closed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    // 取消和采集上限都等待 close；不让 Promise 先返回而遗留活跃 rg 或管道。
    function stop(): void {
      if (closed || killTimer) {
        return;
      }
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    }
    const onAbort = () => {
      processError = 'Tool call cancelled';
      limitReached = true;
      stop();
    };
    options.abortSignal?.addEventListener('abort', onAbort, {once: true});
    if (options.abortSignal?.aborted) {
      onAbort();
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (!limitReached) {
        parser.write(chunk);
      }
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = appendBoundedStderr(stderr, typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk));
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      processError = error.code === 'ENOENT' ? 'ripgrep executable not found' : error.message;
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      closed = true;
      options.abortSignal?.removeEventListener('abort', onAbort);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (!limitReached) {
        parser.end();
      }
      resolve({
        // 因命中上限主动终止时，保留已收集路径并把本次发现视为成功截断。
        error: processError || parserError,
        exitCode: child.pid === undefined ? null : signal && hasMore ? 0 : code,
        hasMore,
        ...(limitReason ? {limitReason} : {}),
        paths,
        stderr: finishStderr(stderr, stderrDecoder),
        truncated
      });
    });
  });
}

function buildRipgrepArgs(request: NormalizedGlobRequest): string[] {
  return [
    '--files',
    '--hidden',
    '--sort',
    'path',
    '--null',
    '--glob',
    request.pattern,
    '--glob',
    '!.git',
    '--glob',
    '!.git/**',
    '--',
    ...request.paths
  ];
}

function createNullPathParser(onPath: (filePath: string) => void, maxPendingBytes: number, onOverflow: () => void): {write: (chunk: Buffer | string) => void; end: () => void} {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let overflowed = false;

  return {
    write(chunk: Buffer | string) {
      if (overflowed) {
        return;
      }
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const paths = pending.split('\0');
      pending = paths.pop() || '';

      for (const filePath of paths) {
        if (Buffer.byteLength(filePath, 'utf8') > maxPendingBytes) {
          pending = '';
          overflowed = true;
          onOverflow();
          return;
        }
        if (filePath !== '') {
          onPath(filePath);
        }
      }
      if (Buffer.byteLength(pending, 'utf8') > maxPendingBytes) {
        pending = '';
        overflowed = true;
        onOverflow();
      }
    },
    end() {
      if (overflowed) {
        return;
      }
      pending += decoder.end();

      if (pending !== '') {
        onPath(pending);
      }
    }
  };
}

function containsGitSegment(value: string): boolean {
  return value.split(/[\\/]+/).includes('.git');
}

function formatGlobSuccess(result: GlobRunResult, maxPaths: number, maxOutputBytes: number): string {
  const lines = result.paths.length === 0 ? ['no files matched'] : [...result.paths];

  if (result.hasMore) {
    lines.push('', ...formatGlobLimitNotice(result.limitReason || 'count', maxPaths, maxOutputBytes).split('\n'));
  }

  return capUtf8Text(lines.join('\n'), maxOutputBytes).text;
}

function formatGlobLimitNotice(reason: 'bytes' | 'count', maxPaths: number, maxOutputBytes: number): string {
  const explanation = reason === 'bytes'
    ? `Output reached the ${maxOutputBytes} UTF-8 byte limit.`
    : `More than ${maxPaths} paths found (path count limit).`;
  return ['has_more: true', `${explanation} Narrow pattern or paths.`].join('\n');
}

function formatGlobFailure(reason: string, maxOutputBytes: number): string {
  return capUtf8Text([
    'glob failed.',
    `Reason: ${reason}`
  ].join('\n'), maxOutputBytes).text;
}

function appendBoundedStderr(stderr: string, chunk: string): string {
  return capUtf8Text(stderr + chunk, MAX_STDERR_BYTES).text;
}

function finishStderr(stderr: string, decoder: StringDecoder): string {
  return appendBoundedStderr(stderr, decoder.end());
}

function cleanStderr(stderr: string): string {
  return stderr.trim().split('\n').filter((line) => line.trim() !== '').join('\n');
}

export {
  DEFAULT_MAX_PATHS,
  GLOB_TOOL_NAME,
  createGlobToolHandler
};

export type {
  GlobToolHandlerOptions
};
