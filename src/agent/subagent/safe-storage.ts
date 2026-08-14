import {createHash, randomUUID} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

type SafeStorageOperations = {
  close?: typeof fs.closeSync; // 关闭安全读取或排他占位使用的文件描述符。
  fstat?: typeof fs.fstatSync; // 在不跟随路径替换的文件描述符上确认普通文件身份。
  lstat?: typeof fs.lstatSync; // 检查目录组件、符号链接和非普通目标。
  mkdir?: typeof fs.mkdirSync; // 逐层创建受控的固定存储目录。
  open?: typeof fs.openSync; // 以 no-follow 或排他模式打开目标。
  readFile?: typeof fs.readFileSync; // 从已验证文件描述符读取完整 UTF-8 内容。
  rename?: typeof fs.renameSync; // 将同目录完整临时文件原子替换到目标。
  unlink?: typeof fs.unlinkSync; // 清理临时文件、创建占位或删除正式文件。
  writeFile?: typeof fs.writeFileSync; // 以排他模式写入完整临时内容。
};

type SafeFileReadResult =
  | {kind: 'missing'} // 路径不存在时不携带内容或指纹。
  | {code: string; kind: 'unsafe'; message: string} // 符号链接、非普通文件或读取失败均不可用于管理写入。
  | {content: string; fingerprint: string; kind: 'file'}; // 普通文件返回原文及 SHA-256 内容指纹。

type SafeDirectoryReadResult =
  | {kind: 'missing'} // 任一固定目录组件不存在时视为尚未创建。
  | {kind: 'safe'; path: string} // 全部组件均为真实目录时返回最终绝对路径。
  | {code: string; kind: 'unsafe'; message: string}; // 符号链接、非目录或检查失败时拒绝继续访问。

/** 计算带算法前缀的稳定内容指纹，供跨读取与写入的乐观冲突检查。 */
function createContentFingerprint(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

/**
 * 不跟随最终路径的符号链接读取普通文件。
 * 读取基于文件描述符完成，避免 lstat 与 readFile 之间切换到目录外目标。
 */
function readRegularFile(filePath: string, operations: SafeStorageOperations = {}, maxBytes?: number): SafeFileReadResult {
  const open = operations.open || fs.openSync;
  const fstat = operations.fstat || fs.fstatSync;
  const readFile = operations.readFile || fs.readFileSync;
  const close = operations.close || fs.closeSync;
  let descriptor: number | undefined;

  try {
    descriptor = open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stats = fstat(descriptor);
    if (!stats.isFile()) {
      return {kind: 'unsafe', code: 'not_regular_file', message: 'Managed path is not a regular file.'};
    }
    if (maxBytes !== undefined && stats.size > maxBytes) {
      return {kind: 'unsafe', code: 'file_too_large', message: `Managed file exceeds ${maxBytes} bytes.`};
    }
    const content = readFile(descriptor, 'utf8') as string;
    if (maxBytes !== undefined && Buffer.byteLength(content, 'utf8') > maxBytes) {
      return {kind: 'unsafe', code: 'file_too_large', message: `Managed file exceeds ${maxBytes} UTF-8 bytes.`};
    }
    return {kind: 'file', content, fingerprint: createContentFingerprint(content)};
  } catch (error: unknown) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return {kind: 'missing'};
    }
    if (isNodeErrorCode(error, 'ELOOP')) {
      return {kind: 'unsafe', code: 'symbolic_link', message: 'Managed path must not be a symbolic link.'};
    }
    return {kind: 'unsafe', code: 'file_unreadable', message: 'Managed file could not be safely read.'};
  } finally {
    if (descriptor !== undefined) {
      try {
        close(descriptor);
      } catch {
        // 读取结果不因 close 失败泄露异常细节。
      }
    }
  }
}

/**
 * 逐层创建固定目录并拒绝符号链接或非目录组件。
 * 调用方只能传入由可信 scope 根拼接出的目录，不接收用户提供的相对路径。
 */
function ensureSafeDirectory(rootPath: string, childSegments: readonly string[], operations: SafeStorageOperations = {}): string {
  const lstat = operations.lstat || fs.lstatSync;
  const mkdir = operations.mkdir || fs.mkdirSync;
  let current = path.resolve(rootPath);

  for (const segment of childSegments) {
    current = path.join(current, segment);
    try {
      mkdir(current);
    } catch (error: unknown) {
      if (!isNodeErrorCode(error, 'EEXIST')) {
        throw error;
      }
    }
    const stats = lstat(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Managed storage directory must be a real directory.');
    }
  }
  return current;
}

/** 只检查既有固定目录链，不创建目录且不跟随符号链接。 */
function inspectSafeDirectory(rootPath: string, childSegments: readonly string[], operations: SafeStorageOperations = {}): SafeDirectoryReadResult {
  const lstat = operations.lstat || fs.lstatSync;
  let current = path.resolve(rootPath);

  for (const segment of childSegments) {
    current = path.join(current, segment);
    try {
      const stats = lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        return {kind: 'unsafe', code: 'unsafe_directory', message: 'Managed storage directory must be a real directory.'};
      }
    } catch (error: unknown) {
      if (isNodeErrorCode(error, 'ENOENT')) {
        return {kind: 'missing'};
      }
      return {kind: 'unsafe', code: 'directory_unreadable', message: 'Managed storage directory could not be safely inspected.'};
    }
  }
  return {kind: 'safe', path: current};
}

/**
 * 通过同目录隐藏临时文件完整写入后原子 rename。
 * create=true 时先以 wx 占位，确保不会覆盖确认后才出现的目标；所有失败路径尽力清理。
 */
function atomicWriteFile(
  targetPath: string,
  content: string,
  create: boolean,
  operations: SafeStorageOperations = {}
): void {
  const writeFile = operations.writeFile || fs.writeFileSync;
  const open = operations.open || fs.openSync;
  const close = operations.close || fs.closeSync;
  const rename = operations.rename || fs.renameSync;
  const unlink = operations.unlink || fs.unlinkSync;
  const tempPath = path.join(path.dirname(targetPath), `.echo-agent-tmp-${process.pid}-${randomUUID()}`);
  let reservedTarget = false;

  try {
    writeFile(tempPath, content, {encoding: 'utf8', flag: 'wx', mode: 0o600});
    if (create) {
      const descriptor = open(targetPath, 'wx', 0o600);
      reservedTarget = true;
      close(descriptor);
    }
    rename(tempPath, targetPath);
    reservedTarget = false;
  } catch (error: unknown) {
    try {
      unlink(tempPath);
    } catch {
      // 临时文件可能尚未创建或已经被 rename。
    }
    if (reservedTarget) {
      try {
        unlink(targetPath);
      } catch {
        // 占位清理失败由原始写入错误代表，后续读取仍会把空文件标为无效。
      }
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export {atomicWriteFile, createContentFingerprint, ensureSafeDirectory, inspectSafeDirectory, readRegularFile};
export type {SafeDirectoryReadResult, SafeFileReadResult, SafeStorageOperations};
