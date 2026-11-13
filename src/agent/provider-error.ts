import {LlmAgentError, redactSensitiveText} from './agent-errors';

import type {ProviderErrorKind} from '../types/agent';

type ProviderErrorFields = {
  message: string; // 已脱敏或待脱敏的可展示错误消息。
  code?: string; // provider 返回的结构化错误码，优先于其他证据。
  type?: string; // provider 错误类型（Anthropic 的 error.type 等）。
  status?: number; // HTTP 状态码；流内错误事件通常缺失。
  retryAfterMs?: number; // 服务端建议的剩余等待毫秒数。
  requestId?: string; // 服务端 request ID，用于排查。
  cause?: unknown; // 原始异常，仅用于本地诊断。
};

type RetryDecision =
  | {kind: 'never'} // 不可恢复，立即失败。
  | {kind: 'backoff'; baseDelayMs: number} // 指数退避 + 抖动。
  | {kind: 'server-directed'; baseDelayMs: number; maxAttempts: number}; // 优先服务端建议，缺失时按保守退避并受独立子预算约束。

const DEFAULT_MAX_RETRIES = 5;
const MAX_RETRIES_LIMIT = 20;
const BACKOFF_BASE_DELAY_MS = 500;
const BACKOFF_MAX_DELAY_MS = 60_000;
const BACKOFF_JITTER_RATIO = 0.2;
const SERVER_DIRECTED_MAX_ATTEMPTS = 2;
const RATE_LIMIT_FALLBACK_BASE_DELAY_MS = 5_000;
const OVERLOADED_FALLBACK_BASE_DELAY_MS = 2_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;
const MIN_STREAM_IDLE_TIMEOUT_MS = 10_000;
const MAX_STREAM_IDLE_TIMEOUT_MS = 3_600_000;

// 兼容文案表：仅在结构化证据缺失时作为最后一级兜底，避免一次性服务端文案变更导致重试失效。
const RATE_LIMIT_MESSAGE_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /try again in \d/i
];
const OVERLOADED_MESSAGE_PATTERNS = [
  /overloaded/i,
  /currently experiencing high demand/i,
  /at capacity/i
];
const TRANSIENT_MESSAGE_PATTERNS = [
  /an error occurred while processing your request/i,
  /internal server error/i,
  /upstream connect error/i,
  /bad gateway/i,
  /service unavailable/i,
  /stream disconnected/i
];

// 结构化错误码到语义类别的映射；键统一按小写比较。
const PROVIDER_ERROR_CODE_KINDS: Readonly<Record<string, ProviderErrorKind>> = {
  context_length_exceeded: 'context_overflow',
  content_filter: 'content_filter',
  content_policy_violation: 'content_filter',
  insufficient_quota: 'quota',
  usage_not_included: 'quota',
  credit_balance_exhausted: 'quota',
  invalid_api_key: 'auth',
  invalid_authentication: 'auth',
  authentication_error: 'auth',
  permission_denied: 'auth',
  rate_limit_error: 'rate_limit',
  rate_limit_exceeded: 'rate_limit',
  slow_down: 'rate_limit',
  overloaded_error: 'overloaded',
  server_is_overloaded: 'overloaded',
  policy_capacity_unavailable: 'overloaded',
  api_error: 'transient',
  server_error: 'transient',
  internal_error: 'transient',
  timeout: 'transient',
  invalid_request_error: 'invalid_request'
};

// Node/undici 网络错误的 code 集合；这类失败一律视为可重试的瞬时连接问题。
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET'
]);

const TRANSIENT_NETWORK_MESSAGE_PATTERNS = [
  /premature close/i,
  /socket hang up/i,
  /stream closed/i,
  /other side closed/i
];

class ProviderError extends LlmAgentError {
  readonly kind: ProviderErrorKind;
  readonly code?: string;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly requestId?: string;

  constructor(fields: ProviderErrorFields & {kind: ProviderErrorKind}) {
    super(redactSensitiveText(fields.message));
    this.name = 'ProviderError';
    this.kind = fields.kind;
    this.code = fields.code;
    this.status = fields.status;
    this.retryAfterMs = fields.retryAfterMs;
    this.requestId = fields.requestId;

    if (fields.cause !== undefined) {
      this.cause = fields.cause;
    }
  }
}

/** 读取 HTTP headers 中的单个值，兼容 Headers 实例、普通对象与已被反序列化的 JSON。 */
function readHeaderValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  const candidate = headers as {get?: unknown} & Record<string, unknown>;

  if (typeof candidate.get === 'function') {
    const value = (candidate.get as (key: string) => unknown)(name);
    return typeof value === 'string' ? value : undefined;
  }

  const lowerName = name.toLowerCase();

  for (const [key, value] of Object.entries(candidate)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

/** 解析 `Retry-After` / `retry-after-ms` 两类服务端建议，返回剩余等待毫秒数。 */
function readRetryAfterMs(headers: unknown): number | undefined {
  const millisHeader = readHeaderValue(headers, 'retry-after-ms');

  if (millisHeader !== undefined) {
    const millis = Number.parseFloat(millisHeader);

    if (Number.isFinite(millis) && millis >= 0) {
      return millis;
    }
  }

  const secondsHeader = readHeaderValue(headers, 'retry-after');

  if (secondsHeader === undefined) {
    return undefined;
  }

  const seconds = Number.parseFloat(secondsHeader);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // HTTP date 形式：按相对当前时刻的剩余时长折算，过期视为 0。
  const deadline = Date.parse(secondsHeader);

  return Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : undefined;
}

/** 从限流文案中提取 `try again in 11.054s` 这类服务端建议。 */
function readRetryAfterMsFromMessage(message: string): number | undefined {
  const match = /try again in\s*(\d+(?:\.\d+)?)\s*(ms|s|seconds?)/i.exec(message);

  if (!match) {
    return undefined;
  }

  const value = Number.parseFloat(match[1]);

  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return match[2].toLowerCase() === 'ms' ? value : value * 1000;
}

function matchesAny(patterns: readonly RegExp[], message: string): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

/** 依据结构化错误码判定语义类别；未知码返回 undefined 以便继续降级判定。 */
function classifyCode(code: string | undefined): ProviderErrorKind | undefined {
  return code === undefined ? undefined : PROVIDER_ERROR_CODE_KINDS[code.toLowerCase()];
}

/**
 * 依据 HTTP 状态码判定语义类别；仅覆盖语义明确的档位。
 * 409 归入可重试，与 OpenAI SDK `shouldRetry` 的既有语义保持一致。
 */
function classifyStatus(status: number | undefined): ProviderErrorKind | undefined {
  if (status === undefined) {
    return undefined;
  }

  if (status === 401 || status === 403) {
    return 'auth';
  }

  if (status === 429) {
    return 'rate_limit';
  }

  if (status === 408 || status === 409 || status >= 500) {
    return 'transient';
  }

  if (status === 400 || status === 422) {
    return 'invalid_request';
  }

  return undefined;
}

function readErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const status = (error as {status?: unknown}).status;

  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidates = error as {code?: unknown; type?: unknown};
  const code = candidates.code;

  if (typeof code === 'string' && code !== '') {
    return code;
  }

  const type = candidates.type;

  return typeof type === 'string' && type !== '' ? type : undefined;
}

function readErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as {message?: unknown}).message;

    if (typeof message === 'string' && message.trim() !== '') {
      return message;
    }
  }

  return '';
}

function classifyMessage(message: string): ProviderErrorKind {
  if (matchesAny(RATE_LIMIT_MESSAGE_PATTERNS, message)) {
    return 'rate_limit';
  }

  if (matchesAny(OVERLOADED_MESSAGE_PATTERNS, message)) {
    return 'overloaded';
  }

  if (matchesAny(TRANSIENT_MESSAGE_PATTERNS, message)) {
    return 'transient';
  }

  return 'unknown';
}

type ProviderErrorEvidence = {
  code?: string; // provider 结构化错误码或运行时网络错误码。
  message?: string; // 原始错误文案，仅在前面的结构化证据缺失时参与判定。
  status?: number; // HTTP 状态码；流内错误事件通常缺失。
  type?: string; // provider 错误类型（Anthropic 的 error.type 等）。
};

/**
 * 唯一的语义类别判定链：网络错误码 → provider 错误码/类型 → HTTP 状态 → 网络文案 → 通用文案。
 * 两个对外入口都复用该函数，避免维护两套优先级顺序。
 */
function resolveProviderErrorKind(evidence: ProviderErrorEvidence): ProviderErrorKind {
  const code = evidence.code ?? evidence.type;

  // 网络错误码优先：undici 与 provider 共用 code 字段，但语义不同。
  if (code !== undefined && TRANSIENT_NETWORK_CODES.has(code)) {
    return 'transient';
  }

  const byCode = classifyCode(code);

  if (byCode !== undefined) {
    return byCode;
  }

  const byStatus = classifyStatus(evidence.status);

  if (byStatus !== undefined) {
    return byStatus;
  }

  const message = evidence.message ?? '';

  if (message !== '' && matchesAny(TRANSIENT_NETWORK_MESSAGE_PATTERNS, message)) {
    return 'transient';
  }

  return message === '' ? 'unknown' : classifyMessage(message);
}

/** 由 adapter 已解析出的结构化证据构造分类错误。 */
function createProviderError(fields: ProviderErrorFields): ProviderError {
  return new ProviderError({
    ...fields,
    kind: resolveProviderErrorKind(fields),
    retryAfterMs: fields.retryAfterMs ?? readRetryAfterMsFromMessage(fields.message)
  });
}

/** 从任意异常构造分类错误；已是 ProviderError 时保持原样，避免丢失已解析的结构化证据。 */
function classifyProviderError(error: unknown, fallbackMessage = '模型响应流异常'): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof LlmAgentError) {
    const kind = classifyMessage(error.message);
    return new ProviderError({message: error.message, kind});
  }

  const message = readErrorMessage(error);
  const code = readErrorCode(error);
  const status = readErrorStatusCode(error);
  const retryAfterMs = readRetryAfterMs(typeof error === 'object' && error !== null ? (error as {headers?: unknown}).headers : undefined);
  const kind = resolveProviderErrorKind({code, message, status});
  const displayMessage = message === '' ? fallbackMessage : `${fallbackMessage}：${redactSensitiveText(message)}`;

  return new ProviderError({
    message: displayMessage,
    kind,
    code,
    status,
    retryAfterMs,
    cause: error
  });
}

/** 依据语义类别给出重试决策；`server-directed` 在缺建议时回退到类别自己的保守退避。 */
function resolveRetryDecision(kind: ProviderErrorKind): RetryDecision {
  switch (kind) {
    case 'transient':
    case 'stream_incomplete':
      return {kind: 'backoff', baseDelayMs: BACKOFF_BASE_DELAY_MS};
    case 'rate_limit':
      return {kind: 'server-directed', baseDelayMs: RATE_LIMIT_FALLBACK_BASE_DELAY_MS, maxAttempts: SERVER_DIRECTED_MAX_ATTEMPTS};
    case 'overloaded':
      return {kind: 'server-directed', baseDelayMs: OVERLOADED_FALLBACK_BASE_DELAY_MS, maxAttempts: SERVER_DIRECTED_MAX_ATTEMPTS};
    case 'provider_incomplete':
    case 'content_filter':
    case 'invalid_request':
    case 'context_overflow':
    case 'auth':
    case 'quota':
    case 'aborted':
    case 'unknown':
      return {kind: 'never'};
    default:
      return {kind: 'never'};
  }
}

/**
 * 计算一次重试的等待时长：服务端建议优先并限制上限，缺失时按类别退避并叠加抖动。
 * 返回 undefined 表示该失败不可重试。
 */
function resolveRetryDelayMs(error: ProviderError, retryCount: number, random: () => number): number | undefined {
  const decision = resolveRetryDecision(error.kind);

  if (decision.kind === 'never') {
    return undefined;
  }

  if (error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, BACKOFF_MAX_DELAY_MS);
  }

  if (decision.kind === 'server-directed' && retryCount > decision.maxAttempts) {
    return undefined;
  }

  const exponential = Math.min(decision.baseDelayMs * 2 ** (retryCount - 1), BACKOFF_MAX_DELAY_MS);
  const jitter = 1 - BACKOFF_JITTER_RATIO + random() * BACKOFF_JITTER_RATIO * 2;

  return Math.round(exponential * jitter);
}

/** 返回面向用户的失败原因标签，用于重试 notice 与最终错误。 */
function describeProviderErrorKind(kind: ProviderErrorKind): string {
  switch (kind) {
    case 'transient':
      return '连接中断';
    case 'rate_limit':
      return '服务限流';
    case 'overloaded':
      return '服务过载';
    case 'stream_incomplete':
      return '响应流中断';
    case 'provider_incomplete':
      return '响应未完整结束';
    case 'content_filter':
      return '内容策略拒绝';
    case 'invalid_request':
      return '请求无效';
    case 'context_overflow':
      return '上下文超限';
    case 'auth':
      return '鉴权失败';
    case 'quota':
      return '配额不足';
    case 'aborted':
      return '已取消';
    default:
      return '模型服务异常';
  }
}

/**
 * 复制分类错误并补充可展示的上下文（request ID、已重试次数）。
 * 结构化字段与原始 cause 一并保留，避免最终错误丢失排查线索。
 */
function annotateProviderError(error: ProviderError, options: {requestId?: string | null; messageSuffix?: string} = {}): ProviderError {
  const suffixParts: string[] = [];
  const requestId = options.requestId;

  if (requestId && !error.message.includes(requestId)) {
    suffixParts.push(`request ID: ${redactSensitiveText(requestId)}`);
  }

  if (options.messageSuffix && !error.message.includes(options.messageSuffix)) {
    suffixParts.push(options.messageSuffix);
  }

  if (suffixParts.length === 0) {
    return error;
  }

  return new ProviderError({
    message: `${error.message}（${suffixParts.join('，')}）`,
    kind: error.kind,
    code: error.code,
    status: error.status,
    retryAfterMs: error.retryAfterMs,
    requestId: error.requestId ?? requestId ?? undefined,
    cause: error.cause
  });
}

export {
  BACKOFF_BASE_DELAY_MS,
  BACKOFF_MAX_DELAY_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  MAX_RETRIES_LIMIT,
  MAX_STREAM_IDLE_TIMEOUT_MS,
  MIN_STREAM_IDLE_TIMEOUT_MS,
  ProviderError,
  annotateProviderError,
  classifyProviderError,
  createProviderError,
  describeProviderErrorKind,
  readRetryAfterMs,
  readRetryAfterMsFromMessage,
  resolveRetryDecision,
  resolveRetryDelayMs
};

export type {ProviderErrorFields, ProviderErrorKind, RetryDecision};
