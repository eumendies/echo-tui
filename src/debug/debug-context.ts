import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {LlmConfig} from '../types/agent';

const DEBUG_ENV_NAME = 'ECHO_TUI_DEBUG';
const DEBUG_LOG_ENV_NAME = 'ECHO_TUI_DEBUG_LOG';
const DEFAULT_PREVIEW_LIMIT = 80;

type DebugEventPayload = Record<string, unknown>;

type DebugContext = {
  enabled: boolean;
  logPath: string | null;
  emit: (event: string, payload?: DebugEventPayload) => void;
  close: () => void;
};

type DebugEnvironment = Record<string, string | undefined>;

type DebugContextOptions = {
  cwd?: string;
  env?: DebugEnvironment;
  fsImpl?: Pick<typeof fs, 'appendFileSync' | 'mkdirSync'>;
  now?: () => Date;
  osImpl?: Pick<typeof os, 'homedir'>;
  pid?: number;
};

type EnabledDebugContextOptions = DebugContextOptions & {
  logPath?: string;
};

type TextSummary = {
  hash: string;
  length: number;
  preview?: string;
  truncated?: boolean;
};

const disabledDebugContext: DebugContext = {
  enabled: false,
  logPath: null,
  emit() {},
  close() {}
};

/**
 * 根据开发者环境变量创建 debug context；未启用时返回无副作用实例。
 */
function createDebugContext(options: DebugContextOptions = {}): DebugContext {
  const env = options.env || process.env;

  if (!isDebugEnabled(env[DEBUG_ENV_NAME])) {
    return disabledDebugContext;
  }

  return createEnabledDebugContext({
    ...options,
    logPath: normalizeLogPath(env[DEBUG_LOG_ENV_NAME]) || createDefaultDebugLogPath(options)
  });
}

/**
 * 创建真实写文件的 debug context；所有写入都是 best-effort，不影响主流程。
 */
function createEnabledDebugContext(options: EnabledDebugContextOptions = {}): DebugContext {
  const fsImpl = options.fsImpl || fs;
  const now = options.now || (() => new Date());
  const logPath = options.logPath || createDefaultDebugLogPath(options);
  let sequence = 0;
  let closed = false;

  function emit(event: string, payload: DebugEventPayload = {}): void {
    if (closed) {
      return;
    }

    sequence += 1;
    const line = JSON.stringify(toJsonSafeValue({
      timestamp: now().toISOString(),
      seq: sequence,
      event,
      ...payload
    }));

    try {
      fsImpl.mkdirSync(path.dirname(logPath), {recursive: true});
      fsImpl.appendFileSync(logPath, `${line}\n`, 'utf8');
    } catch (_error: unknown) {
      // debug 日志是旁路能力，写入失败不能改变 TUI 主流程。
    }
  }

  return {
    enabled: true,
    logPath,
    emit,
    close() {
      closed = true;
    }
  };
}

function isDebugEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();

  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeLogPath(value: string | undefined): string | null {
  const trimmed = String(value || '').trim();

  return trimmed === '' ? null : path.resolve(trimmed);
}

function createDefaultDebugLogPath(options: DebugContextOptions = {}): string {
  const osImpl = options.osImpl || os;
  const now = options.now || (() => new Date());
  const pid = options.pid ?? process.pid;
  const timestamp = now().toISOString().replace(/[:.]/g, '-');

  return path.join(osImpl.homedir(), '.echo', 'echo_tui', 'debug', `${timestamp}-${pid}.jsonl`);
}

function summarizeText(value: unknown, previewLimit = DEFAULT_PREVIEW_LIMIT): TextSummary {
  const text = String(value ?? '');
  const preview = previewLimit > 0 ? text.slice(0, previewLimit) : undefined;

  return {
    length: text.length,
    hash: hashText(text),
    ...(preview !== undefined ? {preview} : {}),
    ...(preview !== undefined && preview.length < text.length ? {truncated: true} : {})
  };
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function hashValue(value: unknown): string {
  return hashText(stableStringify(value));
}

function redactProviderConfig(config: Partial<LlmConfig> | null | undefined): Record<string, unknown> {
  if (!config) {
    return {};
  }

  return {
    ...(typeof config.agentType === 'string' ? {agentType: config.agentType} : {}),
    ...(typeof config.baseURL === 'string' ? {baseURL: config.baseURL} : {}),
    ...(typeof config.contextWindow === 'number' ? {contextWindow: config.contextWindow} : {}),
    ...(typeof config.model === 'string' ? {model: config.model} : {}),
    ...(typeof config.reasoningEffort === 'string' ? {reasoningEffort: config.reasoningEffort} : {}),
    ...(typeof config.reasoningSummary === 'string' ? {reasoningSummary: config.reasoningSummary} : {})
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortForStableStringify((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

function toJsonSafeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Error) {
    return {name: value.name, message: value.message};
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafeValue(entry, seen));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((result, [key, entry]) => {
    if (typeof entry !== 'function' && typeof entry !== 'undefined') {
      result[key] = toJsonSafeValue(entry, seen);
    }

    return result;
  }, {});
}

export {
  DEBUG_ENV_NAME,
  DEBUG_LOG_ENV_NAME,
  createDebugContext,
  createDefaultDebugLogPath,
  createEnabledDebugContext,
  disabledDebugContext,
  hashText,
  hashValue,
  isDebugEnabled,
  redactProviderConfig,
  summarizeText
};

export type {
  DebugContext,
  DebugContextOptions,
  DebugEventPayload,
  TextSummary
};
