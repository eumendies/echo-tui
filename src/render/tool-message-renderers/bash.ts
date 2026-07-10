import {type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText
} from './shared';

import type {TranscriptRecord} from '../../types/transcript';

/**
 * 把 bash function call 投影成稳定的 `Bash('...')` 调用行；参数无效时返回 null 交给通用 renderer。
 */
function renderBashToolCallLines(
  record: TranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] | null {
  const command = extractCommandArgument(record.argumentsText);

  if (!command) {
    return null;
  }

  return renderPrefixedLines({
    text: `Bash(${quoteSingleLine(command)})`,
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
      colorizeFirstSymbol: resolveToolCallPrefixStyle(callStatus, theme)
  });
}

/**
 * 把 bash 执行结果投影成灰色 `⎿` 输出；完整执行摘要仍保留在 transcript text 中。
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

function resolveBashDisplayText(record: TranscriptRecord): string {
  if (typeof record.displayText === 'string') {
    return record.displayText || '(no output)';
  }

  const parsed = parseBashResultText(record.text);

  if (parsed.stdout.trim()) {
    return parsed.stdout;
  }

  if (parsed.stderr.trim()) {
    return parsed.stderr;
  }

  if (record.timedOut === true || parsed.timedOut) {
    return 'Command timed out.';
  }

  if (parsed.hasBashShape) {
    return '(no output)';
  }

  return record.text || '(no output)';
}

function parseBashResultText(text: string): {hasBashShape: boolean; stdout: string; stderr: string; timedOut: boolean} {
  const lines = text.split('\n');
  const stdoutIndex = lines.indexOf('stdout:');
  const stderrIndex = lines.indexOf('stderr:');
  const hasBashShape = stdoutIndex >= 0 || stderrIndex >= 0;
  const timedOut = lines.some((line) => line === 'timed_out: true' || line.startsWith('Command timed out'));

  if (!hasBashShape) {
    return {hasBashShape, stdout: '', stderr: '', timedOut};
  }

  const stdoutEnd = stderrIndex >= 0 ? stderrIndex : lines.length;
  const stderrEnd = findMetadataNoteStart(lines, stderrIndex >= 0 ? stderrIndex + 1 : lines.length);
  const stdout = stdoutIndex >= 0 ? trimOuterBlankLines(lines.slice(stdoutIndex + 1, stdoutEnd)).join('\n') : '';
  const stderr = stderrIndex >= 0 ? trimOuterBlankLines(lines.slice(stderrIndex + 1, stderrEnd)).join('\n') : '';

  return {hasBashShape, stdout, stderr, timedOut};
}

function findMetadataNoteStart(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === 'Output was truncated.' || line.startsWith('Command timed out after')) {
      return index > startIndex && lines[index - 1] === '' ? index - 1 : index;
    }
  }

  return lines.length;
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
    return typeof parsed.command === 'string' ? parsed.command : '';
  } catch {
    return '';
  }
}

function quoteSingleLine(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

export {
  renderBashToolCallLines,
  renderBashToolResultLines
};
