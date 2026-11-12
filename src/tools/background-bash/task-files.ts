import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

import type {BackgroundTaskStatusSnapshot} from '../../types/background-task';
import type {Result} from '../tool-handler-utils';

const BACKGROUND_TASK_STATUS_VERSION = 1;
const DEFAULT_MAX_LOG_LINE_BYTES = 4096;
const REPLACEMENT_CHARACTER_ESCAPE = '\\uFFFD';

/** 单任务日志写入器;同步写入保证终态发布前日志已经落盘。 */
type BackgroundLogSink = {
  append: (stream: 'stdout' | 'stderr', chunk: Buffer) => void; // 按流解码后合并写入同一文件。
  finish: () => void; // 排空解码器剩余字节并关闭文件。
  isSaturated: () => boolean; // 是否已触及单任务日志上限。
  getWriteError: () => string | null; // 磁盘写入失败原因;失败后不再写入。
};

/** 单个后台任务的文件集合;目录与文件名全部由运行时生成。 */
type BackgroundTaskFiles = {
  dir: string; // 任务私有目录,权限 0700。
  outputPath: string; // output.log 绝对路径。
  statusPath: string; // status.json 绝对路径。
  log: BackgroundLogSink; // 增量日志写入器。
};

type CreateBackgroundTaskFilesOptions = {
  taskId: string; // 实例内稳定短 ID。
  sessionId: string; // 拥有者 session,用于分区。
  ownerInstanceId: string; // 拥有者应用实例,用于分区。
  projectCwd: string; // 项目分区键来源。
  maxLogBytes: number; // 单任务磁盘日志上限。
  rootDir?: string; // 覆盖用户级根目录;缺省 ~/.echo/echo_tui。
  onSaturated: () => void; // 达到日志上限时通知管理器停止任务。
  onWriteError: (reason: string) => void; // 运行期写入失败时通知管理器停止任务。
};

/**
 * 生成任务目录并打开 output.log;启动结果返回前两个文件都必须可读。
 */
function createBackgroundTaskFiles(options: CreateBackgroundTaskFilesOptions): Result<BackgroundTaskFiles> {
  const rootDir = options.rootDir || path.join(os.homedir(), '.echo', 'echo_tui');
  const dir = path.join(
    rootDir,
    'projects',
    getProjectKey(options.projectCwd),
    'background-tasks',
    sanitizeSegment(options.sessionId),
    sanitizeSegment(options.ownerInstanceId),
    sanitizeSegment(options.taskId)
  );
  const outputPath = path.join(dir, 'output.log');
  const statusPath = path.join(dir, 'status.json');
  let fd: number;

  try {
    fs.mkdirSync(dir, {mode: 0o700, recursive: true});
    fd = fs.openSync(outputPath, 'a+', 0o600);
  } catch (error: unknown) {
    return {ok: false, reason: describeError(error, '无法创建后台任务文件')};
  }

  const log = createBackgroundLogSink({
    fd,
    maxBytes: options.maxLogBytes,
    onSaturated: options.onSaturated,
    onWriteError: options.onWriteError
  });

  return {ok: true, value: {dir, log, outputPath, statusPath}};
}

/**
 * 原子替换 status.json;先写同目录临时文件再 rename,读取方只会看到完整 JSON。
 */
function writeBackgroundTaskStatus(statusPath: string, snapshot: BackgroundTaskStatusSnapshot): Result<undefined> {
  const tmpPath = `${statusPath}.tmp`;

  try {
    fs.mkdirSync(path.dirname(statusPath), {mode: 0o700, recursive: true});
    fs.writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
    fs.renameSync(tmpPath, statusPath);
    return {ok: true, value: undefined};
  } catch (error: unknown) {
    try {
      fs.rmSync(tmpPath, {force: true});
    } catch {
      // 临时文件清理失败不影响错误语义,状态文件仍视为不可更新。
    }
    return {ok: false, reason: describeError(error, '无法写入后台任务状态')};
  }
}

/**
 * 读取并校验历史任务的 status.json;不合法时返回 null,由调用方显示不可读取。
 */
function readBackgroundTaskStatus(statusPath: string): BackgroundTaskStatusSnapshot | null {
  let raw: string;

  try {
    raw = fs.readFileSync(statusPath, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return isBackgroundTaskStatusSnapshot(parsed) ? parsed : null;
}

/**
 * 读取日志有界尾部;只用于界面展示,不参与状态判定。
 */
function readBackgroundTaskLogTail(outputPath: string, maxBytes: number): string | null {
  let fd: number;

  try {
    fd = fs.openSync(outputPath, 'r');
  } catch {
    return null;
  }

  try {
    const {size} = fs.fstatSync(fd);
    const start = Math.max(0, size - Math.max(0, maxBytes));
    const buffer = Buffer.alloc(size - start);
    let offset = 0;

    while (offset < buffer.length) {
      const read = fs.readSync(fd, buffer, offset, buffer.length - offset, start + offset);

      if (read <= 0) {
        break;
      }

      offset += read;
    }

    // 从 UTF-8 续字节起读会得到半个码点,跳过它避免尾部出现替换字符。
    let sliceStart = 0;

    while (sliceStart < offset && buffer[sliceStart] >= 0x80 && buffer[sliceStart] <= 0xbf) {
      sliceStart += 1;
    }

    return buffer.subarray(sliceStart, offset).toString('utf8');
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // 只读句柄关闭失败无需上报,展示层已拿到或已放弃内容。
    }
  }
}

/**
 * 创建按行规范化的日志写入器:移除 NUL、转义 U+FFFD,并把超长物理行切到码点边界。
 */
function createBackgroundLogSink(options: {
  fd: number;
  maxBytes: number;
  onSaturated: () => void;
  onWriteError: (reason: string) => void;
}): BackgroundLogSink {
  const decoders = {stderr: new StringDecoder('utf8'), stdout: new StringDecoder('utf8')};
  let lineBytes = 0;
  let bytesWritten = 0;
  let saturated = false;
  let closed = false;
  let writeError: string | null = null;
  let saturationNotified = false;

  const failWith = (reason: string) => {
    if (writeError) {
      return;
    }

    writeError = reason;
    closeFile();
    options.onWriteError(reason);
  };
  const closeFile = () => {
    if (closed) {
      return;
    }

    closed = true;

    try {
      fs.closeSync(options.fd);
    } catch {
      // 已经写失败时关闭异常不再改变结论。
    }
  };
  const write = (text: string) => {
    if (writeError || closed || saturated || text === '') {
      return;
    }

    const buffer = Buffer.from(text, 'utf8');
    const remaining = options.maxBytes - bytesWritten;

    if (buffer.length <= remaining) {
      writeBuffer(buffer);
      return;
    }

    if (remaining > 0) {
      writeBuffer(buffer.subarray(0, findUtf8HeadEnd(buffer, remaining)));
    }

    saturated = true;

    if (!saturationNotified) {
      saturationNotified = true;
      options.onSaturated();
    }
  };
  const writeBuffer = (buffer: Buffer) => {
    if (buffer.length === 0) {
      return;
    }

    try {
      let offset = 0;

      while (offset < buffer.length) {
        const written = fs.writeSync(options.fd, buffer, offset, buffer.length - offset);

        if (written <= 0) {
          throw new Error('failed to write background task log');
        }

        offset += written;
      }

      bytesWritten += buffer.length;
    } catch (error: unknown) {
      failWith(describeError(error, '无法写入后台任务日志'));
    }
  };
  /**
   * 已解码文本立即落盘,只维护当前行字节数;等于把"未换行输出"当成正常增量,而不是攒到换行才写。
   */
  const pushText = (text: string) => {
    let remaining = text;

    while (remaining !== '') {
      const budget = DEFAULT_MAX_LOG_LINE_BYTES - lineBytes;
      const segmentBytes = Buffer.byteLength(remaining, 'utf8');

      if (segmentBytes <= budget) {
        write(remaining);
        lineBytes += segmentBytes;
        return;
      }

      const cut = findCutIndex(remaining, budget);

      if (cut <= 0) {
        // 行预算已被占满:先补换行,再从新行继续同一段内容。
        write('\n');
        lineBytes = 0;
        continue;
      }

      write(remaining.slice(0, cut));
      write('\n');
      lineBytes = 0;
      remaining = remaining.slice(cut);
    }
  };
  const pushDecoded = (decoded: string) => {
    if (decoded === '') {
      return;
    }

    const parts = normalizeLogText(decoded).split('\n');

    for (let index = 0; index < parts.length; index += 1) {
      pushText(parts[index]);

      if (index < parts.length - 1) {
        write('\n');
        lineBytes = 0;
      }
    }
  };

  return {
    append(stream, chunk) {
      if (writeError || closed || saturated || chunk.length === 0) {
        return;
      }

      pushDecoded(decoders[stream].write(chunk));
    },
    finish() {
      if (writeError || closed) {
        return;
      }

      pushDecoded(decoders.stdout.end());
      pushDecoded(decoders.stderr.end());

      closeFile();
    },
    isSaturated: () => saturated,
    getWriteError: () => writeError
  };
}

/** 移除 NUL 并把替换字符转成可见字面文本;read_files 会拒绝含这两种字符的文本行。 */
function normalizeLogText(text: string): string {
  return text.split('\0').join('').split('\uFFFD').join(REPLACEMENT_CHARACTER_ESCAPE);
}

function findCutIndex(text: string, budget: number): number {
  let used = 0;
  let index = 0;

  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf8');

    if (used + characterBytes > budget) {
      return index;
    }

    used += characterBytes;
    index += character.length;
  }

  return index;
}

function findUtf8HeadEnd(buffer: Buffer, maxBytes: number): number {
  let end = Math.max(0, Math.min(maxBytes, buffer.length));

  if (end >= buffer.length) {
    return buffer.length;
  }

  while (end > 0 && buffer[end] >= 0x80 && buffer[end] <= 0xbf) {
    end -= 1;
  }

  return end;
}

/** 目录层级只接受安全字符,避免 session/实例/任务 ID 影响路径结构。 */
function sanitizeSegment(value: string): string {
  const normalized = String(value).replace(/[^A-Za-z0-9._-]/gu, '_');
  return normalized === '' || normalized === '.' || normalized === '..' ? 'unnamed' : normalized;
}

function getProjectKey(cwd: string): string {
  return crypto.createHash('sha1').update(String(cwd)).digest('hex');
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? `${fallback}: ${error.message}` : fallback;
}

function isBackgroundTaskStatusSnapshot(value: unknown): value is BackgroundTaskStatusSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return value.version === BACKGROUND_TASK_STATUS_VERSION &&
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.ownerInstanceId) &&
    typeof value.command === 'string' &&
    isNonEmptyString(value.cwd) &&
    isTaskState(value.state) &&
    isNonEmptyString(value.startedAt) &&
    (value.finishedAt === null || isNonEmptyString(value.finishedAt)) &&
    (value.exitCode === null || typeof value.exitCode === 'number') &&
    (value.signal === null || typeof value.signal === 'string') &&
    (value.reason === null || typeof value.reason === 'string') &&
    isNonEmptyString(value.outputPath) &&
    typeof value.outputTruncated === 'boolean';
}

function isTaskState(value: unknown): boolean {
  return value === 'running' || value === 'stopping' || value === 'exited' || value === 'stopped' || value === 'failed';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export {
  BACKGROUND_TASK_STATUS_VERSION,
  createBackgroundTaskFiles,
  normalizeLogText,
  readBackgroundTaskLogTail,
  readBackgroundTaskStatus,
  writeBackgroundTaskStatus
};

export type {
  BackgroundLogSink,
  BackgroundTaskFiles,
  CreateBackgroundTaskFilesOptions
};
