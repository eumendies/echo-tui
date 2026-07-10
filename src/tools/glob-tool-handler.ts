import {spawn} from 'node:child_process';
import * as path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

import {isGitPath, normalizePositiveInteger, resolveCwd} from './tool-handler-utils';

import type {GlobToolExecutionResult, ToolCall, ToolHandler} from '../types/tool';
import type {Result} from './tool-handler-utils';

const GLOB_TOOL_NAME = 'glob';
const DEFAULT_MAX_PATHS = 200;

type GlobToolHandlerOptions = {
  cwd?: string | (() => string);
  maxPaths?: number;
  rgPath?: string;
};

type NormalizedGlobRequest = {
  paths: string[];
  pattern: string;
};

type GlobRunResult = {
  error?: string;
  exitCode: number | null;
  hasMore: boolean;
  paths: string[];
  stderr: string;
  truncated: boolean;
};

/**
 * 创建本地 glob 工具；用于先按路径模式发现文件，再交给 read_files 或 grep 继续观察。
 */
function createGlobToolHandler(options: GlobToolHandlerOptions = {}): ToolHandler {
  const maxPaths = normalizePositiveInteger(options.maxPaths, DEFAULT_MAX_PATHS);
  const rgPath = options.rgPath || 'rg';

  return {
    definition: {
      name: GLOB_TOOL_NAME,
      description: `Find local file paths by glob pattern using ripgrep file listing. Omit paths to search from the current working directory. Returns files only, includes hidden files, excludes .git internals, and caps results at ${maxPaths} paths; narrow pattern or paths when has_more is true.`,
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
    async execute(args: Record<string, unknown>, call: ToolCall): Promise<GlobToolExecutionResult> {
      const result = await glob(args, {
        cwd: resolveCwd(options.cwd),
        maxPaths,
        rgPath
      });

      return {
        callId: call.callId,
        toolName: GLOB_TOOL_NAME,
        ok: result.ok,
        text: result.text,
        exitCode: result.exitCode,
        truncated: result.truncated
      };
    }
  };
}

async function glob(args: Record<string, unknown>, options: {cwd: string; maxPaths: number; rgPath: string}): Promise<{ok: boolean; text: string; exitCode?: number | null; truncated: boolean}> {
  const normalized = normalizeRequest(args, options.cwd);

  if (!normalized.ok) {
    return {
      ok: false,
      text: formatGlobFailure(normalized.reason),
      truncated: false
    };
  }

  const runResult = await runRipgrepFiles(normalized.value, options);
  const ok = runResult.error === undefined && (runResult.exitCode === 0 || runResult.exitCode === 1);

  return {
    ok,
    exitCode: runResult.exitCode,
    text: ok ? formatGlobSuccess(normalized.value, runResult, options.maxPaths) : formatGlobFailure(runResult.error || cleanStderr(runResult.stderr) || 'ripgrep file listing failed'),
    truncated: runResult.truncated
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

function runRipgrepFiles(request: NormalizedGlobRequest, options: {cwd: string; maxPaths: number; rgPath: string}): Promise<GlobRunResult> {
  return new Promise((resolve) => {
    // 文件发现仍通过参数数组调用 rg，避免把 pattern 或 paths 拼进 shell 命令。
    const child = spawn(options.rgPath, buildRipgrepArgs(request), {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const parser = createNullPathParser((filePath) => {
      const absolutePath = path.resolve(options.cwd, filePath);

      if (isGitPath(absolutePath)) {
        return;
      }

      if (paths.length >= options.maxPaths) {
        // 路径发现不分页；超过上限时终止 rg 并提示模型收窄查询。
        hasMore = true;
        truncated = true;
        child.kill('SIGTERM');
        return;
      }

      paths.push(filePath);
    });

    const paths: string[] = [];
    const stderrChunks: Buffer[] = [];
    let hasMore = false;
    let truncated = false;
    let settled = false;

    child.stdout.on('data', (chunk: Buffer | string) => {
      parser.write(chunk);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        error: error.code === 'ENOENT' ? 'ripgrep executable not found' : error.message,
        exitCode: null,
        hasMore,
        paths,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        truncated
      });
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }

      settled = true;
      parser.end();
      resolve({
        // 因命中上限主动终止时，保留已收集路径并把本次发现视为成功截断。
        error: undefined,
        exitCode: signal && hasMore ? 0 : code,
        hasMore,
        paths,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
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

function createNullPathParser(onPath: (filePath: string) => void): {write: (chunk: Buffer | string) => void; end: () => void} {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  return {
    write(chunk: Buffer | string) {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const paths = pending.split('\0');
      pending = paths.pop() || '';

      for (const filePath of paths) {
        if (filePath !== '') {
          onPath(filePath);
        }
      }
    },
    end() {
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

function formatGlobSuccess(_request: NormalizedGlobRequest, result: GlobRunResult, maxPaths: number): string {
  const lines = result.paths.length === 0 ? ['no files matched'] : [...result.paths];

  if (result.hasMore) {
    lines.push('', 'has_more: true', `More than ${maxPaths} paths found. Narrow pattern or paths.`);
  }

  return lines.join('\n');
}

function formatGlobFailure(reason: string): string {
  return [
    'glob failed.',
    `Reason: ${reason}`
  ].join('\n');
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
