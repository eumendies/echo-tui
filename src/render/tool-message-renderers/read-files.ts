import {type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText
} from './shared';

import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

/**
 * read_files 的专属终端投影层只消费现有文本 envelope，不改写 transcript、tool result 或附件。
 * 解析保持保守：只要形状偏离预期就返回 null，由上层分发回退到通用 renderer。
 */
const READ_FILES_TOOL_NAME = 'read_files';
const MAX_CALL_PATHS = 3;
const MAX_CALL_SEGMENT_LENGTH = 48;
// 路径本身允许分号，因此目录项从右侧已知后缀识别类型和大小，不能直接按分号切分。
const DIRECTORY_ENTRY_PATTERN = /^- (.+); (directory|file|other|symlink)(?:; (size_bytes: \d+))?$/u;

type ReadFilesCallRequest = {
  limit?: number;
  offset?: number;
  path: string;
};

type ReadFilesEnvelope = {
  blocks: Map<string, string[]>;
  fields: Map<string, string>;
  kind: string;
  lists: Map<string, string[]>;
  path: string;
};

type ReadFilesParseResult = {
  envelopes: ReadFilesEnvelope[];
  outputTruncated: boolean;
};

/**
 * 渲染 read_files 调用行，用路径摘要替代完整 arguments JSON。
 */
function renderReadFilesToolCallLines(
  record: ToolCallTranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] | null {
  const label = createReadFilesCallLabel(record.argumentsText);

  if (!label) {
    return null;
  }

  return renderPrefixedLines({
    text: label,
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
    colorizeFirstSymbol: resolveToolCallPrefixStyle(callStatus, theme)
  });
}

/**
 * 渲染 read_files 结果 envelope；解析失败返回 null 交给通用 renderer。
 */
function renderReadFilesToolResultLines(record: ToolResultTranscriptRecord, width: number, theme: TuiTheme): string[] | null {
  const parsed = parseReadFilesResult(record.text);

  if (!parsed) {
    return null;
  }

  const renderedLines = parsed.envelopes.flatMap(renderReadFilesEnvelope);

  if (parsed.outputTruncated) {
    renderedLines.push('output_truncated: true');
  }

  const displayText = truncateDisplayText(renderedLines.join('\n'), TOOL_RESULT_MAX_DISPLAY_LINES);

  return renderPrefixedLines({
    text: displayText,
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/**
 * 将 provider-visible 的 JSON arguments 压缩成调用摘要；任何字段形状异常都交给通用 renderer 展示原文。
 */
function createReadFilesCallLabel(argumentsText: unknown): string | null {
  const payload = parseJsonObject(argumentsText);

  if (!payload || !Array.isArray(payload.files) || payload.files.length === 0) {
    return null;
  }

  const requests: ReadFilesCallRequest[] = [];

  for (const file of payload.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      return null;
    }

    const candidate = file as Record<string, unknown>;

    if (typeof candidate.path !== 'string' || candidate.path.trim() === '') {
      return null;
    }

    const offset = normalizeOptionalInteger(candidate.offset, 0);
    const limit = normalizeOptionalInteger(candidate.limit, 1);

    if (offset === null || limit === null) {
      return null;
    }

    requests.push({
      path: candidate.path,
      ...(offset === undefined ? {} : {offset}),
      ...(limit === undefined ? {} : {limit})
    });
  }

  return `read_files(${summarizeReadFilesRequests(requests)})`;
}

/**
 * 多文件调用只展示前几个路径，剩余数量用省略提示表达，避免调用行被大 JSON 或长路径占满。
 */
function summarizeReadFilesRequests(requests: ReadFilesCallRequest[]): string {
  const visible = requests.slice(0, MAX_CALL_PATHS).map(formatReadFilesRequest);
  const omitted = requests.length - visible.length;
  const summary = omitted > 0 ? [...visible, `… +${omitted} more`] : visible;

  return summary.join(', ');
}

/**
 * 用 path@offset+limit 表达分页范围；只有 limit 时显式补 @0，避免用户误以为范围起点未知。
 */
function formatReadFilesRequest(request: ReadFilesCallRequest): string {
  const offset = request.offset ?? (request.limit === undefined ? undefined : 0);
  const range = [
    offset === undefined ? '' : `@${offset}`,
    request.limit === undefined ? '' : `+${request.limit}`
  ].join('');

  return `${ellipsizeSingleLine(request.path, MAX_CALL_SEGMENT_LENGTH)}${range}`;
}

/**
 * 对 offset/limit 做轻量校验；返回 null 表示调用形状不可信，需要保留通用原始展示。
 */
function normalizeOptionalInteger(value: unknown, minimum: number): number | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    return null;
  }

  return value;
}

/**
 * 解析 read_files 结果中的多个 envelope；这里只识别 tool handler 当前输出的顶层文本协议。
 */
function parseReadFilesResult(text: unknown): ReadFilesParseResult | null {
  if (typeof text !== 'string' || !text.startsWith('--- ')) {
    return null;
  }

  const lines = text.split('\n');
  const outputTruncated = stripTrailingOutputTruncatedNote(lines);
  const envelopes: ReadFilesEnvelope[] = [];
  let index = 0;

  while (index < lines.length) {
    if (lines[index] === '') {
      index += 1;
      continue;
    }

    const header = parseEnvelopeHeader(lines[index]);

    if (!header) {
      return null;
    }

    index += 1;
    const body: string[] = [];

    index = collectEnvelopeBodyLines(lines, index, body);

    const envelope = parseEnvelopeBody(header.kind, header.path, body);

    if (!envelope) {
      return null;
    }

    envelopes.push(envelope);
  }

  return envelopes.length > 0 ? {envelopes, outputTruncated} : null;
}

/**
 * 收集当前 envelope 的 body；fenced block 内的内容可能包含伪 header，不能作为 envelope 边界。
 */
function collectEnvelopeBodyLines(lines: string[], startIndex: number, body: string[]): number {
  let index = startIndex;
  let insideFence = false;

  while (index < lines.length) {
    const line = lines[index];

    if (!insideFence && isEnvelopeHeader(line)) {
      break;
    }

    body.push(line);

    if (line === '```') {
      insideFence = !insideFence;
    }

    index += 1;
  }

  return index;
}

/**
 * 通用 tool 截断提示位于整段输出末尾；先移除它，再把状态压缩进 read_files 摘要行。
 */
function stripTrailingOutputTruncatedNote(lines: string[]): boolean {
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  if (lines[lines.length - 1] !== 'Output was truncated.') {
    return false;
  }

  lines.pop();

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return true;
}

/**
 * envelope header 同时给出媒体类型和原始请求路径，是后续降噪投影的最小定位信息。
 */
function parseEnvelopeHeader(line: string): {kind: string; path: string} | null {
  const match = /^--- ([^:]+): (.*)$/u.exec(line);

  if (!match || match[1].trim() === '' || match[2].trim() === '') {
    return null;
  }

  return {kind: match[1], path: match[2]};
}

function isEnvelopeHeader(line: string): boolean {
  return parseEnvelopeHeader(line) !== null;
}

/**
 * 将 envelope body 拆成字段、列表和 fenced block 三类结构；未知行直接触发 fallback，避免误导性摘要。
 */
function parseEnvelopeBody(kind: string, path: string, lines: string[]): ReadFilesEnvelope | null {
  const fields = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const blocks = new Map<string, string[]>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line === '') {
      index += 1;
      continue;
    }

    const blockKey = parseLabelLine(line);
    if (blockKey && lines[index + 1] === '```') {
      const end = lines.indexOf('```', index + 2);

      if (end < 0) {
        return null;
      }

      blocks.set(blockKey, lines.slice(index + 2, end));
      index = end + 1;
      continue;
    }

    if (blockKey && isListStart(blockKey)) {
      const listItems: string[] = [];
      index += 1;

      while (index < lines.length) {
        const item = lines[index];

        if (item === '') {
          index += 1;
          break;
        }

        if (parseLabelLine(item) || isEnvelopeHeader(item)) {
          break;
        }

        listItems.push(item);
        index += 1;
      }

      lists.set(blockKey, listItems);
      continue;
    }

    const field = parseFieldLine(line);

    if (!field) {
      return null;
    }

    fields.set(field.key, field.value);
    index += 1;
  }

  if (!isSupportedEnvelopeShape(kind, fields, lists, blocks)) {
    return null;
  }

  return {blocks, fields, kind, lists, path};
}

function parseLabelLine(line: string): string | null {
  const match = /^([a-z_]+):$/u.exec(line);
  return match ? match[1] : null;
}

function parseFieldLine(line: string): {key: string; value: string} | null {
  const match = /^([a-z_]+):\s*(.*)$/u.exec(line);
  return match ? {key: match[1], value: match[2]} : null;
}

function isListStart(key: string): boolean {
  return key === 'entries';
}

/**
 * 判断 envelope 是否有足够信息可投影；这里接受错误 envelope，确保单个路径失败仍可见。
 */
function isSupportedEnvelopeShape(
  kind: string,
  fields: Map<string, string>,
  lists: Map<string, string[]>,
  blocks: Map<string, string[]>
): boolean {
  if (fields.has('error') || fields.has('reason')) {
    return true;
  }

  if (kind === 'text') {
    return blocks.has('content');
  }

  if (kind === 'directory') {
    return lists.has('entries');
  }

  if (kind === 'image') {
    return fields.has('size_bytes') || fields.has('image_attached');
  }

  if (kind === 'pdf') {
    return fields.has('pages') || blocks.has('extracted_text');
  }

  return fields.has('size_bytes');
}

/**
 * 根据 envelope 类型选择展示策略：正文密集型内容只展示摘要，目录和错误保留可操作信息。
 */
function renderReadFilesEnvelope(envelope: ReadFilesEnvelope): string[] {
  if (envelope.fields.has('error') || envelope.fields.has('reason')) {
    return renderErrorEnvelope(envelope);
  }

  if (envelope.kind === 'text') {
    return renderTextEnvelope(envelope);
  }

  if (envelope.kind === 'directory') {
    return renderDirectoryEnvelope(envelope);
  }

  if (envelope.kind === 'image') {
    return [createEnvelopeHeader(envelope, formatMetadata(envelope, ['size_bytes', 'image_attached']))];
  }

  if (envelope.kind === 'pdf') {
    return renderPdfEnvelope(envelope);
  }

  return renderUnsupportedEnvelope(envelope);
}

function renderTextEnvelope(envelope: ReadFilesEnvelope): string[] {
  return [createEnvelopeHeader(envelope, formatTextMetadata(envelope))];
}

/**
 * 目录读取的用户价值在直接子项，因此保留列表；分页内部状态 has_more 不进入终端投影。
 */
function renderDirectoryEnvelope(envelope: ReadFilesEnvelope): string[] {
  const entries = envelope.lists.get('entries') || [];

  return [
    createEnvelopeHeader(envelope, ''),
    ...entries.map(formatDirectoryEntry)
  ];
}

/**
 * PDF 提取文本会很长，终端只保留页数和截断状态，正文继续留在原始 tool result 中供模型使用。
 */
function renderPdfEnvelope(envelope: ReadFilesEnvelope): string[] {
  return [createEnvelopeHeader(envelope, formatMetadata(envelope, ['pages', 'pages_with_text', 'content_truncated']))];
}

/**
 * 单路径失败需要保留媒体类型、路径和原因，便于用户判断是局部失败还是整次工具失败。
 */
function renderErrorEnvelope(envelope: ReadFilesEnvelope): string[] {
  const metadata = formatMetadata(envelope, ['size_bytes', 'error', 'reason']);
  return [createEnvelopeHeader(envelope, metadata.length > 0 ? metadata : 'error')];
}

function renderUnsupportedEnvelope(envelope: ReadFilesEnvelope): string[] {
  return [createEnvelopeHeader(envelope, formatMetadata(envelope, ['size_bytes', 'error', 'reason']))];
}

/**
 * envelope 头部统一承载类型和路径，后续 metadata 以同一行后缀展示以减少垂直空间占用。
 */
function createEnvelopeHeader(envelope: ReadFilesEnvelope, metadata: string): string {
  const suffix = metadata.length > 0 ? `  ${metadata}` : '';
  return `${envelope.kind}: ${envelope.path}${suffix}`;
}

/**
 * 只投影明确列入白名单的字段，避免把 has_more 或大块模型可见内容重新带回终端噪音。
 */
function formatMetadata(envelope: ReadFilesEnvelope, keys: string[]): string {
  return keys
    .flatMap((key) => {
      const value = envelope.fields.get(key);
      return value === undefined ? [] : [`${key}: ${value}`];
    })
    .join(', ');
}

function formatTextMetadata(envelope: ReadFilesEnvelope): string {
  return [
    summarizeTextContent(envelope.blocks.get('content')),
    formatMetadata(envelope, ['content_truncated'])
  ].filter((part) => part.length > 0).join(', ');
}

/**
 * 文本内容主要供模型继续推理使用，终端只展示读取范围，避免源码正文挤占多文件结果预算。
 */
function summarizeTextContent(lines: string[] | undefined): string {
  if (!lines || lines.length === 0) {
    return 'lines: empty';
  }

  const numberedLines = lines.map(parseNumberedTextLine).filter((line) => line !== null);

  if (numberedLines.length === 0) {
    return `line_count: ${lines.length}`;
  }

  const firstLineNumber = numberedLines[0].lineNumber;
  const lastLineNumber = numberedLines[numberedLines.length - 1].lineNumber;
  const range = firstLineNumber === lastLineNumber ? firstLineNumber : `${firstLineNumber}-${lastLineNumber}`;

  return `lines: ${range} (${numberedLines.length})`;
}

/**
 * 解析 read_files 文本内容中的行号前缀，用于生成紧凑读取摘要；正文不进入终端投影。
 */
function parseNumberedTextLine(line: string): {content: string; lineNumber: string} | null {
  const match = /^(\d+) │ (.*)$/u.exec(line);

  return match ? {lineNumber: match[1], content: match[2]} : null;
}

/**
 * 将目录 envelope 的原始列表项投影成 bullet 行；只从右侧识别已知元数据，避免路径里的分号被误切分。
 */
function formatDirectoryEntry(entry: string): string {
  if (entry === '(empty)') {
    return '  (empty)';
  }

  if (!entry.startsWith('- ')) {
    return `  ${entry}`;
  }

  const parsed = DIRECTORY_ENTRY_PATTERN.exec(entry);

  if (!parsed) {
    return `  • ${entry.slice(2)}`;
  }

  const path = parsed[1];
  const metadata = [parsed[2], parsed[3]].filter((part) => part !== undefined).join(', ');

  return `  • ${path}${metadata.length > 0 ? `  ${metadata}` : ''}`;
}

/**
 * JSON 解析只用于生成可读标签；失败时不能吞掉原始调用信息，所以返回 null 触发 fallback。
 */
function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

/**
 * 调用行路径只做单行化和尾部省略，真正的终端换行仍交给共享 renderer 处理宽度约束。
 */
function ellipsizeSingleLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/[\r\n\t]+/gu, ' ');

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(1, maxLength - 1))}…`;
}

export {
  READ_FILES_TOOL_NAME,
  renderReadFilesToolCallLines,
  renderReadFilesToolResultLines
};
