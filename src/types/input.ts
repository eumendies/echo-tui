import type { INPUT_EVENTS } from '../input/event-types';

export type InputEventType = (typeof INPUT_EVENTS)[keyof typeof INPUT_EVENTS];

export type ControlInputEventType = Exclude<
  InputEventType,
  typeof INPUT_EVENTS.TEXT | typeof INPUT_EVENTS.UNKNOWN | typeof INPUT_EVENTS.MOUSE | typeof INPUT_EVENTS.CURSOR_POSITION
>;

export type TextInputEvent = {
  type: typeof INPUT_EVENTS.TEXT;
  value: string;
};

export type UnknownInputEvent = {
  type: typeof INPUT_EVENTS.UNKNOWN;
  raw?: string;
};

export type ControlInputEvent = {
  type: ControlInputEventType;
};

export type MouseInputEvent = {
  type: typeof INPUT_EVENTS.MOUSE; // 标识该事件来自终端 SGR 鼠标报告。
  phase: 'move' | 'down' | 'up'; // 鼠标移动、按键按下或按键释放的报告阶段。
  button: 'left' | 'middle' | 'right' | 'other'; // 报告对应的物理按键；滚轮和未知按键统一归为 other。
  column: number; // 终端屏幕 1-based 列坐标，解析器已拒绝非正数。
  row: number; // 终端屏幕 1-based 行坐标，解析器已拒绝非正数。
  shift: boolean; // 报告中是否包含 Shift 修饰键。
  alt: boolean; // 报告中是否包含 Alt 修饰键。
  ctrl: boolean; // 报告中是否包含 Ctrl 修饰键。
};

export type CursorPositionInputEvent = {
  type: typeof INPUT_EVENTS.CURSOR_POSITION; // 标识终端对 cursor position query 的 CPR 回复。
  column: number; // 终端屏幕 1-based 光标列坐标。
  row: number; // 终端屏幕 1-based 光标行坐标。
};

export type InputEvent = TextInputEvent | UnknownInputEvent | ControlInputEvent | MouseInputEvent | CursorPositionInputEvent;
