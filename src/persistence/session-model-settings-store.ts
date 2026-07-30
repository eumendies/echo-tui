import fs from 'node:fs';
import path from 'node:path';

import {REASONING_EFFORTS} from '../types/agent';

import type {ReasoningEffort} from '../types/agent';
import type {
  SessionModelSettings,
  SessionModelSettingsInput,
  SessionModelSettingsReadResult,
  SessionModelSettingsStore
} from '../types/session-model-settings';
import type {TranscriptStore} from '../types/transcript';

const SESSION_MODEL_SETTINGS_SCHEMA_VERSION = 1 as const;

type SessionModelSettingsStoreOptions = {
  createTempPath?: (targetPath: string) => string; // 注入临时文件命名，测试可验证原子替换路径。
  mkdir?: (dirPath: string, options: {recursive: boolean}) => unknown; // 创建 sidecar 所在 session 目录。
  readFile?: (filePath: string, encoding: BufferEncoding) => string; // 读取 UTF-8 settings 内容。
  rename?: (oldPath: string, newPath: string) => unknown; // 将完整临时文件原子替换到目标路径。
  writeFile?: (filePath: string, data: string) => unknown; // 写入格式化后的完整 settings JSON。
};

/**
 * 创建只保存当前 model/effort 的 session sidecar store；恢复失败由读取结果分类，不污染 transcript journal。
 */
function createSessionModelSettingsStore(transcriptStore: Pick<TranscriptStore, 'getSessionFilePath'>, options: SessionModelSettingsStoreOptions = {}): SessionModelSettingsStore {
  const createTempPath = options.createTempPath || ((targetPath: string) => `${targetPath}.tmp-${process.pid}-${Date.now()}`);
  const mkdir = options.mkdir || fs.mkdirSync;
  const readFile = options.readFile || fs.readFileSync;
  const rename = options.rename || fs.renameSync;
  const writeFile = options.writeFile || fs.writeFileSync;

  function getFilePath(cwd: string, sessionId: string): string {
    const journalPath = transcriptStore.getSessionFilePath(cwd, sessionId);
    return journalPath.slice(0, -path.extname(journalPath).length) + '.settings.json';
  }

  function read(cwd: string, sessionId: string): SessionModelSettingsReadResult {
    let source: string;

    try {
      source = readFile(getFilePath(cwd, sessionId), 'utf8');
    } catch (error: unknown) {
      return isNodeErrorCode(error, 'ENOENT') ? {kind: 'missing'} : {kind: 'invalid'};
    }

    try {
      const parsed: unknown = JSON.parse(source);
      return isSessionModelSettings(parsed, sessionId)
        ? {kind: 'found', settings: {...parsed}}
        : {kind: 'invalid'};
    } catch {
      return {kind: 'invalid'};
    }
  }

  function write(cwd: string, input: SessionModelSettingsInput, updatedAt = new Date().toISOString()): SessionModelSettings {
    const targetPath = getFilePath(cwd, input.sessionId);
    const tempPath = createTempPath(targetPath);
    const settings: SessionModelSettings = {
      schemaVersion: SESSION_MODEL_SETTINGS_SCHEMA_VERSION,
      sessionId: normalizeRequiredString(input.sessionId, 'sessionId'),
      modelProfileId: normalizeRequiredString(input.modelProfileId, 'modelProfileId'),
      ...(input.reasoningEffortOverride !== undefined ? {reasoningEffortOverride: input.reasoningEffortOverride} : {}),
      updatedAt: normalizeRequiredString(updatedAt, 'updatedAt')
    };

    if (settings.reasoningEffortOverride !== undefined && !isReasoningEffort(settings.reasoningEffortOverride)) {
      throw new Error('Session model settings reasoningEffortOverride 无效');
    }

    mkdir(path.dirname(targetPath), {recursive: true});
    writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`);
    rename(tempPath, targetPath);
    return {...settings};
  }

  return {getFilePath, read, write};
}

function isSessionModelSettings(value: unknown, expectedSessionId: string): value is SessionModelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const settings = value as Record<string, unknown>;
  return settings.schemaVersion === SESSION_MODEL_SETTINGS_SCHEMA_VERSION &&
    settings.sessionId === expectedSessionId &&
    typeof settings.modelProfileId === 'string' && settings.modelProfileId.trim() !== '' &&
    typeof settings.updatedAt === 'string' && settings.updatedAt.trim() !== '' &&
    (settings.reasoningEffortOverride === undefined || isReasoningEffort(settings.reasoningEffortOverride));
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw new Error(`Session model settings ${fieldName} 不能为空`);
  }

  return normalized;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

export {
  SESSION_MODEL_SETTINGS_SCHEMA_VERSION,
  createSessionModelSettingsStore
};

export type {
  SessionModelSettingsStoreOptions
};
