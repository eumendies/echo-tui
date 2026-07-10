import {normalizePositiveInteger} from '../tool-handler-utils';

import {BING_SEARCH_URL, cleanErrorMessage, createCombinedAbort, DEFAULT_COUNT, DEFAULT_MAX_QUERY_BYTES, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_MAX_RESULTS, DEFAULT_MAX_TOTAL_OUTPUT_BYTES, DEFAULT_TIMEOUT_MS, DUCKDUCKGO_SEARCH_URL, isAbortError} from './shared';
import {isBlockedSearchPage, parseBingHtmlResults, parseDuckDuckGoHtmlResults} from './parser';
import type {Result} from '../tool-handler-utils';
import type {FetchLike, NormalizedWebSearchRequest, SearchAttemptOutcome, SearchPage, SearchProviderName, WebSearchLimits, WebSearchToolHandlerOptions} from './shared';

export function normalizeRequest(args: Record<string, unknown>, limits: WebSearchLimits): Result<NormalizedWebSearchRequest> {
  const query = args.query;

  if (typeof query !== 'string' || query.trim() === '') {
    return {ok: false, reason: 'query must be a non-empty string'};
  }

  const trimmedQuery = query.trim();

  if (Buffer.byteLength(trimmedQuery, 'utf8') > limits.maxQueryBytes) {
    return {ok: false, reason: `query exceeds ${limits.maxQueryBytes} bytes`};
  }

  const count = normalizeOptionalPositiveInteger(args.count, DEFAULT_COUNT, 'count');

  if (!count.ok) {
    return count;
  }

  const offset = normalizeNonNegativeInteger(args.offset, 0, 'offset');

  if (!offset.ok) {
    return offset;
  }

  const market = normalizeOptionalMarket(args.market);

  if (!market.ok) {
    return market;
  }

  const safeSearch = normalizeSafeSearch(args.safe_search);

  if (!safeSearch.ok) {
    return safeSearch;
  }

  return {
    ok: true,
    value: {
      count: Math.min(count.value, limits.maxResults),
      ...(market.value === undefined ? {} : {market: market.value}),
      offset: offset.value,
      query: trimmedQuery,
      safeSearch: safeSearch.value
    }
  };
}

async function fetchSearchPage(request: NormalizedWebSearchRequest, provider: SearchProviderName, options: {abortSignal?: AbortSignal; fetchFn: FetchLike; limits: WebSearchLimits}): Promise<Result<SearchPage> & {timedOut: boolean}> {
  const abort = createCombinedAbort(options.limits.timeoutMs, options.abortSignal, 'search request');

  try {
    const response = await options.fetchFn(createSearchUrl(request, provider), {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        // market 同时影响 URL 参数和语言偏好；两者保持一致，尽量贴近用户指定的搜索区域。
        'Accept-Language': request.market ? `${request.market},en;q=0.8` : 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 echo_tui web_search'
      },
      method: 'GET',
      redirect: 'follow',
      signal: abort.signal
    });
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
        fetchedBytes: body.value.bytes,
        status: response.status,
        statusText: response.statusText || ''
      }
    };
  } catch (error: unknown) {
    const aborted = isAbortError(error);
    return {
      ok: false,
      reason: aborted ? abort.formatReason() : cleanErrorMessage(error, 'search request failed'),
      timedOut: aborted && abort.didTimeout()
    };
  } finally {
    abort.cleanup();
  }
}

export async function runSearchAttempt(request: NormalizedWebSearchRequest, provider: SearchProviderName, options: {abortSignal?: AbortSignal; fetchFn: FetchLike; limits: WebSearchLimits}): Promise<SearchAttemptOutcome> {
  const page = await fetchSearchPage(request, provider, options);

  if (!page.ok) {
    return {
      bodyTruncated: false,
      fetchedBytes: 0,
      reason: page.reason,
      timedOut: page.timedOut
    };
  }

  if (page.value.status < 200 || page.value.status >= 300) {
    return {
      bodyTruncated: page.value.bodyTruncated,
      fetchedBytes: page.value.fetchedBytes,
      reason: `search page returned HTTP ${page.value.status}${page.value.statusText ? ` ${page.value.statusText}` : ''}`,
      timedOut: false
    };
  }

  if (isBlockedSearchPage(page.value.body)) {
    return {
      bodyTruncated: page.value.bodyTruncated,
      fetchedBytes: page.value.fetchedBytes,
      reason: 'public search page appears blocked or requires verification',
      timedOut: false
    };
  }

  const parsed = provider === 'bing_html' ? parseBingHtmlResults(page.value.body, options.limits.maxResults) : parseDuckDuckGoHtmlResults(page.value.body, options.limits.maxResults);

  if (!parsed.ok) {
    return {
      bodyTruncated: page.value.bodyTruncated,
      fetchedBytes: page.value.fetchedBytes,
      reason: parsed.reason,
      timedOut: false
    };
  }

  return {
    bodyTruncated: page.value.bodyTruncated,
    fetchedBytes: page.value.fetchedBytes,
    parsedTruncated: parsed.truncated,
    results: parsed.results,
    timedOut: false
  };
}

function createSearchUrl(request: NormalizedWebSearchRequest, provider: SearchProviderName): string {
  return provider === 'bing_html' ? createBingSearchUrl(request) : createDuckDuckGoSearchUrl(request);
}

function createBingSearchUrl(request: NormalizedWebSearchRequest): string {
  const params = [
    `q=${encodeURIComponent(request.query)}`,
    `count=${encodeURIComponent(String(request.count))}`,
    `first=${encodeURIComponent(String(request.offset + 1))}`
  ];

  if (request.market) {
    params.push(`mkt=${encodeURIComponent(request.market)}`);

    if (isEnglishSearchRequest(request)) {
      // ensearch=1 是 Bing HTML 的英文搜索开关；英文 market 默认开启，非英文 market 只在 fallback attempt 中开启。
      params.push('ensearch=1');
    }
  }

  params.push(`safeSearch=${encodeURIComponent(toBingSafeSearchValue(request.safeSearch))}`);
  return `${BING_SEARCH_URL}?${params.join('&')}`;
}

function isEnglishSearchRequest(request: NormalizedWebSearchRequest): boolean {
  return request.market !== undefined && (/^en-/i.test(request.market) || request.englishSearch === true);
}

function createDuckDuckGoSearchUrl(request: NormalizedWebSearchRequest): string {
  const params = [
    `q=${encodeURIComponent(request.query)}`,
    `s=${encodeURIComponent(String(request.offset))}`
  ];

  if (request.market) {
    params.push(`kl=${encodeURIComponent(request.market.toLowerCase())}`);
  }

  params.push(`kp=${encodeURIComponent(toDuckDuckGoSafeSearchValue(request.safeSearch))}`);
  return `${DUCKDUCKGO_SEARCH_URL}?${params.join('&')}`;
}

async function readResponseText(response: Response, maxBytes: number): Promise<Result<{bytes: number; text: string; truncated: boolean}>> {
  if (!response.body) {
    return {ok: true, value: {bytes: 0, text: '', truncated: false}};
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;

  // 流式读取时按 UTF-8 字节截断，避免先把超大公共搜索页完整读进内存。
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
        // 达到响应体上限后主动取消，避免公共页面异常膨胀占用内存。
        await reader.cancel();
        break;
      }

      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytes += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }

      chunks.push(value);
      bytes += value.byteLength;
    }
  } catch (error: unknown) {
    return {ok: false, reason: cleanErrorMessage(error, 'failed to read search response body')};
  }

  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString('utf8').replace(/\uFFFD$/, '');

  return {ok: true, value: {bytes, text, truncated}};
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

function normalizeOptionalPositiveInteger(value: unknown, fallback: number, fieldName: string): Result<number> {
  if (value === undefined || value === null) {
    return {ok: true, value: fallback};
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return {ok: false, reason: `${fieldName} must be a positive integer`};
  }

  return {ok: true, value};
}

function normalizeOptionalMarket(value: unknown): Result<string | undefined> {
  if (value === undefined || value === null || value === '') {
    return {ok: true, value: undefined};
  }

  if (typeof value !== 'string' || !/^[a-z]{2}-[a-z]{2}$/i.test(value)) {
    return {ok: false, reason: 'market must be a locale like en-US'};
  }

  return {ok: true, value};
}

function normalizeSafeSearch(value: unknown): Result<'off' | 'moderate' | 'strict'> {
  if (value === undefined || value === null || value === '') {
    return {ok: true, value: 'moderate'};
  }

  if (typeof value !== 'string') {
    return {ok: false, reason: 'safe_search must be off, moderate, or strict'};
  }

  const normalized = value.toLowerCase();

  if (normalized !== 'off' && normalized !== 'moderate' && normalized !== 'strict') {
    return {ok: false, reason: 'safe_search must be off, moderate, or strict'};
  }

  return {ok: true, value: normalized};
}

function toBingSafeSearchValue(value: 'off' | 'moderate' | 'strict'): string {
  if (value === 'off') {
    return 'Off';
  }

  if (value === 'strict') {
    return 'Strict';
  }

  return 'Moderate';
}

function toDuckDuckGoSafeSearchValue(value: 'off' | 'moderate' | 'strict'): string {
  if (value === 'off') {
    return '-2';
  }

  if (value === 'strict') {
    return '1';
  }

  return '-1';
}

export function normalizeLimits(options: WebSearchToolHandlerOptions): WebSearchLimits {
  return {
    maxQueryBytes: normalizePositiveInteger(options.maxQueryBytes, DEFAULT_MAX_QUERY_BYTES),
    maxResponseBytes: normalizePositiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES),
    maxResults: normalizePositiveInteger(options.maxResults, DEFAULT_MAX_RESULTS),
    maxTotalOutputBytes: normalizePositiveInteger(options.maxTotalOutputBytes, DEFAULT_MAX_TOTAL_OUTPUT_BYTES),
    timeoutMs: normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  };
}
