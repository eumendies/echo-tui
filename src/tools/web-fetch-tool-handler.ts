import * as net from 'node:net';

import {normalizePositiveInteger} from './tool-handler-utils';
import {createOffloadedTextPreview} from './tool-result-offloading';

import type {ToolCall, ToolExecutionOptions, ToolHandler, WebFetchToolExecutionResult} from '../types/tool';
import type {Result} from './tool-handler-utils';
import type {ToolResultStore} from './tool-result-offloading';

const WEB_FETCH_TOOL_NAME = 'web_fetch';

// 网络工具默认暴露给模型，所有外部输入和回传内容都必须有硬边界。
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = 65_536;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_URL_BYTES = 4096;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type WebFetchToolHandlerOptions = {
  fetch?: FetchLike;
  maxRedirects?: number;
  maxResponseBytes?: number;
  maxTotalOutputBytes?: number;
  maxUrlBytes?: number;
  timeoutMs?: number;
  toolResultStore?: ToolResultStore;
};

type WebFetchLimits = {
  maxRedirects: number;
  maxResponseBytes: number;
  maxTotalOutputBytes: number;
  maxUrlBytes: number;
  timeoutMs: number;
};

type NormalizedWebFetchRequest = {
  limit?: number;
  offset: number;
  url: URL;
};

type FetchMetadata = {
  bodyTruncated: boolean;
  contentType: string;
  fetchedBytes: number;
  finalUrl: string;
  redirected: boolean;
  status: number;
  statusText: string;
  url: string;
};

type FetchSuccess = FetchMetadata & {
  body: string;
};

type TextProjection = {
  content: string;
  hasMore: boolean;
  returnedLines: number;
};

/**
 * 创建远程 URL 读取工具；只负责明确 HTTP(S) URL 的 bounded 文本读取，不做搜索或认证。
 */
function createWebFetchToolHandler(options: WebFetchToolHandlerOptions = {}): ToolHandler {
  const limits = normalizeLimits(options);
  const fetchFn = options.fetch || globalThis.fetch.bind(globalThis);

  return {
    definition: {
      name: WEB_FETCH_TOOL_NAME,
      description: `Fetch one explicit HTTP(S) URL with GET and return bounded text content. Supports text and lightweight HTML-to-text output; omit offset to start at line 0 and omit limit to read to the end. Does not support search, browser rendering, credentials, cookies, custom headers, uploads, or binary downloads. Rejects unsafe URLs and caps redirects, response bytes, and output bytes.`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: {
          url: {
            type: 'string'
          },
          offset: {
            type: 'number'
          },
          limit: {
            type: 'number'
          }
        }
      }
    },
    async execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): Promise<WebFetchToolExecutionResult> {
      const result = await webFetch(args, {
        abortSignal: executionOptions?.abortSignal,
        fetchFn,
        limits,
        toolResultStore: options.toolResultStore
      });

      return {
        callId: call.callId,
        toolName: WEB_FETCH_TOOL_NAME,
        ok: result.ok,
        text: result.text,
        details: {
          kind: 'web_fetch',
          timedOut: result.timedOut,
          truncated: result.truncated
        }
      };
    }
  };
}

async function webFetch(args: Record<string, unknown>, options: {abortSignal?: AbortSignal; fetchFn: FetchLike; limits: WebFetchLimits; toolResultStore?: ToolResultStore}): Promise<{ok: boolean; text: string; timedOut: boolean; truncated: boolean}> {
  const normalized = normalizeRequest(args, options.limits);

  if (!normalized.ok) {
    return {
      ok: false,
      text: formatWebFetchFailure(normalized.reason),
      timedOut: false,
      truncated: false
    };
  }

  const fetched = await fetchWithRedirects(normalized.value.url, options);

  if (!fetched.ok) {
    return {
      ok: false,
      text: formatWebFetchFailure(fetched.reason),
      timedOut: fetched.timedOut,
      truncated: false
    };
  }

  const media = classifyContentType(fetched.value.contentType);
  const ok = fetched.value.status >= 200 && fetched.value.status < 300 && media.kind !== 'unsupported';

  if (media.kind === 'unsupported') {
    return {
      ok: false,
      text: formatUnsupportedResponse(fetched.value, media.reason),
      timedOut: false,
      truncated: false
    };
  }

  const text = media.kind === 'html' ? htmlToText(fetched.value.body) : fetched.value.body;
  const projection = projectText(text, normalized.value);
  const formatted = formatWebFetchResponse(fetched.value, normalized.value, projection, ok);
  const preview = createOffloadedTextPreview({
    maxPreviewBytes: options.limits.maxTotalOutputBytes,
    strategy: 'head',
    store: options.toolResultStore,
    text: formatted
  });

  return {
    ok,
    text: preview.truncated && !preview.offloadFilePath ? `${preview.text}\n\nOutput was truncated.` : preview.text,
    timedOut: false,
    truncated: preview.truncated || fetched.value.bodyTruncated
  };
}

function normalizeRequest(args: Record<string, unknown>, limits: WebFetchLimits): Result<NormalizedWebFetchRequest> {
  const url = args.url;

  if (typeof url !== 'string' || url.trim() === '') {
    return {ok: false, reason: 'url must be a non-empty string'};
  }

  const parsed = parseSafeUrl(url, limits);

  if (!parsed.ok) {
    return parsed;
  }

  const offset = normalizeNonNegativeInteger(args.offset, 0, 'offset');

  if (!offset.ok) {
    return offset;
  }

  const limit = normalizeOptionalPositiveInteger(args.limit, 'limit');

  if (!limit.ok) {
    return limit;
  }

  return {
    ok: true,
    value: {
      ...(limit.value === undefined ? {} : {limit: limit.value}),
      offset: offset.value,
      url: parsed.value
    }
  };
}

async function fetchWithRedirects(initialUrl: URL, options: {abortSignal?: AbortSignal; fetchFn: FetchLike; limits: WebFetchLimits}): Promise<Result<FetchSuccess> & {timedOut: boolean}> {
  let currentUrl = initialUrl;
  let redirected = false;

  for (let redirectCount = 0; redirectCount <= options.limits.maxRedirects; redirectCount += 1) {
    const abort = createCombinedAbort(options.limits.timeoutMs, options.abortSignal);
    let response: Response;

    try {
      response = await options.fetchFn(currentUrl.toString(), {
        headers: {
          Accept: 'text/html,text/plain,application/json,application/xml,text/*,*/*;q=0.8',
          'User-Agent': 'echo_tui web_fetch'
        },
        method: 'GET',
        redirect: 'manual',
        signal: abort.signal
      });
    } catch (error: unknown) {
      const aborted = isAbortError(error);
      return {
        ok: false,
        reason: aborted ? abort.formatReason() : cleanErrorMessage(error, 'request failed'),
        timedOut: aborted && abort.didTimeout()
      };
    } finally {
      abort.cleanup();
    }

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');

      if (!location) {
        return {ok: false, reason: 'redirect response missing Location header', timedOut: false};
      }

      if (redirectCount >= options.limits.maxRedirects) {
        return {ok: false, reason: `redirect limit exceeded (${options.limits.maxRedirects})`, timedOut: false};
      }

      const nextUrl = parseRedirectUrl(location, currentUrl, options.limits);

      if (!nextUrl.ok) {
        return {ok: false, reason: `redirect target rejected: ${nextUrl.reason}`, timedOut: false};
      }

      // 不能让 fetch 自动跳转：每一跳都需要重新走 URL 安全校验，避免安全 URL 跳到本机或 metadata 地址。
      currentUrl = nextUrl.value;
      redirected = true;
      continue;
    }

    const body = await readResponseText(response, options.limits.maxResponseBytes);

    if (!body.ok) {
      return {...body, timedOut: false};
    }

    return {
      ok: true,
      timedOut: false,
      value: {
        body: body.value.text,
        bodyTruncated: body.value.truncated,
        contentType: response.headers.get('content-type') || 'unknown',
        fetchedBytes: body.value.bytes,
        finalUrl: response.url || currentUrl.toString(),
        redirected,
        status: response.status,
        statusText: response.statusText || '',
        url: initialUrl.toString()
      }
    };
  }

  return {ok: false, reason: `redirect limit exceeded (${options.limits.maxRedirects})`, timedOut: false};
}

async function readResponseText(response: Response, maxBytes: number): Promise<Result<{bytes: number; text: string; truncated: boolean}>> {
  if (!response.body) {
    return {ok: true, value: {bytes: 0, text: '', truncated: false}};
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;

  try {
    while (true) {
      const {done, value} = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      const remaining = maxBytes - bytes;

      if (remaining <= 0) {
        truncated = true;
        // 达到 body cap 后主动取消读取，避免把超大响应继续拉进内存。
        await reader.cancel();
        break;
      }

      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytes += remaining;
        truncated = true;
        // 只保留 cap 内的前缀；截断状态会进入 tool result metadata。
        await reader.cancel();
        break;
      }

      chunks.push(value);
      bytes += value.byteLength;
    }
  } catch (error: unknown) {
    return {ok: false, reason: cleanErrorMessage(error, 'failed to read response body')};
  }

  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString('utf8').replace(/\uFFFD$/, '');

  return {ok: true, value: {bytes, text, truncated}};
}

function parseSafeUrl(value: string, limits: WebFetchLimits): Result<URL> {
  if (Buffer.byteLength(value, 'utf8') > limits.maxUrlBytes) {
    return {ok: false, reason: `url exceeds ${limits.maxUrlBytes} bytes`};
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return {ok: false, reason: 'url must be an absolute HTTP(S) URL'};
  }

  return validateSafeUrl(url);
}

function parseRedirectUrl(location: string, baseUrl: URL, limits: WebFetchLimits): Result<URL> {
  let url: URL;

  try {
    url = new URL(location, baseUrl);
  } catch {
    return {ok: false, reason: 'redirect Location is not a valid URL'};
  }

  if (Buffer.byteLength(url.toString(), 'utf8') > limits.maxUrlBytes) {
    return {ok: false, reason: `url exceeds ${limits.maxUrlBytes} bytes`};
  }

  return validateSafeUrl(url);
}

function validateSafeUrl(url: URL): Result<URL> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {ok: false, reason: 'url protocol must be http or https'};
  }

  if (url.username !== '' || url.password !== '') {
    return {ok: false, reason: 'url credentials are not allowed'};
  }

  if (url.hostname === '') {
    return {ok: false, reason: 'url host must not be empty'};
  }

  if (isUnsafeHost(url.hostname)) {
    return {ok: false, reason: 'url host is not allowed'};
  }

  return {ok: true, value: url};
}

function isUnsafeHost(hostname: string): boolean {
  // 这是工具层的基础防线，不是完整 SSRF 沙箱；DNS 解析后的 IP 校验留给后续更强 transport 设计。
  const host = hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '').toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  if (net.isIP(host) === 4) {
    return isUnsafeIpv4(host);
  }

  if (net.isIP(host) === 6) {
    return isUnsafeIpv6(host);
  }

  return false;
}

function isUnsafeIpv4(host: string): boolean {
  const [a = 0, b = 0] = host.split('.').map((part) => Number.parseInt(part, 10));

  return (
    a === 0 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    a >= 224
  );
}

function isUnsafeIpv6(host: string): boolean {
  const normalized = host.toLowerCase();

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  );
}

function normalizeNonNegativeInteger(value: unknown, fallback: number, fieldName: string): Result<number> {
  if (value === undefined || value === null) {
    return {ok: true, value: fallback};
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return {ok: false, reason: `${fieldName} must be a non-negative integer`};
  }

  return {ok: true, value};
}

function normalizeOptionalPositiveInteger(value: unknown, fieldName: string): Result<number | undefined> {
  if (value === undefined || value === null) {
    return {ok: true, value: undefined};
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return {ok: false, reason: `${fieldName} must be a positive integer`};
  }

  return {ok: true, value};
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function classifyContentType(contentType: string): {kind: 'html' | 'text' | 'unsupported'; reason?: string} {
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();

  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') {
    return {kind: 'html'};
  }

  if (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType.endsWith('+json') ||
    mediaType === 'application/xml' ||
    mediaType.endsWith('+xml') ||
    mediaType === 'application/javascript' ||
    mediaType === 'application/x-javascript'
  ) {
    return {kind: 'text'};
  }

  return {kind: 'unsupported', reason: `unsupported content type: ${contentType || 'unknown'}`};
}

function htmlToText(html: string): string {
  // 第一版只做轻量文本化，不承诺浏览器级 DOM/JS/CSS 渲染。
  return decodeHtmlEntities(html)
    .replace(/<\s*(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/?\s*(address|article|aside|blockquote|body|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|title|tr|ul)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();

    if (lower === 'amp') {
      return '&';
    }
    if (lower === 'lt') {
      return '<';
    }
    if (lower === 'gt') {
      return '>';
    }
    if (lower === 'quot') {
      return '"';
    }
    if (lower === 'apos') {
      return "'";
    }
    if (lower === 'nbsp') {
      return ' ';
    }

    const codePoint = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);

    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

function projectText(text: string, request: NormalizedWebFetchRequest): TextProjection {
  // offset/limit 作用于“最终文本投影”，保持和 read_files 的行分页语义一致。
  const lines = text.split(/\r?\n/);
  const available = lines.slice(request.offset);
  const selected = request.limit === undefined ? available : available.slice(0, request.limit);
  const hasMore = request.offset < lines.length && selected.length < available.length;

  return {
    content: selected.join('\n'),
    hasMore,
    returnedLines: selected.length
  };
}

function formatWebFetchResponse(response: FetchMetadata, _request: NormalizedWebFetchRequest, projection: TextProjection, ok: boolean): string {
  const finalUrl = response.finalUrl || response.url;
  const lines = [
    ok ? finalUrl : 'web_fetch failed.',
    ...(response.url !== finalUrl ? [`url: ${response.url}`, `final_url: ${finalUrl}`] : []),
    `status: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
    ...(response.contentType && response.contentType !== 'unknown' && !ok ? [`content_type: ${response.contentType}`] : []),
    ...(projection.hasMore ? ['has_more: true'] : []),
    ...(response.bodyTruncated ? ['body_truncated: true'] : []),
    '',
    'content:',
    '```',
    projection.content,
    '```'
  ];

  return lines.join('\n');
}

function formatUnsupportedResponse(response: FetchMetadata, reason?: string): string {
  return [
    'web_fetch failed.',
    `url: ${response.url}`,
    ...(response.finalUrl !== response.url ? [`final_url: ${response.finalUrl}`] : []),
    `status: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
    `content_type: ${response.contentType}`,
    'error: unsupported media type',
    `reason: ${reason || 'unsupported content type'}`
  ].join('\n');
}

function formatWebFetchFailure(reason: string): string {
  return [
    'web_fetch failed.',
    `Reason: ${reason}`
  ].join('\n');
}

function cleanErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createCombinedAbort(timeoutMs: number, parentSignal?: AbortSignal): {
  cleanup: () => void;
  didTimeout: () => boolean;
  formatReason: () => string;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromParent = () => controller.abort();

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, {once: true});
  }

  return {
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
    didTimeout() {
      return timedOut || !parentSignal;
    },
    formatReason() {
      return timedOut || !parentSignal ? `request timed out after ${timeoutMs}ms` : 'request cancelled';
    },
    signal: controller.signal
  };
}

function normalizeLimits(options: WebFetchToolHandlerOptions): WebFetchLimits {
  return {
    maxRedirects: normalizePositiveInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS),
    maxResponseBytes: normalizePositiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES),
    maxTotalOutputBytes: normalizePositiveInteger(options.maxTotalOutputBytes, DEFAULT_MAX_TOTAL_OUTPUT_BYTES),
    maxUrlBytes: normalizePositiveInteger(options.maxUrlBytes, DEFAULT_MAX_URL_BYTES),
    timeoutMs: normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  };
}

export {
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_TOTAL_OUTPUT_BYTES,
  DEFAULT_MAX_URL_BYTES,
  DEFAULT_TIMEOUT_MS,
  WEB_FETCH_TOOL_NAME,
  createWebFetchToolHandler
};

export type {
  WebFetchToolHandlerOptions
};
