import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  createTranscriptJournalEntry,
  createTranscriptJournalStart,
  replayTranscriptJournal,
  serializeTranscriptJournalLine
} from './transcript-journal';

import type {
  LoadedTranscriptSession,
  SubagentTranscriptRecord,
  TranscriptRecord,
  TranscriptJournalOperation,
  TranscriptProjectMetadata,
  TranscriptSessionIndex,
  TranscriptSessionSummary,
  TranscriptSessionPreview,
  TranscriptSessionJournalReference,
  TranscriptStore
} from '../types/transcript';

const STORE_SCHEMA_VERSION = 1 as const;
const SESSION_INDEX_SCHEMA_VERSION = 1 as const;
const SESSION_PREVIEW_RECORD_LIMIT = 20;
const SESSION_PREVIEW_TEXT_LIMIT = 500;

type TranscriptStoreOptions = {
  rootDir?: string;
  fsImpl?: typeof fs;
  osImpl?: Pick<typeof os, 'homedir'>;
  cryptoImpl?: Pick<typeof crypto, 'createHash' | 'randomBytes'>;
};

/**
 * 创建 transcript store，负责按 cwd 分区追加和重放 session journal。
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
   * 返回当前 cwd 下 session journal 的路径。
   */
  function getSessionFilePath(cwd: string, sessionId: string): string {
    return path.join(getProjectDir(cwd), 'sessions', `${sessionId}.jsonl`);
  }

  /** 返回当前项目轻量 session index 的固定路径。 */
  function getSessionIndexFilePath(cwd: string): string {
    return path.join(getProjectDir(cwd), 'sessions', 'index.json');
  }

  /**
   * 原子创建包含首个操作的 journal，避免中断时留下只有 header 的空 session。
   */
  function createSession(cwd: string, operation: TranscriptJournalOperation, now = createTimestamp()): TranscriptSessionJournalReference {
    const createdAt = now;
    const sessionId = createSessionId(createdAt, cryptoImpl);
    const normalizedCwd = String(cwd);
    const reference: TranscriptSessionJournalReference = {
      sessionId,
      cwd: normalizedCwd,
      createdAt,
      updatedAt: now,
      sequence: 1
    };
    const projectDir = getProjectDir(normalizedCwd);
    const sessionsDir = path.join(projectDir, 'sessions');
    const targetPath = getSessionFilePath(normalizedCwd, sessionId);
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    const journal = [
      serializeTranscriptJournalLine(createTranscriptJournalStart(sessionId, normalizedCwd, createdAt)),
      serializeTranscriptJournalLine(createTranscriptJournalEntry(operation, reference.sequence, now)),
      ''
    ].join('\n');

    fsImpl.mkdirSync(sessionsDir, {recursive: true});
    ensureProjectMetadata(projectDir, normalizedCwd);
    fsImpl.writeFileSync(tmpPath, journal, 'utf8');
    fsImpl.renameSync(tmpPath, targetPath);

    return reference;
  }

  /**
   * 向既有 journal 追加一个完整操作行；调用方持有 seq，避免为写入反复扫描历史。
   */
  function appendSession(cwd: string, reference: TranscriptSessionJournalReference, operation: TranscriptJournalOperation, now = createTimestamp()): TranscriptSessionJournalReference {
    const normalizedCwd = String(cwd);

    if (reference.cwd !== normalizedCwd) {
      throw new Error('Session cwd does not match append cwd.');
    }

    const nextSequence = reference.sequence + 1;
    const entry = createTranscriptJournalEntry(operation, nextSequence, now);
    const targetPath = getSessionFilePath(normalizedCwd, reference.sessionId);

    fsImpl.appendFileSync(targetPath, `${serializeTranscriptJournalLine(entry)}\n`, 'utf8');

    return {
      ...reference,
      updatedAt: now,
      sequence: nextSequence
    };
  }

  /**
   * 读取轻量 index 并与 journal 文件指纹对账；正常路径不读取任何 journal 正文。
   */
  function listSessionSummaries(cwd: string): TranscriptSessionSummary[] {
    const normalizedCwd = String(cwd);
    const sessionsDir = path.join(getProjectDir(normalizedCwd), 'sessions');

    if (!fsImpl.existsSync(sessionsDir)) {
      return [];
    }

    const journalNames = fsImpl.readdirSync(sessionsDir).filter((fileName) => fileName.endsWith('.jsonl'));
    const persisted = readSessionIndex(normalizedCwd);
    const indexedById = new Map((persisted?.sessions || []).map((session) => [session.sessionId, session]));
    const sessions: TranscriptSessionSummary[] = [];
    let dirty = persisted === null || indexedById.size !== journalNames.length;

    for (const fileName of journalNames) {
      const sessionId = fileName.slice(0, -'.jsonl'.length);
      const filePath = path.join(sessionsDir, fileName);
      const stat = safelyStatJournal(filePath);
      const indexed = indexedById.get(sessionId);

      if (stat && indexed && indexed.cwd === normalizedCwd && fingerprintMatches(indexed, stat)) {
        sessions.push(cloneSessionSummary(indexed));
        continue;
      }

      dirty = true;
      const loaded = safelyReadJournal(filePath, normalizedCwd, false);
      const refreshedStat = safelyStatJournal(filePath);
      if (!loaded || !refreshedStat || loaded.session.sessionId !== sessionId) {
        continue;
      }

      sessions.push(createSessionSummary(loaded.reference, loaded.session.records, refreshedStat));
    }

    sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (dirty) {
      safelyWriteSessionIndex(normalizedCwd, sessions);
    }

    return sessions.map(cloneSessionSummary);
  }

  /**
   * 在 journal 已成功提交后原子更新单个摘要；调用方决定失败是否影响业务写入。
   */
  function updateSessionIndex(cwd: string, reference: TranscriptSessionJournalReference, records: import('../types/transcript').TranscriptRecord[]): void {
    const normalizedCwd = String(cwd);
    const stat = fsImpl.statSync(getSessionFilePath(normalizedCwd, reference.sessionId));
    const current = readSessionIndex(normalizedCwd)?.sessions || [];
    const next = current.filter((session) => session.sessionId !== reference.sessionId);
    next.push(createSessionSummary(reference, records, stat));
    next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    writeSessionIndex(normalizedCwd, next);
  }

  /** 异步只读重放一个 journal，并只返回右栏需要的有界预览。 */
  function loadSessionPreview(cwd: string, sessionId: string): Promise<TranscriptSessionPreview | null> {
    const normalizedCwd = String(cwd);
    const filePath = getSessionFilePath(normalizedCwd, sessionId);

    return new Promise((resolve) => {
      fsImpl.readFile(filePath, 'utf8', (error, text) => {
        if (error) {
          resolve(null);
          return;
        }

        try {
          const loaded = replayTranscriptJournal(String(text));
          if (!loaded || loaded.session.cwd !== normalizedCwd || loaded.session.sessionId !== sessionId) {
            resolve(null);
            return;
          }

          resolve({
            sessionId,
            previewRecords: createSessionPreviewRecords(loaded.session.records)
          });
        } catch {
          resolve(null);
        }
      });
    });
  }

  /**
   * 加载一个 session journal 并重放为 app 可使用的 session 与 journal 引用。
   */
  function loadSession(cwd: string, sessionId: string): LoadedTranscriptSession | null {
    const loaded = safelyReadJournal(getSessionFilePath(cwd, sessionId), cwd, true);

    return loaded?.session.sessionId === sessionId ? loaded : null;
  }

  /**
   * 只读重放一个 session，不修复或改写源 journal。
   */
  function loadSessionReadOnly(cwd: string, sessionId: string): LoadedTranscriptSession | null {
    const loaded = safelyReadJournal(getSessionFilePath(cwd, sessionId), cwd, false);

    return loaded?.session.sessionId === sessionId ? loaded : null;
  }

  function ensureProjectMetadata(projectDir: string, cwd: string): void {
    const metadataPath = path.join(projectDir, 'project.json');

    if (!fsImpl.existsSync(metadataPath)) {
      fsImpl.writeFileSync(metadataPath, JSON.stringify(getProjectMetadata(cwd), null, 2), 'utf8');
    }
  }

  function safelyReadJournal(filePath: string, cwd: string, repairTail: boolean): LoadedTranscriptSession | null {
    try {
      const loaded = replayTranscriptJournal(fsImpl.readFileSync(filePath, 'utf8'));

      if (!loaded || loaded.session.cwd !== String(cwd)) {
        return null;
      }

      if (repairTail && loaded.requiresRepair) {
        repairJournal(filePath, loaded.repairedJournalText);
      }

      return {
        session: loaded.session,
        reference: loaded.reference
      };
    } catch {
      return null;
    }
  }

  function safelyStatJournal(filePath: string): import('node:fs').Stats | null {
    try {
      return fsImpl.statSync(filePath);
    } catch {
      return null;
    }
  }

  function readSessionIndex(cwd: string): TranscriptSessionIndex | null {
    try {
      const parsed: unknown = JSON.parse(fsImpl.readFileSync(getSessionIndexFilePath(cwd), 'utf8'));
      return isSessionIndex(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function safelyWriteSessionIndex(cwd: string, sessions: TranscriptSessionSummary[]): void {
    try {
      writeSessionIndex(cwd, sessions);
    } catch {
      // index 是可重建缓存，失败不能影响 journal 查询或恢复。
    }
  }

  function writeSessionIndex(cwd: string, sessions: TranscriptSessionSummary[]): void {
    const targetPath = getSessionIndexFilePath(cwd);
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    const index: TranscriptSessionIndex = {
      schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
      sessions: sessions.map(cloneSessionSummary)
    };

    fsImpl.mkdirSync(path.dirname(targetPath), {recursive: true});
    try {
      fsImpl.writeFileSync(tmpPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
      fsImpl.renameSync(tmpPath, targetPath);
    } finally {
      try {
        fsImpl.rmSync(tmpPath, {force: true});
      } catch {
        // 清理失败不能覆盖原始 index 写入错误。
      }
    }
  }

  function repairJournal(filePath: string, text: string): void {
    const tmpPath = `${filePath}.repair-${process.pid}-${Date.now()}`;

    fsImpl.writeFileSync(tmpPath, text, 'utf8');
    fsImpl.renameSync(tmpPath, filePath);
  }

  return {
    appendSession,
    createSession,
    getDefaultRootDir,
    getProjectDir,
    getProjectMetadata,
    getSessionIndexFilePath,
    getSessionFilePath,
    listSessionSummaries,
    loadSession,
    loadSessionReadOnly,
    loadSessionPreview,
    updateSessionIndex
  };
}

function createSessionSummary(
  reference: TranscriptSessionJournalReference,
  records: import('../types/transcript').TranscriptRecord[],
  stat: Pick<import('node:fs').Stats, 'mtimeMs' | 'size'>
): TranscriptSessionSummary {
  return {
    sessionId: reference.sessionId,
    createdAt: reference.createdAt,
    updatedAt: reference.updatedAt,
    cwd: reference.cwd,
    messageCount: records.length,
    title: createSessionTitle(records),
    fingerprint: {size: stat.size, mtimeMs: stat.mtimeMs}
  };
}

function cloneSessionSummary(session: TranscriptSessionSummary): TranscriptSessionSummary {
  return {...session, fingerprint: {...session.fingerprint}};
}

function fingerprintMatches(session: TranscriptSessionSummary, stat: Pick<import('node:fs').Stats, 'mtimeMs' | 'size'>): boolean {
  return session.fingerprint.size === stat.size && session.fingerprint.mtimeMs === stat.mtimeMs;
}

function isSessionIndex(value: unknown): value is TranscriptSessionIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const index = value as Record<string, unknown>;
  if (index.schemaVersion !== SESSION_INDEX_SCHEMA_VERSION || !Array.isArray(index.sessions) || !index.sessions.every(isSessionSummary)) {
    return false;
  }

  const ids = index.sessions.map((session) => session.sessionId);
  return new Set(ids).size === ids.length;
}

function isSessionSummary(value: unknown): value is TranscriptSessionSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const session = value as Record<string, unknown>;
  const fingerprint = session.fingerprint;
  return typeof session.sessionId === 'string' && session.sessionId.length > 0 &&
    typeof session.createdAt === 'string' && session.createdAt.length > 0 &&
    typeof session.updatedAt === 'string' && session.updatedAt.length > 0 &&
    typeof session.cwd === 'string' &&
    Number.isInteger(session.messageCount) && Number(session.messageCount) >= 0 &&
    typeof session.title === 'string' && session.title.length > 0 &&
    Boolean(fingerprint && typeof fingerprint === 'object' && !Array.isArray(fingerprint) &&
      typeof (fingerprint as Record<string, unknown>).size === 'number' && Number.isFinite((fingerprint as Record<string, unknown>).size) && Number((fingerprint as Record<string, unknown>).size) >= 0 &&
      typeof (fingerprint as Record<string, unknown>).mtimeMs === 'number' && Number.isFinite((fingerprint as Record<string, unknown>).mtimeMs) && Number((fingerprint as Record<string, unknown>).mtimeMs) >= 0);
}

/**
 * 生成新的 session id，兼顾时间可读性和同秒内唯一性。
 */
function createSessionId(timestamp: string, cryptoImpl: Pick<typeof crypto, 'randomBytes'>): string {
  return `${String(timestamp).replace(/[:.]/g, '-')}-${cryptoImpl.randomBytes(3).toString('hex')}`;
}

/**
 * 生成 ISO 时间戳，统一 session 与 journal 操作的时间来源。
 */
function createTimestamp(): string {
  return new Date().toISOString();
}

function createSessionPreviewRecords(records: TranscriptRecord[]): import('../types/transcript').TranscriptSessionPreviewRecord[] {
  const previewRecords: import('../types/transcript').TranscriptSessionPreviewRecord[] = [];
  let index = records.length - 1;

  while (index >= 0 && previewRecords.length < SESSION_PREVIEW_RECORD_LIMIT) {
    const record = records[index];
    if (record.role === 'subagent') {
      let startIndex = index;
      while (startIndex > 0) {
        const previous = records[startIndex - 1];
        if (previous.role !== 'subagent' || previous.runId !== record.runId) {
          break;
        }
        startIndex -= 1;
      }
      const runRecords = records.slice(startIndex, index + 1) as SubagentTranscriptRecord[];
      previewRecords.push(createSubagentPreviewRecord(runRecords));
      index = startIndex - 1;
      continue;
    }

    const text = normalizePreviewText(createRecordPreviewText(record)).slice(0, SESSION_PREVIEW_TEXT_LIMIT);

    if (text.length === 0) {
      index -= 1;
      continue;
    }

    previewRecords.push({
      role: record.role,
      text,
      ...(record.createdAt ? {createdAt: String(record.createdAt)} : {})
    });
    index -= 1;
  }

  return previewRecords.reverse();
}

/** 把一段连续子运行压成单条 session preview，避免内部工具过程挤掉主对话摘要。 */
function createSubagentPreviewRecord(records: SubagentTranscriptRecord[]): import('../types/transcript').TranscriptSessionPreviewRecord {
  const first = records[0];
  const start = records.find((record) => record.event.kind === 'start');
  const terminal = [...records].reverse().find((record) =>
    record.event.kind === 'completed' || record.event.kind === 'failed' || record.event.kind === 'cancelled'
  );
  const status = terminal?.event.kind || 'interrupted';
  const task = start?.event.kind === 'start' ? normalizePreviewText(start.event.task) : '';
  const text = normalizePreviewText(`${first.agentName} · ${status}${task ? ` · ${task}` : ''}`).slice(0, SESSION_PREVIEW_TEXT_LIMIT);

  return {
    role: 'subagent',
    text,
    ...(terminal?.createdAt || first.createdAt ? {createdAt: String(terminal?.createdAt || first.createdAt)} : {})
  };
}

function createRecordPreviewText(record: TranscriptRecord): unknown {
  return record.role === 'user' && typeof record.displayText === 'string' ? record.displayText : record.text;
}

function normalizePreviewText(text: unknown): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * 从第一条用户消息派生稳定标题；列表只需要可辨识摘要，不引入额外模型调用。
 */
function createSessionTitle(records: TranscriptRecord[]): string {
  const firstUser = records.find((record) => record.role === 'user');
  const text = firstUser && firstUser.role === 'user'
    ? firstUser.displayText || firstUser.text
    : '';
  const normalized = normalizePreviewText(text);

  return normalized === '' ? '未命名对话' : normalized.slice(0, 60);
}

export {
  STORE_SCHEMA_VERSION,
  createTranscriptStore
};
