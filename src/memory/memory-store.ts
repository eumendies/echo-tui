import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {UserMemory, UserMemoryMutationResult, UserMemoryReadResult} from '../types/memory';

const MEMORY_FILE_NAME = 'memories.json';
const MEMORY_FILE_VERSION = 1;

type MemoryStoreOptions = {
  createId?: () => string;
  createTempPath?: (targetPath: string) => string;
  getNow?: () => Date;
  homedir?: () => string;
  mkdir?: typeof fs.mkdirSync;
  readFile?: typeof fs.readFileSync;
  rename?: typeof fs.renameSync;
  storagePath?: string;
  writeFile?: typeof fs.writeFileSync;
};

type MemoryFile = {
  version: number;
  memories: UserMemory[];
};

function getDefaultUserMemoryPath(): string {
  return path.join(os.homedir(), '.echo', MEMORY_FILE_NAME);
}

/**
 * 读取用户显式维护的 memory；文件缺失是正常空状态，其他格式错误必须显式反馈以免覆盖用户文件。
 */
function readUserMemories(options: MemoryStoreOptions = {}): UserMemoryReadResult {
  const targetPath = getStoragePath(options);
  const readFile = options.readFile || fs.readFileSync;
  let raw: string;

  try {
    raw = readFile(targetPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return {ok: true, memories: []};
    }

    return {ok: false, error: `无法读取 memory 文件：${formatError(error)}`};
  }

  try {
    return {ok: true, memories: parseMemoryFile(JSON.parse(raw), targetPath).memories};
  } catch (error: unknown) {
    return {ok: false, error: formatError(error)};
  }
}

/**
 * 创建一个 memory 条目并立即落盘；读取失败时不尝试写入，避免覆盖无效的手工文件。
 */
function createUserMemory(content: string, options: MemoryStoreOptions = {}): UserMemoryMutationResult {
  const normalizedContent = normalizeMemoryContent(content);

  if (normalizedContent === '') {
    return {ok: false, error: 'memory 内容不能为空'};
  }

  const current = readUserMemories(options);

  if (!current.ok) {
    return current;
  }

  const timestamp = (options.getNow || (() => new Date()))().toISOString();
  const memory: UserMemory = {
    id: (options.createId || crypto.randomUUID)(),
    content: normalizedContent,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const memories = [...current.memories, memory];
  return saveUserMemories(memories, options);
}

function updateUserMemory(id: string, content: string, options: MemoryStoreOptions = {}): UserMemoryMutationResult {
  const normalizedContent = normalizeMemoryContent(content);

  if (normalizedContent === '') {
    return {ok: false, error: 'memory 内容不能为空'};
  }

  const current = readUserMemories(options);

  if (!current.ok) {
    return current;
  }

  const index = current.memories.findIndex((memory) => memory.id === id);

  if (index < 0) {
    return {ok: false, error: '要编辑的 memory 不存在'};
  }

  const updatedAt = (options.getNow || (() => new Date()))().toISOString();
  const memories = current.memories.map((memory, memoryIndex) => memoryIndex === index
    ? {...memory, content: normalizedContent, updatedAt}
    : memory);
  return saveUserMemories(memories, options);
}

function deleteUserMemory(id: string, options: MemoryStoreOptions = {}): UserMemoryMutationResult {
  const current = readUserMemories(options);

  if (!current.ok) {
    return current;
  }

  const memories = current.memories.filter((memory) => memory.id !== id);

  if (memories.length === current.memories.length) {
    return {ok: false, error: '要删除的 memory 不存在'};
  }

  return saveUserMemories(memories, options);
}

function setUserMemoryEnabled(id: string, enabled: boolean, options: MemoryStoreOptions = {}): UserMemoryMutationResult {
  const current = readUserMemories(options);

  if (!current.ok) {
    return current;
  }

  const index = current.memories.findIndex((memory) => memory.id === id);

  if (index < 0) {
    return {ok: false, error: '要更新的 memory 不存在'};
  }

  const updatedAt = (options.getNow || (() => new Date()))().toISOString();
  const memories = current.memories.map((memory, memoryIndex) => memoryIndex === index
    ? {...memory, enabled: Boolean(enabled), updatedAt}
    : memory);
  return saveUserMemories(memories, options);
}

function saveUserMemories(memories: UserMemory[], options: MemoryStoreOptions = {}): UserMemoryMutationResult {
  const targetPath = getStoragePath(options);
  const mkdir = options.mkdir || fs.mkdirSync;
  const writeFile = options.writeFile || fs.writeFileSync;
  const rename = options.rename || fs.renameSync;
  const tempPath = (options.createTempPath || ((filePath: string) => `${filePath}.tmp-${process.pid}-${Date.now()}`))(targetPath);
  const file: MemoryFile = {version: MEMORY_FILE_VERSION, memories: memories.map((memory) => ({...memory}))};

  try {
    mkdir(path.dirname(targetPath), {recursive: true});
    writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    rename(tempPath, targetPath);
    return {ok: true, memories: file.memories};
  } catch (error: unknown) {
    return {ok: false, error: `无法保存 memory 文件：${formatError(error)}`};
  }
}

function parseMemoryFile(value: unknown, filePath: string): MemoryFile {
  if (!isPlainObject(value)) {
    throw new Error(`memory 文件根节点必须是对象：${filePath}`);
  }

  if (value.version !== MEMORY_FILE_VERSION) {
    throw new Error(`memory 文件版本必须是 ${MEMORY_FILE_VERSION}：${filePath}`);
  }

  if (!Array.isArray(value.memories)) {
    throw new Error(`memory 文件缺少 memories 数组：${filePath}`);
  }

  const memories = value.memories.map((memory, index) => parseUserMemory(memory, index));
  const ids = new Set(memories.map((memory) => memory.id));

  if (ids.size !== memories.length) {
    throw new Error(`memory 文件包含重复 id：${filePath}`);
  }

  return {version: MEMORY_FILE_VERSION, memories};
}

function parseUserMemory(value: unknown, index: number): UserMemory {
  if (!isPlainObject(value) || typeof value.id !== 'string' || value.id.trim() === '' || typeof value.content !== 'string' || normalizeMemoryContent(value.content) === '' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || (value.enabled !== undefined && typeof value.enabled !== 'boolean')) {
    throw new Error(`memory 条目 #${index + 1} 无效`);
  }

  return {
    id: value.id,
    content: normalizeMemoryContent(value.content),
    enabled: value.enabled === undefined ? true : value.enabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function getStoragePath(options: MemoryStoreOptions): string {
  return options.storagePath || path.join((options.homedir || os.homedir)(), '.echo', MEMORY_FILE_NAME);
}

function normalizeMemoryContent(content: string): string {
  return String(content).replace(/\r\n?/g, '\n').trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  MEMORY_FILE_NAME,
  MEMORY_FILE_VERSION,
  createUserMemory,
  deleteUserMemory,
  getDefaultUserMemoryPath,
  readUserMemories,
  saveUserMemories,
  setUserMemoryEnabled,
  updateUserMemory
};

export type {MemoryStoreOptions};
