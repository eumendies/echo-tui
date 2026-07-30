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
  TranscriptJournalOperation,
  TranscriptProjectMetadata,
  TranscriptSessionJournalReference,
  TranscriptSessionMetadata,
  TranscriptStore
} from '../types/transcript';

const STORE_SCHEMA_VERSION = 1 as const;
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
   * 读取并按更新时间倒序返回当前 cwd 下可恢复的 session metadata。
   */
  function listSessions(cwd: string): TranscriptSessionMetadata[] {
    const sessionsDir = path.join(getProjectDir(cwd), 'sessions');

    if (!fsImpl.existsSync(sessionsDir)) {
      return [];
    }

    return fsImpl.readdirSync(sessionsDir)
      .filter((fileName) => fileName.endsWith('.jsonl'))
      .map((fileName) => safelyReadJournal(path.join(sessionsDir, fileName), cwd, false))
      .filter((loaded): loaded is LoadedTranscriptSession => loaded !== null)
      .map(({session}) => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        cwd: session.cwd,
        messageCount: session.records.length,
        lastMessagePreview: createLastMessagePreview(session.records),
        previewRecords: createSessionPreviewRecords(session.records),
        sourcePath: getSessionFilePath(cwd, session.sessionId),
        title: createSessionTitle(session.records)
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    getSessionFilePath,
    listSessions,
    loadSession,
    loadSessionReadOnly
  };
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

function createLastMessagePreview(records: import('../types/transcript').TranscriptRecord[]): string {
  if (!records.length) {
    return '空会话';
  }

  const lastRecord = records[records.length - 1];
  return normalizePreviewText(createRecordPreviewText(lastRecord)).slice(0, 60);
}

function createSessionPreviewRecords(records: import('../types/transcript').TranscriptRecord[]): import('../types/transcript').TranscriptSessionPreviewRecord[] {
  const previewRecords: import('../types/transcript').TranscriptSessionPreviewRecord[] = [];

  for (let index = records.length - 1; index >= 0 && previewRecords.length < SESSION_PREVIEW_RECORD_LIMIT; index -= 1) {
    const record = records[index];
    const text = normalizePreviewText(createRecordPreviewText(record)).slice(0, SESSION_PREVIEW_TEXT_LIMIT);

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

function createRecordPreviewText(record: import('../types/transcript').TranscriptRecord): unknown {
  return record.role === 'user' && typeof record.displayText === 'string' ? record.displayText : record.text;
}

function normalizePreviewText(text: unknown): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * 从第一条用户消息派生稳定标题；列表只需要可辨识摘要，不引入额外模型调用。
 */
function createSessionTitle(records: import('../types/transcript').TranscriptRecord[]): string {
  const firstUser = records.find((record) => record.role === 'user');
  const text = firstUser && firstUser.role === 'user'
    ? firstUser.displayText || firstUser.text
    : '';
  const normalized = normalizePreviewText(text);

  return normalized === '' ? '未命名对话' : normalized.slice(0, 60);
}

export {
  STORE_SCHEMA_VERSION,
  createSessionTitle,
  createTranscriptStore
};
