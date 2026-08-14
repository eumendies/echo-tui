import * as fs from 'node:fs';
import * as path from 'node:path';

import {MAX_CUSTOM_SUBAGENTS, validateCustomSubagentManifest} from './catalog';
import {BUILTIN_SUBAGENT_DEFINITIONS} from './definition';
import {MAX_CUSTOM_SUBAGENT_FILE_BYTES, parseCustomSubagentManifest, serializeCustomSubagentManifest} from './manifest';
import {isBuiltinSubagentName, isValidSubagentName} from './name';
import {atomicWriteFile, createContentFingerprint, ensureSafeDirectory, inspectSafeDirectory, readRegularFile} from './safe-storage';

import type {AgentUserConfigSnapshot} from '../../types/agent';
import type {CustomSubagentManifest} from './manifest';
import type {SafeStorageOperations} from './safe-storage';

type AgentManagementScope = 'user' | 'project';
type AgentManagementSourceKind = 'builtin' | AgentManagementScope;
type AgentManagementStatus = 'active' | 'shadowed' | 'invalid' | 'reserved';

type AgentManagementDiagnostic = {
  code: string; // 供 command port 分类展示的稳定诊断码。
  message: string; // 不包含 manifest 正文或底层异常细节的有界摘要。
};

type AgentManagementItem = {
  diagnostics: readonly Readonly<AgentManagementDiagnostic>[]; // 当前物理项的解析、安全或覆盖诊断。
  draft?: Readonly<CustomSubagentManifest>; // 仅完整通过 parser、权限和模型目录校验的可编辑草稿。
  fingerprint?: string; // 普通物理文件原始 UTF-8 内容的 SHA-256 指纹。
  name: string; // 内置名称或物理 Markdown 文件的基础名。
  sourceKind: AgentManagementSourceKind; // 固定内置、用户级或项目级来源。
  sourcePath?: string; // 自定义物理项的规范化绝对路径；内置项没有磁盘路径。
  status: AgentManagementStatus; // 下一运行候选中的生效、遮蔽、无效或保留状态。
};

type AgentManagementSnapshot = {
  diagnostics: readonly Readonly<AgentManagementDiagnostic>[]; // 无法归属到单个文件的目录级诊断。
  items: readonly Readonly<AgentManagementItem>[]; // 按 Built-in、User、Project 和文件名稳定排序的物理项。
};

type AgentManagementStoreOptions = {
  configSnapshot?: AgentUserConfigSnapshot; // 当前管理会话用于严格校验模型 profile 的配置快照。
  homedir: string; // 用户 scope 的可信根目录。
  operations?: SafeStorageOperations; // 文件系统替换缝，用于验证原子写失败清理等安全属性。
  projectRoot: string; // 项目 scope 的可信根目录。
};

type AgentDefinitionMutationResult =
  | {fingerprint?: string; ok: true; sourcePath: string} // 成功创建或更新时返回新指纹，删除时仅返回路径。
  | {code: string; kind: 'validation' | 'conflict' | 'io'; message: string; ok: false; sourcePath?: string}; // 失败保持磁盘原内容并提供稳定分类。

type ScannedCustomItem = {
  diagnostics: AgentManagementDiagnostic[]; // 扫描、解析与共享策略校验产生的当前项诊断。
  draft?: Readonly<CustomSubagentManifest>; // 完整合法时用于表单的结构化草稿。
  fingerprint?: string; // 能安全读取普通文件时计算的内容指纹。
  name: string; // 文件基础名，非法名称也保留供物理视图显示。
  participatesInSelection: boolean; // 是否与 runtime 一样作为普通文件参与同名优先级选择。
  sourceKind: AgentManagementScope; // 当前扫描目录对应的来源 scope。
  sourcePath: string; // 当前直接 Markdown 项的绝对路径。
};

/**
 * 创建只管理固定 user/project Agent 路径的存储。
 * 返回端口不接收任意路径，所有目标都由 scope 与合法名称重新构造。
 */
function createAgentManagementStore(options: AgentManagementStoreOptions) {
  const homedir = path.resolve(options.homedir);
  const projectRoot = path.resolve(options.projectRoot);
  const operations = options.operations || {};

  /** 列出内置定义与两个物理目录中的全部直接 Markdown 项，并投影下一运行的覆盖状态。 */
  function list(): Readonly<AgentManagementSnapshot> {
    const diagnostics: AgentManagementDiagnostic[] = [];
    const userItems = scanScope('user', diagnostics);
    const projectItems = scanScope('project', diagnostics);
    const userCandidates = candidateMap(userItems);
    const projectCandidates = candidateMap(projectItems);
    const selectedNames = Array.from(new Set([...userCandidates.keys(), ...projectCandidates.keys()]))
      .filter((name) => !isBuiltinSubagentName(name))
      .sort((left, right) => left.localeCompare(right, 'en'));
    const selectedIndexes = new Map(selectedNames.map((name, index) => [name, index]));

    const customItems = [...userItems, ...projectItems].map((item): Readonly<AgentManagementItem> => {
      const itemDiagnostics = [...item.diagnostics];
      let status: AgentManagementStatus;
      if (!isValidSubagentName(item.name) || itemDiagnostics.length > 0) {
        status = 'invalid';
      } else if (isBuiltinSubagentName(item.name)) {
        status = 'reserved';
        itemDiagnostics.push({code: 'reserved_name', message: `Custom subagent name "${item.name}" is reserved by a built-in definition.`});
      } else if ((selectedIndexes.get(item.name) ?? 0) >= MAX_CUSTOM_SUBAGENTS) {
        status = 'invalid';
        itemDiagnostics.push({code: 'custom_limit_exceeded', message: `Custom subagent limit of ${MAX_CUSTOM_SUBAGENTS} definitions was exceeded.`});
      } else if (item.sourceKind === 'user' && projectCandidates.has(item.name)) {
        status = 'shadowed';
        itemDiagnostics.push({code: 'shadowed_by_project', message: 'A project definition with the same name takes precedence.'});
      } else {
        status = 'active';
      }
      return freezeItem({
        diagnostics: itemDiagnostics,
        ...(item.draft && status !== 'reserved' ? {draft: item.draft} : {}),
        ...(item.fingerprint ? {fingerprint: item.fingerprint} : {}),
        name: item.name,
        sourceKind: item.sourceKind,
        sourcePath: item.sourcePath,
        status
      });
    });
    const builtins = BUILTIN_SUBAGENT_DEFINITIONS.map((definition): Readonly<AgentManagementItem> => freezeItem({
      diagnostics: [],
      name: definition.name,
      sourceKind: 'builtin',
      status: 'active'
    }));
    return Object.freeze({
      diagnostics: Object.freeze(diagnostics.map(freezeDiagnostic)),
      items: Object.freeze([...builtins, ...customItems])
    });
  }

  /** 创建规范化 manifest；目标在确认后出现时以 conflict 返回，绝不覆盖。 */
  function create(scope: AgentManagementScope, name: string, draft: Readonly<CustomSubagentManifest>): AgentDefinitionMutationResult {
    const target = resolveDefinitionTarget(scope, name);
    if (!target.ok) {
      return target;
    }
    const validated = validateDraft(draft, target.sourcePath);
    if (!validated.ok) {
      return validated;
    }
    const inspectedDirectory = inspectSafeDirectory(scope === 'user' ? homedir : projectRoot, ['.echo', 'agents'], operations);
    if (inspectedDirectory.kind === 'unsafe') {
      return mutationFailure('validation', inspectedDirectory.code, inspectedDirectory.message, target.sourcePath);
    }
    const current = readRegularFile(target.sourcePath, operations);
    if (current.kind !== 'missing') {
      return current.kind === 'file'
        ? mutationFailure('conflict', 'target_exists', 'Agent definition already exists.', target.sourcePath)
        : unsafeMutationFailure(current, target.sourcePath);
    }
    const limitFailure = validateDefinitionLimit(name, target.sourcePath);
    if (limitFailure) {
      return limitFailure;
    }
    try {
      ensureDefinitionDirectory(scope);
      atomicWriteFile(target.sourcePath, validated.content, true, operations);
      return {ok: true, sourcePath: target.sourcePath, fingerprint: createContentFingerprint(validated.content)};
    } catch (error: unknown) {
      return isNodeErrorCode(error, 'EEXIST')
        ? mutationFailure('conflict', 'target_exists', 'Agent definition already exists.', target.sourcePath)
        : mutationFailure('io', 'write_failed', 'Agent definition could not be created.', target.sourcePath);
    }
  }

  /** 复用创建路径与 runtime 策略校验，但不读取或修改目标文件。 */
  function validate(scope: AgentManagementScope, name: string, draft: Readonly<CustomSubagentManifest>): AgentDefinitionMutationResult {
    const target = resolveDefinitionTarget(scope, name);
    if (!target.ok) {
      return target;
    }
    const validated = validateDraft(draft, target.sourcePath);
    if (!validated.ok) {
      return validated;
    }
    return validateDefinitionLimit(name, target.sourcePath) || {ok: true, sourcePath: target.sourcePath};
  }

  /** 仅在目标仍为同一普通文件且内容指纹匹配时原子替换规范化 manifest。 */
  function update(scope: AgentManagementScope, name: string, draft: Readonly<CustomSubagentManifest>, expectedFingerprint: string): AgentDefinitionMutationResult {
    const target = resolveDefinitionTarget(scope, name);
    if (!target.ok) {
      return target;
    }
    const validated = validateDraft(draft, target.sourcePath);
    if (!validated.ok) {
      return validated;
    }
    const directoryFailure = requireSafeDefinitionDirectory(scope, target.sourcePath);
    if (directoryFailure) {
      return directoryFailure;
    }
    const conflict = checkExpectedFile(target.sourcePath, expectedFingerprint);
    if (conflict) {
      return conflict;
    }
    try {
      atomicWriteFile(target.sourcePath, validated.content, false, operations);
      return {ok: true, sourcePath: target.sourcePath, fingerprint: createContentFingerprint(validated.content)};
    } catch {
      return mutationFailure('io', 'write_failed', 'Agent definition could not be updated.', target.sourcePath);
    }
  }

  /** 仅删除指纹仍匹配的普通定义文件，符号链接和目录均保持不动。 */
  function remove(scope: AgentManagementScope, name: string, expectedFingerprint: string): AgentDefinitionMutationResult {
    const target = resolveDefinitionTarget(scope, name, 'physical');
    if (!target.ok) {
      return target;
    }
    const directoryFailure = requireSafeDefinitionDirectory(scope, target.sourcePath);
    if (directoryFailure) {
      return directoryFailure;
    }
    const conflict = checkExpectedFile(target.sourcePath, expectedFingerprint);
    if (conflict) {
      return conflict;
    }
    try {
      (operations.unlink || fs.unlinkSync)(target.sourcePath);
      return {ok: true, sourcePath: target.sourcePath};
    } catch {
      return mutationFailure('io', 'delete_failed', 'Agent definition could not be deleted.', target.sourcePath);
    }
  }

  function scanScope(scope: AgentManagementScope, directoryDiagnostics: AgentManagementDiagnostic[]): ScannedCustomItem[] {
    const dirPath = definitionDirectory(scope);
    const inspectedDirectory = inspectSafeDirectory(scope === 'user' ? homedir : projectRoot, ['.echo', 'agents'], operations);
    if (inspectedDirectory.kind === 'missing') {
      return [];
    }
    if (inspectedDirectory.kind === 'unsafe') {
      directoryDiagnostics.push({code: inspectedDirectory.code, message: `${scope} Agent directory could not be safely read.`});
      return [];
    }
    let names: string[];
    try {
      names = fs.readdirSync(dirPath).filter((name) => name.endsWith('.md')).sort((left, right) => left.localeCompare(right, 'en'));
    } catch (error: unknown) {
      if (!isNodeErrorCode(error, 'ENOENT')) {
        directoryDiagnostics.push({code: 'directory_unreadable', message: `${scope} Agent directory could not be read.`});
      }
      return [];
    }

    return names.map((fileName) => {
      const sourcePath = path.join(dirPath, fileName);
      const name = fileName.slice(0, -3);
      const diagnostics: AgentManagementDiagnostic[] = [];
      const read = readRegularFile(sourcePath, operations, MAX_CUSTOM_SUBAGENT_FILE_BYTES);
      if (!isValidSubagentName(name)) {
        diagnostics.push({code: 'invalid_name', message: 'Custom subagent filename must match [a-z0-9][a-z0-9_-]{0,63}.md.'});
      }
      if (read.kind === 'missing') {
        diagnostics.push({code: 'file_unreadable', message: 'Custom subagent file disappeared during scanning.'});
        return {diagnostics, name, participatesInSelection: false, sourceKind: scope, sourcePath};
      }
      if (read.kind === 'unsafe') {
        diagnostics.push({code: read.code, message: read.message});
        return {diagnostics, name, participatesInSelection: false, sourceKind: scope, sourcePath};
      }
      if (!isValidSubagentName(name) || isBuiltinSubagentName(name)) {
        return {diagnostics, fingerprint: read.fingerprint, name, participatesInSelection: true, sourceKind: scope, sourcePath};
      }
      const parsed = parseCustomSubagentManifest(read.content);
      if (!parsed.ok) {
        diagnostics.push(parsed.error);
        return {diagnostics, fingerprint: read.fingerprint, name, participatesInSelection: true, sourceKind: scope, sourcePath};
      }
      const policy = validateCustomSubagentManifest(parsed.manifest, options.configSnapshot);
      if (!policy.ok) {
        diagnostics.push({code: policy.code, message: policy.message});
        return {diagnostics, fingerprint: read.fingerprint, name, participatesInSelection: true, sourceKind: scope, sourcePath};
      }
      return {
        diagnostics,
        draft: freezeDraft(parsed.manifest),
        fingerprint: read.fingerprint,
        name,
        participatesInSelection: true,
        sourceKind: scope,
        sourcePath
      };
    });
  }

  function candidateMap(items: readonly ScannedCustomItem[]): Map<string, ScannedCustomItem> {
    return new Map(items.filter((item) => item.participatesInSelection && isValidSubagentName(item.name)).map((item) => [item.name, item]));
  }

  function resolveDefinitionTarget(
    scope: AgentManagementScope,
    name: string,
    mode: 'definition' | 'physical' = 'definition'
  ): {ok: true; sourcePath: string} | Extract<AgentDefinitionMutationResult, {ok: false}> {
    if (scope !== 'user' && scope !== 'project') {
      return mutationFailure('validation', 'invalid_scope', 'Agent definition scope must be user or project.');
    }
    const validName = mode === 'definition'
      ? isValidSubagentName(name)
      : name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('\0');
    if (!validName) {
      return mutationFailure('validation', 'invalid_name', 'Agent definition name is invalid.');
    }
    if (mode === 'definition' && isBuiltinSubagentName(name)) {
      return mutationFailure('validation', 'reserved_name', `Agent definition name "${name}" is reserved.`);
    }
    const dirPath = definitionDirectory(scope);
    const sourcePath = path.resolve(dirPath, `${name}.md`);
    if (path.dirname(sourcePath) !== dirPath) {
      return mutationFailure('validation', 'path_escape', 'Agent definition path escapes its managed directory.');
    }
    return {ok: true, sourcePath};
  }

  function validateDraft(draft: Readonly<CustomSubagentManifest>, sourcePath: string): {ok: true; content: string} | Extract<AgentDefinitionMutationResult, {ok: false}> {
    let content: string;
    try {
      content = serializeCustomSubagentManifest(draft);
    } catch {
      return mutationFailure('validation', 'invalid_manifest', 'Agent manifest draft is invalid.', sourcePath);
    }
    const parsed = parseCustomSubagentManifest(content);
    if (!parsed.ok) {
      return mutationFailure('validation', parsed.error.code, parsed.error.message, sourcePath);
    }
    const policy = validateCustomSubagentManifest(parsed.manifest, options.configSnapshot);
    return policy.ok
      ? {ok: true, content}
      : mutationFailure('validation', policy.code, policy.message, sourcePath);
  }

  function checkExpectedFile(sourcePath: string, expectedFingerprint: string): Extract<AgentDefinitionMutationResult, {ok: false}> | undefined {
    const current = readRegularFile(sourcePath, operations);
    if (current.kind === 'unsafe') {
      return unsafeMutationFailure(current, sourcePath);
    }
    if (current.kind === 'missing' || current.fingerprint !== expectedFingerprint) {
      return mutationFailure('conflict', 'content_conflict', 'Agent definition changed since it was read.', sourcePath);
    }
    return undefined;
  }

  /** 新定义只有在不增加超限有效名称时才允许落盘；同名跨 scope 遮蔽不额外占用目录名额。 */
  function validateDefinitionLimit(name: string, sourcePath: string): Extract<AgentDefinitionMutationResult, {ok: false}> | undefined {
    const names = new Set(list().items
      .filter((item) => item.sourceKind !== 'builtin' && isValidSubagentName(item.name) && !isBuiltinSubagentName(item.name))
      .map((item) => item.name));
    return !names.has(name) && names.size >= MAX_CUSTOM_SUBAGENTS
      ? mutationFailure('validation', 'custom_limit_exceeded', `Custom subagent limit of ${MAX_CUSTOM_SUBAGENTS} definitions was reached.`, sourcePath)
      : undefined;
  }

  function definitionDirectory(scope: AgentManagementScope): string {
    const root = scope === 'user' ? homedir : projectRoot;
    return path.join(root, '.echo', 'agents');
  }

  function ensureDefinitionDirectory(scope: AgentManagementScope): string {
    return ensureSafeDirectory(scope === 'user' ? homedir : projectRoot, ['.echo', 'agents'], operations);
  }

  function requireSafeDefinitionDirectory(scope: AgentManagementScope, sourcePath: string): Extract<AgentDefinitionMutationResult, {ok: false}> | undefined {
    const inspected = inspectSafeDirectory(scope === 'user' ? homedir : projectRoot, ['.echo', 'agents'], operations);
    return inspected.kind === 'safe'
      ? undefined
      : mutationFailure('validation', inspected.kind === 'unsafe' ? inspected.code : 'content_conflict', inspected.kind === 'unsafe' ? inspected.message : 'Agent definition changed since it was read.', sourcePath);
  }

  return Object.freeze({create, list, remove, update, validate});
}

function freezeDraft(draft: Readonly<CustomSubagentManifest>): Readonly<CustomSubagentManifest> {
  return Object.freeze({...draft, tools: Object.freeze([...draft.tools])});
}

function freezeDiagnostic(diagnostic: AgentManagementDiagnostic): Readonly<AgentManagementDiagnostic> {
  return Object.freeze({...diagnostic});
}

function freezeItem(item: AgentManagementItem): Readonly<AgentManagementItem> {
  return Object.freeze({...item, diagnostics: Object.freeze(item.diagnostics.map(freezeDiagnostic))});
}

function mutationFailure(kind: 'validation' | 'conflict' | 'io', code: string, message: string, sourcePath?: string): Extract<AgentDefinitionMutationResult, {ok: false}> {
  return {ok: false, kind, code, message, ...(sourcePath ? {sourcePath} : {})};
}

function unsafeMutationFailure(read: Extract<ReturnType<typeof readRegularFile>, {kind: 'unsafe'}>, sourcePath: string): Extract<AgentDefinitionMutationResult, {ok: false}> {
  return mutationFailure('validation', read.code, read.message, sourcePath);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export {createAgentManagementStore};
export type {
  AgentDefinitionMutationResult,
  AgentManagementDiagnostic,
  AgentManagementItem,
  AgentManagementScope,
  AgentManagementSnapshot,
  AgentManagementSourceKind,
  AgentManagementStatus,
  AgentManagementStoreOptions
};
