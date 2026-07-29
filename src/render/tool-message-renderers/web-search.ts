import {blockText} from '../colors';
import {displayWidth, safeRenderWidth, splitGraphemes} from '../layout';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText,
  wrapContentLine
} from './shared';

import type {TuiTheme} from '../../config/theme-config';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

const WEB_SEARCH_TOOL_NAME = 'web_search';
const WEB_SEARCH_WARNING_TEXT = 'warning: results may be unrelated or incomplete';
const WEB_SEARCH_RESULTS_HEADER = 'results:';
const WEB_SEARCH_EMPTY_TEXT = 'no search results';
const WEB_SEARCH_FAILURE_PREFIX = 'web_search failed.\nReason: ';
const WEB_SEARCH_OUTPUT_TRUNCATED_TEXT = 'Output was truncated.';
const MAX_QUERY_GRAPHEMES = 160;
const MAX_MISSING_TERM_GRAPHEMES = 64;
const MAX_VISIBLE_RESULTS = Math.max(1, Math.floor((TOOL_RESULT_MAX_DISPLAY_LINES - 2) / 2));

type WebSearchResultItem = {
  displayUrl: string; // 去掉 HTTP(S) scheme 后供终端展示、仍可区分具体页面的 URL。
  snippet: string; // 搜索页返回的单行结果摘要。
  title: string; // 搜索结果标题，顺序与工具原始输出一致。
};

type ParsedWebSearchSuccess = {
  kind: 'success'; // 标识结果文本包含可投影的自然搜索结果。
  missingTerms: string[]; // 低覆盖结果中 formatter 明确报告的未匹配 query terms。
  partialMatch: boolean; // 标识 formatter 已判定结果可能不相关或不完整。
  results: WebSearchResultItem[]; // 已按原始编号顺序解析出的完整结果项。
};

type ParsedWebSearchEmpty = {
  kind: 'empty'; // 标识工具成功完成但明确没有自然搜索结果。
};

type ParsedWebSearchFailure = {
  kind: 'failure'; // 标识文本符合 web_search 的失败 envelope。
  reason: string; // 去除协议字段后的可见失败原因。
};

/**
 * 渲染 pending、孤立或 fallback 后拆分的 web_search call，只展示查询和生命周期状态。
 */
function renderWebSearchToolCallLines(
  record: ToolCallTranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] | null {
  const query = parseWebSearchQuery(record.argumentsText);

  if (!query) {
    return null;
  }

  return renderWebSearchHeaderLines(query, resolveCallStatusLabel(callStatus), callStatus, width, theme);
}

/**
 * 将相邻 web_search call/result 投影成共享标题、metadata 和结果树；协议不可信时交给通用 renderer。
 */
function renderWebSearchToolPairLines(
  call: ToolCallTranscriptRecord,
  result: ToolResultTranscriptRecord,
  width: number,
  theme: TuiTheme
): string[] | null {
  const query = parseWebSearchQuery(call.argumentsText);

  if (!query) {
    return null;
  }

  if (!result.ok) {
    const failure = parseWebSearchFailure(result.text);
    if (!failure) {
      return null;
    }

    const timedOut = result.details.kind === 'web_search' && result.details.timedOut;
    return [
      ...renderWebSearchHeaderLines(query, timedOut ? 'timed out' : 'failed', false, width, theme),
      ...renderWebSearchFailureLines(failure.reason, width, theme)
    ];
  }

  const parsed = parseWebSearchSuccess(result.text);
  if (!parsed) {
    return null;
  }

  const lines = renderWebSearchHeaderLines(query, null, true, width, theme);
  const truncated = result.details.kind === 'web_search' && result.details.truncated;

  if (parsed.kind === 'empty') {
    lines.push(...renderWebSearchMetadataLines(truncated ? 'no results · truncated' : 'no results', width, theme));
    return lines;
  }

  lines.push(...renderWebSearchMetadataLines(createResultMetadata(parsed, truncated), width, theme));
  lines.push(...renderWebSearchResultTreeLines(parsed.results, width, theme));
  return lines;
}

/** 从 arguments JSON 中读取并规范化 query；无效参数返回 null 触发通用 fallback。 */
function parseWebSearchQuery(argumentsText: unknown): string | null {
  if (typeof argumentsText !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const query = (parsed as {query?: unknown}).query;
  if (typeof query !== 'string') {
    return null;
  }

  const normalized = normalizeDisplayText(query);
  return normalized ? ellipsizeGraphemes(normalized, MAX_QUERY_GRAPHEMES) : null;
}

/** 解析成功或空结果协议；任何未知诊断或不完整结果项都会返回 null。 */
function parseWebSearchSuccess(text: unknown): ParsedWebSearchSuccess | ParsedWebSearchEmpty | null {
  if (typeof text !== 'string') {
    return null;
  }

  const lines = stripOutputTruncationNote(text.replace(/\r\n?/gu, '\n').split('\n'));
  let index = 0;
  let partialMatch = false;
  let missingTerms: string[] = [];

  if (lines[index] === WEB_SEARCH_WARNING_TEXT) {
    partialMatch = true;
    index += 1;
    const missingTermsLine = lines[index];
    if (!missingTermsLine?.startsWith('missing_query_terms: ')) {
      return null;
    }
    missingTerms = parseMissingTerms(missingTermsLine.slice('missing_query_terms: '.length));
    index += 1;
  }

  if (lines[index] === 'truncated: true') {
    index += 1;
  }

  if (index > 0) {
    if (lines[index] !== '') {
      return null;
    }
    index += 1;
  }

  if (lines[index] !== WEB_SEARCH_RESULTS_HEADER) {
    return null;
  }
  index += 1;

  if (lines[index] === WEB_SEARCH_EMPTY_TEXT && index === lines.length - 1) {
    return {kind: 'empty'};
  }

  const results = parseWebSearchResultItems(lines, index);
  return results ? {kind: 'success', missingTerms, partialMatch, results} : null;
}

/** 解析固定三行结果项，并验证编号、字段和 URL 均符合当前 formatter 契约。 */
function parseWebSearchResultItems(lines: string[], startIndex: number): WebSearchResultItem[] | null {
  const results: WebSearchResultItem[] = [];

  for (let index = startIndex; index < lines.length; index += 3) {
    const titleMatch = new RegExp(`^${results.length + 1}\\. (.+)$`, 'u').exec(lines[index] || '');
    const urlMatch = /^   url: (.+)$/u.exec(lines[index + 1] || '');
    const snippetMatch = /^   snippet: (.+)$/u.exec(lines[index + 2] || '');

    if (!titleMatch || !urlMatch || !snippetMatch) {
      return null;
    }

    const title = normalizeDisplayText(titleMatch[1]);
    const snippet = normalizeDisplayText(snippetMatch[1]);
    const displayUrl = createDisplayUrl(urlMatch[1]);
    if (!title || !snippet || !displayUrl) {
      return null;
    }

    results.push({displayUrl, snippet, title});
  }

  return results.length > 0 ? results : null;
}

/** 从 formatter 的失败 envelope 中提取原因，避免在可见区重复内部协议标题。 */
function parseWebSearchFailure(text: unknown): ParsedWebSearchFailure | null {
  if (typeof text !== 'string') {
    return null;
  }

  const normalized = text.replace(/\r\n?/gu, '\n');
  if (!normalized.startsWith(WEB_SEARCH_FAILURE_PREFIX)) {
    return null;
  }

  const reason = normalized.slice(WEB_SEARCH_FAILURE_PREFIX.length).trim();
  return reason ? {kind: 'failure', reason} : null;
}

/** 将 formatter 的 missing terms 字段转换成弱化 metadata 所需的有界 term 列表。 */
function parseMissingTerms(text: string): string[] {
  if (text === '(none)') {
    return [];
  }

  return text.split(', ')
    .map((term) => ellipsizeGraphemes(normalizeDisplayText(term), MAX_MISSING_TERM_GRAPHEMES))
    .filter((term) => term !== '');
}

/** 生成移除 scheme 但保留具体页面定位信息的 display URL。 */
function createDisplayUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) {
    return null;
  }

  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.host}${path}${parsed.search}${parsed.hash}`;
}

/** 渲染搜索标题；状态只影响 marker 和必要的生命周期尾缀。 */
function renderWebSearchHeaderLines(
  query: string,
  statusLabel: string | null,
  callStatus: boolean | undefined,
  width: number,
  theme: TuiTheme
): string[] {
  const status = statusLabel ? ` · ${statusLabel}` : '';
  return renderPrefixedLines({
    text: `Web search · “${query}”${status}`,
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
    colorizeFirstSymbol: resolveToolCallPrefixStyle(callStatus, theme)
  });
}

/** 根据 call 是否已有结果生成 pending、完成或失败标题尾缀。 */
function resolveCallStatusLabel(callStatus: boolean | undefined): string | null {
  if (callStatus === undefined) {
    return 'searching';
  }
  return callStatus ? null : 'failed';
}

/** 将结果数量、部分匹配和结构化截断事实组合成单行弱化 metadata。 */
function createResultMetadata(parsed: ParsedWebSearchSuccess, truncated: boolean): string {
  const countLabel = truncated
    ? `${parsed.results.length} displayed ${parsed.results.length === 1 ? 'result' : 'results'}`
    : `${parsed.results.length} ${parsed.results.length === 1 ? 'result' : 'results'}`;
  const parts = [countLabel];

  if (parsed.partialMatch) {
    parts.push('partial match');
    if (parsed.missingTerms.length > 0) {
      parts.push(`${parsed.missingTerms.map((term) => `“${term}”`).join(', ')} not matched`);
    }
  }
  if (truncated) {
    parts.push('truncated');
  }

  return parts.join(' · ');
}

/** 渲染弱化 metadata，长 missing terms 按 safe width 延续相同缩进。 */
function renderWebSearchMetadataLines(text: string, width: number, theme: TuiTheme): string[] {
  return renderPrefixedLines({
    text,
    width,
    firstPrefix: '  ',
    continuationPrefix: '  ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/** 在逻辑行预算内渲染完整结果项，并以树末节点表达省略数量。 */
function renderWebSearchResultTreeLines(results: WebSearchResultItem[], width: number, theme: TuiTheme): string[] {
  const visibleResults = results.slice(0, MAX_VISIBLE_RESULTS);
  const omitted = results.length - visibleResults.length;
  const lines: string[] = [];

  visibleResults.forEach((result, index) => {
    const isLast = index === visibleResults.length - 1 && omitted === 0;
    const branchPrefix = isLast ? '  └─ ' : '  ├─ ';
    const railPrefix = isLast ? '     ' : '  │  ';

    lines.push(...renderWebSearchTreeRowLines(result.title, width, branchPrefix, railPrefix, 'text', theme));
    lines.push(...renderWebSearchTreeRowLines(`${result.displayUrl} · ${result.snippet}`, width, railPrefix, railPrefix, 'toolOutput', theme));
  });

  if (omitted > 0) {
    lines.push(...renderWebSearchTreeRowLines(
      `… ${omitted} more ${omitted === 1 ? 'result' : 'results'}`,
      width,
      '  └─ ',
      '     ',
      'toolOutput',
      theme
    ));
  }

  return lines;
}

/** 单独着色树形 rail 与内容，避免标题色和摘要色改变左侧层级线颜色。 */
function renderWebSearchTreeRowLines(
  text: string,
  width: number,
  firstPrefix: string,
  continuationPrefix: string,
  contentStyle: 'text' | 'toolOutput',
  theme: TuiTheme
): string[] {
  const lines: string[] = [];
  let first = true;
  const safeWidth = safeRenderWidth(width);

  for (const segment of wrapContentLine(text, safeWidth, displayWidth(firstPrefix))) {
    const prefix = first ? firstPrefix : continuationPrefix;
    lines.push(`${blockText(theme, 'toolOutput', prefix)}${blockText(theme, contentStyle, segment)}`);
    first = false;
  }

  return lines.length > 0 ? lines : [`${blockText(theme, 'toolOutput', firstPrefix)}${blockText(theme, contentStyle, '')}`];
}

/** 渲染有界失败原因，协议前缀已在解析阶段移除。 */
function renderWebSearchFailureLines(reason: string, width: number, theme: TuiTheme): string[] {
  return renderPrefixedLines({
    text: truncateDisplayText(reason, TOOL_RESULT_MAX_DISPLAY_LINES),
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/** 移除输出 cap 追加的固定尾注；真实截断状态只读取结构化 details。 */
function stripOutputTruncationNote(lines: string[]): string[] {
  const normalized = [...lines];
  while (normalized[normalized.length - 1] === '') {
    normalized.pop();
  }
  if (normalized[normalized.length - 1] === WEB_SEARCH_OUTPUT_TRUNCATED_TEXT) {
    normalized.pop();
    while (normalized[normalized.length - 1] === '') {
      normalized.pop();
    }
  }
  return normalized;
}

/** 将外部单行字段中的空白折叠，避免控制换行破坏 renderer 行数预算。 */
function normalizeDisplayText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** 按 grapheme 截断用户或网络文本，避免切断组合字符。 */
function ellipsizeGraphemes(value: string, maxGraphemes: number): string {
  const graphemes = splitGraphemes(value);
  if (graphemes.length <= maxGraphemes) {
    return value;
  }
  return `${graphemes.slice(0, Math.max(1, maxGraphemes - 1)).join('')}…`;
}

export {
  WEB_SEARCH_TOOL_NAME,
  renderWebSearchToolCallLines,
  renderWebSearchToolPairLines
};
