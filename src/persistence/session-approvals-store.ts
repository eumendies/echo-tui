import fs from 'node:fs';
import path from 'node:path';

import type {
  SessionApprovals,
  SessionApprovalsInput,
  SessionApprovalsReadResult,
  SessionApprovalsStore
} from '../types/session-approvals';
import type {TranscriptStore} from '../types/transcript';

const SESSION_APPROVALS_SCHEMA_VERSION = 1 as const;
// 授权文件是安全边界的输入，写盘权限收紧到仅当前用户可读写。
const SESSION_APPROVALS_FILE_MODE = 0o600;

/**
 * 创建会话级工具授权 sidecar store；与 transcript journal 同目录同身份，读取失败由分类结果表达。
 */
function createSessionApprovalsStore(transcriptStore: Pick<TranscriptStore, 'getSessionFilePath'>): SessionApprovalsStore {
  /**
   * 复用 journal 路径派生 sidecar：两者除扩展名外完全同名，session 删除后不会残留孤儿身份。
   */
  function getFilePath(cwd: string, sessionId: string): string {
    const journalPath = transcriptStore.getSessionFilePath(cwd, sessionId);
    return journalPath.slice(0, -path.extname(journalPath).length) + '.approvals.json';
  }

  /**
   * 严格解析授权根节点并按条目归一化。
   * 结构或身份错误整文件作废；单个脏条目只丢弃自己，因为减少授权是安全方向。
   */
  function read(cwd: string, sessionId: string): SessionApprovalsReadResult {
    let source: string;

    try {
      source = fs.readFileSync(getFilePath(cwd, sessionId), 'utf8');
    } catch (error: unknown) {
      return isNodeErrorCode(error, 'ENOENT') ? {kind: 'missing'} : {kind: 'invalid'};
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(source);
    } catch {
      return {kind: 'invalid'};
    }

    return normalizeSessionApprovals(parsed, sessionId);
  }

  /**
   * 原子写入当前授权；三个授权来源都为空时删除文件，使"撤销全部授权"与"文件不存在"成为同一状态。
   * 输入来自进程内 Set 展开，这里只做归一化而不抛错，避免把不可能的入参问题伪装成磁盘故障。
   */
  function write(cwd: string, input: SessionApprovalsInput, updatedAt = new Date().toISOString()): SessionApprovals | null {
    const sessionId = String(input.sessionId || '').trim();
    const tools = normalizeNameList(input.tools);
    const bashCommands = normalizeNameList(input.bashCommands);

    if (!sessionId) {
      return null;
    }

    if (!input.allowAll && tools.length === 0 && bashCommands.length === 0) {
      fs.rmSync(getFilePath(cwd, sessionId), {force: true});
      return null;
    }

    const targetPath = getFilePath(cwd, sessionId);
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    const approvals: SessionApprovals = {
      schemaVersion: SESSION_APPROVALS_SCHEMA_VERSION,
      sessionId,
      updatedAt,
      allowAll: input.allowAll,
      tools,
      bashCommands
    };

    fs.mkdirSync(path.dirname(targetPath), {recursive: true});
    fs.writeFileSync(tempPath, `${JSON.stringify(approvals, null, 2)}\n`, {mode: SESSION_APPROVALS_FILE_MODE});
    fs.renameSync(tempPath, targetPath);
    return {...approvals};
  }

  /** 删除已移除 journal 的可选授权文件；缺失文件由 force 语义视为已清理。 */
  function remove(cwd: string, sessionId: string): void {
    fs.rmSync(getFilePath(cwd, sessionId), {force: true});
  }

  return {getFilePath, read, remove, write};
}

/**
 * 校验 sidecar 根节点并归一化授权集合。
 * schemaVersion、sessionId、allowAll 与两个数组的结构无法被安全容忍：任一放宽都可能把无效数据解释成放行。
 * updatedAt 只服务人工排查，缺失或损坏不影响授权本身，因此不参与判定。
 */
function normalizeSessionApprovals(value: unknown, expectedSessionId: string): SessionApprovalsReadResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {kind: 'invalid'};
  }

  const approvals = value as Record<string, unknown>;

  if (approvals.schemaVersion !== SESSION_APPROVALS_SCHEMA_VERSION ||
    approvals.sessionId !== expectedSessionId ||
    typeof approvals.allowAll !== 'boolean' ||
    !Array.isArray(approvals.tools) ||
    !Array.isArray(approvals.bashCommands)) {
    return {kind: 'invalid'};
  }

  return {
    kind: 'found',
    approvals: {
      schemaVersion: SESSION_APPROVALS_SCHEMA_VERSION,
      sessionId: expectedSessionId,
      updatedAt: typeof approvals.updatedAt === 'string' ? approvals.updatedAt : '',
      allowAll: approvals.allowAll,
      tools: normalizeNameList(approvals.tools),
      bashCommands: normalizeNameList(approvals.bashCommands)
    }
  };
}

/** 过滤空白与非字符串条目并按首次出现去重，保持用户批准顺序；只丢弃脏项，不影响其余授权。 */
function normalizeNameList(value: unknown): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(value)) {
    return names;
  }

  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '' || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    names.push(entry);
  }

  return names;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

export {
  SESSION_APPROVALS_SCHEMA_VERSION,
  createSessionApprovalsStore
};
