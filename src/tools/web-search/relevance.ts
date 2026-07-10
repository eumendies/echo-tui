import {escapeRegExp, getResultHostname, normalizeSearchText, roundQualityScore} from './shared';

import type {QueryTerm, ScoredSearchResult, SearchQualityAssessment, SearchResult} from './shared';

/**
 * 从原始 query 中提取用于相关性计算的结构化匹配项。
 *
 * 规则：
 * - `site:` 被提取为 `host` term，并清洗协议、`www.`、path/query/hash。
 * - 连续 2 个及以上汉字被提取为中文 term。
 * - 英文/数字 token 使用 `[a-z0-9][a-z0-9._-]*` 提取，长度小于 2 的 token 丢弃。
 * - `site:` 片段不会再被普通 token 提取，避免 `site` 或 host 本身污染关键词覆盖率。
 *
 * 返回值按原 query 中的位置排序，并按 normalized 值去重。
 */
export function extractQueryTerms(query: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  const seen = new Set<string>();
  // site: 既是召回约束也是相关性约束；提取普通 term 前先挖出 host，避免 host 被拆成关键词。
  const searchableQuery = stripSiteOperators(query);

  for (const match of query.matchAll(/(?:^|\s)site:([^\s]+)/gi)) {
    addQueryTerm(terms, seen, cleanHostTerm(match[1]), 'host', match.index + match[0].indexOf(match[1]));
  }

  for (const match of searchableQuery.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    addQueryTerm(terms, seen, match[0], 'term', match.index);
  }

  for (const match of searchableQuery.matchAll(/[a-z0-9][a-z0-9._-]*/gi)) {
    const value = match[0].toLowerCase();

    if (value.length < 2) {
      continue;
    }

    addQueryTerm(terms, seen, value, 'term', match.index);
  }

  return terms.sort((left, right) => left.position - right.position);
}

function addQueryTerm(terms: QueryTerm[], seen: Set<string>, value: string, kind: QueryTerm['kind'], position: number): void {
  const normalized = normalizeSearchText(value);

  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  terms.push({ kind, normalized, position, value });
}

function cleanHostTerm(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '').toLowerCase();
}

function stripSiteOperators(query: string): string {
  return query.replace(/(?:^|\s)site:\S+/ig, (value) => ' '.repeat(value.length));
}

/**
 * 为一批自然搜索结果补充命中项、单条相关性分和 attempt 顺序。
 *
 * `matchedTerms` 表示该结果在 title、snippet、url 或 host 上命中的 query terms；
 * `relevanceScore` 使用 `calculateRelevanceScore` 的 0～1 分值；`attemptIndex` 保留真实请求顺序，
 * 在相同分数结果排序时作为稳定 tie-breaker。
 */
export function scoreSearchResults(results: SearchResult[], terms: QueryTerm[], attemptIndex: number): ScoredSearchResult[] {
  return results.map((result) => {
    const matchedTerms = terms.filter((term) => resultContainsTerm(result, term)).map((term) => term.value);
    const relevanceScore = calculateRelevanceScore(result, terms);

    return {
      ...result,
      attemptIndex,
      matchedTerms,
      relevanceScore
    };
  });
}

function resultContainsTerm(result: SearchResult, term: QueryTerm): boolean {
  if (term.kind === 'host') {
    return hostMatches(getResultHostname(result.url), term.normalized);
  }

  return searchCorpusContainsTerm(normalizeSearchText(`${result.title} ${result.snippet} ${result.url}`), term);
}

/**
 * 计算单条结果的 0～1 相关性分。
 *
 * 每个 query term 单独计分后取平均：
 * - host term：结果 hostname 满足 exact/subdomain 匹配得 1，否则 0。
 * - 普通 term：title 命中得 1，snippet 命中得 0.75，url 命中得 0.45，三者取最大值。
 *
 * 额外对前 2～3 个非中文普通 term 组成的连续短语做轻量加成：该短语出现在 title 或 snippet
 * 时加 0.1。最终分数封顶 1，并四舍五入到两位小数。
 */
function calculateRelevanceScore(result: SearchResult, terms: QueryTerm[]): number {
  if (terms.length === 0) {
    return 1;
  }

  const title = normalizeSearchText(result.title);
  const snippet = normalizeSearchText(result.snippet);
  const url = normalizeSearchText(result.url);
  // 标题比摘要更能代表结果主题，URL 只作为弱信号；三者取最大值避免重复计算同一 term。
  const termScore = terms.reduce((score, term) => score + scoreTerm(result, {title, snippet, url}, term), 0) / terms.length;

  return roundQualityScore(Math.min(1, termScore + calculatePhraseBoost({title, snippet}, terms)));
}

function scoreTerm(result: SearchResult, fields: {snippet: string; title: string; url: string}, term: QueryTerm): number {
  if (term.kind === 'host') {
    return hostMatches(getResultHostname(result.url), term.normalized) ? 1 : 0;
  }

  return Math.max(
    searchCorpusContainsTerm(fields.title, term) ? 1 : 0,
    searchCorpusContainsTerm(fields.snippet, term) ? 0.75 : 0,
    searchCorpusContainsTerm(fields.url, term) ? 0.45 : 0
  );
}

function calculatePhraseBoost(fields: {snippet: string; title: string}, terms: QueryTerm[]): number {
  // 只对前几个英文 term 做短语加成，鼓励标题/摘要里的自然短语匹配，避免整句精确匹配过窄。
  const phraseTerms = terms.filter((term) => term.kind === 'term' && !/[\p{Script=Han}]/u.test(term.normalized)).slice(0, 3);

  if (phraseTerms.length < 2) {
    return 0;
  }

  const phrase = phraseTerms.map((term) => term.normalized).join(' ');
  return fields.title.includes(phrase) || fields.snippet.includes(phrase) ? 0.1 : 0;
}

/**
 * 判断归一化文本中是否包含普通 query term。
 *
 * 中文 term 使用子串包含；英文/数字 term 使用字母数字边界匹配，避免 `api` 命中 `apidoc`、
 * `go` 命中 `golang` 这类偶然子串。host term 不在文本 corpus 内判断。
 */
function searchCorpusContainsTerm(corpus: string, term: QueryTerm): boolean {
  if (term.kind === 'host') {
    return false;
  }

  if (/[\p{Script=Han}]/u.test(term.normalized)) {
    return corpus.includes(term.normalized);
  }

  // 英文 term 使用字母数字边界，避免 api 命中 apidoc、go 命中 golang 这类偶然子串。
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term.normalized)}([^a-z0-9]|$)`, 'i').test(corpus);
}

/**
 * 评估当前合并结果集是否足够可信，并生成面向模型的质量 metadata。
 *
 * 指标计算：
 * - `matchedTerms`/`missingTerms` 基于整个结果集的 term 覆盖率，而不是单条结果。
 * - `bestScore` 是所有结果中的最高 `relevanceScore`。
 * - `topAverage` 是按 `relevanceScore` 排序后的 top 3 平均分。
 * - `coverage = matchedTerms.length / terms.length`；没有 terms 时 coverage 视为 1。
 * - `qualityScore = max(bestScore, topAverage, coverage * 0.75)`，并四舍五入到两位小数。
 *
 * `quality` 只有在以下条件同时成立时才是 `acceptable`：有结果、没有 missing terms、没有显式
 * `site:` host mismatch，并且没有 weak-top-results。weak-top-results 的阈值是
 * `bestScore < 0.72 && topAverage < 0.62`，用于防止多个弱结果拼出全量 coverage 后误判可用。
 */
export function assessSearchQuality(results: ScoredSearchResult[], terms: QueryTerm[]): SearchQualityAssessment {
  const matched = new Set<string>();
  const reasons: string[] = [];

  for (const result of results) {
    for (const term of result.matchedTerms) {
      matched.add(term);
    }
  }

  const matchedTerms = terms.filter((term) => matched.has(term.value)).map((term) => term.value);
  const missingTerms = terms.filter((term) => !matched.has(term.value)).map((term) => term.value);
  const bestScore = results.reduce((best, result) => Math.max(best, result.relevanceScore), 0);
  const topScores = results.map((result) => result.relevanceScore).sort((left, right) => right - left).slice(0, 3);
  const topAverage = topScores.length === 0 ? 0 : topScores.reduce((sum, score) => sum + score, 0) / topScores.length;
  const coverage = terms.length === 0 ? 1 : matchedTerms.length / terms.length;
  // coverage 只能说明“所有词被某些结果覆盖”，不能说明 top 结果本身相关；因此只给弱上限。
  const qualityScore = roundQualityScore(Math.max(bestScore, topAverage, coverage * 0.75));

  if (results.length === 0) {
    reasons.push('no-results');
  }

  if (missingTerms.length > 0) {
    reasons.push(`missing-terms:${missingTerms.join(',')}`);
  }

  const requiredHostMismatch = hasRequiredHostMismatch(results, terms);

  if (requiredHostMismatch) {
    reasons.push('required-host-mismatch');
  }

  const weakTopResults = terms.length > 0 && bestScore < 0.72 && topAverage < 0.62;

  if (results.length > 0 && missingTerms.length === 0 && weakTopResults) {
    // 防止多个弱结果拼出全量 term coverage 后被误判为可接受。
    reasons.push('weak-top-results');
  }

  const quality = results.length > 0 && missingTerms.length === 0 && !requiredHostMismatch && !weakTopResults ? 'acceptable' : 'low';

  return {
    matchedTerms,
    missingTerms,
    quality,
    qualityScore,
    reasons: reasons.length === 0 ? ['ok'] : reasons
  };
}

function hasRequiredHostMismatch(results: ScoredSearchResult[], terms: QueryTerm[]): boolean {
  const hostTerms = terms.filter((term) => term.kind === 'host');

  return hostTerms.some((term) => !results.some((result) => hostMatches(getResultHostname(result.url), term.normalized)));
}

/**
 * 判断结果 hostname 是否满足 `site:` host 约束。
 *
 * 允许 exact match 和真实子域名，例如 `example.com` 与 `docs.example.com`；不允许
 * `badexample.com` 这种纯后缀碰撞。
 */
function hostMatches(host: string, requiredHost: string): boolean {
  // site:example.com 允许 example.com 及其子域名，但不能让 badexample.com 这类后缀碰撞通过。
  return host === requiredHost || host.endsWith(`.${requiredHost}`);
}

/**
 * 将一次搜索 attempt 的已评分结果合并进全局候选池。
 *
 * URL 去重会忽略 hash；同一 URL 的多个候选保留 `compareScoredResults` 排名更靠前的版本，
 * 即优先保留更高相关性分，相同分数时保留更早 attempt 的结果。
 */
export function mergeScoredResults(target: Map<string, ScoredSearchResult>, results: ScoredSearchResult[]): void {
  for (const result of results) {
    const key = normalizeComparableUrl(result.url);
    const existing = target.get(key);

    if (!existing || compareScoredResults(result, existing) < 0) {
      target.set(key, result);
    }
  }
}

/**
 * 搜索结果最终排序规则：先按 `relevanceScore` 降序，再按 `attemptIndex` 升序。
 */
export function compareScoredResults(left: ScoredSearchResult, right: ScoredSearchResult): number {
  if (right.relevanceScore !== left.relevanceScore) {
    return right.relevanceScore - left.relevanceScore;
  }

  return left.attemptIndex - right.attemptIndex;
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}
