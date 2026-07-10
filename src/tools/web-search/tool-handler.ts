import {formatWebSearchFailure, formatWebSearchResponse, WEB_SEARCH_TOOL_NAME} from './shared';
import {assessSearchQuality, compareScoredResults, extractQueryTerms, mergeScoredResults, scoreSearchResults} from './relevance';
import {normalizeLimits, normalizeRequest, runSearchAttempt} from './request';
import {capUtf8Text, dedupeStrings} from './shared';

import type {ToolCall, ToolExecutionOptions, ToolHandler, WebSearchToolExecutionResult} from '../../types/tool';
import type {FetchLike, ScoredSearchResult, SearchProviderName, SearchQualityAssessment, WebSearchLimits, WebSearchToolHandlerOptions} from './shared';

/**
 * 创建公共网页搜索工具；解析公共搜索 HTML 自然结果，不使用 API key 或浏览器自动化。
 */
function createWebSearchToolHandler(options: WebSearchToolHandlerOptions = {}): ToolHandler {
  const limits = normalizeLimits(options);
  const fetchFn = options.fetch || globalThis.fetch.bind(globalThis);

  return {
    definition: {
      name: WEB_SEARCH_TOOL_NAME,
      description: `Search the public web without an API key by fetching public HTML search pages and returning bounded natural web results. Uses Bing HTML first and DuckDuckGo HTML as a fallback when quality stays low. Omit count for the default result count, offset for the first page, market for the default locale, and safe_search for moderate filtering. Best effort only: returns title, URL, snippet, and relevance score, and may fail if public pages are blocked or change. Does not use official search APIs, cookies, login state, browser automation, proxies, or anti-bot bypass. Use web_fetch on a returned URL to read page content.`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: {
            type: 'string'
          },
          count: {
            type: 'number'
          },
          offset: {
            type: 'number'
          },
          market: {
            type: 'string'
          },
          safe_search: {
            type: 'string',
            enum: ['off', 'moderate', 'strict', 'Off', 'Moderate', 'Strict']
          }
        }
      }
    },
    async execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): Promise<WebSearchToolExecutionResult> {
      const result = await webSearch(args, {
        abortSignal: executionOptions?.abortSignal,
        fetchFn,
        limits
      });

      return {
        callId: call.callId,
        toolName: WEB_SEARCH_TOOL_NAME,
        ok: result.ok,
        text: result.text,
        timedOut: result.timedOut,
        truncated: result.truncated
      };
    }
  };
}

async function webSearch(args: Record<string, unknown>, options: {abortSignal?: AbortSignal; fetchFn: FetchLike; limits: WebSearchLimits}): Promise<{ok: boolean; text: string; timedOut: boolean; truncated: boolean}> {
  const normalized = normalizeRequest(args, options.limits);

  if (!normalized.ok) {
    return {
      ok: false,
      text: formatWebSearchFailure(normalized.reason),
      timedOut: false,
      truncated: false
    };
  }

  const queryTerms = extractQueryTerms(normalized.value.query);
  const usedProviders: SearchProviderName[] = [];
  const failures: string[] = [];
  const mergedResults = new Map<string, ScoredSearchResult>();
  let bodyTruncated = false;
  let fetchedBytes = 0;
  let parsedTruncated = false;
  let timedOut = false;
  let sawEmptySearch = false;
  let attemptCount = 0;
  let qualityAssessment: SearchQualityAssessment = assessSearchQuality([], queryTerms);

  if (options.abortSignal?.aborted) {
    return {
      ok: false,
      text: formatWebSearchFailure('search request cancelled'),
      timedOut: false,
      truncated: false
    };
  }

  providerLoop:
  for (const provider of (['bing_html', 'duckduckgo_html'] as SearchProviderName[])) {
    if (provider === 'duckduckgo_html' && qualityAssessment.quality === 'acceptable') {
      break;
    }

    // 同一 provider 内先跑用户原始 market 下的 query；只有这些结果仍低质时，
    // Bing 才会继续尝试 English fallback，避免 ensearch=1 覆盖掉本地 market 的好结果。
    const searchAttempts = createProviderSearchAttempts(provider, normalized.value);

    for (const {englishSearch} of searchAttempts) {
      // attemptIndex 表示真实请求顺序，用于同分结果排序；不能从 provider 下标推导，
      // 因为 Bing 可能追加 English fallback attempt。
      const searchAttemptIndex = attemptCount;
      const outcome = await runSearchAttempt({ ...normalized.value, ...(englishSearch ? {englishSearch} : {}) }, provider, options);
      attemptCount += 1;

      if (options.abortSignal?.aborted) {
        return {
          ok: false,
          text: formatWebSearchFailure('search request cancelled'),
          timedOut: false,
          truncated: false
        };
      }

      addUsedProvider(usedProviders, provider);
      timedOut = timedOut || outcome.timedOut;
      bodyTruncated = bodyTruncated || outcome.bodyTruncated;
      fetchedBytes += outcome.fetchedBytes;

      if (!('results' in outcome)) {
        failures.push(outcome.reason);
        continue;
      }

      parsedTruncated = parsedTruncated || outcome.parsedTruncated;

      if (outcome.results.length === 0) {
        sawEmptySearch = true;
        continue;
      }

      mergeScoredResults(mergedResults, scoreSearchResults(outcome.results, queryTerms, searchAttemptIndex));
      // 质量门控按最终可见结果口径评估，避免未返回的候选把 metadata 撑高后提前停止 fallback。
      const visibleCandidates = [...mergedResults.values()].sort(compareScoredResults).slice(0, normalized.value.count);
      qualityAssessment = assessSearchQuality(visibleCandidates, queryTerms);

      if (qualityAssessment.quality === 'acceptable') {
        break providerLoop;
      }
    }
  }

  if (mergedResults.size === 0 && !sawEmptySearch) {
    return {
      ok: false,
      text: formatWebSearchFailure(failures.length === 0 ? 'search produced no usable results' : `all search attempts failed: ${dedupeStrings(failures).join('; ')}`),
      timedOut,
      truncated: bodyTruncated
    };
  }

  const sortedResults = [...mergedResults.values()].sort(compareScoredResults);
  const returnedResults = sortedResults.slice(0, normalized.value.count);
  const visibleTruncated = bodyTruncated || parsedTruncated || sortedResults.length > returnedResults.length;
  qualityAssessment = assessSearchQuality(returnedResults, queryTerms);

  const formatted = formatWebSearchResponse(returnedResults, {
    attempts: attemptCount,
    bodyTruncated,
    fetchedBytes,
    matchedTerms: qualityAssessment.matchedTerms,
    missingTerms: qualityAssessment.missingTerms,
    quality: qualityAssessment.quality,
    qualityReasons: qualityAssessment.reasons,
    qualityScore: qualityAssessment.qualityScore,
    providers: usedProviders,
    truncated: visibleTruncated
  });
  const capped = capUtf8Text(formatted, options.limits.maxTotalOutputBytes);

  return {
    ok: true,
    text: capped.truncated ? `${capped.text}\n\nOutput was truncated.` : capped.text,
    timedOut: false,
    truncated: visibleTruncated || capped.truncated
  };
}

function addUsedProvider(providers: SearchProviderName[], provider: SearchProviderName): void {
  if (!providers.includes(provider)) {
    providers.push(provider);
  }
}

function createProviderSearchAttempts(provider: SearchProviderName, request: {market?: string; query: string}): Array<{englishSearch?: true}> {
  const attempts: Array<{englishSearch?: true}> = [{}];

  if (provider === 'bing_html' && shouldTryEnglishBingFallback(request)) {
    // ensearch=1 对英文技术 query 有时能显著改善非英文 market 的排序，但它不是单调收益；
    // 因此只作为原始 localized attempts 之后的 Bing fallback，不对 DuckDuckGo 生效。
    attempts.push({englishSearch: true});
  }

  return attempts;
}

function shouldTryEnglishBingFallback(request: {market?: string; query: string}): boolean {
  // 仅处理“非英文 market + 拉丁 query”的常见错排场景；含 CJK 的 query 保持本地语言搜索语义。
  return request.market !== undefined && !/^en-/i.test(request.market) && /[a-z]/i.test(request.query) && !/[\p{Script=Han}]/u.test(request.query);
}

export {
  createWebSearchToolHandler
};
