import {spawn} from 'node:child_process';
import * as path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

import {projectScriptList, scriptFailure, validateScriptInput} from './code-mode/contracts';
import type {ScriptToolEnvelope} from './code-mode/contracts';

import {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES, capUtf8Text, isGitPath, normalizePositiveInteger, resolveCwd} from './tool-handler-utils';

import type {GrepDisplayMatch, GrepDisplayMetadata, GrepToolExecutionResult, ToolCall, ToolExecutionOptions, ToolHandler} from '../types/tool';
import type {Result} from './tool-handler-utils';

const GREP_TOOL_NAME = 'grep';
const DEFAULT_MAX_MATCHES = 100;
const MAX_PARSER_PENDING_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;

type GrepToolHandlerOptions = {
  cwd?: string | (() => string); // 本次调用解析相对路径的基准目录。
  maxMatches?: number; // 保留匹配项数量上限。
  maxOutputBytes?: number; // 原生结果和采集的字节上限。
  rgPath?: string; // 受信任的 ripgrep 可执行文件路径。
};

type NormalizedGrepRequest = {
  caseSensitive?: boolean; // 缺失时沿用 ripgrep 大小写规则。
  glob?: string; // 可选路径过滤模式。
  literal: boolean; // 是否按字面量而非正则查询。
  paths: string[]; // 按原生口径保留的有序路径。
  pattern: string; // 不经 shell 展开的查询模式。
};

type GrepRunResult = {
  error?: string; // 采集失败的有界诊断。
  exitCode: number | null; // 子进程的真实退出码或上限中止后的成功码。
  hasMore: boolean; // 已知或可能存在未保留的结果。
  limitReason?: 'bytes' | 'count'; // 决定原生截断提示的预算种类。
  matches: GrepDisplayMatch[]; // 实际保留的原始源行匹配项。
  stderr: string; // 有界标准错误输出。
  truncated: boolean; // 采集预算是否导致信息缺失。
};

/**
 * 创建本地 grep 工具；底层使用 ripgrep JSON 输出提供结构化文本搜索结果。
 */
function createGrepToolHandler(options: GrepToolHandlerOptions = {}): ToolHandler {
  const maxMatches = normalizePositiveInteger(options.maxMatches, DEFAULT_MAX_MATCHES);
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
  const rgPath = options.rgPath || 'rg';

  return {
    definition: {
      name: GREP_TOOL_NAME,
      // 字节上限的细节属于运行时截断通知，不占常态 schema 上下文；这里只声明截断可能发生。
      description: `Search local text files with ripgrep and return structured matches. Omit paths to search from the current working directory. Omit glob for no glob filter, literal to default to true, and case_sensitive to use ripgrep's default case behavior. Results are capped at ${maxMatches} matches and may be truncated when output is large; narrow pattern, paths, or glob when has_more is true.`,
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
    async execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): Promise<GrepToolExecutionResult> {
      const result = await grep(args, {
        cwd: resolveCwd(options.cwd),
        maxMatches,
        maxOutputBytes,
        rgPath,
        abortSignal: executionOptions?.abortSignal
      });

      return {
        callId: call.callId,
        toolName: GREP_TOOL_NAME,
        ok: result.ok,
        text: result.text,
        details: {
          kind: 'grep',
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
      const input = validateScriptInput('grep', args);
      if (!input.ok) {
        return scriptFailure('invalid_arguments', input.reason);
      }
      const cwd = resolveCwd(options.cwd);
      const normalized = normalizeRequest(input.value, cwd);
      if (!normalized.ok) {
        return scriptFailure('invalid_arguments', normalized.reason);
      }
      const result = await runRipgrep(normalized.value, {
        cwd,
        maxMatches,
        maxOutputBytes,
        rgPath,
        abortSignal: executionOptions?.abortSignal,
        script: true
      });
      if (executionOptions?.abortSignal?.aborted) {
        return scriptFailure('cancelled', 'Tool call cancelled');
      }
      if (result.error !== undefined || (result.exitCode !== 0 && result.exitCode !== 1)) {
        return scriptFailure('tool_failed', result.error || cleanStderr(result.stderr) || 'ripgrep failed');
      }
      return projectScriptList('grep', result.matches, result.hasMore, result.truncated);
    }
  };
}

async function grep(args: Record<string, unknown>, options: {
  cwd: string;
  maxMatches: number;
  maxOutputBytes: number;
  rgPath: string;
  abortSignal?: AbortSignal;
  script?: boolean
}): Promise<{
  ok: boolean;
  text: string;
  display?: GrepDisplayMetadata;
  exitCode?: number | null;
  truncated: boolean
}> {
  const normalized = normalizeRequest(args, options.cwd);

  if (!normalized.ok) {
    return {
      ok: false,
      text: formatGrepFailure(normalized.reason, options.maxOutputBytes),
      truncated: false
    };
  }

  const runResult = await runRipgrep(normalized.value, options);
  const ok = runResult.error === undefined && (runResult.exitCode === 0 || runResult.exitCode === 1);

  return {
    ok,
    exitCode: runResult.exitCode,
    text: ok ? formatGrepSuccess(runResult, options.maxMatches, options.maxOutputBytes) : formatGrepFailure(runResult.error || cleanStderr(runResult.stderr) || 'ripgrep failed', options.maxOutputBytes),
    truncated: runResult.truncated,
    ...(ok ? {display: {kind: 'grep', matches: runResult.matches}} : {})
  };
}

function normalizeRequest(args: Record<string, unknown>, cwd: string): Result<NormalizedGrepRequest> {
  const pattern = args.pattern;

  if (typeof pattern !== 'string' || pattern.trim() === '') {
    return {ok: false, reason: 'pattern must be a non-empty string'};
  }

  if (pattern.includes('\0')) {
    return {
      ok: false,
      reason: 'pattern must not contain NUL'
    };
  }

  const paths = normalizePaths(args.paths, cwd);

  if (!paths.ok) {
    return paths;
  }

  const glob = args.glob;

  if (glob !== undefined && glob !== null && (typeof glob !== 'string' || glob.trim() === '')) {
    return {ok: false, reason: 'glob must be a non-empty string or null'};
  }

  if (typeof glob === 'string' && glob.includes('\0')) {
    return {
      ok: false,
      reason: 'glob must not contain NUL'
    };
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

function runRipgrep(request: NormalizedGrepRequest, options: {
  cwd: string;
  maxMatches: number;
  maxOutputBytes: number;
  rgPath: string;
  abortSignal?: AbortSignal;
  script?: boolean
}): Promise<GrepRunResult> {
  if (options.abortSignal?.aborted) {
    return Promise.resolve({
      error: 'Tool call cancelled',
      exitCode: null,
      hasMore: false,
      matches: [],
      stderr: '',
      truncated: false
    });
  }
  return new Promise((resolve) => {
    // 使用参数数组调用 ripgrep，避免把模型输入拼接进 shell 命令。
    const child = spawn(options.rgPath, buildRipgrepArgs(request), {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const parser = createJsonLineParser((line) => {
      if (limitReached) {
        return;
      }
      const match = parseRipgrepMatch(line);

      if (!match || isGitPath(path.resolve(options.cwd, match.path))) {
        return;
      }

      if (matches.length >= options.maxMatches) {
        // 搜索结果不做 offset/limit 分页；命中过多时终止 rg 并提示模型收窄查询。
        hasMore = true;
        limitReason = 'count';
        truncated = true;
        limitReached = true;
        stop();
        return;
      }

      const prefix = `${match.path}:${match.line}:${match.column}: `;
      const separatorBytes = matches.length === 0 ? 0 : 1;
      const notice = formatGrepLimitNotice('bytes', options.maxMatches, options.maxOutputBytes);
      const availableLineBytes = options.maxOutputBytes
        - outputBytes
        - separatorBytes
        - Buffer.byteLength(`\n\n${notice}`, 'utf8');
      const fullLineBytes = Buffer.byteLength(prefix + match.text, 'utf8');

      if (fullLineBytes <= availableLineBytes) {
        matches.push(match);
        outputBytes += separatorBytes + fullLineBytes;
        return;
      }

      const textBudget = availableLineBytes - Buffer.byteLength(prefix, 'utf8');
      if (textBudget >= 0 && !options.script) {
        const boundedText = capUtf8Text(match.text, textBudget).text;
        matches.push({...match, text: boundedText});
      }
      hasMore = true;
      limitReason = 'bytes';
      truncated = true;
      limitReached = true;
      stop();
    }, MAX_PARSER_PENDING_BYTES, () => {
      if (!limitReached) {
        if (options.script) {
          hasMore = true;
          truncated = true;
          limitReason = 'bytes';
        } else {
          parserError = `ripgrep JSON line exceeded ${MAX_PARSER_PENDING_BYTES} bytes without a delimiter`;
        }
        limitReached = true;
        stop();
      }
    });

    const matches: GrepDisplayMatch[] = [];
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
        // 因命中上限主动终止时，保留已收集结果并把本次搜索视为成功截断。
        error: processError || parserError,
        exitCode: child.pid === undefined ? null : signal && hasMore ? 0 : code,
        hasMore,
        ...(limitReason ? {limitReason} : {}),
        matches,
        stderr: finishStderr(stderr, stderrDecoder),
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

function createJsonLineParser(onLine: (line: string) => void, maxPendingBytes: number, onOverflow: () => void): {write: (chunk: Buffer | string) => void; end: () => void} {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let overflowed = false;

  return {
    write(chunk: Buffer | string) {
      if (overflowed) {
        return;
      }
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';

      // 已闭合的超长 JSON 行也受上限约束，且先保留它之前已完成的匹配。
      for (const line of lines) {
        if (Buffer.byteLength(line, 'utf8') > maxPendingBytes) {
          pending = '';
          overflowed = true;
          onOverflow();
          return;
        }
        if (line.trim() !== '') {
          onLine(line);
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

      if (pending.trim() !== '') {
        onLine(pending);
      }
    }
  };
}

function parseRipgrepMatch(line: string): GrepDisplayMatch | undefined {
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

function formatGrepSuccess(result: GrepRunResult, maxMatches: number, maxOutputBytes: number): string {
  const lines = result.matches.length === 0
    ? ['no matches found']
    : result.matches.map((match) => `${match.path}:${match.line}:${match.column}: ${match.text}`);

  if (result.hasMore) {
    lines.push('', ...formatGrepLimitNotice(result.limitReason || 'count', maxMatches, maxOutputBytes).split('\n'));
  }

  return capUtf8Text(lines.join('\n'), maxOutputBytes).text;
}

function formatGrepLimitNotice(reason: 'bytes' | 'count', maxMatches: number, maxOutputBytes: number): string {
  const explanation = reason === 'bytes'
    ? `Output reached the ${maxOutputBytes} UTF-8 byte limit.`
    : `More than ${maxMatches} matches found (match count limit).`;
  return ['has_more: true', `${explanation} Narrow pattern, paths, or glob.`].join('\n');
}

function formatGrepFailure(reason: string, maxOutputBytes: number): string {
  return capUtf8Text([
    'grep failed.',
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
  DEFAULT_MAX_MATCHES,
  GREP_TOOL_NAME,
  createGrepToolHandler
};

export type {
  GrepToolHandlerOptions
};
