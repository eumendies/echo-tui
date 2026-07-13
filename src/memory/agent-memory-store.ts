import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {findProjectRoot} from '../agent/agent-instructions';

import type {AgentMemoryCatalog, AgentMemoryCatalogListResult, AgentMemoryCatalogReadResult, AgentMemoryItem, AgentMemoryMutationResult, AgentMemoryScope} from '../types/memory';

const AGENT_MEMORY_VERSION = 1;
const AGENT_MEMORY_DIR_NAME = 'agent-memory';
const AGENT_MEMORY_INDEX_NAME = 'catalogs.json';

type AgentMemoryStoreOptions = {
  createId?: () => string;
  getNow?: () => Date;
  homedir?: () => string;
  readFile?: typeof fs.readFileSync;
  writeFile?: typeof fs.writeFileSync;
  rename?: typeof fs.renameSync;
  mkdir?: typeof fs.mkdirSync;
  unlink?: typeof fs.unlinkSync;
  stat?: typeof fs.statSync;
  storageRoot?: string;
};

type AgentMemoryIndexFile = {
  version: number;
  catalogs: AgentMemoryCatalog[];
};

type AgentMemoryCatalogFile = {
  version: number;
  catalogId: string;
  memories: AgentMemoryItem[];
};

/** 解析当前 cwd 对应的 project scope；找不到项目 marker 时以 cwd 自身作为边界。 */
function resolveAgentMemoryProjectRoot(cwd: string, options: AgentMemoryStoreOptions = {}): string {
  const resolvedCwd = path.resolve(cwd);
  const root = findProjectRoot(resolvedCwd, (options.homedir || os.homedir)(), options.stat || fs.statSync);
  return path.resolve(root || resolvedCwd);
}

/** 列出当前项目可访问的 global/project catalog；保留同名项供管理 UI 展示。 */
function listAgentMemoryCatalogs(cwd: string, options: AgentMemoryStoreOptions = {}): AgentMemoryCatalogListResult {
  const index = readIndex(options);
  if (!index.ok) {
    return index;
  }

  const projectRoot = resolveAgentMemoryProjectRoot(cwd, options);
  const catalogs = index.catalogs
    .filter((catalog) => catalog.scope.kind === 'global' || catalog.scope.projectRoot === projectRoot)
    .map(cloneCatalog);
  return {ok: true, catalogs};
}

/** 生成 provider 使用的有效 catalog 列表；project 同名项覆盖 global。 */
function listEffectiveAgentMemoryCatalogs(cwd: string, options: AgentMemoryStoreOptions = {}): AgentMemoryCatalogListResult {
  const result = listAgentMemoryCatalogs(cwd, options);
  if (!result.ok) {
    return result;
  }

  const effective = new Map<string, AgentMemoryCatalog>();
  const globalCatalogs = result.catalogs.filter((catalog) => catalog.scope.kind === 'global');
  const projectCatalogs = result.catalogs.filter((catalog) => catalog.scope.kind === 'project');

  for (const catalog of globalCatalogs) {
    effective.set(normalizeName(catalog.name), catalog);
  }

  // 后写 project catalog，使其覆盖同名 global catalog。
  for (const catalog of projectCatalogs) {
    effective.set(normalizeName(catalog.name), catalog);
  }

  return {ok: true, catalogs: Array.from(effective.values()).map(cloneCatalog)};
}

/** 读取一个可访问 catalog；未指定 scope 时应用 project 覆盖 global 规则。 */
function readAgentMemoryCatalog(cwd: string, name: string, scopeKind?: AgentMemoryScope['kind'], options: AgentMemoryStoreOptions = {}): AgentMemoryCatalogReadResult {
  const resolved = resolveCatalog(cwd, name, scopeKind, options);
  if (!resolved.ok) {
    return resolved;
  }

  const file = readCatalogFile(resolved.catalog, options);
  if (!file.ok) {
    return file;
  }

  return {
    ok: true,
    catalog: cloneCatalog(resolved.catalog),
    memories: file.memories.map(cloneItem)
  };
}

/** 向 catalog 添加 item；不存在时创建 catalog 和首个 item。 */
function addAgentMemory(
  cwd: string,
  input: {catalog: string; description?: string; content: string; scope?: AgentMemoryScope['kind']},
  options: AgentMemoryStoreOptions = {}
): AgentMemoryMutationResult {
  const name = normalizeRequired(input.catalog, 'catalog 名称不能为空');
  const content = normalizeRequired(input.content, 'memory 内容不能为空');

  if (!name.ok) {
    return name;
  }

  if (!content.ok) {
    return content;
  }

  const index = readIndex(options);
  if (!index.ok) {
    return index;
  }

  const scope = createScope(cwd, input.scope || 'project', options);
  const existing = findCatalogInScope(index.catalogs, name.value, scope);
  const now = (options.getNow || (() => new Date()))().toISOString();
  const createId = options.createId || (() => crypto.randomUUID());
  const item: AgentMemoryItem = {
    id: createId(),
    content: content.value,
    createdAt: now,
    updatedAt: now
  };

  if (existing) {
    const file = readCatalogFile(existing, options);

    if (!file.ok) {
      return file;
    }

    const memories = [...file.memories, item];
    const saved = saveCatalogFile(existing.id, memories, options);

    if (!saved.ok) {
      return saved;
    }

    return {
      ok: true,
      catalogs: index.catalogs.map(cloneCatalog),
      catalog: cloneCatalog(existing),
      memories: memories.map(cloneItem)
    };
  }

  const description = normalizeRequired(input.description || '', '新 catalog 的 description 不能为空');
  if (!description.ok) {
    return description;
  }

  const catalog: AgentMemoryCatalog = {
    id: createId(),
    name: name.value,
    description: description.value,
    scope
  };
  const savedCatalog = saveCatalogFile(catalog.id, [item], options);
  if (!savedCatalog.ok) {
    return savedCatalog;
  }

  const catalogs = [...index.catalogs, catalog];
  const savedIndex = saveIndex(catalogs, options);

  if (!savedIndex.ok) {
    // catalog 文件尚未进入索引，索引写失败时尽力清理 orphan 文件。
    tryUnlink(catalogPath(catalog.id, options), options);
    return savedIndex;
  }

  return {
    ok: true,
    catalogs: catalogs.map(cloneCatalog),
    catalog: cloneCatalog(catalog),
    memories: [cloneItem(item)]
  };
}

function updateAgentMemoryCatalog(
  cwd: string,
  name: string,
  updates: {name?: string; description?: string},
  scopeKind?: AgentMemoryScope['kind'],
  options: AgentMemoryStoreOptions = {}
): AgentMemoryMutationResult {
  const resolved = resolveCatalog(cwd, name, scopeKind, options);
  if (!resolved.ok) {
    return resolved;
  }

  const index = readIndex(options);
  if (!index.ok) {
    return index;
  }

  const nextName = updates.name === undefined ? resolved.catalog.name : normalizeRequired(updates.name, 'catalog 名称不能为空');
  const nextDescription = updates.description === undefined ? resolved.catalog.description : normalizeRequired(updates.description, 'catalog description 不能为空');

  if (typeof nextName !== 'string' && !nextName.ok) {
    return nextName;
  }

  if (typeof nextDescription !== 'string' && !nextDescription.ok) {
    return nextDescription;
  }

  const nameValue = typeof nextName === 'string' ? nextName : nextName.value;
  const descriptionValue = typeof nextDescription === 'string' ? nextDescription : nextDescription.value;
  const duplicate = index.catalogs.find((catalog) =>
    catalog.id !== resolved.catalog.id &&
    sameScope(catalog.scope, resolved.catalog.scope) &&
    normalizeName(catalog.name) === normalizeName(nameValue));

  if (duplicate) {
    return {ok: false, error: '目标 scope 已存在同名 catalog'};
  }

  const catalog = {...resolved.catalog, name: nameValue, description: descriptionValue};
  const catalogs = index.catalogs.map((item) => item.id === catalog.id ? catalog : item);
  const saved = saveIndex(catalogs, options);

  if (!saved.ok) {
    return saved;
  }

  return {ok: true, catalogs: catalogs.map(cloneCatalog), catalog: cloneCatalog(catalog)};
}

function updateAgentMemoryItem(
  cwd: string,
  catalogName: string,
  itemId: string,
  content: string,
  scopeKind?: AgentMemoryScope['kind'],
  options: AgentMemoryStoreOptions = {}
): AgentMemoryMutationResult {
  const normalized = normalizeRequired(content, 'memory 内容不能为空');
  if (!normalized.ok) {
    return normalized;
  }

  const resolved = resolveCatalog(cwd, catalogName, scopeKind, options);
  if (!resolved.ok) {
    return resolved;
  }

  const file = readCatalogFile(resolved.catalog, options);
  if (!file.ok) {
    return file;
  }

  if (!file.memories.some((item) => item.id === itemId)) {
    return {ok: false, error: '要更新的 agent memory item 不存在'};
  }

  const updatedAt = (options.getNow || (() => new Date()))().toISOString();
  const memories = file.memories.map((item) => item.id === itemId ? {...item, content: normalized.value, updatedAt} : item);
  const saved = saveCatalogFile(resolved.catalog.id, memories, options);

  return saved.ok ? mutationSnapshot(cwd, resolved.catalog, memories, options) : saved;
}

function removeAgentMemoryItem(cwd: string, catalogName: string, itemId: string, scopeKind?: AgentMemoryScope['kind'], options: AgentMemoryStoreOptions = {}): AgentMemoryMutationResult {
  const resolved = resolveCatalog(cwd, catalogName, scopeKind, options);
  if (!resolved.ok) {
    return resolved;
  }

  const file = readCatalogFile(resolved.catalog, options);
  if (!file.ok) {
    return file;
  }

  const memories = file.memories.filter((item) => item.id !== itemId);
  if (memories.length === file.memories.length) {
    return {ok: false, error: '要删除的 agent memory item 不存在'};
  }

  if (memories.length > 0) {
    const saved = saveCatalogFile(resolved.catalog.id, memories, options);
    return saved.ok ? mutationSnapshot(cwd, resolved.catalog, memories, options) : saved;
  }

  // 索引是 source of truth，先移除索引再清理文件，失败的 orphan 不会被后续读取。
  const removed = removeCatalogFromIndex(resolved.catalog, options);
  if (!removed.ok) {
    return removed;
  }

  tryUnlink(catalogPath(resolved.catalog.id, options), options);
  return {ok: true, catalogs: removed.catalogs, removedCatalog: true};
}

function removeAgentMemoryCatalog(cwd: string, name: string, scopeKind?: AgentMemoryScope['kind'], options: AgentMemoryStoreOptions = {}): AgentMemoryMutationResult {
  const resolved = resolveCatalog(cwd, name, scopeKind, options);
  if (!resolved.ok) {
    return resolved;
  }

  const removed = removeCatalogFromIndex(resolved.catalog, options);
  if (!removed.ok) {
    return removed;
  }

  tryUnlink(catalogPath(resolved.catalog.id, options), options);
  return {ok: true, catalogs: removed.catalogs, removedCatalog: true};
}

function mutationSnapshot(cwd: string, catalog: AgentMemoryCatalog, memories: AgentMemoryItem[], options: AgentMemoryStoreOptions): AgentMemoryMutationResult {
  const listed = listAgentMemoryCatalogs(cwd, options);

  if (!listed.ok) {
    return listed;
  }

  return {
    ok: true,
    catalogs: listed.catalogs,
    catalog: cloneCatalog(catalog),
    memories: memories.map(cloneItem)
  };
}

function resolveCatalog(
  cwd: string,
  name: string,
  scopeKind: AgentMemoryScope['kind'] | undefined,
  options: AgentMemoryStoreOptions
): {ok: true; catalog: AgentMemoryCatalog} | {ok: false; error: string} {
  const listed = listAgentMemoryCatalogs(cwd, options);

  if (!listed.ok) {
    return listed;
  }

  const matches = listed.catalogs.filter((catalog) => normalizeName(catalog.name) === normalizeName(name));
  const catalog = scopeKind
    ? matches.find((item) => item.scope.kind === scopeKind)
    : matches.find((item) => item.scope.kind === 'project') || matches.find((item) => item.scope.kind === 'global');

  return catalog
    ? {ok: true, catalog}
    : {ok: false, error: 'agent memory catalog 不存在或不属于当前 scope'};
}

function readIndex(options: AgentMemoryStoreOptions): AgentMemoryCatalogListResult {
  let raw: string;
  try {
    raw = (options.readFile || fs.readFileSync)(indexPath(options), 'utf8');
  } catch (error: unknown) {
    return isCode(error, 'ENOENT')
      ? {ok: true, catalogs: []}
      : {ok: false, error: `无法读取 agent memory 索引：${formatError(error)}`};
  }

  try {
    const value: unknown = JSON.parse(raw);

    if (!isObject(value) || value.version !== AGENT_MEMORY_VERSION || !Array.isArray(value.catalogs)) {
      throw new Error('agent memory 索引格式无效');
    }

    const catalogs = value.catalogs.map(parseCatalog);

    if (new Set(catalogs.map((item) => item.id)).size !== catalogs.length) {
      throw new Error('agent memory 索引包含重复 id');
    }

    if (new Set(catalogs.map(catalogIdentity)).size !== catalogs.length) {
      throw new Error('agent memory 索引在同一 scope 包含同名 catalog');
    }

    return {ok: true, catalogs};
  } catch (error: unknown) {
    return {ok: false, error: formatError(error)};
  }
}

function readCatalogFile(
  catalog: AgentMemoryCatalog,
  options: AgentMemoryStoreOptions
): {ok: true; memories: AgentMemoryItem[]} | {ok: false; error: string} {
  try {
    const value: unknown = JSON.parse((options.readFile || fs.readFileSync)(catalogPath(catalog.id, options), 'utf8'));

    if (!isObject(value) || value.version !== AGENT_MEMORY_VERSION || value.catalogId !== catalog.id || !Array.isArray(value.memories)) {
      throw new Error(`agent memory catalog 文件格式无效：${catalog.name}`);
    }

    const memories = value.memories.map(parseItem);

    if (new Set(memories.map((item) => item.id)).size !== memories.length) {
      throw new Error(`agent memory catalog 包含重复 item id：${catalog.name}`);
    }

    return {ok: true, memories};
  } catch (error: unknown) {
    return {ok: false, error: `无法读取 agent memory catalog：${formatError(error)}`};
  }
}

function saveIndex(
  catalogs: AgentMemoryCatalog[],
  options: AgentMemoryStoreOptions
): {ok: true} | {ok: false; error: string} {
  return atomicWrite(indexPath(options), {version: AGENT_MEMORY_VERSION, catalogs}, 'agent memory 索引', options);
}

function saveCatalogFile(
  catalogId: string,
  memories: AgentMemoryItem[],
  options: AgentMemoryStoreOptions
): {ok: true} | {ok: false; error: string} {
  return atomicWrite(catalogPath(catalogId, options), {version: AGENT_MEMORY_VERSION, catalogId, memories}, 'agent memory catalog', options);
}

/** 写入临时文件后 rename，避免进程中断时留下半截 JSON 覆盖正式文件。 */
function atomicWrite(
  target: string,
  value: AgentMemoryIndexFile | AgentMemoryCatalogFile,
  label: string,
  options: AgentMemoryStoreOptions
): {ok: true} | {ok: false; error: string} {
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    (options.mkdir || fs.mkdirSync)(path.dirname(target), {recursive: true});
    (options.writeFile || fs.writeFileSync)(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    (options.rename || fs.renameSync)(temp, target);
    return {ok: true};
  } catch (error: unknown) {
    return {ok: false, error: `无法保存 ${label}：${formatError(error)}`};
  }
}

function removeCatalogFromIndex(
  catalog: AgentMemoryCatalog,
  options: AgentMemoryStoreOptions
): {ok: true; catalogs: AgentMemoryCatalog[]} | {ok: false; error: string} {
  const index = readIndex(options);

  if (!index.ok) {
    return index;
  }

  const catalogs = index.catalogs.filter((item) => item.id !== catalog.id);
  const saved = saveIndex(catalogs, options);

  return saved.ok
    ? {ok: true, catalogs: catalogs.map(cloneCatalog)}
    : saved;
}

function createScope(cwd: string, kind: AgentMemoryScope['kind'], options: AgentMemoryStoreOptions): AgentMemoryScope {
  if (kind === 'global') {
    return {kind: 'global'};
  }

  return {kind: 'project', projectRoot: resolveAgentMemoryProjectRoot(cwd, options)};
}

function findCatalogInScope(catalogs: AgentMemoryCatalog[], name: string, scope: AgentMemoryScope): AgentMemoryCatalog | undefined {
  return catalogs.find((catalog) => sameScope(catalog.scope, scope) && normalizeName(catalog.name) === normalizeName(name));
}

function sameScope(left: AgentMemoryScope, right: AgentMemoryScope): boolean {
  if (left.kind !== right.kind || left.kind === 'global') {
    return left.kind === right.kind;
  }

  return right.kind === 'project' && left.projectRoot === right.projectRoot;
}

function parseCatalog(value: unknown): AgentMemoryCatalog {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.description !== 'string' || !isObject(value.scope)) {
    throw new Error('agent memory catalog 索引条目无效');
  }

  const name = normalizeRequired(value.name, 'agent memory catalog 名称无效');
  const description = normalizeRequired(value.description, 'agent memory catalog description 无效');

  if (!name.ok || !description.ok || value.id.trim() === '') {
    throw new Error(!name.ok ? name.error : !description.ok ? description.error : 'agent memory catalog id 无效');
  }

  const scope = parseScope(value.scope);
  if (!scope) {
    throw new Error('agent memory catalog scope 无效');
  }

  return {id: value.id, name: name.value, description: description.value, scope};
}

function parseItem(value: unknown): AgentMemoryItem {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.trim() === '' || typeof value.content !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    throw new Error('agent memory item 无效');
  }

  const content = normalizeRequired(value.content, 'agent memory item 内容无效');

  if (!content.ok) {
    throw new Error(content.error);
  }

  return {id: value.id, content: content.value, createdAt: value.createdAt, updatedAt: value.updatedAt};
}

function parseScope(scope: Record<string, unknown>): AgentMemoryScope | null {
  if (scope.kind === 'global') {
    return {kind: 'global'};
  }

  if (scope.kind === 'project' && typeof scope.projectRoot === 'string' && scope.projectRoot !== '') {
    return {kind: 'project', projectRoot: path.resolve(scope.projectRoot)};
  }

  return null;
}

function normalizeRequired(value: string, error: string): {ok: true; value: string} | {ok: false; error: string} {
  const normalized = String(value).replace(/\r\n?/g, '\n').trim();
  return normalized === ''
    ? {ok: false, error}
    : {ok: true, value: normalized};
}

function normalizeName(value: string): string {
  return String(value).trim().toLocaleLowerCase();
}

function catalogIdentity(catalog: AgentMemoryCatalog): string {
  const scope = catalog.scope.kind === 'global'
    ? 'global'
    : `project:${catalog.scope.projectRoot}`;
  return `${scope}\0${normalizeName(catalog.name)}`;
}

function cloneCatalog(value: AgentMemoryCatalog): AgentMemoryCatalog {
  return {...value, scope: {...value.scope}};
}

function cloneItem(value: AgentMemoryItem): AgentMemoryItem {
  return {...value};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rootPath(options: AgentMemoryStoreOptions): string {
  return options.storageRoot || path.join((options.homedir || os.homedir)(), '.echo', AGENT_MEMORY_DIR_NAME);
}

function indexPath(options: AgentMemoryStoreOptions): string {
  return path.join(rootPath(options), AGENT_MEMORY_INDEX_NAME);
}

function catalogPath(id: string, options: AgentMemoryStoreOptions): string {
  return path.join(rootPath(options), 'catalogs', `${id}.json`);
}

function tryUnlink(filePath: string, options: AgentMemoryStoreOptions): void {
  try {
    (options.unlink || fs.unlinkSync)(filePath);
  } catch {
    // orphan 文件不在索引中，不影响后续读取。
  }
}

export {
  AGENT_MEMORY_DIR_NAME,
  AGENT_MEMORY_INDEX_NAME,
  AGENT_MEMORY_VERSION,
  addAgentMemory,
  listAgentMemoryCatalogs,
  listEffectiveAgentMemoryCatalogs,
  readAgentMemoryCatalog,
  removeAgentMemoryCatalog,
  removeAgentMemoryItem,
  resolveAgentMemoryProjectRoot,
  updateAgentMemoryCatalog,
  updateAgentMemoryItem
};

export type {AgentMemoryStoreOptions};
