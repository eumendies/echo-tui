import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import * as ansi from '../../terminal/ansi';
import {markdownStyle} from '../colors';
import {findInlineMath} from './inline-math';

export type TextStyle = (text: string) => string;

export type StyledSpan = {
  text: string;
  style?: TextStyle;
};

type InlineMatch = {
  start: number;
  end: number;
  text: string;
  style: TextStyle;
};

/**
 * 解析普通文本中的 inline Markdown span；不支持时保留原文。
 *
 */
export function parseInlineSpans(text: string, theme: TuiTheme = DEFAULT_TUI_THEME): StyledSpan[] {
  const spans: StyledSpan[] = [];
  let index = 0;

  function pushPlain(end: number): void {
    if (end > index) {
      spans.push({ text: text.slice(index, end) });
    }
  }

  while (index < text.length) {
      const match = findNextInline(text, index, theme);

    if (!match) {
      spans.push({ text: text.slice(index) });
      break;
    }

    pushPlain(match.start);
    spans.push({ text: match.text, style: match.style });
    index = match.end;
  }

  return spans.length > 0 ? spans : [{ text }];
}

/**
 * 合并同样式的相邻 span，避免重复打开/关闭 ANSI 样式。
 *
 */
export function mergeAdjacentSpans(spans: StyledSpan[]): StyledSpan[] {
  const merged: StyledSpan[] = [];

  for (const span of spans) {
    const previous = merged[merged.length - 1];

    if (previous && previous.style === span.style) {
      previous.text += span.text;
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

/**
 * 查找下一个保守可识别 inline Markdown 片段。
 *
 */
function findNextInline(text: string, from: number, theme: TuiTheme): InlineMatch | null {
  const code = findInlineCode(text, from, theme);
  const link = findInlineLink(text, from, theme);
  const mathMatch = findInlineMath(text, from);
  // 转换结果携带 math token 样式；扫描器保持无 theme 依赖的纯函数边界。
  const math = mathMatch ? {...mathMatch, style: (value: string) => markdownStyle(theme, 'math', value)} : null;
  const candidates = [
    code,
    link,
    findInlineStrikethrough(text, from),
    findInlineBold(text, from, theme),
    findInlineItalic(text, from, theme),
    math
  ].filter((candidate): candidate is InlineMatch => Boolean(candidate));

  candidates.sort((left, right) => left.start - right.start || left.end - right.end);

  const first = candidates[0];
  if (!first) {
    return null;
  }

  // 数学候选与 inline code / link span 重叠时放弃转换：code/link 是既有保护结构，
  // 数学若把它们拦腰截断（如链接只剩半截），剩余文本会失去结构；此时退回下一个候选。
  const mathEnd = math ? math.end : -1;
  if (first === math && [code, link].some((span) => span !== null && span.start < mathEnd)) {
    return candidates[1] ?? null;
  }

  return first;
}

function findInlineCode(text: string, from: number, theme: TuiTheme): InlineMatch | null {
  const start = text.indexOf('`', from);
  if (start < 0) {
    return null;
  }

  const end = text.indexOf('`', start + 1);
  if (end < 0 || end === start + 1) {
    return null;
  }

  return { start, end: end + 1, text: text.slice(start + 1, end), style: (value) => markdownStyle(theme, 'inlineCode', value) };
}

function findInlineStrikethrough(text: string, from: number): InlineMatch | null {
  const start = text.indexOf('~~', from);
  if (start < 0) {
    return null;
  }

  const end = text.indexOf('~~', start + 2);
  if (end < 0 || end === start + 2) {
    return null;
  }

  return { start, end: end + 2, text: text.slice(start + 2, end), style: ansi.strikethrough };
}

function findInlineBold(text: string, from: number, theme: TuiTheme): InlineMatch | null {
  const start = text.indexOf('**', from);
  if (start < 0) {
    return null;
  }

  const end = text.indexOf('**', start + 2);
  if (end < 0 || end === start + 2) {
    return null;
  }

  return { start, end: end + 2, text: text.slice(start + 2, end), style: (value) => markdownStyle(theme, 'bold', value) };
}

function findInlineItalic(text: string, from: number, theme: TuiTheme): InlineMatch | null {
  const start = findSingleAsterisk(text, from);
  if (start < 0) {
    return null;
  }

  const end = findSingleAsterisk(text, start + 1);
  if (end < 0 || end === start + 1) {
    return null;
  }

  return { start, end: end + 1, text: text.slice(start + 1, end), style: (value) => markdownStyle(theme, 'italic', value) };
}

function findInlineLink(text: string, from: number, theme: TuiTheme): InlineMatch | null {
  const pattern = /\[([^\]\n]+)]\(([^)\n]+)\)/g;
  pattern.lastIndex = from;
  const match = pattern.exec(text);

  if (!match) {
    return null;
  }

  return {
    start: match.index,
    end: match.index + match[0].length,
    text: `${match[1]} (${match[2]})`,
      style: (value) => markdownStyle(theme, 'link', value)
  };
}

function findSingleAsterisk(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== '*') {
      continue;
    }

    if (text[index - 1] === '*' || text[index + 1] === '*') {
      continue;
    }

    return index;
  }

  return -1;
}
