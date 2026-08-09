import type {InputEvent} from './input';

export type TerminalController = {
  getSize: () => {columns: number; rows: number};
  cleanup: () => void;
};

export type AppController = {
  exit: () => void;
  handleChunk: (chunk: string | Buffer) => Promise<void>;
  handleEvent: (event: InputEvent) => Promise<void> | void;
  render: () => void;
  renderResizeRecovery: () => void;
  start: () => void;
};
