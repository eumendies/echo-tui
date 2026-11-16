import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {createProjectKey} from '../../../persistence/project-key';
import {atomicWriteFile, ensureSafeDirectory, inspectSafeDirectory, readRegularFile} from '../safe-storage';

import type {SafeStorageOperations} from '../safe-storage';

const REGISTRY_SCHEMA_VERSION = 1 as const;
const ENTRY_FILE_NAME = 'workspace.json';
const MAX_ENTRY_BYTES = 64 * 1024;

/** 受管 worktree 在源仓库内的相对目录；与登记分区分离，便于用户在项目里直接定位。 */
const WORKTREE_DIR_SEGMENTS = ['.echo', 'worktrees'] as const;

/** 受管工作区的生命周期状态。 */
type WorkerWorkspaceStatus =
  | 'preparing' // 登记已写入，worktree 尚未完成创建。
  | 'running' // Worker 子运行已启动。
  | 'completed' // 子运行成功结束。
  | 'failed' // 子运行非取消失败。
  | 'cancelled' // 父 turn 取消。
  | 'cleaned'; // 工作区已移除且无成果。

/** 创建者归属；fork 只继承历史引用，不转移这里的任何字段。 */
type WorkerWorkspaceOwner = {
  agentName: string; // 发起委派的内置 Worker 名称。
  parentToolCallId: string; // 外层 run_subagent 调用身份。
  projectCwd: string; // 父运行项目身份目录；决定项目分区。
  runId: string; // 子运行稳定身份。
  sessionId?: string; // 交互式父会话；headless 缺省且不伪造 journal。
};

/** 版本化登记文件；字段只追加不重命名，未知版本只报告不可自动处理。 */
type WorkerWorkspaceEntry = {
  baseCommit: string; // 创建 worktree 时冻结的完整基线；人工排查用。
  createdAt: string; // 登记首次写入时间，ISO-8601。
  owner: WorkerWorkspaceOwner;
  repoRoot: string; // 源仓库根；人工检查或清理时用于 `git -C`。
  schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  status: WorkerWorkspaceStatus;
  statusDetail?: string; // 有界的失败/保留原因，不含文件正文。
  updatedAt: string; // 最近一次状态更新时间。
  workspaceId: string; // 受管身份，同时是登记目录名。
  workspaceRoot: string; // 完整 worktree 根；人工检查或清理时用于 `git worktree`。
  cleanup?: {
    kind: 'retained' | 'removed'; // retained 表示按保守策略保留现场。
    message?: string; // 保留原因或 git 拒绝删除的诊断。
  };
};

type WorkerWorkspaceReadResult =
  | {kind: 'ok'; entry: WorkerWorkspaceEntry} // 校验通过且版本已知。
  | {kind: 'missing'} // 登记目录或文件不存在。
  | {kind: 'unsupported'; message: string} // 版本未知或结构不再兼容；禁止自动操作。
  | {kind: 'unsafe'; message: string}; // 目录链是符号链接、非普通文件或不可读。

type WorkerWorkspaceStoreOptions = {
  homedir?: string | (() => string); // 用户目录根；测试可注入以避免污染真实 home。
  operations?: SafeStorageOperations; // 文件系统替换缝，用于验证原子写失败等安全属性。
  rootDir?: string; // 受管存储根；缺省为 <homedir>/.echo/echo_tui。
};

type WorkerWorkspaceStore = {
  getEntry: (projectCwd: string, workspaceId: string) => WorkerWorkspaceReadResult;
  getWorkspaceRoot: (repoRoot: string, workspaceId: string) => string;
  writeEntry: (entry: WorkerWorkspaceEntry) => void;
  ensureWorkspaceDir: (projectCwd: string, workspaceId: string) => string;
};

/** 解析受管存储根，保持与 transcript/usage/tool-result 相同布局。 */
function resolveStoreRoot(options: WorkerWorkspaceStoreOptions): string {
  if (options.rootDir) {
    return path.resolve(options.rootDir);
  }
  const homedir = typeof options.homedir === 'function' ? options.homedir() : (options.homedir || os.homedir());
  return path.join(path.resolve(homedir), '.echo', 'echo_tui');
}

/**
 * 创建受管工作区登记存储。
 *
 * 分区键固定使用父 projectCwd，而不是 repo root 或 worktree 路径：同一仓库的不同启动
 * 子目录要保持各自既有分区，否则会与 session/usage 的归属分裂。
 */
function createWorkerWorkspaceStore(options: WorkerWorkspaceStoreOptions = {}): WorkerWorkspaceStore {
  const rootDir = resolveStoreRoot(options);
  const operations = options.operations || {};

  /**
   * 受管目录布局的唯一定义。
   * 所有 getter 与 ensure 都从这里派生：两套 path 算法迟早会漂移，而漂移只会在恢复时暴露。
   */
  function getWorkspaceSegments(projectCwd: string, workspaceId: string): string[] {
    return ['projects', createProjectKey(projectCwd), 'worker-workspaces', workspaceId];
  }

  /**
   * 创建受管存储根后逐层建目录。
   * safe-storage 的逐层创建要求根已存在；根由系统拥有，这里只创建一次并沿用注入的 mkdir。
   */
  function ensureStoreRoot(): void {
    const mkdir = operations.mkdir || fs.mkdirSync;
    mkdir(rootDir, {recursive: true, mode: 0o700});
  }

  /** 创建受管目录链并拒绝符号链接组件；只接受系统生成的 workspaceId。 */
  function ensureWorkspaceDir(projectCwd: string, workspaceId: string): string {
    if (!isSafeWorkspaceId(workspaceId)) {
      throw new Error('Managed worker workspace id is invalid.');
    }
    ensureStoreRoot();
    return ensureSafeDirectory(rootDir, getWorkspaceSegments(projectCwd, workspaceId), operations);
  }

  function writeEntry(entry: WorkerWorkspaceEntry): void {
    const dirPath = ensureWorkspaceDir(entry.owner.projectCwd, entry.workspaceId);
    atomicWriteFile(path.join(dirPath, ENTRY_FILE_NAME), `${JSON.stringify(entry, null, 2)}\n`, false, operations);
  }

  function getEntry(projectCwd: string, workspaceId: string): WorkerWorkspaceReadResult {
    if (!isSafeWorkspaceId(workspaceId)) {
      return {kind: 'unsupported', message: 'Managed worker workspace id is invalid.'};
    }
    const inspected = inspectSafeDirectory(rootDir, getWorkspaceSegments(projectCwd, workspaceId), operations);
    if (inspected.kind === 'missing') {
      return {kind: 'missing'};
    }
    if (inspected.kind === 'unsafe') {
      return {kind: 'unsafe', message: inspected.message};
    }

    const read = readRegularFile(path.join(inspected.path, ENTRY_FILE_NAME), operations, MAX_ENTRY_BYTES);
    if (read.kind === 'missing') {
      return {kind: 'missing'};
    }
    if (read.kind === 'unsafe') {
      return {kind: 'unsafe', message: read.message};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(read.content);
    } catch {
      return {kind: 'unsupported', message: 'Managed worker workspace registry is not valid JSON.'};
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
      return {kind: 'unsupported', message: 'Managed worker workspace registry has an unsupported schema version.'};
    }
    const entry = parsed as unknown as WorkerWorkspaceEntry;
    if (!isValidEntry(entry, projectCwd, workspaceId)) {
      return {kind: 'unsupported', message: 'Managed worker workspace registry failed structural validation.'};
    }
    return {kind: 'ok', entry};
  }

  /**
   * 计算受管 worktree 的绝对路径。
   *
   * 放在源仓库的 `.echo/worktrees/<id>`：跟随仓库走，用户在项目目录里就能直接查看和清理。
   * 登记仍留在用户数据目录的 projectCwd 分区，因为分区键属于父会话身份而不是仓库。
   */
  function getWorkspaceRoot(repoRoot: string, workspaceId: string): string {
    if (!isSafeWorkspaceId(workspaceId)) {
      throw new Error('Managed worker workspace id is invalid.');
    }
    return path.join(path.resolve(repoRoot), WORKTREE_DIR_SEGMENTS[0], WORKTREE_DIR_SEGMENTS[1], workspaceId);
  }

  return {
    getEntry,
    getWorkspaceRoot,
    writeEntry,
    ensureWorkspaceDir
  };
}

/** workspaceId 只允许小写十六进制与连字符，杜绝路径分隔符和父目录穿越。 */
function isSafeWorkspaceId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value);
}

function isValidEntry(entry: WorkerWorkspaceEntry, projectCwd: string, workspaceId: string): boolean {
  if (entry.workspaceId !== workspaceId || entry.owner?.projectCwd !== projectCwd) {
    return false;
  }
  if (typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string') {
    return false;
  }
  return typeof entry.owner?.runId === 'string' &&
    typeof entry.owner?.parentToolCallId === 'string' &&
    typeof entry.owner?.agentName === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** 生成由系统拥有、可安全用作目录名的 workspace 身份；长度由 timestamp 与调用方后缀共同决定。 */
function createWorkspaceId(randomSuffix: string, timestamp: number): string {
  return `${String(timestamp)}-${randomSuffix.toLowerCase().replace(/[^a-z0-9]/gu, '')}`;
}

export {
  REGISTRY_SCHEMA_VERSION,
  WORKTREE_DIR_SEGMENTS,
  createWorkerWorkspaceStore,
  createWorkspaceId,
  isSafeWorkspaceId
};

export type {
  WorkerWorkspaceEntry,
  WorkerWorkspaceOwner,
  WorkerWorkspaceReadResult,
  WorkerWorkspaceStatus,
  WorkerWorkspaceStore,
  WorkerWorkspaceStoreOptions
};
