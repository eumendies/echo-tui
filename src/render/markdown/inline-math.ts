/**
 * 行内数学（$...$ / \(...\)）的保守识别与 Unicode 近似转换。
 *
 * 模块只服务 render 层：从普通文本中查找可以安全转换的行内数学片段，输出单行
 * Unicode 近似文本。任何超出受支持子集、超出预算或存在误伤风险的内容都返回
 * null，由调用方按原文回退；模块不产生 ANSI、不读取 theme、不抛异常。
 */

import {charWidth, splitGraphemes} from '../layout';

export type InlineMathMatch = {
  start: number; // 匹配起始 offset（含 opener 定界符）
  end: number; // 匹配结束 offset（exclusive，含 closer 定界符）
  text: string; // 转换后的单行 Unicode 文本
};

type MathParserState = {
  source: string; // 已 trim 的公式源码
  index: number; // 当前读取 offset（UTF-16 单位）
  depth: number; // 当前递归深度
};

// 预算：公式长度、closer 距离、嵌套深度与单次扫描的候选数都保持有界。
const MAX_SOURCE_LENGTH = 512;
const MAX_PARSE_DEPTH = 16;
const MAX_OPENER_ATTEMPTS = 64;

/** \left / \right 接受的命名定界符。 */
const DELIMITER_NAME_MAP: Readonly<Record<string, string>> = {
  langle: '⟨', rangle: '⟩',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  lVert: '‖', rVert: '‖', lvert: '|', rvert: '|',
  lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']'
};

/** 受支持的符号命令；值均为终端宽度 1 的字符或纯 ASCII（由测试锁定）。 */
export const INLINE_MATH_SYMBOL_MAP: Readonly<Record<string, string>> = {
  // 希腊字母与变体
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', varkappa: 'ϰ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // 运算符与关系
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
  ll: '≪', gg: '≫', lesssim: '≲', gtrsim: '≳',
  in: '∈', notin: '∉', ni: '∋',
  subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', nexists: '∄',
  neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  implies: '⟹', iff: '⟺', impliedby: '⟸',
  oplus: '⊕', otimes: '⊗', odot: '⊙', circ: '∘', bullet: '∙',
  perp: '⊥', parallel: '∥', angle: '∠',
  infty: '∞', partial: '∂', nabla: '∇',
  // 大运算符
  sum: '∑', prod: '∏', int: '∫', iint: '∬', iiint: '∭', oint: '∮', coprod: '∐',
  bigcup: '⋃', bigcap: '⋂',
  // 省略号与点号
  ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  // 字母变体与特殊记号
  aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', imath: 'ı', jmath: 'ȷ',
  prime: '′', dagger: '†', ddagger: '‡',
  // 箭头
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  mapsto: '↦', uparrow: '↑', downarrow: '↓', updownarrow: '↕',
  // 可独立使用的命名定界符
  vert: '|', Vert: '‖',
  ...DELIMITER_NAME_MAP
};

/** \mathbb 受支持的字母。 */
export const INLINE_MATH_BLACKBOARD_MAP: Readonly<Record<string, string>> = {
  R: 'ℝ', C: 'ℂ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', P: 'ℙ'
};

/** accent 命令到组合符的映射；组合符零宽，只作用于单 grapheme 参数。 */
export const INLINE_MATH_ACCENT_MAP: Readonly<Record<string, string>> = {
  hat: '\u0302',
  bar: '\u0304',
  tilde: '\u0303',
  vec: '\u20d7',
  dot: '\u0307',
  ddot: '\u0308'
};

// 上下标映射：源串与目标串按码点一一对应；目标宽度不变量由测试锁定。
const SUPERSCRIPT_SOURCE = '0123456789+-=()abcdefghijklmnoprstuvwxyz';
const SUPERSCRIPT_TARGET = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ';
const SUBSCRIPT_SOURCE = '0123456789+-=()aehijklmnoprstuvx';
const SUBSCRIPT_TARGET = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ';

/** 上标映射。 */
export const INLINE_MATH_SUPERSCRIPT_MAP: Readonly<Record<string, string>> = zipCharMap(SUPERSCRIPT_SOURCE, SUPERSCRIPT_TARGET);

/** 下标映射。 */
export const INLINE_MATH_SUBSCRIPT_MAP: Readonly<Record<string, string>> = zipCharMap(SUBSCRIPT_SOURCE, SUBSCRIPT_TARGET);

/**
 * 从 from 开始查找下一个可安全转换的行内数学片段。
 *
 * 识别 `$...$` 与 `\(...\)`，只接受同一行内闭合且通过全部护栏的候选；返回
 * { start, end, text }（text 为转换结果），无可用候选时返回 null。扫描预算
 * 有界，超限时整体放弃，不影响调用方按原文回退。
 */
export function findInlineMath(text: string, from: number): InlineMathMatch | null {
  if (from >= text.length) {
    return null;
  }

  // 快速短路：剩余文本没有候选定界符时不进入逐候选扫描。
  if (text.indexOf('$', from) < 0 && text.indexOf('\\(', from) < 0) {
    return null;
  }

  let cursor = Math.max(0, from);
  let attempts = 0;

  while (cursor < text.length && attempts < MAX_OPENER_ATTEMPTS) {
    const dollarIndex = text.indexOf('$', cursor);
    const parenIndex = text.indexOf('\\(', cursor);

    if (dollarIndex < 0 && parenIndex < 0) {
      return null;
    }

    const useDollar = dollarIndex >= 0 && (parenIndex < 0 || dollarIndex < parenIndex);
    const opener = useDollar ? dollarIndex : parenIndex;

    if (useDollar) {
      // `$$` 是 display 定界符，整体跳过，不参与行内配对。
      if (text[opener + 1] === '$') {
        cursor = opener + 2;
        continue;
      }
      if (isEscaped(text, opener)) {
        cursor = opener + 1;
        continue;
      }
      // shell 形态（`$(`、`${`）与空白开头的 `$` 不视为行内数学起点。
      const firstBodyChar = text[opener + 1];
      if (firstBodyChar === undefined || isMathWhitespace(firstBodyChar) || firstBodyChar === '(' || firstBodyChar === '{') {
        cursor = opener + 1;
        continue;
      }
    } else if (isEscaped(text, opener)) {
      cursor = opener + 1;
      continue;
    }

    attempts += 1;
    const bodyStart = opener + (useDollar ? 1 : 2);
    const closerIndex = findMathCloser(text, bodyStart, useDollar);

    if (closerIndex < 0) {
      cursor = opener + 1;
      continue;
    }

    const formula = text.slice(bodyStart, closerIndex);

    if (useDollar) {
      const decision = classifyDollarFormula(formula, text[closerIndex + 1]);
      if (decision === 'retry') {
        cursor = opener + 1;
        continue;
      }
      if (decision === 'skip') {
        cursor = closerIndex + 1;
        continue;
      }
    }

    // 公式内部出现反引号或链接定界符时保守回退，避免与 inline code / link 竞争。
    if (formula.includes('`') || formula.includes('](')) {
      cursor = opener + 1;
      continue;
    }

    const converted = convertInlineMathSource(formula);
    if (converted === null) {
      cursor = opener + 1;
      continue;
    }

    return {
      start: opener,
      end: closerIndex + (useDollar ? 1 : 2),
      text: converted
    };
  }

  return null;
}

/**
 * `$` 专属护栏：识别货币、shell 变量和普通单词等非数学场景。
 *
 * retry 表示放弃这对候选但允许 closer 再次作为 opener；skip 表示连同 closer
 * 一起跳过（如 $USD$、$42$），避免 closer 被重新配对成错误的行内数学。
 */
function classifyDollarFormula(formula: string, nextChar: string | undefined): 'accept' | 'retry' | 'skip' {
  const lastChar = formula[formula.length - 1];

  // 公式首尾不应有空白；closer 后紧跟 ASCII 字母或数字通常意味着货币或变量续写。
  if (lastChar === undefined || isMathWhitespace(lastChar)) {
    return 'retry';
  }
  if (nextChar !== undefined && isAsciiAlphaNumeric(nextChar)) {
    return 'retry';
  }

  // 纯数字开头且不含任何运算符的组合按货币处理（$42$ 等）。
  if (isAsciiDigit(formula[0]) && !hasMathOperator(formula)) {
    return 'skip';
  }

  // 全大写且长度大于 1 的单词按 shell 变量处理（$USD$、$HOME$ 等）。
  if (formula.length > 1 && /^[A-Z]+$/.test(formula)) {
    return 'skip';
  }

  return 'accept';
}

/** 公式中是否出现常见数学运算符；反斜杠命令也算数学信号。 */
function hasMathOperator(formula: string): boolean {
  for (const operator of ['\\', '^', '_', '=', '+', '-', '*', '/', '<', '>']) {
    if (formula.includes(operator)) {
      return true;
    }
  }
  return false;
}

/** 在公式源码内查找同一行的 closer；遇到换行或超出窗口返回 -1。 */
function findMathCloser(text: string, from: number, useDollar: boolean): number {
  // 窗口允许公式体本身达到上限长度，closer 最远出现在 from + MAX_SOURCE_LENGTH。
  const limit = Math.min(text.length, from + MAX_SOURCE_LENGTH + 1);

  for (let index = from; index < limit; index += 1) {
    const ch = text[index];
    if (ch === '\n') {
      return -1;
    }
    if (useDollar) {
      if (ch === '$' && !isEscaped(text, index)) {
        return index;
      }
      continue;
    }
    if (ch === '\\' && text[index + 1] === ')' && !isEscaped(text, index)) {
      return index;
    }
  }

  return -1;
}

/**
 * 把公式源码转换为单行 Unicode 文本；完整解析成功才返回结果，否则返回 null。
 */
function convertInlineMathSource(source: string): string | null {
  const trimmed = source.trim();
  if (trimmed === '' || Array.from(trimmed).length > MAX_SOURCE_LENGTH) {
    return null;
  }

  const state: MathParserState = {source: trimmed, index: 0, depth: 0};
  const rendered = parseMathSequence(state, false);
  if (rendered === null || rendered.trim() === '') {
    return null;
  }

  return rendered;
}

/**
 * 解析一个序列（整个公式或一对花括号内部）；未配对的 `}`、非法上下标或非法
 * 原子都返回 null，保证调用方只能得到完整转换或整体回退。
 */
function parseMathSequence(state: MathParserState, inGroup: boolean): string | null {
  if (state.depth >= MAX_PARSE_DEPTH) {
    return null;
  }

  state.depth += 1;
  const result = parseMathSequenceInner(state, inGroup);
  state.depth -= 1;
  return result;
}

function parseMathSequenceInner(state: MathParserState, inGroup: boolean): string | null {
  const source = state.source;
  const parts: string[] = [];
  let hasBase = false; // 当前原子是否可作为上下标的 base（单 grapheme）
  let scriptMask = 0; // 位掩码：1 = 已消费 `^`，2 = 已消费 `_`

  while (state.index < source.length) {
    const ch = source[state.index];

    if (ch === '}') {
      if (!inGroup) {
        return null;
      }
      state.index += 1;
      return parts.join('');
    }

    if (ch === '^' || ch === '_') {
      const bit = ch === '^' ? 1 : 2;
      if (!hasBase || (scriptMask & bit) !== 0) {
        return null;
      }
      scriptMask |= bit;
    } else if (!isMathWhitespace(ch)) {
      scriptMask = 0;
    }

    const atom = parseMathAtom(state);
    if (atom === null) {
      return null;
    }

    if (ch !== '^' && ch !== '_' && !isMathWhitespace(ch)) {
      hasBase = splitGraphemes(atom).length === 1;
    }

    parts.push(atom);
  }

  return inGroup ? null : parts.join('');
}

function parseMathAtom(state: MathParserState): string | null {
  if (state.depth >= MAX_PARSE_DEPTH) {
    return null;
  }

  state.depth += 1;
  const result = parseMathAtomInner(state);
  state.depth -= 1;
  return result;
}

function parseMathAtomInner(state: MathParserState): string | null {
  const source = state.source;
  if (state.index >= source.length) {
    return null;
  }

  const ch = source[state.index];

  if (ch === '{') {
    state.index += 1;
    return parseMathSequence(state, true);
  }

  if (ch === '\\') {
    state.index += 1;
    return parseMathCommand(state);
  }

  if (ch === '^' || ch === '_') {
    state.index += 1;
    const argument = parseMathArgument(state);
    if (argument === null) {
      return null;
    }
    const map = ch === '^' ? INLINE_MATH_SUPERSCRIPT_MAP : INLINE_MATH_SUBSCRIPT_MAP;
    let output = '';
    for (const value of argument) {
      const mapped = Object.hasOwn(map, value) ? map[value] : null;
      if (mapped === null) {
        return null;
      }
      output += mapped;
    }
    return output;
  }

  if (ch === '}' || ch === '$' || ch === '%' || ch === '#' || ch === '&' || ch === '`') {
    return null;
  }

  if (isMathWhitespace(ch)) {
    // 连续空白折叠为单个空格，与常见 TeX 行内文本渲染一致。
    while (state.index < source.length && isMathWhitespace(source[state.index])) {
      state.index += 1;
    }
    return ' ';
  }

  const codePoint = source.codePointAt(state.index);
  if (codePoint === undefined) {
    return null;
  }
  const literal = String.fromCodePoint(codePoint);
  if (isControlChar(literal)) {
    return null;
  }

  state.index += literal.length;
  return literal;
}

/** 解析上下标与命令参数：跳过前导空白，参数不得以 `^` 或 `_` 开头。 */
function parseMathArgument(state: MathParserState): string | null {
  const source = state.source;
  while (state.index < source.length && isMathWhitespace(source[state.index])) {
    state.index += 1;
  }
  if (state.index >= source.length) {
    return null;
  }

  const ch = source[state.index];
  if (ch === '^' || ch === '_') {
    return null;
  }
  return parseMathAtom(state);
}

/**
 * 解析反斜杠命令；未知命令、非法参数或超出子集都返回 null。
 */
function parseMathCommand(state: MathParserState): string | null {
  const source = state.source;
  const nameStart = state.index;

  while (state.index < source.length && isAsciiLetter(source[state.index])) {
    state.index += 1;
  }
  const name = source.slice(nameStart, state.index);

  if (name === '') {
    return parseMathSymbolEscape(state);
  }

  switch (name) {
    case 'frac':
    case 'dfrac':
    case 'tfrac': {
      const numerator = parseMathArgument(state);
      if (numerator === null) {
        return null;
      }
      const denominator = parseMathArgument(state);
      if (denominator === null) {
        return null;
      }
      return `((${numerator})/(${denominator}))`;
    }

    case 'sqrt': {
      // 不支持 \sqrt[n]{}：出现可选参数即整体回退。
      if (source[skipMathWhitespace(state)] === '[') {
        return null;
      }
      const radicand = parseMathArgument(state);
      if (radicand === null) {
        return null;
      }
      return `√(${radicand})`;
    }

    case 'mathbb': {
      const argument = parseMathArgument(state);
      if (argument === null || !Object.hasOwn(INLINE_MATH_BLACKBOARD_MAP, argument)) {
        return null;
      }
      return INLINE_MATH_BLACKBOARD_MAP[argument];
    }

    case 'hat':
    case 'bar':
    case 'tilde':
    case 'vec':
    case 'dot':
    case 'ddot': {
      const argument = parseMathArgument(state);
      if (argument === null || splitGraphemes(argument).length !== 1 || argument.trim() === '' || charWidth(argument) === 0) {
        return null;
      }
      return `${argument}${INLINE_MATH_ACCENT_MAP[name]}`;
    }

    case 'mathrm':
    case 'mathbf':
    case 'mathit':
      return parseMathArgument(state);

    case 'text':
    case 'operatorname':
      return parseRawTextArgument(state);

    case 'left':
    case 'right':
      return parseMathDelimiter(state);

    default: {
      if (!Object.hasOwn(INLINE_MATH_SYMBOL_MAP, name)) {
        return null;
      }
      return INLINE_MATH_SYMBOL_MAP[name];
    }
  }
}

/** 解析无字母的转义命令：\,、\;、\:、\ （空白）、\!（无输出）、\{、\}、\|。 */
function parseMathSymbolEscape(state: MathParserState): string | null {
  const source = state.source;
  if (state.index >= source.length) {
    return null;
  }

  const ch = source[state.index];
  state.index += 1;

  switch (ch) {
    case ',':
    case ';':
    case ':':
    case ' ':
      return ' ';
    case '!':
      return '';
    case '{':
      return '{';
    case '}':
      return '}';
    case '|':
      return '‖';
    default:
      return null;
  }
}

/** 解析 \text / \operatorname 的 {…} 参数；内容直通，出现 TeX 特殊字符或控制字符失败。 */
function parseRawTextArgument(state: MathParserState): string | null {
  const source = state.source;
  const openIndex = skipMathWhitespace(state);
  if (source[openIndex] !== '{') {
    return null;
  }

  const closeIndex = source.indexOf('}', openIndex + 1);
  if (closeIndex < 0) {
    return null;
  }

  const text = source.slice(openIndex + 1, closeIndex);
  if (/[{}\\$%#&]/.test(text)) {
    return null;
  }
  for (const ch of text) {
    if (isControlChar(ch)) {
      return null;
    }
  }

  state.index = closeIndex + 1;
  return text;
}

/** 解析 \left / \right 后的定界符；`.` 表示不可见定界符。 */
function parseMathDelimiter(state: MathParserState): string | null {
  const source = state.source;
  const index = skipMathWhitespace(state);
  if (index >= source.length) {
    return null;
  }

  const ch = source[index];

  if (ch === '.') {
    state.index = index + 1;
    return '';
  }
  if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '|') {
    state.index = index + 1;
    return ch;
  }
  if (ch === '<') {
    state.index = index + 1;
    return '⟨';
  }
  if (ch === '>') {
    state.index = index + 1;
    return '⟩';
  }
  if (ch === '\\') {
    state.index = index + 1;
    return parseDelimiterCommand(state);
  }

  return null;
}

/** 解析 \left\langle 一类命名定界符命令，以及 \{、\}、\|。 */
function parseDelimiterCommand(state: MathParserState): string | null {
  const source = state.source;
  const nameStart = state.index;

  while (state.index < source.length && isAsciiLetter(source[state.index])) {
    state.index += 1;
  }
  const name = source.slice(nameStart, state.index);

  if (name === '') {
    if (state.index >= source.length) {
      return null;
    }
    const ch = source[state.index];
    state.index += 1;
    if (ch === '{') {
      return '{';
    }
    if (ch === '}') {
      return '}';
    }
    if (ch === '|') {
      return '‖';
    }
    return null;
  }

  if (!Object.hasOwn(DELIMITER_NAME_MAP, name)) {
    return null;
  }
  return DELIMITER_NAME_MAP[name];
}

/** 跳过连续空白，返回第一个非空白 offset（不修改 state）。 */
function skipMathWhitespace(state: MathParserState): number {
  let index = state.index;
  while (index < state.source.length && isMathWhitespace(state.source[index])) {
    index += 1;
  }
  return index;
}

/** 判断 index 处的字符是否被奇数个反斜杠转义。 */
function isEscaped(text: string, index: number): boolean {
  let count = 0;
  let cursor = index - 1;

  while (cursor >= 0 && text[cursor] === '\\') {
    count += 1;
    cursor -= 1;
  }

  return count % 2 === 1;
}

function isMathWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function isAsciiDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isAsciiAlphaNumeric(ch: string): boolean {
  return isAsciiLetter(ch) || isAsciiDigit(ch);
}

/** 控制字符不参与公式文本，避免把不可见内容带进渲染层。 */
function isControlChar(ch: string): boolean {
  const codePoint = ch.codePointAt(0);
  if (codePoint === undefined) {
    return true;
  }
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** 把两个字符集压缩成码点级映射；长度不一致时按较短侧截断（长度由测试锁定）。 */
function zipCharMap(source: string, target: string): Readonly<Record<string, string>> {
  const sourceChars = Array.from(source);
  const targetChars = Array.from(target);
  const map: Record<string, string> = {};

  for (let index = 0; index < sourceChars.length && index < targetChars.length; index += 1) {
    map[sourceChars[index]] = targetChars[index];
  }

  return map;
}
