import {spawn} from 'node:child_process';
import * as path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

import {isGitPath, normalizePositiveInteger, resolveCwd} from './tool-handler-utils';

import type {GrepToolExecutionResult, ToolCall, ToolHandler} from '../types/tool';
import type {Result} from './tool-handler-utils';

const GREP_TOOL_NAME = 'grep';
const DEFAULT_MAX_MATCHES = 100;

type GrepToolHandlerOptions = {
  cwd?: string | (() => string);
  maxMatches?: number;
  rgPath?: string;
};

type NormalizedGrepRequest = {
  caseSensitive?: boolean;
  glob?: string;
  literal: boolean;
  paths: string[];
  pattern: string;
};

type GrepMatch = {
  column: number;
  line: number;
  path: string;
  text: string;
};

type GrepRunResult = {
  error?: string;
  exitCode: number | null;
  hasMore: boolean;
  matches: GrepMatch[];
  stderr: string;
  truncated: boolean;
};

/**
 * 创建本地 grep 工具；底层使用 ripgrep JSON 输出提供结构化文本搜索结果。
 */
function createGrepToolHandler(options: GrepToolHandlerOptions = {}): ToolHandler {
  const maxMatches = normalizePositiveInteger(options.maxMatches, DEFAULT_MAX_MATCHES);
  const rgPath = options.rgPath || 'rg';

  return {
    definition: {
      name: GREP_TOOL_NAME,
      description: `Search local text files with ripgrep and return structured matches. Omit paths to search from the current working directory. Omit glob for no glob filter, literal to default to true, and case_sensitive to use ripgrep's default case behavior. Results are capped at ${maxMatches} matches; narrow pattern, paths, or glob when has_more is true.`,
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
          },
          glob: {
            type: 'string'
          },
          literal: {
            type: 'boolean',
            description: 'Defaults to true. Set to false to enable regex search, equivalent to grep -E/rg regex.'
          },
          case_sensitive: {
            type: 'boolean'
          }
        }
      }
    },
    async execute(args: Record<string, unknown>, call: ToolCall): Promise<GrepToolExecutionResult> {
      const result = await grep(args, {
        cwd: resolveCwd(options.cwd),
        maxMatches,
        rgPath
      });

      return {
        callId: call.callId,
        toolName: GREP_TOOL_NAME,
        ok: result.ok,
        text: result.text,
        details: {
          kind: 'grep',
          exitCode: result.exitCode,
          truncated: result.truncated
        }
      };
    }
  };
}

async function grep(args: Record<string, unknown>, options: {cwd: string; maxMatches: number; rgPath: string}): Promise<{ok: boolean; text: string; exitCode?: number | null; truncated: boolean}> {
  const normalized = normalizeRequest(args, options.cwd);

  if (!normalized.ok) {
    return {
      ok: false,
      text: formatGrepFailure(normalized.reason),
      truncated: false
    };
  }

  const runResult = await runRipgrep(normalized.value, options);
  const ok = runResult.error === undefined && (runResult.exitCode === 0 || runResult.exitCode === 1);

  return {
    ok,
    exitCode: runResult.exitCode,
    text: ok ? formatGrepSuccess(normalized.value, runResult, options.maxMatches) : formatGrepFailure(runResult.error || cleanStderr(runResult.stderr) || 'ripgrep failed'),
    truncated: runResult.truncated
  };
}

function normalizeRequest(args: Record<string, unknown>, cwd: string): Result<NormalizedGrepRequest> {
  const pattern = args.pattern;

  if (typeof pattern !== 'string' || pattern.trim() === '') {
    return {ok: false, reason: 'pattern must be a non-empty string'};
  }

  const paths = normalizePaths(args.paths, cwd);

  if (!paths.ok) {
    return paths;
  }

  const glob = args.glob;

  if (glob !== undefined && glob !== null && (typeof glob !== 'string' || glob.trim() === '')) {
    return {ok: false, reason: 'glob must be a non-empty string or null'};
  }

  const literal = args.literal;

  if (literal !== undefined && literal !== null && typeof literal !== 'boolean') {
    return {ok: false, reason: 'literal must be a boolean or null'};
  }

  const caseSensitive = args.case_sensitive;

  if (caseSensitive !== undefined && caseSensitive !== null && typeof caseSensitive !== 'boolean') {
    return {ok: false, reason: 'case_sensitive must be a boolean or null'};
  }

  return {
    ok: true,
    value: {
      ...(caseSensitive === undefined || caseSensitive === null ? {} : {caseSensitive}),
      ...(glob === undefined || glob === null ? {} : {glob}),
      // 默认固定字符串搜索，避免模型搜索代码片段时被正则特殊字符意外影响。
      literal: literal !== false,
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

function runRipgrep(request: NormalizedGrepRequest, options: {cwd: string; maxMatches: number; rgPath: string}): Promise<GrepRunResult> {
  return new Promise((resolve) => {
    // 使用参数数组调用 ripgrep，避免把模型输入拼接进 shell 命令。
    const child = spawn(options.rgPath, buildRipgrepArgs(request), {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const parser = createJsonLineParser((line) => {
      const match = parseRipgrepMatch(line);

      if (!match) {
        return;
      }

      if (matches.length >= options.maxMatches) {
        // 搜索结果不做 offset/limit 分页；命中过多时终止 rg 并提示模型收窄查询。
        hasMore = true;
        truncated = true;
        child.kill('SIGTERM');
        return;
      }

      matches.push(match);
    });

    const matches: GrepMatch[] = [];
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
        matches,
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
        // 因命中上限主动终止时，保留已收集结果并把本次搜索视为成功截断。
        error: undefined,
        exitCode: signal && hasMore ? 0 : code,
        hasMore,
        matches,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        truncated
      });
    });
  });
}

function buildRipgrepArgs(request: NormalizedGrepRequest): string[] {
  const args = ['--json', '--line-number', '--column'];

  if (request.literal) {
    args.push('--fixed-strings');
  }

  if (request.caseSensitive === true) {
    args.push('--case-sensitive');
  } else if (request.caseSensitive === false) {
    args.push('--ignore-case');
  }

  if (request.glob) {
    args.push('--glob', request.glob);
  }

  args.push('--', request.pattern, ...request.paths);

  return args;
}

function createJsonLineParser(onLine: (line: string) => void): {write: (chunk: Buffer | string) => void; end: () => void} {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  return {
    write(chunk: Buffer | string) {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() !== '') {
          onLine(line);
        }
      }
    },
    end() {
      pending += decoder.end();

      if (pending.trim() !== '') {
        onLine(pending);
      }
    }
  };
}

function parseRipgrepMatch(line: string): GrepMatch | undefined {
  let event: unknown;

  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!event || typeof event !== 'object') {
    return undefined;
  }

  const candidate = event as {type?: unknown; data?: unknown};

  if (candidate.type !== 'match' || !candidate.data || typeof candidate.data !== 'object') {
    return undefined;
  }

  const data = candidate.data as {path?: unknown; line_number?: unknown; lines?: unknown; submatches?: unknown};
  const text = extractRipgrepText(data.lines);
  const matchPath = extractRipgrepText(data.path);
  const column = extractFirstColumn(data.submatches);

  if (typeof data.line_number !== 'number' || !matchPath || text === undefined || column === undefined) {
    return undefined;
  }

  return {
    column,
    line: data.line_number,
    path: matchPath,
    text: text.replace(/\r?\n$/, '')
  };
}

function extractRipgrepText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as {text?: unknown};

  return typeof candidate.text === 'string' ? candidate.text : undefined;
}

function extractFirstColumn(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const first = value[0];

  if (!first || typeof first !== 'object') {
    return undefined;
  }

  const candidate = first as {start?: unknown};

  return typeof candidate.start === 'number' ? candidate.start + 1 : undefined;
}

function formatGrepSuccess(_request: NormalizedGrepRequest, result: GrepRunResult, maxMatches: number): string {
  const lines = result.matches.length === 0
    ? ['no matches found']
    : result.matches.map((match) => `${match.path}:${match.line}:${match.column}: ${match.text}`);

  if (result.hasMore) {
    lines.push('', 'has_more: true', `More than ${maxMatches} matches found. Narrow pattern, paths, or glob.`);
  }

  return lines.join('\n');
}

function formatGrepFailure(reason: string): string {
  return [
    'grep failed.',
    `Reason: ${reason}`
  ].join('\n');
}

function cleanStderr(stderr: string): string {
  return stderr.trim().split('\n').filter((line) => line.trim() !== '').join('\n');
}

export {
  DEFAULT_MAX_MATCHES,
  GREP_TOOL_NAME,
  createGrepToolHandler
};

export type {
  GrepToolHandlerOptions
};
