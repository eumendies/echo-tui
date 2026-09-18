/**
 * 符号消息与行布局 primitives：前缀缩进、按宽度换行、补宽与显示宽度截断。
 */
import { charWidth, displayWidth, isPlainAsciiLine, safeRenderWidth, splitGraphemes, tabWidthAt } from '../layout';

export type TextStyle = (text: string) => string;

export type SymbolMessageOptions = {
  text: string;
  width: number;
  prefix: string;
  colorizePrefix?: TextStyle;
  colorizeLine?: TextStyle;
  repeatPrefixEveryLine?: boolean;
};

/**
 * 按显示宽度截断文本，并在需要时追加省略号。
 *
 */
export function clampToDisplayWidth(text: string, width: number): string {
  const normalizedWidth = Math.max(0, width);

  if (displayWidth(text) <= normalizedWidth) {
    return text;
  }

  if (normalizedWidth <= 3) {
    return '.'.repeat(normalizedWidth);
  }

  let result = '';
  let currentWidth = 0;

  for (const char of splitGraphemes(text)) {
    const widthOfChar = charWidth(char);

    if (currentWidth + widthOfChar > normalizedWidth - 3) {
      break;
    }

    result += char;
    currentWidth += widthOfChar;
  }

  return `${result}...`;
}

/**
 * 通用符号消息 renderer：负责首行前缀、多行缩进和按当前宽度换行。
 *
 */
export function renderSymbolMessage({ text, width, prefix, colorizePrefix, colorizeLine, repeatPrefixEveryLine = false }: SymbolMessageOptions): string[] {
  // 布局计算只使用未上色 prefix，避免 ANSI escape sequence 干扰显示宽度。
  const safeWidth = safeRenderWidth(width);
  const indent = ' '.repeat(displayWidth(prefix)); // 每行文本前面留出和 prefix 相同的宽度
  const renderedPrefix = colorizePrefix ? colorizePrefix(prefix) : prefix;
  const lines: string[] = [];
  let isFirstVisualLine = true;

  for (const sourceLine of text.split('\n')) {
    const wrapped = wrapContentLine(sourceLine, safeWidth, displayWidth(prefix));

    for (const contentLine of wrapped) {
      let rawLine: string;

      if (isFirstVisualLine || repeatPrefixEveryLine) {
        rawLine = `${prefix}${contentLine}`;
        isFirstVisualLine = false;
      } else {
        rawLine = `${indent}${contentLine}`;
      }

      lines.push(renderMessageLine(rawLine, safeWidth, renderedPrefix, prefix, colorizeLine));
    }
  }

  return lines.length > 0 ? lines : [renderMessageLine(prefix, safeWidth, renderedPrefix, prefix, colorizeLine)];
}

/**
 * 对单行消息应用前缀着色或整行背景着色。
 *
 */
function renderMessageLine(rawLine: string, width: number, renderedPrefix: string, rawPrefix: string, colorizeLine?: TextStyle): string {
  if (colorizeLine) {
    // 先补齐整行再上色，确保背景覆盖整条消息行。
    return colorizeLine(padToDisplayWidth(rawLine, width));
  }

  if (rawLine.startsWith(rawPrefix)) {
    return `${renderedPrefix}${rawLine.slice(rawPrefix.length)}`;
  }

  return rawLine;
}

/**
 * 把文本补齐到目标显示宽度，避免背景色在行尾提前结束。
 *
 */
export function padToDisplayWidth(text: string, width: number): string {
  const currentWidth = displayWidth(text);

  if (currentWidth >= width) {
    return text;
  }

  return `${text}${' '.repeat(width - currentWidth)}`;
}

/**
 * 在扣除前缀宽度后对单个逻辑行做自动换行。
 *
 */
function wrapContentLine(text: string, width: number, prefixWidth: number): string[] {
  // 可打印 ASCII 行每字符一列且无制表符，按预算切片与逐 grapheme 换行等价；
  // 预算非正时退化为每行一个字符，与逐 grapheme 分支的 column > prefixWidth 判定一致。
  if (isPlainAsciiLine(text)) {
    const budget = Math.max(1, width - prefixWidth);
    const asciiLines: string[] = [];

    for (let start = 0; start < text.length; start += budget) {
      asciiLines.push(text.slice(start, start + budget));
    }

    return asciiLines.length > 0 ? asciiLines : [''];
  }

  const lines = [''];
  let column = prefixWidth;

  for (const char of splitGraphemes(text)) {
    let widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);

    if (column + widthOfChar > width && column > prefixWidth) {
      lines.push('');
      column = prefixWidth;
      widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
    }

    lines[lines.length - 1] += char === '\t' ? ' '.repeat(widthOfChar) : char;
    column += widthOfChar;
  }

  return lines;
}
