const WEB_SEARCH_TOOL_NAME = 'web_search';

// 公共搜索页不是稳定 API；工具必须用硬边界限制请求、解析和回传内容。
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = 64_000;
const DEFAULT_MAX_QUERY_BYTES = 1024;
const DEFAULT_COUNT = 5;
const DEFAULT_MAX_RESULTS = 10;
const BING_SEARCH_URL = 'https://www.bing.com/search';
const DUCKDUCKGO_SEARCH_URL = 'https://duckduckgo.com/html/';

export {
  BING_SEARCH_URL,
  DEFAULT_COUNT,
  DEFAULT_MAX_QUERY_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  DUCKDUCKGO_SEARCH_URL,
  WEB_SEARCH_TOOL_NAME
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type WebSearchToolHandlerOptions = {
  fetch?: FetchLike;
  maxQueryBytes?: number;
  maxResponseBytes?: number;
  maxResults?: number;
  maxTotalOutputBytes?: number;
  timeoutMs?: number;
};

type WebSearchLimits = {
  maxQueryBytes: number;
  maxResponseBytes: number;
  maxResults: number;
  maxTotalOutputBytes: number;
  timeoutMs: number;
};

type NormalizedWebSearchRequest = {
  count: number;
  // 内部 fallback 标记：保持用户 market 不变，仅让 Bing URL 额外携带 ensearch=1。
  englishSearch?: boolean;
  market?: string;
  offset: number;
  query: string;
  safeSearch: 'off' | 'moderate' | 'strict';
};

type SearchPage = {
  body: string;
  bodyTruncated: boolean;
  fetchedBytes: number;
  status: number;
  statusText: string;
};

type SearchResult = {
  snippet: string;
  title: string;
  url: string;
};

type SearchProviderName = 'bing_html' | 'duckduckgo_html';

type QueryTerm = {
  kind: 'host' | 'term';
  normalized: string;
  position: number;
  value: string;
};

type ScoredSearchResult = SearchResult & {
  attemptIndex: number;
  matchedTerms: string[];
  relevanceScore: number;
};

type SearchQualityAssessment = {
  matchedTerms: string[];
  missingTerms: string[];
  quality: 'acceptable' | 'low';
  qualityScore: number;
  reasons: string[];
};

type SearchAttemptOutcome = {
  bodyTruncated: boolean;
  fetchedBytes: number;
  parsedTruncated: boolean;
  results: SearchResult[];
  timedOut: boolean;
} | {
  bodyTruncated: boolean;
  fetchedBytes: number;
  reason: string;
  timedOut: boolean;
};

type SearchResponseMetadata = {
  attempts: number;
  bodyTruncated: boolean;
  fetchedBytes: number;
  matchedTerms: string[];
  missingTerms: string[];
  quality: 'acceptable' | 'low';
  qualityReasons: string[];
  qualityScore: number;
  providers: SearchProviderName[];
  truncated: boolean;
};

export type {
  FetchLike,
  NormalizedWebSearchRequest,
  QueryTerm,
  ScoredSearchResult,
  SearchAttemptOutcome,
  SearchPage,
  SearchProviderName,
  SearchQualityAssessment,
  SearchResponseMetadata,
  SearchResult,
  WebSearchLimits,
  WebSearchToolHandlerOptions
};

export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = normalizeSearchText(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(value);
  }

  return deduped;
}

export function roundQualityScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getResultHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function capUtf8Text(text: string, maxBytes: number): {text: string; truncated: boolean} {
  const buffer = Buffer.from(text, 'utf8');

  if (buffer.length <= maxBytes) {
    return {text, truncated: false};
  }

  return {
    text: buffer.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/, ''),
    truncated: true
  };
}

export function cleanErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function createCombinedAbort(timeoutMs: number, parentSignal?: AbortSignal, label = 'request'): {
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
      return timedOut || !parentSignal ? `${label} timed out after ${timeoutMs}ms` : `${label} cancelled`;
    },
    signal: controller.signal
  };
}

export function formatWebSearchResponse(results: ScoredSearchResult[], metadata: SearchResponseMetadata): string {
  const diagnostics = [
    ...(metadata.quality === 'low' && results.length > 0 ? [
      'warning: results may be unrelated or incomplete',
      `missing_query_terms: ${metadata.missingTerms.length === 0 ? '(none)' : metadata.missingTerms.join(', ')}`
    ] : []),
    ...(metadata.truncated ? ['truncated: true'] : [])
  ];

  return [
    ...diagnostics,
    ...(diagnostics.length > 0 ? [''] : []),
    'results:',
    results.length === 0 ? 'no search results' : formatResults(results)
  ].join('\n');
}

function formatResults(results: ScoredSearchResult[]): string {
  return results.map((result, index) => [
    `${index + 1}. ${result.title}`,
    `   url: ${result.url}`,
    `   snippet: ${result.snippet}`
  ].join('\n')).join('\n');
}

export function formatWebSearchFailure(reason: string): string {
  return [
    'web_search failed.',
    `Reason: ${reason}`
  ].join('\n');
}
