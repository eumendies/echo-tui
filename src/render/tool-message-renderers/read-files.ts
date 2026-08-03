import {type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {displayWidth, safeRenderWidth} from '../layout';
import {
  clampToDisplayWidth,
  createToolCallTitle,
  expandTabs,
  normalizeContentText,
  renderPrefixedLines,
  resolveToolCallPrefixStyle
} from './shared';

import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

/**
 * read_files 的专属终端投影层只消费现有文本 envelope，不改写 transcript、tool result 或附件。
 * 解析保持保守：只要形状偏离预期就返回 null，由上层分发回退到通用 renderer。
 * 结果投影使用专属预算 READ_FILES_MAX_DISPLAY_LINES（大于共享的 TOOL_RESULT_MAX_DISPLAY_LINES），
 * 因为结果区要展示有界内容预览；其他工具 renderer 仍使用共享 12 行预算。
 */
const READ_FILES_TOOL_NAME = 'read_files';
// read_files 结果投影总预算：header 行、内容行与 output_truncated 提示行合计恒不超过此值。
const READ_FILES_MAX_DISPLAY_LINES = 30;
// 树状投影字符与 grep 结果树同族，保证 header 竖线与内容行 rail 在同一列对齐。
const TREE_HEADER_PREFIX = '  ├─ ';
const TREE_HEADER_LAST_PREFIX = '  └─ ';
const TREE_CONTENT_RAIL = '  │ ';
const TREE_CONTENT_CLOSED_RAIL = '    ';
const OUTPUT_TRUNCATED_LINE = 'output_truncated: true';
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
 * 先解析全部 envelope，再按专属预算分配每个内容型 envelope 的行数，最后逐 envelope 树状渲染合并。
 */
function renderReadFilesToolResultLines(record: ToolResultTranscriptRecord, width: number, theme: TuiTheme): string[] | null {
  const parsed = parseReadFilesResult(record.text);

  if (!parsed) {
    return null;
  }

  const perEnvelopeLines = allocateContentLineBudget(parsed.envelopes, parsed.outputTruncated);
  const lines = parsed.envelopes.flatMap((envelope, index) =>
    renderReadFilesEnvelopeLines(envelope, {
      isLast: index === parsed.envelopes.length - 1,
      perEnvelopeLines,
      width,
      theme
    })
  );

  if (parsed.outputTruncated) {
    lines.push(renderBoundedLine('  ', OUTPUT_TRUNCATED_LINE, width, theme));
  }

  return lines;
}

/**
 * 内容行预算：总预算先扣除每个 envelope 的 header 行与 output_truncated 提示行，
 * 剩余行数由所有内容型 envelope（成功 text 与 directory）等分，余数留白。
 */
function allocateContentLineBudget(envelopes: ReadFilesEnvelope[], outputTruncated: boolean): number {
  const headerLines = envelopes.length;
  const markerLines = outputTruncated ? 1 : 0;
  const contentCount = envelopes.filter(isContentEnvelope).length;
  const remaining = READ_FILES_MAX_DISPLAY_LINES - headerLines - markerLines;
  const perEnvelopeLines = contentCount > 0 ? Math.max(0, Math.floor(remaining / contentCount)) : 0;

  return perEnvelopeLines;
}

/**
 * 内容型 envelope 指成功 text 与 directory；错误 envelope 和 image/pdf 只占 header 行。
 */
function isContentEnvelope(envelope: ReadFilesEnvelope): boolean {
  if (envelope.fields.has('error') || envelope.fields.has('reason')) {
    return false;
  }

  return envelope.kind === 'text' || envelope.kind === 'directory';
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

  return createToolCallTitle(READ_FILES_TOOL_NAME, [summarizeReadFilesRequests(requests)]);
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
 * 渲染单个 envelope 的树状行：header 节点 + 预算内的内容行。
 * 非最后一个 envelope 使用 ├─ 节点和 │ rail，最后一个使用 └─ 闭合，竖线不悬空。
 */
function renderReadFilesEnvelopeLines(
  envelope: ReadFilesEnvelope,
  options: {isLast: boolean; perEnvelopeLines: number; width: number; theme: TuiTheme}
): string[] {
  const headerPrefix = options.isLast ? TREE_HEADER_LAST_PREFIX : TREE_HEADER_PREFIX;
  const rail = options.isLast ? TREE_CONTENT_CLOSED_RAIL : TREE_CONTENT_RAIL;
  const lines = [renderBoundedLine(headerPrefix, createEnvelopeHeaderText(envelope), options.width, options.theme)];

  if (!isContentEnvelope(envelope)) {
    return lines;
  }

  if (envelope.kind === 'text') {
    lines.push(...renderTextPreviewLines(envelope, rail, options.perEnvelopeLines, options.width, options.theme));
  } else if (envelope.kind === 'directory') {
    lines.push(...renderDirectoryEntryLines(envelope, rail, options.perEnvelopeLines, options.width, options.theme));
  }

  return lines;
}

/**
 * 生成 envelope header 的纯文本；metadata 白名单按类型选择，错误 envelope 保留原因。
 */
function createEnvelopeHeaderText(envelope: ReadFilesEnvelope): string {
  if (envelope.fields.has('error') || envelope.fields.has('reason')) {
    return createEnvelopeHeader(envelope, formatMetadata(envelope, ['size_bytes', 'error', 'reason']) || 'error');
  }

  if (envelope.kind === 'text') {
    return createEnvelopeHeader(envelope, formatTextMetadata(envelope));
  }

  if (envelope.kind === 'directory') {
    return createEnvelopeHeader(envelope, formatDirectoryMetadata(envelope));
  }

  if (envelope.kind === 'image') {
    return createEnvelopeHeader(envelope, formatMetadata(envelope, ['size_bytes', 'image_attached']));
  }

  if (envelope.kind === 'pdf') {
    return createEnvelopeHeader(envelope, formatMetadata(envelope, ['pages', 'pages_with_text', 'content_truncated']));
  }

  return createEnvelopeHeader(envelope, formatMetadata(envelope, ['size_bytes', 'error', 'reason']));
}

/**
 * 目录 header 展示已解析的直接子项数量；(empty) 哨兵表示空目录，计数为 0。
 */
function formatDirectoryMetadata(envelope: ReadFilesEnvelope): string {
  const entries = envelope.lists.get('entries') || [];
  const count = entries.length > 0 && entries[0] === '(empty)' ? 0 : entries.length;

  return `entries: ${count}`;
}

/**
 * 展示 content block 前若干带行号源行；内容超出预算时最后一行换成可计数省略提示。
 * 行号在该文件预览内右对齐，内容行数不足预算时按实际行数显示，空文件保持 header 的 lines: empty 摘要。
 */
function renderTextPreviewLines(
  envelope: ReadFilesEnvelope,
  rail: string,
  budget: number,
  width: number,
  theme: TuiTheme
): string[] {
  const contentLines = envelope.blocks.get('content') || [];
  const {visible: visibleLines, omitted} = sliceWithOmissionHint(contentLines, budget);

  if (visibleLines.length === 0) {
    return [];
  }

  const parsedLines = visibleLines.map(parseNumberedTextLine);
  const maxLineNumberWidth = parsedLines.reduce(
    (maximum, item) => Math.max(maximum, item === null ? 0 : displayWidth(item.lineNumber)),
    1
  );
  const lines = visibleLines.map((rawLine, index) => {
    const item = parsedLines[index];
    const gutter = item === null
      ? `${' '.repeat(maxLineNumberWidth)} │ `
      : `${' '.repeat(maxLineNumberWidth - displayWidth(item.lineNumber))}${item.lineNumber} │ `;
    const content = item === null ? rawLine : item.content;

    return renderBoundedLine(`${rail}${gutter}`, content, width, theme);
  });

  if (omitted > 0) {
    lines.push(renderBoundedLine(rail, `… +${omitted} more`, width, theme));
  }

  return lines;
}

/**
 * 按预算切出可见项并计算被省略数量，text 预览与 directory entries 共用同一省略规则：
 * budget<=0 或空列表返回空；数量不超预算全部显示；预算为 1 只显示 1 项不加提示；
 * 其余情况显示前 budget-1 项，由调用方追加省略提示行。
 */
function sliceWithOmissionHint<T>(items: T[], budget: number): {visible: T[]; omitted: number} {
  if (budget <= 0 || items.length === 0) {
    return {visible: [], omitted: 0};
  }

  if (items.length <= budget) {
    return {visible: items, omitted: 0};
  }

  if (budget === 1) {
    return {visible: items.slice(0, 1), omitted: 0};
  }

  const visibleCount = budget - 1;

  return {visible: items.slice(0, visibleCount), omitted: items.length - visibleCount};
}

/**
 * 展示预算内的目录直接子项；entries 超出预算时最后一行换成可计数省略提示。
 */
function renderDirectoryEntryLines(
  envelope: ReadFilesEnvelope,
  rail: string,
  budget: number,
  width: number,
  theme: TuiTheme
): string[] {
  const entries = envelope.lists.get('entries') || [];

  if (entries.length > 0 && entries[0] === '(empty)') {
    return [];
  }

  const {visible: visibleEntries, omitted} = sliceWithOmissionHint(entries, budget);
  const lines = visibleEntries.map((entry) => renderBoundedLine(rail, `  • ${formatDirectoryEntryText(entry)}`, width, theme));

  if (omitted > 0) {
    lines.push(renderBoundedLine(rail, `… +${omitted} more`, width, theme));
  }

  return lines;
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
 * 文本内容主要供模型继续推理使用，header 摘要展示读取范围；正文预览行数由专属预算另行约束。
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
 * 解析 read_files 文本内容中的行号前缀，用于生成紧凑读取摘要和预览行的行号 gutter。
 */
function parseNumberedTextLine(line: string): {content: string; lineNumber: string} | null {
  const match = /^(\d+) │ (.*)$/u.exec(line);

  return match ? {lineNumber: match[1], content: match[2]} : null;
}

/**
 * 将目录 envelope 的原始列表项投影成裸条目文本；只从右侧识别已知元数据，避免路径里的分号被误切分。
 */
function formatDirectoryEntryText(entry: string): string {
  if (!entry.startsWith('- ')) {
    return entry;
  }

  const parsed = DIRECTORY_ENTRY_PATTERN.exec(entry);

  if (!parsed) {
    return entry.slice(2);
  }

  const path = parsed[1];
  const metadata = [parsed[2], parsed[3]].filter((part) => part !== undefined).join(', ');

  return metadata.length > 0 ? `${path}  ${metadata}` : path;
}

/**
 * 渲染带固定前缀的单物理行：前缀后文本按可用宽度尾部省略，保证 1 源行 = 1 物理行。
 * header、预览行、目录条目与省略提示行统一走此函数，保持 toolOutput 单色、宽度安全。
 */
function renderBoundedLine(prefix: string, text: string, width: number, theme: TuiTheme): string {
  const available = Math.max(1, safeRenderWidth(width) - displayWidth(prefix));
  const bounded = clampToDisplayWidth(expandTabs(normalizeContentText(text), displayWidth(prefix)), available);

  return blockText(theme, 'toolOutput', `${prefix}${bounded}`);
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
  READ_FILES_MAX_DISPLAY_LINES,
  READ_FILES_TOOL_NAME,
  renderReadFilesToolCallLines,
  renderReadFilesToolResultLines
};
