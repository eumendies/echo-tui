import {DEFAULT_TUI_THEME, type SyntaxTheme, type SyntaxTokenKind, type ThemeTextStyle} from '../../config/theme-config';
import {styleText} from '../colors';
import type { StyledSpan, TextStyle } from './markdown-inline';

// scanner 只保留会跨行影响 token 归类的状态；普通 token 不需要进入状态机。
type ScannerState =
  | { kind: 'normal' }
  | { kind: 'string'; delimiter: string }
  | { kind: 'blockComment' };

type SyntaxToken = {
  kind: SyntaxTokenKind;
  text: string;
};

const KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'def',
  'default',
  'delete',
  'do',
  'elif',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'return',
  'then',
  'throw',
  'true',
  'try',
  'type',
  'var',
  'while',
  'yield'
]);
const OPERATOR_CHARS = '=+-*/%<>!&|^~?:.';
const PUNCTUATION_CHARS = '(){}[];,:';

/**
 * 把 code block 文本转换成按行排列的 semantic styled spans。
 */
function highlightCodeBlock(lines: string[], theme: SyntaxTheme = DEFAULT_TUI_THEME.syntax): StyledSpan[][] {
  const styleCache = createStyleCache(theme);
  let state: ScannerState = { kind: 'normal' };

  return lines.map((line) => {
    // 逐行扫描但复用上一行返回的状态，以支持未闭合字符串和块注释延续。
    const result = scanLine(line, state);
    state = result.state;
    return tokensToSpans(result.tokens, styleCache);
  });
}

function scanLine(line: string, initialState: ScannerState): { tokens: SyntaxToken[]; state: ScannerState } {
  const tokens: SyntaxToken[] = [];
  let state = initialState;
  let index = 0;

  function push(kind: SyntaxTokenKind, text: string): void {
    if (text.length > 0) {
      tokens.push({ kind, text });
    }
  }

  while (index < line.length) {
    // 先消费跨行状态，否则块注释/字符串内部的关键字和数字会被误判为代码 token。
    if (state.kind === 'blockComment') {
      const endIndex = line.indexOf('*/', index);

      if (endIndex < 0) {
        push('comment', line.slice(index));
        index = line.length;
        continue;
      }

      push('comment', line.slice(index, endIndex + 2));
      index = endIndex + 2;
      state = { kind: 'normal' };
      continue;
    }

    if (state.kind === 'string') {
      const endIndex = findStringEnd(line, index, state.delimiter);

      if (endIndex < 0) {
        push('string', line.slice(index));
        index = line.length;
        continue;
      }

      push('string', line.slice(index, endIndex + 1));
      index = endIndex + 1;
      state = { kind: 'normal' };
      continue;
    }

    // normal 状态下按“最长且最有约束的 token 优先”识别：注释/字符串先于操作符和标点。
    if (line.startsWith('/*', index)) {
      const endIndex = line.indexOf('*/', index + 2);

      if (endIndex < 0) {
        push('comment', line.slice(index));
        state = { kind: 'blockComment' };
        index = line.length;
        continue;
      }

      push('comment', line.slice(index, endIndex + 2));
      index = endIndex + 2;
      continue;
    }

    if (line.startsWith('//', index) || line.startsWith('--', index)) {
      push('comment', line.slice(index));
      index = line.length;
      continue;
    }

    if (line[index] === '#' && isHashCommentStart(line, index)) {
      push('comment', line.slice(index));
      index = line.length;
      continue;
    }

    if (isStringDelimiter(line[index])) {
      const delimiter = line[index];
      const endIndex = findStringEnd(line, index + 1, delimiter);

      if (endIndex < 0) {
        push('string', line.slice(index));
        state = { kind: 'string', delimiter };
        index = line.length;
        continue;
      }

      push('string', line.slice(index, endIndex + 1));
      index = endIndex + 1;
      continue;
    }

    const numberMatch = line.slice(index).match(/^\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/);
    if (numberMatch) {
      push('number', numberMatch[0]);
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = line.slice(index).match(/^[A-Za-z_$][\w$]*/);
    if (identifierMatch) {
      const identifier = identifierMatch[0];
      const nextIndex = index + identifier.length;
      // 非语言专用实现：identifier 后紧跟调用括号时按函数名着色，其余普通 identifier 按变量着色。
      const kind = KEYWORDS.has(identifier) ? 'keyword' : isFunctionIdentifier(line, nextIndex) ? 'function' : 'variable';
      push(kind, identifier);
      index = nextIndex;
      continue;
    }

    const char = line[index];
    if (OPERATOR_CHARS.includes(char)) {
      push('operator', char);
      index += 1;
      continue;
    }

    if (PUNCTUATION_CHARS.includes(char)) {
      push('punctuation', char);
      index += 1;
      continue;
    }

    push('plain', char);
    index += 1;
  }

  return { tokens, state };
}

function tokensToSpans(tokens: SyntaxToken[], styleCache: Record<SyntaxTokenKind, TextStyle>): StyledSpan[] {
  // 空代码行也返回一个空 span，让上游保留 code block 的空行布局。
  return tokens.length > 0
    ? tokens.map((token) => ({ text: token.text, style: styleCache[token.kind] }))
    : [{ text: '', style: styleCache.plain }];
}

function createStyleCache(theme: SyntaxTheme): Record<SyntaxTokenKind, TextStyle> {
  // 每个 token kind 只构造一次 style closure，避免长代码块逐 token 重建样式函数。
  return {
    plain: createTokenStyle(theme.plain),
    keyword: createTokenStyle(theme.keyword),
    string: createTokenStyle(theme.string),
    number: createTokenStyle(theme.number),
    comment: createTokenStyle(theme.comment),
    function: createTokenStyle(theme.function),
    variable: createTokenStyle(theme.variable),
    operator: createTokenStyle(theme.operator),
    punctuation: createTokenStyle(theme.punctuation)
  };
}

function createTokenStyle(tokenStyle: ThemeTextStyle): TextStyle {
  return (text: string) => styleText(tokenStyle, text);
}

function findStringEnd(line: string, from: number, delimiter: string): number {
  let index = from;

  while (index < line.length) {
    if (line[index] === '\\') {
      // 跳过转义字符后的一个字符，避免把 \" / \' / \` 当作字符串结束。
      index += 2;
      continue;
    }

    if (line[index] === delimiter) {
      return index;
    }

    index += 1;
  }

  return -1;
}

function isFunctionIdentifier(line: string, index: number): boolean {
  let cursor = index;

  while (cursor < line.length && /\s/.test(line[cursor])) {
    cursor += 1;
  }

  return line[cursor] === '(';
}

function isHashCommentStart(line: string, index: number): boolean {
  return index === 0 || /\s/.test(line[index - 1]);
}

function isStringDelimiter(char: string): boolean {
  return char === '\'' || char === '"' || char === '`';
}

function isSyntaxTokenKind(value: string): value is SyntaxTokenKind {
  return value === 'plain'
    || value === 'keyword'
    || value === 'string'
    || value === 'number'
    || value === 'comment'
    || value === 'function'
    || value === 'variable'
    || value === 'operator'
    || value === 'punctuation';
}

export {
  highlightCodeBlock
};

export type {
  SyntaxTheme,
  SyntaxTokenKind
};
