import { INPUT_EVENTS } from './event-types';
import type { ControlInputEventType, InputEvent, MouseInputEvent, MouseWheelInputEvent } from '../types/input';

type SequenceMatch = {
  sequence: string;
  type: ControlInputEventType;
};

type KeyParser = {
  parse: (chunk: string | Buffer) => InputEvent[];
};

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
const SGR_MOUSE_PREFIX = '\x1b[<';
const MAX_TERMINAL_REPORT_LENGTH = 64;
const MAX_TERMINAL_COORDINATE = 10_000;

// 支持的最小按键集合。不同终端会为 Home/End/方向键发出不同序列。
const KEY_SEQUENCES = new Map<string, ControlInputEventType>([
  ['\x7f', INPUT_EVENTS.BACKSPACE], // Backspace
  ['\b', INPUT_EVENTS.BACKSPACE], // Backspace (Ctrl+H)
  ['\x1b[3~', INPUT_EVENTS.DELETE_FORWARD], // Delete
  ['\x15', INPUT_EVENTS.DELETE_TO_LINE_START], // Ctrl+U
  ['\x0b', INPUT_EVENTS.DELETE_TO_LINE_END], // Ctrl+K
  ['\x17', INPUT_EVENTS.DELETE_PREVIOUS_WORD], // Ctrl+W
  ['\x14', INPUT_EVENTS.TOGGLE_MODEL_TUNING], // Ctrl+T
  ['\x0f', INPUT_EVENTS.OPEN_SUBAGENT_VIEW], // Ctrl+O
  ['\x1b[A', INPUT_EVENTS.MOVE_UP], // Up Arrow
  ['\x1bOA', INPUT_EVENTS.MOVE_UP], // Up Arrow (application mode)
  ['\x1b[B', INPUT_EVENTS.MOVE_DOWN], // Down Arrow
  ['\x1bOB', INPUT_EVENTS.MOVE_DOWN], // Down Arrow (application mode)
  ['\x1b[5~', INPUT_EVENTS.PAGE_UP], // Page Up
  ['\x1b[6~', INPUT_EVENTS.PAGE_DOWN], // Page Down
  ['\x1b[D', INPUT_EVENTS.MOVE_LEFT], // Left Arrow
  ['\x1bOD', INPUT_EVENTS.MOVE_LEFT], // Left Arrow (application mode)
  ['\x1b[C', INPUT_EVENTS.MOVE_RIGHT], // Right Arrow
  ['\x1bOC', INPUT_EVENTS.MOVE_RIGHT], // Right Arrow (application mode)
  ['\x01', INPUT_EVENTS.MOVE_HOME], // Ctrl+A
  ['\x1b[H', INPUT_EVENTS.MOVE_HOME], // Home
  ['\x1b[1~', INPUT_EVENTS.MOVE_HOME], // Home (alternate sequence)
  ['\x1bOH', INPUT_EVENTS.MOVE_HOME], // Home (application mode)
  ['\x05', INPUT_EVENTS.MOVE_END], // Ctrl+E
  ['\x1b[F', INPUT_EVENTS.MOVE_END], // End
  ['\x1b[4~', INPUT_EVENTS.MOVE_END], // End (alternate sequence)
  ['\x1bOF', INPUT_EVENTS.MOVE_END], // End (application mode)
  ['\t', INPUT_EVENTS.TAB], // Tab
  ['\x1b[Z', INPUT_EVENTS.SHIFT_TAB], // Shift+Tab
  ['\r', INPUT_EVENTS.SUBMIT], // Enter
  ['\x1b', INPUT_EVENTS.ESCAPE], // Escape
  ['\x03', INPUT_EVENTS.EXIT], // Ctrl+C
  ['\x04', INPUT_EVENTS.EXIT], // Ctrl+D
  ['\n', INPUT_EVENTS.INSERT_NEWLINE] // Ctrl+J / Line Feed
]);

// 按照长度进行排序，先匹配长序列。
const ORDERED_KEY_SEQUENCES = Array.from(KEY_SEQUENCES.entries()).sort(
  (left, right) => right[0].length - left[0].length
);

/**
 * 创建跨 stdin chunk 保持状态的按键解析器；运行时使用它避免 bracketed paste 被拆包后误触发提交。
 */
export function createKeyParser(): KeyParser {
  return new StatefulKeyParser();
}

/**
 * 运行时输入解析器；chunk 只是传输边界，paste 起止序列才是语义边界。
 */
class StatefulKeyParser {
  private normalPending = '';

  private discardingTerminalReport = false;

  private pasteBuffer = '';

  private pastePending = '';

  private pasting = false;

  /**
   * 解析一个 stdin chunk，并在 bracketed paste 结束前缓存粘贴内容。
   */
  parse(chunk: string | Buffer): InputEvent[] {
    const events: InputEvent[] = [];
    let remaining: string | null = String(chunk);

    while (remaining !== null) {
      remaining = this.pasting
        ? this.consumePasting(remaining, events)
        : this.consumeNormal(remaining, events);
    }

    return events;
  }

  /**
   * 在普通输入模式下扫描 paste start；start 前后的普通按键仍交给无状态 parser 解析。
   */
  private consumeNormal(text: string, events: InputEvent[]): string | null {
    if (this.discardingTerminalReport) {
      const end = findCsiTerminator(text, 0);

      if (end === null) {
        return null;
      }

      this.discardingTerminalReport = false;
      return text.slice(end);
    }

    const incoming = this.normalPending + text;
    this.normalPending = '';
    const pasteStart = incoming.indexOf(BRACKETED_PASTE_START);

    if (pasteStart !== -1) {
      events.push(...parseKeyChunk(incoming.slice(0, pasteStart)));
      this.pasting = true;
      return incoming.slice(pasteStart + BRACKETED_PASTE_START.length);
    }

    const split = splitTrailingControlPrefix(incoming);
    events.push(...parseKeyChunk(split.ready));
    this.normalPending = split.pending;
    this.discardingTerminalReport = split.discard;
    return null;
  }

  /**
   * 在粘贴模式下只寻找 paste end；期间所有换行都作为 payload 缓存，不产生 submit。
   */
  private consumePasting(text: string, events: InputEvent[]): string | null {
    const incoming = this.pastePending + text;
    this.pastePending = '';
    const pasteEnd = incoming.indexOf(BRACKETED_PASTE_END);

    if (pasteEnd !== -1) {
      this.pasteBuffer += incoming.slice(0, pasteEnd);
      events.push({
        type: INPUT_EVENTS.TEXT,
        value: normalizePastedText(this.pasteBuffer)
      });
      this.pasteBuffer = '';
      this.pasting = false;
      return incoming.slice(pasteEnd + BRACKETED_PASTE_END.length);
    }

    const split = splitTrailingPrefix(incoming, BRACKETED_PASTE_END, 1);
    this.pasteBuffer += split.ready;
    this.pastePending = split.pending;
    return null;
  }
}

/**
 * 将 raw stdin chunk 解析为语义输入事件列表。
 *
 */
export function parseKeyChunk(chunk: string | Buffer): InputEvent[] {
  // raw stdin 一个 chunk 里可能混有 escape sequence 和普通字符，所以必须流式扫描。
  const text = String(chunk);
  const events: InputEvent[] = [];
  let index = 0;

  while (index < text.length) {
    const paste = parseBracketedPasteAt(text, index);

    if (paste) {
      events.push({
        type: INPUT_EVENTS.TEXT,
        value: normalizePastedText(paste.payload)
      });
      index = paste.endIndex;
      continue;
    }

    const terminalReport = parseTerminalReportAt(text, index);

    if (terminalReport) {
      events.push(...terminalReport.events);
      index = terminalReport.endIndex;
      continue;
    }

    const matched = findSequenceAt(text, index);

    if (matched) {
      events.push({ type: matched.type });
      index += matched.sequence.length;
      continue;
    }

    // Array.from 取一个 Unicode code point，避免中文字符被 UTF-16 下标切碎。
    const char = Array.from(text.slice(index))[0];

    if (!char) {
      break;
    }

    events.push(parseCharacter(char));
    index += char.length;
  }

  return events;
}

/**
 * 解析完整 SGR 鼠标报告和 CPR 回复；超长的完整 SGR/CPR 仍完整吞掉，避免残片进入 composer。
 */
function parseTerminalReportAt(text: string, index: number): {endIndex: number; events: InputEvent[]} | null {
  if (!text.startsWith('\x1b[', index)) {
    return null;
  }

  const remaining = text.slice(index, index + MAX_TERMINAL_REPORT_LENGTH);
  const isMouse = remaining.startsWith(SGR_MOUSE_PREFIX);
  const isCursorPosition = /^\x1b\[\d*;\d*/.test(remaining);
  // SGR 鼠标帧格式为 ESC [ < 按键编码 ; 列 ; 行 M/m：M 表示按下/移动，m 表示释放。
  const mouseMatch = isMouse ? /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(remaining) : null;

  if (mouseMatch) {
    const event = createMouseEvent(mouseMatch);
    return {
      endIndex: index + mouseMatch[0].length,
      events: event ? [event] : []
    };
  }

  // CPR 是本进程发送 ESC[6n 后终端返回的 ESC [ 行 ; 列 R，用于定位 footer 屏幕原点。
  const cursorMatch = /^\x1b\[(\d+);(\d+)R/.exec(remaining);

  if (cursorMatch) {
    const row = Number(cursorMatch[1]);
    const column = Number(cursorMatch[2]);
    return {
      endIndex: index + cursorMatch[0].length,
      events: isTerminalCoordinate(row) && isTerminalCoordinate(column)
        ? [{type: INPUT_EVENTS.CURSOR_POSITION, row, column}]
        : []
    };
  }

  if (!isMouse && !isCursorPosition) {
    return null;
  }

  const csiEnd = findCompleteCsiEnd(text, index);

  if (csiEnd !== null) {
    return {endIndex: csiEnd, events: []};
  }

  return null;
}

/** 将合法无修饰符垂直滚轮单独解析，防止轮事件进入点击/hover 路径。 */
function createMouseEvent(match: RegExpExecArray): MouseInputEvent | MouseWheelInputEvent | null {
  const code = Number(match[1]);
  const column = Number(match[2]);
  const row = Number(match[3]);
  const final = match[4];

  if (!Number.isInteger(code) || code < 0 || code > 255 || !isTerminalCoordinate(column) || !isTerminalCoordinate(row)) {
    return null;
  }

  if (code & 64) {
    return final === 'M' && (code === 64 || code === 65)
      ? {type: INPUT_EVENTS.MOUSE_WHEEL, direction: code === 64 ? 'up' : 'down', column, row}
      : null;
  }

  const buttonCode = code & 3;
  const button = buttonCode === 0 ? 'left' : buttonCode === 1 ? 'middle' : buttonCode === 2 ? 'right' : 'other';
  return {
    type: INPUT_EVENTS.MOUSE,
    phase: final === 'm' ? 'up' : code & 32 ? 'move' : 'down',
    button,
    column,
    row,
    shift: Boolean(code & 4),
    alt: Boolean(code & 8),
    ctrl: Boolean(code & 16)
  };
}

function isTerminalCoordinate(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_TERMINAL_COORDINATE;
}

/** 返回完整 CSI 的尾后一位；仅在已经识别为终端报告前缀时调用。 */
function findCompleteCsiEnd(text: string, index: number): number | null {
  return findCsiTerminator(text, index + 2);
}

/** 在完整或被截断的 CSI 参数流中定位终结字节，返回其尾后一位。 */
function findCsiTerminator(text: string, start: number): number | null {
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const code = text.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) {
      return cursor + 1;
    }
  }

  return null;
}

/**
 * 在当前位置识别完整 bracketed paste payload；parser 保持无状态，不跨 chunk 缓冲半截粘贴。
 */
function parseBracketedPasteAt(text: string, index: number): {endIndex: number; payload: string} | null {
  if (!text.startsWith(BRACKETED_PASTE_START, index)) {
    return null;
  }

  const payloadStart = index + BRACKETED_PASTE_START.length;
  const payloadEnd = text.indexOf(BRACKETED_PASTE_END, payloadStart);

  if (payloadEnd === -1) {
    return null;
  }

  return {
    endIndex: payloadEnd + BRACKETED_PASTE_END.length,
    payload: text.slice(payloadStart, payloadEnd)
  };
}

/**
 * 将粘贴中的 CRLF/CR 统一为 composer 内部使用的 LF，避免误触发提交。
 */
function normalizePastedText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 拆分末尾可能属于目标序列前缀的片段，让下一次 chunk 到达后再决定语义。
 */
function splitTrailingPrefix(text: string, target: string, minLength: number): {ready: string; pending: string} {
  const maxLength = Math.min(target.length - 1, text.length);

  for (let length = maxLength; length >= minLength; length -= 1) {
    const suffix = text.slice(-length);

    if (target.startsWith(suffix)) {
      return {
        ready: text.slice(0, -length),
        pending: suffix
      };
    }
  }

  return {ready: text, pending: ''};
}

/**
 * 保留尾部尚未结束的 paste、SGR 鼠标或 CPR 序列，避免拆包残片被无状态 parser 误认为普通文本。
 */
function splitTrailingControlPrefix(text: string): {discard: boolean; ready: string; pending: string} {
  const paste = splitTrailingPrefix(text, BRACKETED_PASTE_START, 2);

  if (paste.pending !== '') {
    return {...paste, discard: false};
  }

  const start = text.lastIndexOf('\x1b');

  if (start === -1) {
    return {discard: false, ready: text, pending: ''};
  }

  const candidate = text.slice(start);
  const isIncompleteMouse = candidate.startsWith(SGR_MOUSE_PREFIX) && /^\x1b\[<[\d;]*$/.test(candidate);
  const isIncompleteCursorPosition = /^\x1b\[\d*;\d*$/.test(candidate);

  if (isIncompleteMouse || isIncompleteCursorPosition) {
    if (candidate.length > MAX_TERMINAL_REPORT_LENGTH) {
      return {discard: true, ready: text.slice(0, start), pending: ''};
    }
    return {discard: false, ready: text.slice(0, start), pending: candidate};
  }

  return {discard: false, ready: text, pending: ''};
}

/**
 * 在指定位置查找是否命中已知控制键序列。
 *
 */
function findSequenceAt(text: string, index: number): SequenceMatch | null {
  // 先匹配长序列，避免 "\x1b[3~" 被短前缀提前吞掉。
  for (const [sequence, type] of ORDERED_KEY_SEQUENCES) {
    if (text.startsWith(sequence, index)) {
      return { sequence, type };
    }
  }

  return null;
}

/**
 * 将单个字符解析为 printable text 或 unknown 事件。
 *
 */
function parseCharacter(char: string): InputEvent {
  const sequenceType = KEY_SEQUENCES.get(char);

  if (sequenceType) {
    return { type: sequenceType };
  }

  if (isPrintable(char)) {
    return {
      type: INPUT_EVENTS.TEXT,
      value: char
    };
  }

  return { type: INPUT_EVENTS.UNKNOWN, raw: char };
}

/**
 * 判断字符是否可打印。
 *
 */
function isPrintable(char: string): boolean {
  // raw mode 下控制字符也会进来；这里只把可打印字符交给 composer。
  const codePoint = char.codePointAt(0);
  return typeof codePoint === 'number' && codePoint >= 0x20 && codePoint !== 0x7f;
}
