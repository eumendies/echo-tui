import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

import {capUtf8TailText as capUtf8TailTextShared, capUtf8Text, normalizePositiveInteger} from './tool-handler-utils';

const DEFAULT_TOOL_RESULT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const TOOL_RESULT_TRUNCATION_MARKER_PREFIX = '[tool result truncated: ';
const TOOL_RESULT_TRUNCATION_MARKER_SUFFIX = ']';

type CwdOption = string | (() => string) | undefined;

type ToolResultStoreOptions = {
  cwd?: CwdOption;
  fsImpl?: Pick<typeof fs, 'mkdirSync' | 'writeFileSync' | 'renameSync' | 'rmSync' | 'openSync' | 'writeSync' | 'closeSync'>;
  maxArtifactBytes?: number;
  rootDir?: string;
};

type ToolResultArtifactWriteResult =
  | {ok: true; path: string; truncated: boolean}
  | {ok: false};

type ToolResultStreamWriter = {
  append: (chunk: Buffer | string) => void;
  finish: () => ToolResultArtifactWriteResult;
};

type ToolResultStore = {
  createStreamWriter: () => ToolResultStreamWriter | null;
  writeText: (text: string) => ToolResultArtifactWriteResult;
};

type ToolResultPreviewStrategy = 'head' | 'tail';

type OffloadedTextPreview = {
  offloadFilePath?: string;
  text: string;
  truncated: boolean;
};

/**
 * 创建工具结果 offloading store，所有文件都写入用户级 cwd 项目分区。
 */
function createToolResultStore(options: ToolResultStoreOptions = {}): ToolResultStore {
  const fsImpl = options.fsImpl || fs;
  const rootDir = options.rootDir || path.join(os.homedir(), '.echo', 'echo_tui');
  const maxArtifactBytes = normalizePositiveInteger(options.maxArtifactBytes, DEFAULT_TOOL_RESULT_MAX_ARTIFACT_BYTES);

  function getToolResultsDir(): string {
    return path.join(rootDir, 'projects', getProjectKey(resolveCwd(options.cwd)), 'tool-results');
  }

  function writeText(text: string): ToolResultArtifactWriteResult {
    const paths = createArtifactPaths(getToolResultsDir());

    try {
      fsImpl.mkdirSync(path.dirname(paths.targetPath), {recursive: true, mode: 0o700});
      const capped = capUtf8HeadText(text, maxArtifactBytes);

      fsImpl.writeFileSync(paths.tmpPath, capped.text, {encoding: 'utf8', mode: 0o600});
      fsImpl.renameSync(paths.tmpPath, paths.targetPath);

      return {ok: true, path: paths.targetPath, truncated: capped.truncated};
    } catch {
      cleanupTempFile(fsImpl, paths.tmpPath);
      return {ok: false};
    }
  }

  function createStreamWriter(): ToolResultStreamWriter | null {
    const paths = createArtifactPaths(getToolResultsDir());
    const decoder = new StringDecoder('utf8');
    let fd: number;
    let bytesWritten = 0;
    let closed = false;
    let failed = false;
    let saturated = false;
    let truncated = false;

    try {
      fsImpl.mkdirSync(path.dirname(paths.targetPath), {recursive: true, mode: 0o700});
      fd = fsImpl.openSync(paths.tmpPath, 'w', 0o600);
    } catch {
      cleanupTempFile(fsImpl, paths.tmpPath);
      return null;
    }

    function closeFd(): boolean {
      if (closed) {
        return true;
      }

      try {
        fsImpl.closeSync(fd);
        closed = true;
        return true;
      } catch {
        closed = true;
        failed = true;
        return false;
      }
    }

    function appendDecodedText(text: string): void {
      if (text === '' || failed || closed || saturated) {
        return;
      }

      const buffer = Buffer.from(text, 'utf8');

      if (bytesWritten >= maxArtifactBytes) {
        saturated = true;
        truncated = true;
        return;
      }

      const remaining = maxArtifactBytes - bytesWritten;
      const accepted = buffer.length > remaining ? capUtf8HeadBuffer(buffer, remaining) : buffer;

      if (accepted.length === 0) {
        saturated = true;
        truncated = true;
        return;
      }

      try {
        let offset = 0;

        while (offset < accepted.length) {
          const written = fsImpl.writeSync(fd, accepted, offset, accepted.length - offset);

          if (written <= 0) {
            throw new Error('failed to write tool result artifact');
          }

          offset += written;
        }

        bytesWritten += offset;
        if (accepted.length < buffer.length) {
          saturated = true;
          truncated = true;
        }
      } catch {
        failed = true;
        closeFd();
        cleanupTempFile(fsImpl, paths.tmpPath);
      }
    }

    function append(chunk: Buffer | string): void {
      if (failed || closed || saturated) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');

      if (buffer.length === 0) {
        return;
      }

      appendDecodedText(decoder.write(buffer));
    }

    function finish(): ToolResultArtifactWriteResult {
      if (!failed && !closed && !saturated) {
        appendDecodedText(decoder.end());
      }

      if (failed || !closeFd()) {
        cleanupTempFile(fsImpl, paths.tmpPath);
        return {ok: false};
      }

      try {
        fsImpl.renameSync(paths.tmpPath, paths.targetPath);
        return {ok: true, path: paths.targetPath, truncated};
      } catch {
        cleanupTempFile(fsImpl, paths.tmpPath);
        return {ok: false};
      }
    }

    return {append, finish};
  }

  return {createStreamWriter, writeText};
}

function createOffloadedTextPreview(options: {
  maxPreviewBytes: number;
  strategy: ToolResultPreviewStrategy;
  store?: ToolResultStore;
  text: string;
  truncationMessage?: string;
}): OffloadedTextPreview {
  const maxPreviewBytes = normalizePositiveInteger(options.maxPreviewBytes, 1);

  if (Buffer.byteLength(options.text, 'utf8') <= maxPreviewBytes) {
    return {text: options.text, truncated: false};
  }

  const written = options.store?.writeText(options.text);
  const artifactMarker = written?.ok ? createToolResultTruncationMarker(written.path) : undefined;
  const canExposeArtifact = artifactMarker !== undefined && Buffer.byteLength(artifactMarker, 'utf8') <= maxPreviewBytes;
  const marker = canExposeArtifact ? artifactMarker : options.truncationMessage;
  const boundedMarker = marker ? capUtf8Text(marker, maxPreviewBytes).text : '';
  const markerBytes = Buffer.byteLength(boundedMarker, 'utf8');
  const separator = boundedMarker ? '\n\n' : '';
  const previewBudget = Math.max(0, maxPreviewBytes - markerBytes - Buffer.byteLength(separator, 'utf8'));
  const preview = options.strategy === 'head'
    ? capUtf8Text(options.text, previewBudget).text
    : capUtf8TailText(options.text, previewBudget).text;

  if (!boundedMarker) {
    return {text: preview, truncated: true};
  }

  const text = preview === ''
    ? boundedMarker
    : options.strategy === 'head'
      ? `${preview}${separator}${boundedMarker}`
      : `${boundedMarker}${separator}${preview}`;

  return {
    ...(written?.ok && canExposeArtifact ? {offloadFilePath: written.path} : {}),
    text,
    truncated: true
  };
}

function createToolResultTruncationMarker(filePath: string): string {
  return `${TOOL_RESULT_TRUNCATION_MARKER_PREFIX}${filePath}${TOOL_RESULT_TRUNCATION_MARKER_SUFFIX}`;
}

function capUtf8HeadText(text: string, maxBytes: number): {text: string; truncated: boolean} {
  return capUtf8Text(text, maxBytes);
}

function capUtf8TailText(text: string, maxBytes: number): {text: string; truncated: boolean} {
  return capUtf8TailTextShared(text, maxBytes);
}

function capUtf8HeadBuffer(buffer: Buffer, maxBytes: number): Buffer {
  if (buffer.length <= maxBytes) {
    return buffer;
  }

  const safeEnd = findUtf8HeadEnd(buffer, maxBytes);

  return buffer.subarray(0, safeEnd);
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

function resolveCwd(cwd: CwdOption): string {
  return typeof cwd === 'function' ? cwd() : cwd || process.cwd();
}

function getProjectKey(cwd: string): string {
  return crypto.createHash('sha1').update(String(cwd)).digest('hex');
}

function createArtifactPaths(toolResultsDir: string): {targetPath: string; tmpPath: string} {
  const suffix = `${Date.now()}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const targetPath = path.join(toolResultsDir, `tool-result-${suffix}.txt`);

  return {
    targetPath,
    tmpPath: `${targetPath}.tmp`
  };
}

function cleanupTempFile(fsImpl: Pick<typeof fs, 'rmSync'>, filePath: string): void {
  try {
    fsImpl.rmSync(filePath, {force: true});
  } catch {
    // 清理失败不能影响工具原始结果返回，后续由系统临时文件清理兜底。
  }
}

export {
  DEFAULT_TOOL_RESULT_MAX_ARTIFACT_BYTES,
  createOffloadedTextPreview,
  createToolResultStore,
  createToolResultTruncationMarker,
  capUtf8HeadText,
  capUtf8TailText
};

export type {
  ToolResultStore,
  ToolResultStreamWriter
};
