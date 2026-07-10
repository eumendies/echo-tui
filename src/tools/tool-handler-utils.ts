import * as path from 'node:path';

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
    text: buffer.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/, ''),
    truncated: true
  };
}

export {
  capUtf8Text,
  isGitPath,
  normalizePositiveInteger,
  resolveCwd
};

export type {
  CwdOption,
  Result
};
