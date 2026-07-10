import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {ChangeCheckpoint} from '../types/change-history';
import type {
  CompactionState,
  TodoState,
  TranscriptProjectMetadata,
  TranscriptRecord,
  TranscriptSession,
  TranscriptSessionMetadata,
  TranscriptSessionPreviewRecord,
  TranscriptStore
} from '../types/transcript';

const STORE_SCHEMA_VERSION = 1;
const SESSION_PREVIEW_RECORD_LIMIT = 20;
const SESSION_PREVIEW_TEXT_LIMIT = 500;

type TranscriptStoreOptions = {
  rootDir?: string;
  fsImpl?: typeof fs;
  osImpl?: Pick<typeof os, 'homedir'>;
  cryptoImpl?: Pick<typeof crypto, 'createHash'>;
};

type SessionInput = {
  schemaVersion?: number;
  sessionId: string;
  createdAt: string;
  updatedAt?: string;
  records: TranscriptRecord[];
  changeHistory?: ChangeCheckpoint[];
  compaction?: CompactionState;
  todoState?: TodoState;
};

/**
 * 创建 transcript store，负责按 cwd 分区保存和读取本地 session。
 */
function createTranscriptStore(options: TranscriptStoreOptions = {}): TranscriptStore {
  const fsImpl = options.fsImpl || fs;
  const osImpl = options.osImpl || os;
  const cryptoImpl = options.cryptoImpl || crypto;
  const rootDir = options.rootDir || path.join(osImpl.homedir(), '.echo', 'echo_tui');

  /**
   * 返回默认 transcript store 根目录，便于文档和测试复用同一来源。
   */
  function getDefaultRootDir(): string {
    return rootDir;
  }

  /**
   * 生成当前 cwd 对应的稳定项目 key，避免真实路径直接出现在目录层级里。
   */
  function getProjectKey(cwd: string): string {
    return cryptoImpl.createHash('sha1').update(String(cwd)).digest('hex');
  }

  /**
   * 返回当前 cwd 在 store 中的项目目录路径。
   */
  function getProjectDir(cwd: string): string {
    return path.join(rootDir, 'projects', getProjectKey(cwd));
  }

  /**
   * 返回项目 metadata，便于调试和后续展示真实 cwd。
   */
  function getProjectMetadata(cwd: string): TranscriptProjectMetadata {
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      cwd: String(cwd),
      cwdHash: getProjectKey(cwd)
    };
  }

  /**
   * 返回当前 cwd 下的 session 文件路径。
   */
  function getSessionFilePath(cwd: string, sessionId: string): string {
    return path.join(getProjectDir(cwd), 'sessions', `${sessionId}.json`);
  }

  /**
   * 创建新的 session 对象，供 app 在首次提交普通消息时启用。
   */
  function createSession(cwd: string, records: TranscriptRecord[] = [], now = createTimestamp()): TranscriptSession {
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      sessionId: createSessionId(now),
      cwd: String(cwd),
      createdAt: now,
      updatedAt: now,
      records: cloneRecords(records)
    };
  }

  /**
   * 读取并按更新时间倒序返回当前 cwd 下可恢复的 session metadata。
   */
  function listSessions(cwd: string): TranscriptSessionMetadata[] {
    const sessionsDir = path.join(getProjectDir(cwd), 'sessions');

    if (!fsImpl.existsSync(sessionsDir)) {
      return [];
    }

    return fsImpl.readdirSync(sessionsDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => safelyReadSession(path.join(sessionsDir, fileName), cwd))
      .filter((session): session is TranscriptSession => session !== null)
      .map((session) => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        cwd: session.cwd,
        messageCount: session.records.length,
        lastMessagePreview: createLastMessagePreview(session.records),
        previewRecords: createSessionPreviewRecords(session.records)
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /**
   * 加载某个 session 的完整记录；不存在或无效时返回 null。
   */
  function loadSession(cwd: string, sessionId: string): TranscriptSession | null {
    return safelyReadSession(getSessionFilePath(cwd, sessionId), cwd);
  }

  /**
   * 保存 session，并使用临时文件 + rename 保证单文件写入的原子性。
   */
  function saveSession(cwd: string, session: TranscriptSession): TranscriptSession {
    const inputSession = session as SessionInput;
    const changeHistory = cloneChangeHistory(inputSession.changeHistory);
    const normalizedSession: TranscriptSession = {
      schemaVersion: STORE_SCHEMA_VERSION,
      sessionId: String(inputSession.sessionId),
      cwd: String(cwd),
      createdAt: String(inputSession.createdAt),
      updatedAt: String(inputSession.updatedAt || createTimestamp()),
      records: cloneRecords(inputSession.records || []),
      ...(changeHistory.length > 0 ? {changeHistory} : {}),
      ...(inputSession.compaction ? {compaction: {...inputSession.compaction}} : {}),
      ...(isTodoStateShape(inputSession.todoState) ? {todoState: cloneTodoState(inputSession.todoState)} : {})
    };
    const projectDir = getProjectDir(cwd);
    const sessionsDir = path.join(projectDir, 'sessions');
    const metadataPath = path.join(projectDir, 'project.json');
    const targetPath = getSessionFilePath(cwd, normalizedSession.sessionId);
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

    fsImpl.mkdirSync(sessionsDir, {recursive: true});
    fsImpl.writeFileSync(metadataPath, JSON.stringify(getProjectMetadata(cwd), null, 2));
    fsImpl.writeFileSync(tmpPath, JSON.stringify(normalizedSession, null, 2));
    fsImpl.renameSync(tmpPath, targetPath);

    return normalizedSession;
  }

  /**
   * 安全读取 session 文件；只接受当前 schemaVersion 和匹配 cwd 的数据。
   */
  function safelyReadSession(filePath: string, cwd: string): TranscriptSession | null {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(filePath, 'utf8')) as unknown;

      if (!isTranscriptSessionShape(parsed) || parsed.schemaVersion !== STORE_SCHEMA_VERSION || parsed.cwd !== String(cwd)) {
        return null;
      }

      return {
        schemaVersion: STORE_SCHEMA_VERSION,
        sessionId: parsed.sessionId,
        cwd: parsed.cwd,
        createdAt: String(parsed.createdAt),
        updatedAt: String(parsed.updatedAt),
        records: cloneRecords(parsed.records),
        ...(Array.isArray(parsed.changeHistory) && parsed.changeHistory.length > 0 ? {changeHistory: cloneChangeHistory(parsed.changeHistory)} : {}),
        ...(isCompactionShape(parsed.compaction) ? {compaction: {...parsed.compaction}} : {}),
        todoState: isTodoStateShape(parsed.todoState) ? cloneTodoState(parsed.todoState) : createEmptyTodoState()
      };
    } catch (_error: unknown) {
      return null;
    }
  }

  return {
    createSession,
    getDefaultRootDir,
    getProjectDir,
    getProjectMetadata,
    getSessionFilePath,
    listSessions,
    loadSession,
    saveSession
  };
}

/**
 * 生成新的 session id，兼顾时间可读性和同秒内唯一性。
 */
function createSessionId(timestamp: string): string {
  return `${String(timestamp).replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * 生成 ISO 时间戳，统一 session 与 record 的时间来源。
 */
function createTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 克隆 transcript records，避免 store 输出与 app 内部状态共享引用。
 */
function cloneRecords(records: TranscriptRecord[]): TranscriptRecord[] {
  return records.map((record) => ({...record}));
}

function createEmptyTodoState(): TodoState {
  return {
    items: [],
    updatedAt: ''
  };
}

function cloneTodoState(todoState: TodoState): TodoState {
  return {
    updatedAt: String(todoState.updatedAt || ''),
    items: todoState.items.map((item) => ({
      id: String(item.id),
      text: String(item.text),
      status: item.status
    }))
  };
}

function cloneChangeHistory(history: ChangeCheckpoint[] | null | undefined): ChangeCheckpoint[] {
  return (history || []).map((checkpoint) => ({
    ...checkpoint,
    ...(checkpoint.compactionBefore ? {compactionBefore: {...checkpoint.compactionBefore}} : {}),
    files: checkpoint.files.map((entry) => ({
      ...entry,
      snapshot: {...entry.snapshot}
    }))
  }));
}

function isCompactionShape(value: unknown): value is CompactionState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'summaryText' in value &&
    typeof (value as CompactionState).summaryText === 'string' &&
    'activeStartIndex' in value &&
    typeof (value as CompactionState).activeStartIndex === 'number'
  );
}

function isTodoStateShape(value: unknown): value is TodoState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<TodoState>;

  return Array.isArray(candidate.items) &&
    candidate.items.every(isTodoItemShape) &&
    (candidate.updatedAt === undefined || typeof candidate.updatedAt === 'string');
}

function isTodoItemShape(value: unknown): value is TodoState['items'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<TodoState['items'][number]>;

  return typeof candidate.id === 'string' &&
    candidate.id.trim() !== '' &&
    typeof candidate.text === 'string' &&
    candidate.text.trim() !== '' &&
    (candidate.status === 'open' || candidate.status === 'completed');
}

function isTranscriptSessionShape(value: unknown): value is TranscriptSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    'sessionId' in value &&
    typeof value.sessionId === 'string' &&
    'cwd' in value &&
    typeof value.cwd === 'string' &&
    'createdAt' in value &&
    'updatedAt' in value &&
    'records' in value &&
    Array.isArray(value.records)
  );
}

/**
 * 为 session 列表生成最后一条消息摘要，用于 `/resume` 选择列表说明文字。
 */
function createLastMessagePreview(records: TranscriptRecord[]): string {
  if (!records.length) {
    return '空会话';
  }

  const lastRecord = records[records.length - 1];
  return String(lastRecord.text || '').replace(/\s+/g, ' ').slice(0, 60);
}

/**
 * 为恢复面板生成最近消息摘要；只派生展示数据，不改变持久化 records。
 */
function createSessionPreviewRecords(records: TranscriptRecord[]): TranscriptSessionPreviewRecord[] {
  const previewRecords: TranscriptSessionPreviewRecord[] = [];

  for (let index = records.length - 1; index >= 0 && previewRecords.length < SESSION_PREVIEW_RECORD_LIMIT; index -= 1) {
    const record = records[index];
    const text = normalizePreviewText(record.text).slice(0, SESSION_PREVIEW_TEXT_LIMIT);

    if (text.length === 0) {
      continue;
    }

    previewRecords.push({
      role: record.role,
      text,
      ...(record.createdAt ? {createdAt: String(record.createdAt)} : {})
    });
  }

  return previewRecords.reverse();
}

/**
 * 归一化预览文本，避免换行和连续空白破坏两栏布局。
 */
function normalizePreviewText(text: unknown): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export {
  STORE_SCHEMA_VERSION,
  createTranscriptStore
};
