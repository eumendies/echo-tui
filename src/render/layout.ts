import * as ansi from '../terminal/ansi';
import {parseFileMentions} from '../input/file-mentions';

import type { ComposerState } from '../types/composer';
import type { ComposerLayout } from '../types/render';

const TEXT_PRESENTATION_WIDTH_1_CODEPOINTS = new Set([
  0x26a0, // ⚠
  0x2713, // ✓
  0x2715  // ✕
]);
const TAB_STOP_WIDTH = 8;

/**
 * 计算单个字符的终端显示宽度，兼容换行、组合字符、emoji 和常见东亚宽字符。
 *
 */
export function charWidth(char: string): number {
  // 这里实现一个原型级 display width：emoji/中文等宽字符按 2，普通字符按 1。
  if (char === '\n' || char === '\r') {
    return 0;
  }

  const codePoint = char.codePointAt(0) ?? 0;

  if (codePoint >= 0x300 && codePoint <= 0x36f) {
    // 组合音标本身不占列宽。
    return 0;
  }

  if (isZeroWidthEmojiComponent(codePoint)) {
    return 0;
  }

  if (TEXT_PRESENTATION_WIDTH_1_CODEPOINTS.has(codePoint)) {
    // 这些未带 emoji variation selector 的符号在常见终端里按文本符号显示为 1 列；按 2 列会让边框补齐错位。
    return 1;
  }

  if (isEmojiCluster(char)) {
    return 2;
  }

  if (isWideCodePoint(codePoint) || isEmojiCodePoint(codePoint)) {
    return 2;
  }

  return 1;
}

/**
 * 计算制表符从当前列移动到下一个固定制表位所需的宽度。
 *
 */
export function tabWidthAt(column: number): number {
  const normalizedColumn = Number.isFinite(column) ? Math.max(0, Math.floor(column)) : 0;
  return TAB_STOP_WIDTH - (normalizedColumn % TAB_STOP_WIDTH);
}

/**
 * 计算字符串在终端中的实际显示宽度，会先移除 ANSI 控制序列。
 *
 */
export function displayWidth(text: string): number {
  let width = 0;
  let column = 0;

  for (const char of splitGraphemes(stripAnsi(text))) {
    if (char === '\n' || char === '\r') {
      column = 0;
      continue;
    }

    const widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
    width += widthOfChar;
    column += widthOfChar;
  }

  return width;
}

/**
 * 返回安全渲染宽度，保守少用最后一列，避免触发终端自动换行。
 *
 */
export function safeRenderWidth(width: number): number {
  // 终端最后一列容易触发自动换行，所有整行渲染都保守少用一列。
  const value = Number.isFinite(width) && width > 0 ? width : 80;
  return Math.max(1, value - 1);
}

/**
 * 去掉字符串中的 ANSI 控制序列，避免颜色或光标控制干扰宽度计算。
 *
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

/**
 * 判断一个 code point 是否应当按宽字符处理。
 *
 */
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

/**
 * 判断 emoji 序列中的组合成分是否不应单独占终端列宽。
 *
 */
function isZeroWidthEmojiComponent(codePoint: number): boolean {
  return (
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  );
}

/**
 * 判断常见 emoji code point 是否通常按 2 列显示。
 *
 */
function isEmojiCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2b00 && codePoint <= 0x2bff) ||
    (codePoint >= 0x2300 && codePoint <= 0x23ff)
  );
}

/**
 * 按 grapheme cluster 切分文本，避免把复合 emoji 拆成多个显示单元。
 *
 */
export function splitGraphemes(text: string): string[] {
  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }

  return Array.from(text);
}

function isEmojiCluster(value: string): boolean {
  return splitCodePoints(value).some(isEmojiCodePoint);
}

function splitCodePoints(value: string): number[] {
  return Array.from(value).map((char) => char.codePointAt(0) ?? 0);
}

/**
 * 使用给定前缀对文本做自动换行，主要服务于 pending preview 一类前缀消息。
 *
 */
export function wrapText(text: string, width: number, prefix = ''): string[] {
  // pending preview 使用同一个 prefix 包装；换行后继续保留 role 前缀。
  const safeWidth = safeRenderWidth(width);
  const lines: string[] = [];

  for (const sourceLine of text.split('\n')) {
    let line = prefix;
    let column = displayWidth(prefix);

    for (const char of splitGraphemes(sourceLine)) {
      let widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
      if (column + widthOfChar > safeWidth && column > displayWidth(prefix)) {
        lines.push(line);
        line = prefix;
        column = displayWidth(prefix);
        widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
      }

      line += char === '\t' ? ' '.repeat(widthOfChar) : char;
      column += widthOfChar;
    }

    lines.push(line);
  }

  return lines.length > 0 ? lines : [prefix];
}

/**
 * 把 composer 的字符数组投影成可见行，并同时计算光标应回到的行列。
 *
 */
export function renderComposer(composer: ComposerState, width: number, prompt = '> ', options: {highlightFileMentions?: boolean; startColumn?: number} = {}): ComposerLayout {
  // 同时生成 composer 可见行和光标坐标，footer 重绘后需要用它恢复光标。
  const startColumn = Number.isFinite(options.startColumn) ? Math.max(0, Math.floor(options.startColumn as number)) : 0;
  const continuation = ' '.repeat(Math.max(1, displayWidth(prompt)));
  const safeWidth = safeRenderWidth(width);
  const lines: string[] = [prompt];
  const mentionRanges = options.highlightFileMentions ? parseFileMentions(composer.chars.join('')) : [];
  let row = 0;
  let column = startColumn + displayWidth(prompt);
  let cursorRow = 0;
  let cursorColumn = column - startColumn;

  /**
   * 在遍历到目标 cursor index 的瞬间记录当前的可见行列位置。
   *
   */
  function rememberCursor(index: number): void {
    // 在渲染到 cursor index 的瞬间记录当前位置。
    if (index === composer.cursor) {
      cursorRow = row;
      cursorColumn = column - startColumn;
    }
  }

  for (let index = 0; index <= composer.chars.length; index += 1) {
    rememberCursor(index);

    if (index === composer.chars.length) {
      break;
    }

    const char = composer.chars[index];

    if (char === '\n') {
      // 逻辑换行会开启新的 composer 行，并使用缩进保持视觉对齐。
      row += 1;
      lines[row] = continuation;
      column = startColumn + displayWidth(continuation);
      continue;
    }

    let widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
    const currentPrefixWidth = startColumn + (row === 0 ? displayWidth(prompt) : displayWidth(continuation));

    if (column + widthOfChar > startColumn + safeWidth && column > currentPrefixWidth) {
      // 自动换行只影响显示，不改变 composer 的字符数组。
      row += 1;
      lines[row] = continuation;
      column = startColumn + displayWidth(continuation);
      widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
    }

    const renderedChar = char === '\t' ? ' '.repeat(widthOfChar) : char;
    lines[row] += isMentionChar(index, mentionRanges) ? ansi.cyan(renderedChar) : renderedChar;
    column += widthOfChar;
  }

  return {
    lines,
    cursorRow,
    cursorColumn
  };
}

function isMentionChar(index: number, ranges: Array<{start: number; end: number}>): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}
