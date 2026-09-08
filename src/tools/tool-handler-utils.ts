import * as path from 'node:path';

const DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES = 65_536;

type Result<T> = {ok: true; value: T} | {ok: false; reason: string};

type CwdOption = string | (() => string) | undefined;

function resolveCwd(cwd: CwdOption): string {
  if (typeof cwd === 'function') {
    return cwd();
  }

  return cwd || process.cwd();
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isGitPath(absolutePath: string): boolean {
  return absolutePath.split(path.sep).includes('.git');
}

function capUtf8Text(text: string, maxBytes: number): {text: string; truncated: boolean} {
  const buffer = Buffer.from(text, 'utf8');

  if (buffer.length <= maxBytes) {
    return {text, truncated: false};
  }

  return {
    text: buffer.subarray(0, findUtf8HeadEnd(buffer, maxBytes)).toString('utf8'),
    truncated: true
  };
}

function capUtf8TailText(text: string, maxBytes: number): {text: string; truncated: boolean} {
  const buffer = Buffer.from(text, 'utf8');

  if (buffer.length <= maxBytes) {
    return {text, truncated: false};
  }

  let start = Math.max(0, buffer.length - Math.max(0, maxBytes));
  while (start < buffer.length && isUtf8ContinuationByte(buffer[start])) {
    start += 1;
  }

  return {text: buffer.subarray(start).toString('utf8'), truncated: true};
}

function findUtf8HeadEnd(buffer: Buffer, maxBytes: number): number {
  let end = Math.max(0, Math.min(maxBytes, buffer.length));
  if (end >= buffer.length) {
    return buffer.length;
  }

  while (end > 0 && isUtf8ContinuationByte(buffer[end])) {
    end -= 1;
  }
  return end;
}

function isUtf8ContinuationByte(byte: number | undefined): boolean {
  return typeof byte === 'number' && byte >= 0x80 && byte <= 0xbf;
}

export {
  DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES,
  capUtf8Text,
  capUtf8TailText,
  isGitPath,
  normalizePositiveInteger,
  resolveCwd
};

export type {
  CwdOption,
  Result
};
