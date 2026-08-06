import {INPUT_EVENTS} from './event-types';
import {splitGraphemes} from './graphemes';

import type { ComposerState } from '../types/composer';
import type { InputEvent } from '../types/input';

/**
 * 创建一个新的 composer 状态，内部使用字符数组而不是原始字符串管理光标。
 *
 */
export function createComposer(initialValue = ''): ComposerState {
  // composer 用 grapheme 数组作为编辑模型，光标按 cluster 边界移动，避免拆散复合 emoji。
  const chars = splitGraphemes(initialValue);

  return {
    chars,
    cursor: chars.length
  };
}

/**
 * 读取 composer 当前完整文本。
 *
 */
export function getText(composer: Pick<ComposerState, 'chars'>): string {
  return composer.chars.join('');
}

/**
 * 判断 composer 是否为空。
 *
 */
export function isEmpty(composer: Pick<ComposerState, 'chars'>): boolean {
  return composer.chars.length === 0;
}

/**
 * 将输入事件应用到 composer 编辑状态；返回 false 表示该事件不是文本编辑事件。
 *
 */
export function applyComposerEditEvent(composer: ComposerState, event: InputEvent): boolean {
  switch (event.type) {
    case INPUT_EVENTS.TEXT:
      insertText(composer, event.value || '');
      return true;
    case INPUT_EVENTS.BACKSPACE:
      backspace(composer);
      return true;
    case INPUT_EVENTS.DELETE_FORWARD:
      deleteForward(composer);
      return true;
    case INPUT_EVENTS.DELETE_TO_LINE_START:
      deleteToLineStart(composer);
      return true;
    case INPUT_EVENTS.DELETE_TO_LINE_END:
      deleteToLineEnd(composer);
      return true;
    case INPUT_EVENTS.DELETE_PREVIOUS_WORD:
      deletePreviousWord(composer);
      return true;
    case INPUT_EVENTS.MOVE_LEFT:
      moveLeft(composer);
      return true;
    case INPUT_EVENTS.MOVE_RIGHT:
      moveRight(composer);
      return true;
    case INPUT_EVENTS.MOVE_HOME:
      moveHome(composer);
      return true;
    case INPUT_EVENTS.MOVE_END:
      moveEnd(composer);
      return true;
  }

  return false;
}

/**
 * 在当前光标位置插入文本，并让光标移动到插入内容之后。
 *
 */
export function insertText(composer: ComposerState, text: string): void {
  // grapheme 切分让中文和复合 emoji 都按一个编辑单元插入和移动。
  const incoming = splitGraphemes(text);
  composer.chars.splice(composer.cursor, 0, ...incoming);
  composer.cursor += incoming.length;
}

/**
 * 替换 composer 中的一段编辑单元，并把光标移动到替换内容之后。
 *
 */
export function replaceRange(composer: ComposerState, start: number, end: number, text: string): void {
  const normalizedStart = Math.min(Math.max(0, Math.floor(start)), composer.chars.length);
  const normalizedEnd = Math.min(Math.max(normalizedStart, Math.floor(end)), composer.chars.length);
  const incoming = splitGraphemes(text);
  composer.chars.splice(normalizedStart, normalizedEnd - normalizedStart, ...incoming);
  composer.cursor = normalizedStart + incoming.length;
}

/**
 * 在当前光标位置插入逻辑换行。
 *
 */
export function insertNewline(composer: ComposerState): void {
  insertText(composer, '\n');
}

/**
 * 删除光标前一个编辑单元，并把光标左移一位。
 *
 */
export function backspace(composer: ComposerState): void {
  if (composer.cursor === 0) {
    return;
  }

  composer.chars.splice(composer.cursor - 1, 1);
  composer.cursor -= 1;
}

/**
 * 删除光标后的一个编辑单元，不移动当前光标。
 *
 */
export function deleteForward(composer: ComposerState): void {
  if (composer.cursor >= composer.chars.length) {
    return;
  }

  composer.chars.splice(composer.cursor, 1);
}

/**
 * 删除从当前逻辑行开头到光标前的内容。
 *
 */
export function deleteToLineStart(composer: ComposerState): void {
  const lineStart = findLineStart(composer.chars, composer.cursor);

  if (lineStart === composer.cursor) {
    return;
  }

  composer.chars.splice(lineStart, composer.cursor - lineStart);
  composer.cursor = lineStart;
}

/**
 * 删除从当前光标到逻辑行结尾的内容。
 *
 */
export function deleteToLineEnd(composer: ComposerState): void {
  const lineEnd = findLineEnd(composer.chars, composer.cursor);

  if (lineEnd === composer.cursor) {
    return;
  }

  composer.chars.splice(composer.cursor, lineEnd - composer.cursor);
}

/**
 * 删除光标前的前一个词；先跳过连续空白，再删除前一个连续非空白片段。
 *
 */
export function deletePreviousWord(composer: ComposerState): void {
  let start = composer.cursor;

  while (start > 0 && isWhitespace(composer.chars[start - 1])) {
    start -= 1;
  }

  while (start > 0 && !isWhitespace(composer.chars[start - 1])) {
    start -= 1;
  }

  if (start === composer.cursor) {
    return;
  }

  composer.chars.splice(start, composer.cursor - start);
  composer.cursor = start;
}

/**
 * 把光标向左移动一个编辑单元，并限制在内容开头以内。
 *
 */
export function moveLeft(composer: Pick<ComposerState, 'cursor'>): void {
  composer.cursor = Math.max(0, composer.cursor - 1);
}

/**
 * 把光标向右移动一个编辑单元，并限制在内容末尾以内。
 *
 */
export function moveRight(composer: ComposerState): void {
  composer.cursor = Math.min(composer.chars.length, composer.cursor + 1);
}

/**
 * 把光标向上移动到上一逻辑行，并尽量保持当前逻辑列。
 *
 */
export function moveUp(composer: ComposerState): void {
  const currentLineStart = findLineStart(composer.chars, composer.cursor);

  if (currentLineStart === 0) {
    return;
  }

  const currentColumn = composer.cursor - currentLineStart;
  const previousLineEnd = currentLineStart - 1;
  const previousLineStart = findLineStart(composer.chars, previousLineEnd);
  composer.cursor = Math.min(previousLineStart + currentColumn, previousLineEnd);
}

/**
 * 把光标向下移动到下一逻辑行，并尽量保持当前逻辑列。
 *
 */
export function moveDown(composer: ComposerState): void {
  const currentLineStart = findLineStart(composer.chars, composer.cursor);
  const currentLineEnd = findLineEnd(composer.chars, composer.cursor);

  if (currentLineEnd === composer.chars.length) {
    return;
  }

  const currentColumn = composer.cursor - currentLineStart;
  const nextLineStart = currentLineEnd + 1;
  const nextLineEnd = findLineEnd(composer.chars, nextLineStart);
  composer.cursor = Math.min(nextLineStart + currentColumn, nextLineEnd);
}

/**
 * 把光标移动到当前逻辑行开头。
 *
 */
export function moveHome(composer: ComposerState): void {
  composer.cursor = findLineStart(composer.chars, composer.cursor);
}

/**
 * 把光标移动到当前逻辑行末尾；如果没有后续换行则移动到全文末尾。
 *
 */
export function moveEnd(composer: ComposerState): void {
  composer.cursor = findLineEnd(composer.chars, composer.cursor);
}

/**
 * 用整段文本替换 composer 内容，并把光标放到末尾。
 *
 */
export function setText(composer: ComposerState, text: string): void {
  composer.chars = splitGraphemes(text);
  composer.cursor = composer.chars.length;
}

/**
 * 清空 composer 内容并把光标归零。
 *
 */
export function reset(composer: ComposerState): void {
  composer.chars = [];
  composer.cursor = 0;
}

/**
 * 找到给定 cursor 所在逻辑行的开头。
 *
 */
function findLineStart(chars: string[], cursor: number): number {
  for (let index = cursor - 1; index >= 0; index -= 1) {
    if (chars[index] === '\n') {
      return index + 1;
    }
  }

  return 0;
}

/**
 * 找到给定 cursor 所在逻辑行的结尾；返回的是行尾光标位置，不含换行符本身。
 *
 */
function findLineEnd(chars: string[], cursor: number): number {
  for (let index = cursor; index < chars.length; index += 1) {
    if (chars[index] === '\n') {
      return index;
    }
  }

  return chars.length;
}

/**
 * 判断字符是否为空白，用于词级删除。
 *
 */
function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}
