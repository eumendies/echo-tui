import {blockText} from '../colors';
import {safeRenderWidth, splitGraphemes} from '../layout';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  createToolRailPrefix,
  truncateDisplayText,
  wrapContentLine
} from './shared';

import type {TuiTheme} from '../../config/theme-config';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

const WEB_FETCH_TOOL_NAME = 'web_fetch';
const WEB_FETCH_FAILURE_LINE = 'web_fetch failed.';
const CONTENT_HEADER = 'content:';
const CONTENT_FENCE = '```';
const OUTPUT_TRUNCATED_TEXT = 'Output was truncated.';
const OFFLOAD_MARKER_PATTERN = /^\[tool result truncated: (.+)\]$/u;
const MAX_DISPLAY_URL_GRAPHEMES = 88;
const MAX_REDIRECT_SOURCE_GRAPHEMES = 40;
const MAX_REDIRECT_FINAL_GRAPHEMES = 64;
const DOCUMENT_MAX_LOGICAL_LINES = 10;

type WebFetchCallRequest = {
  limit?: number; // 请求的最大最终文本行数；省略表示读取到可用结尾。
  offset: number; // 最终文本投影中的零基起始行。
  url: URL; // 已验证为无 credentials 的绝对 HTTP(S) URL。
};

type ParsedWebFetchResponse = {
  bodyLines: string[]; // 从 content envelope 恢复的正文逻辑行。
  bodyTruncated: boolean; // formatter header 是否声明远端响应 body 达到读取硬上限。
  completeEnvelope: boolean; // 是否找到了 formatter 最末 closing fence。
  contentType: string | null; // HTTP error envelope 中可选的响应媒体类型。
  finalUrl: URL | null; // redirect 后的最终 URL；普通响应可由首行或 call 补足。
  hasMore: boolean; // formatter 是否声明分页范围后仍有正文。
  kind: 'response'; // 标识成功或 HTTP error 的 content envelope。
  offloaded: boolean; // 截断 preview 末尾是否包含已保存完整结果的 marker。
  outputTruncated: boolean; // preview 是否缺少完整 envelope 或包含固定输出截断尾注。
  requestedUrl: URL | null; // redirect envelope 中显式保留的原请求 URL。
  status: string; // 标准化后的 `<code> <status text>` 标题片段。
};

type ParsedWebFetchFailure = {
  kind: 'failure'; // 标识无 HTTP content envelope 的请求失败。
  reason: string; // 去除内部 `Reason:` 字段后的诊断。
};

type ParsedWebFetchUnsupported = {
  contentType: string; // 不受支持响应的媒体类型。
  finalUrl: URL | null; // redirect 后存在时的最终 URL。
  kind: 'unsupported'; // 标识 formatter 的 unsupported media envelope。
  reason: string; // formatter 返回的 unsupported 原因。
  requestedUrl: URL; // formatter 明确记录的请求 URL。
  status: string; // HTTP status 标题片段。
};

type ParsedResponseHeaders = {
  bodyTruncated: boolean; // header 是否包含 `body_truncated: true`。
  contentType: string | null; // 可选 content type header。
  finalUrl: URL | null; // 可选 final URL header。
  hasMore: boolean; // header 是否包含 `has_more: true`。
  requestedUrl: URL | null; // 可选 requested URL header。
  status: string; // 必需 HTTP status header。
};

type PreviewTail = {
  lines: string[]; // 移除 renderer 可识别尾注后的 envelope 行。
  offloaded: boolean; // 尾部是否为合法 offloading marker。
  outputTruncated: boolean; // 尾部是否声明 preview 被输出 cap 截断。
};

/** 渲染 pending、孤立或 fallback 拆分后的 web_fetch call 标题。 */
function renderWebFetchToolCallLines(
  record: ToolCallTranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] | null {
  const request = parseWebFetchCall(record.argumentsText);
  if (!request) {
    return null;
  }

  const status = callStatus === undefined ? 'fetching' : callStatus ? null : 'failed';
  return renderWebFetchHeaderLines(createDisplayUrl(request.url, MAX_DISPLAY_URL_GRAPHEMES), status ? [status] : [], callStatus, width, theme);
}

/** 将相邻 web_fetch call/result 投影成 inline metadata 标题与文档 rail。 */
function renderWebFetchToolPairLines(
  call: ToolCallTranscriptRecord,
  result: ToolResultTranscriptRecord,
  width: number,
  theme: TuiTheme
): string[] | null {
  const request = parseWebFetchCall(call.argumentsText);
  if (!request) {
    return null;
  }

  const timedOut = result.details.kind === 'web_fetch' && result.details.timedOut;
  const truncated = result.details.kind === 'web_fetch' && result.details.truncated;

  if (result.ok) {
    const response = parseWebFetchResponse(result.text, true, truncated);
    return response ? renderWebFetchResponseLines(request, response, true, truncated, width, theme) : null;
  }

  const response = parseWebFetchResponse(result.text, false, truncated);
  if (response) {
    return renderWebFetchResponseLines(request, response, false, truncated, width, theme);
  }

  const unsupported = parseWebFetchUnsupported(result.text);
  if (unsupported) {
    return renderWebFetchUnsupportedLines(request, unsupported, width, theme);
  }

  const failure = parseWebFetchFailure(result.text);
  if (!failure) {
    return null;
  }

  return [
    ...renderWebFetchHeaderLines(createDisplayUrl(request.url, MAX_DISPLAY_URL_GRAPHEMES), [timedOut ? 'timed out' : 'failed'], false, width, theme),
    ...renderWebFetchDiagnosticLines(failure.reason, width, theme)
  ];
}

/** 从 call arguments 中保守读取 URL 与分页参数。 */
function parseWebFetchCall(argumentsText: unknown): WebFetchCallRequest | null {
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

  const payload = parsed as Record<string, unknown>;
  const url = typeof payload.url === 'string' ? parseDisplayableUrl(payload.url) : null;
  const offset = normalizeOptionalInteger(payload.offset, 0, 0);
  const limit = normalizeOptionalInteger(payload.limit, 1, undefined);
  if (!url || offset === null || limit === null) {
    return null;
  }

  return {
    url,
    offset: offset ?? 0,
    ...(limit === undefined ? {} : {limit})
  };
}

/** 校验可选整数；null 表示值不可信，undefined 表示调用未设置。 */
function normalizeOptionalInteger(value: unknown, minimum: number, fallback: number | undefined): number | undefined | null {
  if (value === undefined || value === null) {
    return fallback;
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum ? value : null;
}

/** 解析成功或 HTTP error content envelope，并把任意正文与 header 边界分离。 */
function parseWebFetchResponse(text: unknown, expectedOk: boolean, structuredTruncated: boolean): ParsedWebFetchResponse | null {
  if (typeof text !== 'string') {
    return null;
  }

  const tail = extractPreviewTail(text.replace(/\r\n?/gu, '\n').split('\n'), structuredTruncated);
  const lines = tail.lines;
  const firstLine = lines[0] || '';
  const firstUrl = expectedOk ? parseDisplayableUrl(firstLine) : null;
  if ((expectedOk && !firstUrl) || (!expectedOk && firstLine !== WEB_FETCH_FAILURE_LINE)) {
    return null;
  }

  const separatorIndex = lines.indexOf('', 1);
  if (separatorIndex < 0) {
    return null;
  }

  const headers = parseResponseHeaders(lines.slice(1, separatorIndex));
  if (!headers || lines[separatorIndex + 1] !== CONTENT_HEADER || lines[separatorIndex + 2] !== CONTENT_FENCE) {
    return null;
  }

  const bodyStart = separatorIndex + 3;
  const closingIndex = findClosingFence(lines, bodyStart);
  const completeEnvelope = closingIndex >= bodyStart;
  if (!completeEnvelope && !structuredTruncated) {
    return null;
  }
  if (completeEnvelope && closingIndex !== lines.length - 1) {
    return null;
  }

  const bodyLines = lines.slice(bodyStart, completeEnvelope ? closingIndex : lines.length);
  const finalUrl = headers.finalUrl || firstUrl;
  if (expectedOk && headers.finalUrl && firstUrl?.toString() !== headers.finalUrl.toString()) {
    return null;
  }
  if ((headers.requestedUrl && !headers.finalUrl) || (!headers.requestedUrl && headers.finalUrl)) {
    return null;
  }

  return {
    bodyLines,
    bodyTruncated: headers.bodyTruncated,
    completeEnvelope,
    contentType: headers.contentType,
    finalUrl,
    hasMore: headers.hasMore,
    kind: 'response',
    offloaded: tail.offloaded,
    outputTruncated: tail.outputTruncated || !completeEnvelope,
    requestedUrl: headers.requestedUrl,
    status: headers.status
  };
}

/** 解析 response header，拒绝重复、未知或不符合 formatter 语义的字段。 */
function parseResponseHeaders(lines: string[]): ParsedResponseHeaders | null {
  let requestedUrl: URL | null = null;
  let finalUrl: URL | null = null;
  let status: string | null = null;
  let contentType: string | null = null;
  let hasMore = false;
  let bodyTruncated = false;

  for (const line of lines) {
    if (line.startsWith('url: ') && !requestedUrl) {
      requestedUrl = parseDisplayableUrl(line.slice('url: '.length));
      if (!requestedUrl) {
        return null;
      }
      continue;
    }
    if (line.startsWith('final_url: ') && !finalUrl) {
      finalUrl = parseDisplayableUrl(line.slice('final_url: '.length));
      if (!finalUrl) {
        return null;
      }
      continue;
    }
    if (line.startsWith('status: ') && !status) {
      status = parseHttpStatus(line.slice('status: '.length));
      if (!status) {
        return null;
      }
      continue;
    }
    if (line.startsWith('content_type: ') && !contentType) {
      contentType = normalizeSingleLine(line.slice('content_type: '.length));
      if (!contentType) {
        return null;
      }
      continue;
    }
    if (line === 'has_more: true' && !hasMore) {
      hasMore = true;
      continue;
    }
    if (line === 'body_truncated: true' && !bodyTruncated) {
      bodyTruncated = true;
      continue;
    }
    return null;
  }

  return status ? {bodyTruncated, contentType, finalUrl, hasMore, requestedUrl, status} : null;
}

/** 解析 formatter 的简单请求失败 envelope。 */
function parseWebFetchFailure(text: unknown): ParsedWebFetchFailure | null {
  if (typeof text !== 'string') {
    return null;
  }
  const prefix = `${WEB_FETCH_FAILURE_LINE}\nReason: `;
  const normalized = text.replace(/\r\n?/gu, '\n');
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  const reason = normalized.slice(prefix.length).trim();
  return reason ? {kind: 'failure', reason} : null;
}

/** 解析 unsupported media envelope，确保字段顺序和当前 formatter 一致。 */
function parseWebFetchUnsupported(text: unknown): ParsedWebFetchUnsupported | null {
  if (typeof text !== 'string') {
    return null;
  }
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  if (lines[0] !== WEB_FETCH_FAILURE_LINE || lines.length < 6) {
    return null;
  }

  let index = 1;
  const requestedUrl = lines[index]?.startsWith('url: ') ? parseDisplayableUrl(lines[index].slice('url: '.length)) : null;
  if (!requestedUrl) {
    return null;
  }
  index += 1;

  let finalUrl: URL | null = null;
  if (lines[index]?.startsWith('final_url: ')) {
    finalUrl = parseDisplayableUrl(lines[index].slice('final_url: '.length));
    if (!finalUrl) {
      return null;
    }
    index += 1;
  }

  const status = lines[index]?.startsWith('status: ') ? parseHttpStatus(lines[index].slice('status: '.length)) : null;
  const contentType = lines[index + 1]?.startsWith('content_type: ')
    ? normalizeSingleLine(lines[index + 1].slice('content_type: '.length))
    : '';
  if (!status || !contentType || lines[index + 2] !== 'error: unsupported media type' || !lines[index + 3]?.startsWith('reason: ') || index + 4 !== lines.length) {
    return null;
  }

  const reason = normalizeSingleLine(lines[index + 3].slice('reason: '.length));
  return reason ? {contentType, finalUrl, kind: 'unsupported', reason, requestedUrl, status} : null;
}

/** 只在结构化 truncated 已成立时移除固定输出尾注或 offloading marker。 */
function extractPreviewTail(sourceLines: string[], structuredTruncated: boolean): PreviewTail {
  const lines = [...sourceLines];
  if (!structuredTruncated) {
    return {lines, offloaded: false, outputTruncated: false};
  }

  while (lines[lines.length - 1] === '') {
    lines.pop();
  }

  const finalLine = lines[lines.length - 1] || '';
  const offloadMatch = OFFLOAD_MARKER_PATTERN.exec(finalLine);
  if (offloadMatch && offloadMatch[1].trim() !== '') {
    lines.pop();
    stripTrailingBlankLines(lines);
    return {lines, offloaded: true, outputTruncated: true};
  }
  if (finalLine === OUTPUT_TRUNCATED_TEXT) {
    lines.pop();
    stripTrailingBlankLines(lines);
    return {lines, offloaded: false, outputTruncated: true};
  }

  return {lines, offloaded: false, outputTruncated: false};
}

/** 移除 envelope 尾部仅用于分隔截断 marker 的空行。 */
function stripTrailingBlankLines(lines: string[]): void {
  while (lines[lines.length - 1] === '') {
    lines.pop();
  }
}

/** 使用最末 fence 作为完整 envelope 边界，正文内部 fence 保持为普通内容。 */
function findClosingFence(lines: string[], bodyStart: number): number {
  for (let index = lines.length - 1; index >= bodyStart; index -= 1) {
    if (lines[index] === CONTENT_FENCE) {
      return index;
    }
  }
  return -1;
}

/** 解析无 credentials 的绝对 HTTP(S) URL。 */
function parseDisplayableUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname && !parsed.username && !parsed.password
    ? parsed
    : null;
}

/** 校验并规范化 HTTP status 标题片段。 */
function parseHttpStatus(value: string): string | null {
  const match = /^([1-5]\d\d)(?: ([^\r\n]+))?$/u.exec(value);
  if (!match) {
    return null;
  }
  const statusText = match[2] ? normalizeSingleLine(match[2]) : '';
  return statusText ? `${match[1]} ${statusText}` : match[1];
}

/** 折叠外部单行字段中的空白，避免控制字符破坏标题结构。 */
function normalizeSingleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** 生成去掉 scheme 且保留 host 与末尾定位信息的有界 URL。 */
function createDisplayUrl(url: URL, maxGraphemes: number): string {
  const path = url.pathname === '/' ? '' : url.pathname;
  const full = `${url.host}${path}${url.search}${url.hash}`;
  const graphemes = splitGraphemes(full);
  if (graphemes.length <= maxGraphemes) {
    return full;
  }

  const host = url.host;
  const hostGraphemes = splitGraphemes(host);
  const tailBudget = Math.max(8, maxGraphemes - Math.min(hostGraphemes.length, Math.floor(maxGraphemes / 2)) - 2);
  const visibleHost = hostGraphemes.length <= maxGraphemes - tailBudget - 2
    ? host
    : `${hostGraphemes.slice(0, Math.max(4, maxGraphemes - tailBudget - 3)).join('')}…`;
  const tail = graphemes.slice(-tailBudget).join('');
  return `${visibleHost}/…${tail.startsWith('/') ? '' : '/'}${tail}`;
}

/** 渲染完成响应标题与正文 rail。 */
function renderWebFetchResponseLines(
  request: WebFetchCallRequest,
  response: ParsedWebFetchResponse,
  ok: boolean,
  truncated: boolean,
  width: number,
  theme: TuiTheme
): string[] {
  const identity = createResponseIdentity(request, response);
  const bodyLines = normalizeBodyLines(response.bodyLines);
  const metadata = createResponseMetadata(request, response, bodyLines.length, truncated);
  if (bodyLines.length === 0 && response.completeEnvelope) {
    metadata.push('no readable content');
  }

  const lines = renderWebFetchHeaderLines(identity, [response.status, ...metadata], ok, width, theme);
  if (bodyLines.length > 0) {
    lines.push(...renderDocumentRailRow('', 'toolOutput', width, theme));
    lines.push(...renderDocumentRailLines(bodyLines, width, theme));
  }
  return lines;
}

/** 渲染 unsupported media 标题与短诊断，不构造伪正文。 */
function renderWebFetchUnsupportedLines(
  request: WebFetchCallRequest,
  unsupported: ParsedWebFetchUnsupported,
  width: number,
  theme: TuiTheme
): string[] {
  const finalUrl = unsupported.finalUrl || request.url;
  const identity = finalUrl.toString() === request.url.toString()
    ? createDisplayUrl(finalUrl, MAX_DISPLAY_URL_GRAPHEMES)
    : createRedirectIdentity(request.url, finalUrl);
  return [
    ...renderWebFetchHeaderLines(identity, [unsupported.status, 'unsupported', unsupported.contentType], false, width, theme),
    ...renderWebFetchDiagnosticLines(unsupported.reason, width, theme)
  ];
}

/** 根据 redirect facts 构造 requested → final URL 身份。 */
function createResponseIdentity(request: WebFetchCallRequest, response: ParsedWebFetchResponse): string {
  const requestedUrl = response.requestedUrl || request.url;
  const finalUrl = response.finalUrl || request.url;
  return requestedUrl.toString() === finalUrl.toString()
    ? createDisplayUrl(finalUrl, MAX_DISPLAY_URL_GRAPHEMES)
    : createRedirectIdentity(requestedUrl, finalUrl);
}

/** 为 redirect 标题分别压缩来源与最终 URL。 */
function createRedirectIdentity(requestedUrl: URL, finalUrl: URL): string {
  return `${createDisplayUrl(requestedUrl, MAX_REDIRECT_SOURCE_GRAPHEMES)} → ${createDisplayUrl(finalUrl, MAX_REDIRECT_FINAL_GRAPHEMES)}`;
}

/** 将分页与结构化截断事实组合成 inline 标题 modifiers。 */
function createResponseMetadata(
  request: WebFetchCallRequest,
  response: ParsedWebFetchResponse,
  bodyLineCount: number,
  truncated: boolean
): string[] {
  const metadata: string[] = [];
  if ((request.offset > 0 || request.limit !== undefined) && response.completeEnvelope && bodyLineCount > 0) {
    metadata.push(`lines ${request.offset + 1}–${request.offset + bodyLineCount}`);
  }
  if (response.hasMore) {
    metadata.push('more');
  }
  if (!truncated) {
    return metadata;
  }

  let classified = false;
  if (response.bodyTruncated) {
    metadata.push('response truncated');
    classified = true;
  }
  if (response.offloaded) {
    metadata.push('preview truncated', 'full result saved');
    classified = true;
  } else if (response.outputTruncated) {
    metadata.push('preview truncated');
    classified = true;
  }
  if (!classified) {
    metadata.push('truncated');
  }
  return metadata;
}

/** 将 formatter 的单个空正文行归一为空数组，其余段落空行保持不变。 */
function normalizeBodyLines(lines: string[]): string[] {
  return lines.length === 1 && lines[0] === '' ? [] : lines;
}

/** 渲染 Bash 风格的状态 rail 标题；metadata 与 URL 共用同一个可换行标题块。 */
function renderWebFetchHeaderLines(
  identity: string,
  metadata: string[],
  callStatus: boolean | undefined,
  width: number,
  theme: TuiTheme
): string[] {
  const title = ['Web fetch', identity, ...metadata].join(' · ');
  const safeWidth = safeRenderWidth(width);
  const prefixWidth = safeWidth >= 4 ? 4 : safeWidth >= 2 ? 2 : 0;
  const markerStyle = callStatus === undefined ? 'toolOutput' : callStatus ? 'toolSuccess' : 'toolError';
  const railStyle = callStatus === undefined ? 'tool' : markerStyle;
  const titleStyle = callStatus === undefined ? 'tool' : markerStyle;

  return wrapContentLine(title, safeWidth, prefixWidth)
    .map((segment, index) => `${createToolRailPrefix(index === 0, safeWidth, theme, railStyle, markerStyle)}${blockText(theme, titleStyle, segment)}`);
}

/** 渲染固定十个逻辑行预算的 Bash 风格正文 rail。 */
function renderDocumentRailLines(bodyLines: string[], width: number, theme: TuiTheme): string[] {
  const omitted = bodyLines.length > DOCUMENT_MAX_LOGICAL_LINES
    ? bodyLines.length - (DOCUMENT_MAX_LOGICAL_LINES - 1)
    : 0;
  const visible = omitted > 0 ? bodyLines.slice(0, DOCUMENT_MAX_LOGICAL_LINES - 1) : bodyLines;
  const lines = visible.flatMap((line) => renderDocumentRailRow(line, 'text', width, theme));
  if (omitted > 0) {
    lines.push(...renderDocumentRailRow(`… ${omitted} more ${omitted === 1 ? 'line' : 'lines'}`, 'toolOutput', width, theme));
  }
  return lines;
}

/** 分离 document rail 与正文颜色，并让每个视觉换行延续同色 rail。 */
function renderDocumentRailRow(
  text: string,
  contentStyle: 'text' | 'toolOutput',
  width: number,
  theme: TuiTheme
): string[] {
  const safeWidth = safeRenderWidth(width);
  const prefixWidth = safeWidth >= 4 ? 4 : safeWidth >= 2 ? 2 : 0;
  return wrapContentLine(text, safeWidth, prefixWidth)
    .map((segment) => `${createToolRailPrefix(false, safeWidth, theme, 'toolOutput', 'toolOutput')}${blockText(theme, contentStyle, segment)}`);
}

/** 将请求失败或 unsupported 诊断接入同一个连续 rail 块。 */
function renderWebFetchDiagnosticLines(reason: string, width: number, theme: TuiTheme): string[] {
  return [
    ...renderDocumentRailRow('', 'toolOutput', width, theme),
    ...renderDocumentRailRow(truncateDisplayText(reason, TOOL_RESULT_MAX_DISPLAY_LINES), 'toolOutput', width, theme)
  ];
}

export {
  WEB_FETCH_TOOL_NAME,
  renderWebFetchToolCallLines,
  renderWebFetchToolPairLines
};
