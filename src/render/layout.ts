import * as ansi from '../terminal/ansi';
import {parseFileMentions} from '../input/file-mentions';
import {splitGraphemes} from '../input/graphemes';
import {
  EMOJI_BASE_RANGES,
  EMOJI_PRESENTATION_RANGES,
  WIDE_RANGES,
  ZERO_WIDTH_RANGES
} from './width-data';

import type { ComposerState } from '../types/composer';
import type { ComposerLayout } from '../types/render';

const TAB_STOP_WIDTH = 8;

// 变体选择符与组合记号：参与 grapheme 级宽度决策的特殊码点。
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const ZWJ = 0x200d;
const KEYCAP = 0x20e3;

/**
 * 计算单个 grapheme cluster 的终端显示宽度。
 *
 * 决策顺序（依据 design.md D2）：
 * 1. 含 VS15：强制文本呈现，按码点求和；
 * 2. 含 VS16 且含 Emoji base：按 2 列（emoji 呈现）；
 * 3. 含 ZWJ 且含 Emoji base：按 2 列（单字形序列）；
 * 4. 含 keycap 组合圈：按 2 列（keycap 序列）；
 * 5. 含 Emoji_Presentation 码点：按 2 列（旗帜的双 regional indicator 也在该区间内）；
 * 6. 其余按码点求和：零宽 0 / 宽字符 2 / 其余 1（East Asian Ambiguous 一律按 1 列，
 *    避免框线等布局字符在宽度计算与终端实际渲染之间错位）。
 */
export function charWidth(char: string): number {
  if (char === '\n' || char === '\r') {
    return 0;
  }

  // ASCII 单码点没有零宽或宽字符变体，直接按 1 列返回，跳过区间查找。
  if (char.length === 1 && char.charCodeAt(0) < 0x80) {
    return 1;
  }

  // 单次遍历收集哨兵标志与 emoji 属性，避免对多码点 cluster 反复扫描数组。
  const codePoints = Array.from(char, (value) => value.codePointAt(0) ?? 0);
  let hasVS15 = false;
  let hasVS16 = false;
  let hasZWJ = false;
  let hasKeycap = false;
  let hasEmojiBase = false;
  let hasEmojiPresentation = false;

  for (const codePoint of codePoints) {
    hasVS15 ||= codePoint === VS15;
    hasVS16 ||= codePoint === VS16;
    hasZWJ ||= codePoint === ZWJ;
    hasKeycap ||= codePoint === KEYCAP;
    hasEmojiBase ||= isInRanges(codePoint, EMOJI_BASE_RANGES);
    hasEmojiPresentation ||= isInRanges(codePoint, EMOJI_PRESENTATION_RANGES);
  }

  if (hasVS15) {
    // VS15 强制文本呈现：忽略 emoji 规则，仅按码点求和。
    return sumCodePointWidths(codePoints);
  }

  if (hasVS16 && hasEmojiBase) {
    return 2;
  }

  if (hasZWJ && hasEmojiBase) {
    // ZWJ 序列整体渲染为单个字形，常见终端按 2 列显示。
    return 2;
  }

  if (hasKeycap) {
    // keycap 序列（如 1️⃣）整体渲染为单个 2 列字形。
    return 2;
  }

  if (hasEmojiPresentation) {
    return 2;
  }

  return sumCodePointWidths(codePoints);
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

// grapheme 切分是 input 编辑层与 render 宽度层共用口径，从 input/graphemes 再导出保持既有调用点不变。
export {splitGraphemes};

/**
 * 判断码点是否落在排序区间表内，二分查找。
 *
 */
function isInRanges(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const [start, end] = ranges[mid];

    if (codePoint < start) {
      high = mid - 1;
    } else if (codePoint > end) {
      low = mid + 1;
    } else {
      return true;
    }
  }

  return false;
}

/**
 * 按码点求和 cluster 宽度：零宽 0 / 宽字符 2 / 其余 1（Ambiguous 一律按 1）。
 *
 */
function sumCodePointWidths(codePoints: number[]): number {
  let width = 0;

  for (const codePoint of codePoints) {
    if (isInRanges(codePoint, ZERO_WIDTH_RANGES)) {
      continue;
    }

    if (isInRanges(codePoint, WIDE_RANGES)) {
      width += 2;
      continue;
    }

    width += 1;
  }

  return width;
}

/**
 * 使用给定前缀对文本做自动换行，主要服务于 pending preview 一类前缀消息。
 *
 */
export function wrapText(text: string, width: number, prefix = ''): string[] {
  // pending preview 使用同一个 prefix 包装；换行后继续保留 role 前缀。
  const safeWidth = safeRenderWidth(width);
  const lines: string[] = [];
  const prefixWidth = displayWidth(prefix);

  for (const sourceLine of text.split('\n')) {
    let line = prefix;
    let column = prefixWidth;

    for (const char of splitGraphemes(sourceLine)) {
      let widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
      if (column + widthOfChar > safeWidth && column > prefixWidth) {
        lines.push(line);
        line = prefix;
        column = prefixWidth;
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
