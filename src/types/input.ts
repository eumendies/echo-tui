import type { INPUT_EVENTS } from '../input/event-types';

export type InputEventType = (typeof INPUT_EVENTS)[keyof typeof INPUT_EVENTS];

export type ControlInputEventType = Exclude<
  InputEventType,
  typeof INPUT_EVENTS.TEXT | typeof INPUT_EVENTS.UNKNOWN
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

export type InputEvent = TextInputEvent | UnknownInputEvent | ControlInputEvent;

export type ParseKeyChunk = (chunk: string | Buffer) => InputEvent[];
