import {blockText} from '../colors';
import {safeRenderWidth} from '../layout';
import {TOOL_RESULT_MAX_DISPLAY_LINES, renderPrefixedLines, truncateDisplayText, wrapContentLine} from './shared';

import type {TuiTheme} from '../../config/theme-config';
import type {TranscriptRecord} from '../../types/transcript';

const BASH_SCRIPT_MAX_DISPLAY_LINES = 12;
const HEREDOC_PATTERN = /(<<-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/u;
const INLINE_SCRIPT_PATTERN = /(?:^|\s)(-c|-e)\s+(['"])/u;

type BashCommandDisplay = {
  headerLines: string[];
  scriptLines: string[] | null;
  trailerLines: string[];
};

type BashResultDisplay = {
  hasBashShape: boolean;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  truncated: boolean;
};

type BashRailRow = {
  style: 'command' | 'error' | 'muted' | 'title';
  text: string;
};

type BashRailStyle = 'tool' | 'toolError' | 'toolOutput';
type BashStatusStyle = 'toolError' | 'toolOutput' | 'toolSuccess';

/**
 * 渲染尚未获得结果的 bash 调用；命令使用 rail 保留原有多行结构。
 */
function renderBashToolCallLines(record: TranscriptRecord, width: number, callStatus: boolean | undefined, theme: TuiTheme): string[] | null {
  const command = extractCommandArgument(record.argumentsText);

  if (!command) {
    return null;
  }

  const title = callStatus === undefined ? 'Bash · running' : callStatus ? 'Bash · complete' : 'Bash · failed';
  const markerStyle = callStatus === undefined ? 'toolOutput' : callStatus ? 'toolSuccess' : 'toolError';
  return renderBashRailLines(command, title, null, width, theme, markerStyle);
}

/**
 * 将相邻 bash call/result 合并为同一段双 rail；参数不可靠时交给通用 renderer。
 */
function renderBashToolPairLines(call: TranscriptRecord, result: TranscriptRecord, width: number, theme: TuiTheme): string[] | null {
  const command = extractCommandArgument(call.argumentsText);

  if (!command) {
    return null;
  }

  return renderBashRailLines(command, createBashResultTitle(result), result, width, theme, resolveBashMarkerStyle(result));
}

/**
 * 单独出现的 bash result 仍使用紧凑输出投影，避免缺少命令时构造不完整 rail 块。
 */
function renderBashToolResultLines(record: TranscriptRecord, width: number, theme: TuiTheme): string[] {
  const displayText = resolveBashDisplayText(record);

  return renderPrefixedLines({
    text: truncateDisplayText(displayText.trimEnd(), TOOL_RESULT_MAX_DISPLAY_LINES),
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/**
 * 构造 bash rail 的命令段和结果段；所有内容先按纯文本换行，再附加 theme 样式。
 */
function renderBashRailLines(
  command: string,
  title: string,
  result: TranscriptRecord | null,
  width: number,
  theme: TuiTheme,
  markerStyle: BashStatusStyle
): string[] {
  const parsedCommand = parseBashCommand(command);
  const failed = markerStyle === 'toolError';
  const commandRows: BashRailRow[] = [{style: failed ? 'error' : 'title', text: title}];

  commandRows.push(...parsedCommand.headerLines.map((text) => ({style: 'command' as const, text})));
  if (parsedCommand.scriptLines) {
    commandRows.push(...limitLogicalLines(parsedCommand.scriptLines, BASH_SCRIPT_MAX_DISPLAY_LINES).map((text) => ({style: 'muted' as const, text})));
  }
  commandRows.push(...parsedCommand.trailerLines.map((text) => ({style: 'command' as const, text})));

  const lines = renderRailRows(commandRows, width, theme, failed ? 'toolError' : 'tool', true, markerStyle);

  if (!result) {
    return lines;
  }

  lines.push(...renderRailRows([{style: 'muted', text: ''}], width, theme, 'toolOutput', false, markerStyle));
  lines.push(...renderRailRows(createBashResultRows(result), width, theme, 'toolOutput', false, markerStyle));
  return lines;
}

function renderRailRows(
  rows: BashRailRow[],
  width: number,
  theme: TuiTheme,
  railStyle: BashRailStyle,
  includeMarker: boolean,
  markerStyle: BashStatusStyle
): string[] {
  const safeWidth = safeRenderWidth(width);
  const prefixWidth = safeWidth >= 4 ? 4 : safeWidth >= 2 ? 2 : 0;
  const rendered: string[] = [];
  let first = includeMarker;

  for (const row of rows) {
    for (const segment of wrapContentLine(row.text, safeWidth, prefixWidth)) {
      rendered.push(`${createRailPrefix(first, safeWidth, theme, railStyle, markerStyle)}${colorizeRailContent(row.style, segment, theme)}`);
      first = false;
    }
  }

  return rendered.length > 0 ? rendered : [createRailPrefix(includeMarker, safeWidth, theme, railStyle, markerStyle)];
}

function createRailPrefix(
  first: boolean,
  safeWidth: number,
  theme: TuiTheme,
  railStyle: BashRailStyle,
  markerStyle: BashStatusStyle
): string {
  if (safeWidth >= 4) {
    const marker = first ? `${blockText(theme, markerStyle, '◆')} ` : '  ';
    return `${marker}${blockText(theme, railStyle, '▌')} `;
  }

  if (safeWidth >= 2) {
    return first ? `${blockText(theme, markerStyle, '◆')} ` : '  ';
  }

  return '';
}

function colorizeRailContent(style: BashRailRow['style'], text: string, theme: TuiTheme): string {
  if (style === 'error') {
    return blockText(theme, 'toolError', text);
  }
  if (style === 'muted') {
    return blockText(theme, 'toolOutput', text);
  }
  if (style === 'title') {
    return blockText(theme, 'tool', text);
  }
  return blockText(theme, 'text', text);
}

/**
 * 只在 heredoc 或 inline script 边界可确定时拆分；其余命令完整保留，避免审计信息丢失。
 */
function parseBashCommand(command: string): BashCommandDisplay {
  const lines = command.replace(/\r\n?/gu, '\n').replace(/\n$/u, '').split('\n');
  const heredoc = parseHeredocCommand(lines);

  if (heredoc) {
    return heredoc;
  }

  const inline = parseInlineScriptCommand(command);
  if (inline) {
    return inline;
  }

  return {headerLines: lines, scriptLines: null, trailerLines: []};
}

function parseHeredocCommand(lines: string[]): BashCommandDisplay | null {
  const markerIndex = lines.findIndex((line) => HEREDOC_PATTERN.test(line));
  const match = markerIndex >= 0 ? lines[markerIndex].match(HEREDOC_PATTERN) : null;
  const operator = match?.[1];
  const delimiter = match?.[3];

  if (!operator || !delimiter) {
    return null;
  }

  const closingIndex = lines.findIndex((line, index) => index > markerIndex && isHeredocClosingLine(line, delimiter, operator === '<<-'));
  if (closingIndex < 0) {
    return null;
  }

  return {
    headerLines: lines.slice(0, markerIndex + 1),
    scriptLines: lines.slice(markerIndex + 1, closingIndex),
    trailerLines: lines.slice(closingIndex)
  };
}

/**
 * 按 shell heredoc 规则判断闭合行；`<<-` 只允许剥离前导 tab，不能剥离空格。
 */
function isHeredocClosingLine(line: string, delimiter: string, stripLeadingTabs: boolean): boolean {
  return (stripLeadingTabs ? line.replace(/^\t+/u, '') : line) === delimiter;
}

function parseInlineScriptCommand(command: string): BashCommandDisplay | null {
  if (command.includes('`') || command.includes('$(')) {
    return null;
  }

  const match = command.match(INLINE_SCRIPT_PATTERN);
  if (!match || match.index === undefined) {
    return null;
  }

  const quote = match[2];
  const quoteIndex = match.index + match[0].lastIndexOf(quote);
  const bodyStart = quoteIndex + 1;
  const bodyEnd = findClosingQuote(command, quote, bodyStart);
  if (bodyEnd < 0) {
    return null;
  }

  const body = command.slice(bodyStart, bodyEnd);
  if (!body.includes('\n') && body.length <= 60) {
    return null;
  }

  return {
    headerLines: [`${command.slice(0, bodyStart)}…${command.slice(bodyEnd)}`],
    scriptLines: body.split('\n'),
    trailerLines: []
  };
}

function findClosingQuote(text: string, quote: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] !== quote) {
      continue;
    }

    let slashCount = 0;
    for (let cursor = index - 1; cursor >= start && text[cursor] === '\\'; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) {
      return index;
    }
  }

  return -1;
}

function createBashResultRows(record: TranscriptRecord): BashRailRow[] {
  const parsed = parseBashResult(record);
  const rows = limitRailRows(createBashOutputRows(parsed), TOOL_RESULT_MAX_DISPLAY_LINES);

  if (rows.length === 0) {
    rows.push({style: 'muted', text: parsed.timedOut ? 'Command timed out.' : '(no output)'});
  }
  if (parsed.truncated) {
    rows.push({style: 'muted', text: 'Output was truncated.'});
  }

  return rows;
}

/**
 * 将 stdout 与 stderr 转为同一个有序 rail 行序列，便于应用统一输出预算。
 */
function createBashOutputRows(parsed: BashResultDisplay): BashRailRow[] {
  const rows: BashRailRow[] = [];

  if (parsed.stdout.trim()) {
    rows.push(...parsed.stdout.split('\n').map((text) => ({style: 'muted' as const, text})));
  }
  if (parsed.stderr.trim()) {
    rows.push(...parsed.stderr.split('\n').map((text) => ({style: 'error' as const, text})));
  }

  return rows;
}

/**
 * 对已合并的结果行应用单一逻辑行预算，并保留可计数省略提示。
 */
function limitRailRows(rows: BashRailRow[], maxLines: number): BashRailRow[] {
  const normalizedMaxLines = Math.max(1, Math.floor(maxLines));
  if (rows.length <= normalizedMaxLines) {
    return rows;
  }

  const visibleRows = Math.max(0, normalizedMaxLines - 1);
  return [
    ...rows.slice(0, visibleRows),
    {style: 'muted', text: `… ${rows.length - visibleRows} more lines`}
  ];
}

function limitLogicalLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }

  return [...lines.slice(0, Math.max(1, maxLines - 1)), `… ${lines.length - maxLines + 1} more lines`];
}

function createBashResultTitle(record: TranscriptRecord): string {
  const exitCode = typeof record.exitCode === 'number' ? record.exitCode : undefined;
  const durationMs = typeof record.durationMs === 'number' && Number.isFinite(record.durationMs) && record.durationMs >= 0 ? Math.floor(record.durationMs) : undefined;
  const timedOut = record.timedOut === true;
  const truncated = record.truncated === true;
  const status = timedOut ? 'timed out' : record.ok === false ? 'failed' : 'complete';
  const parts = ['Bash', status];

  if (exitCode !== undefined) {
    parts.push(`exit ${exitCode}`);
  }
  if (durationMs !== undefined) {
    parts.push(formatDuration(durationMs));
  }
  if (truncated) {
    parts.push('truncated');
  }
  return parts.join(' · ');
}

function resolveBashMarkerStyle(record: TranscriptRecord): BashStatusStyle {
  if (record.ok === false) {
    return 'toolError';
  }

  return record.ok === true ? 'toolSuccess' : 'toolOutput';
}

function formatDuration(durationMs: number): string {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(durationMs % 1000 === 0 ? 0 : 1)}s` : `${durationMs}ms`;
}

function resolveBashDisplayText(record: TranscriptRecord): string {
  const parsed = parseBashResult(record);
  if (parsed.stdout.trim()) {
    return parsed.stdout;
  }
  if (parsed.stderr.trim()) {
    return parsed.stderr;
  }
  if (parsed.timedOut) {
    return 'Command timed out.';
  }
  return parsed.hasBashShape ? '(no output)' : record.text || '(no output)';
}

function parseBashResult(record: TranscriptRecord): BashResultDisplay {
  if (typeof record.displayText === 'string') {
    return {hasBashShape: true, stdout: record.displayText, stderr: '', timedOut: record.timedOut === true, truncated: record.truncated === true};
  }

  const lines = record.text.split('\n');
  const stdoutIndex = lines.indexOf('stdout:');
  const stderrIndex = lines.indexOf('stderr:');
  const hasBashShape = stdoutIndex >= 0 || stderrIndex >= 0;
  const timedOut = record.timedOut === true;
  const truncated = record.truncated === true;

  if (!hasBashShape) {
    return {hasBashShape, stdout: record.text, stderr: '', timedOut, truncated};
  }

  const stdoutEnd = stderrIndex >= 0 ? stderrIndex : lines.length;
  return {
    hasBashShape,
    stdout: stdoutIndex >= 0 ? trimStructuredResultNotes(lines.slice(stdoutIndex + 1, stdoutEnd), {timedOut, truncated}).join('\n') : '',
    stderr: stderrIndex >= 0 ? trimStructuredResultNotes(lines.slice(stderrIndex + 1), {timedOut, truncated}).join('\n') : '',
    timedOut,
    truncated
  };
}

/**
 * 只在结构化字段确认状态时移除工具追加的尾部提示，避免把字面量输出当作状态来源。
 */
function trimStructuredResultNotes(lines: string[], flags: {timedOut: boolean; truncated: boolean}): string[] {
  let outputLines = lines;

  if (flags.truncated) {
    outputLines = trimTrailingStructuredNote(outputLines, 'Output was truncated.');
  }
  if (flags.timedOut) {
    outputLines = trimTrailingStructuredNote(outputLines, 'Command timed out.');
  }

  return trimOuterBlankLines(outputLines);
}

/**
 * 从通道末尾裁掉一个确定的结构化提示，同时保留普通输出中的同名字面量。
 */
function trimTrailingStructuredNote(lines: string[], note: string): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') {
    end -= 1;
  }
  if (end === 0 || lines[end - 1] !== note) {
    return lines;
  }

  end -= 1;
  while (end > 0 && lines[end - 1] === '') {
    end -= 1;
  }
  return lines.slice(0, end);
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') {
    start += 1;
  }
  while (end > start && lines[end - 1] === '') {
    end -= 1;
  }
  return lines.slice(start, end);
}

function extractCommandArgument(argumentsText: unknown): string {
  if (typeof argumentsText !== 'string') {
    return '';
  }

  try {
    const parsed = JSON.parse(argumentsText) as {command?: unknown};
    return typeof parsed.command === 'string' && parsed.command.trim() ? parsed.command : '';
  } catch {
    return '';
  }
}

export {
  renderBashToolCallLines,
  renderBashToolPairLines,
  renderBashToolResultLines
};
