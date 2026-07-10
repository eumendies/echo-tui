import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {charWidth, displayWidth, safeRenderWidth, splitGraphemes} from '../layout';

const TOOL_RESULT_MAX_DISPLAY_LINES = 12;
const TOOL_RESULT_TRUNCATION_TEXT = '[tool output truncated for display]';

type ToolRecordRenderOptions = {
  callStatus?: boolean;
};

/**
 * 根据 tool result 执行状态选择 tool_call 符号样式，历史记录缺少状态时保持中性显示。
 */
function resolveToolCallPrefixStyle(status: unknown, theme: TuiTheme = DEFAULT_TUI_THEME): ((symbol: string) => string) | undefined {
  if (status === true) {
    return (symbol) => blockText(theme, 'toolSuccess', symbol);
  }

  if (status === false) {
    return (symbol) => blockText(theme, 'toolError', symbol);
  }

  return undefined;
}

/**
 * 只截断可见投影，不改写 transcript record，也不影响回传给模型的 tool output。
 */
function truncateDisplayText(text: string, maxLines: number): string {
  const lines = text.split('\n');
  const normalizedMaxLines = Math.max(1, Math.floor(maxLines));

  if (lines.length <= normalizedMaxLines) {
    return text;
  }

  if (normalizedMaxLines === 1) {
    return TOOL_RESULT_TRUNCATION_TEXT;
  }

  return [...lines.slice(0, normalizedMaxLines - 1), TOOL_RESULT_TRUNCATION_TEXT].join('\n');
}

/**
 * 渲染带首行前缀和 continuation 缩进的工具消息行，并在样式前完成宽度计算。
 */
function renderPrefixedLines(options: {
  text: string;
  width: number;
  firstPrefix: string;
  continuationPrefix: string;
  colorizeFirstSymbol?: (symbol: string) => string;
  colorizeLine?: (line: string) => string;
}): string[] {
  const safeWidth = safeRenderWidth(options.width);
  const lines: string[] = [];
  let first = true;

  for (const sourceLine of options.text.split('\n')) {
    const prefix = first ? options.firstPrefix : options.continuationPrefix;
    const wrapped = wrapContentLine(sourceLine, safeWidth, displayWidth(prefix));

    for (const contentLine of wrapped) {
      const linePrefix = first ? options.firstPrefix : options.continuationPrefix;
      const renderedPrefix = first ? renderFirstPrefix(linePrefix, options.colorizeFirstSymbol) : linePrefix;
      const rawLine = `${renderedPrefix}${contentLine}`;
      lines.push(options.colorizeLine ? options.colorizeLine(rawLine) : rawLine);
      first = false;
    }
  }

  if (lines.length > 0) {
    return lines;
  }

  const rawLine = renderFirstPrefix(options.firstPrefix, options.colorizeFirstSymbol);
  return [options.colorizeLine ? options.colorizeLine(rawLine) : rawLine];
}

function renderFirstPrefix(prefix: string, colorizeFirstSymbol?: (symbol: string) => string): string {
  if (!colorizeFirstSymbol || prefix.length === 0) {
    return prefix;
  }

  const [firstSymbol, ...rest] = splitGraphemes(prefix);
  return `${colorizeFirstSymbol(firstSymbol)}${rest.join('')}`;
}

/**
 * 按 grapheme 和显示宽度换行，避免 ANSI 样式或宽字符破坏工具输出对齐。
 */
function wrapContentLine(text: string, width: number, prefixWidth: number): string[] {
  const contentWidth = Math.max(1, width - prefixWidth);
  const lines = [''];
  let column = 0;

  for (const char of splitGraphemes(text)) {
    const widthOfChar = charWidth(char);

    if (column + widthOfChar > contentWidth && column > 0) {
      lines.push('');
      column = 0;
    }

    lines[lines.length - 1] += char;
    column += widthOfChar;
  }

  return lines;
}

export {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText,
  wrapContentLine
};

export type {
  ToolRecordRenderOptions
};
