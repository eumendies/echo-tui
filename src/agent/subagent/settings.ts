import * as fs from 'node:fs';
import * as path from 'node:path';

import {SUBAGENT_EFFORT_POLICIES} from './manifest';
import {atomicWriteFile, createContentFingerprint, ensureSafeDirectory, inspectSafeDirectory, readRegularFile} from './safe-storage';

import type {AgentUserConfigSnapshot} from '../../types/agent';
import type {SubagentEffortPolicy} from './definition';
import type {SafeStorageOperations} from './safe-storage';

const AGENTS_SETTINGS_SCHEMA_VERSION = 1;
const MAX_AGENTS_SETTINGS_FILE_BYTES = 16 * 1024;

type BuiltinSubagentName = 'explorer' | 'worker';

type BuiltinSubagentOverride = {
  effort: SubagentEffortPolicy; // 缺省归一化为 inherit；default 与固定档位保留原策略。
  modelProfileId?: string; // 同一父 run 配置 snapshot 内待严格验证的模型引用。
};

type ParsedAgentsSettings = {
  overrides: Readonly<Partial<Record<BuiltinSubagentName, Readonly<BuiltinSubagentOverride>>>>; // 当前物理文件声明的内置策略条目。
  schemaVersion: 1; // 已验证且受当前 runtime 支持的固定格式版本。
};

type AgentsSettingsError = {
  code: string; // 不包含文件正文的稳定诊断码。
  message: string; // 不包含凭据或任意 JSON 值的有界诊断摘要。
};

type AgentsSettingsParseResult =
  | {ok: true; settings: Readonly<ParsedAgentsSettings>} // 完整文件通过严格 schema 后才返回设置。
  | {ok: false; error: Readonly<AgentsSettingsError>}; // 任一未知或非法字段使整个物理文件失效。

type AgentsSettingsScope = 'user' | 'project';

type AgentsSettingsStoreOptions = {
  configSnapshot?: AgentUserConfigSnapshot; // 内置 override 模型引用严格校验使用的当前配置快照。
  homedir: string; // 用户级 sidecar 的可信根目录。
  operations?: SafeStorageOperations; // 原子写、安全读取与失败清理的文件系统替换缝。
  projectRoot: string; // 项目级 sidecar 的可信根目录。
};

type AgentsSettingsScopeReadResult = {
  error?: Readonly<AgentsSettingsError>; // invalid 时提供不含文件正文的失败原因。
  fingerprint?: string; // 普通文件原始 UTF-8 内容的 SHA-256 冲突指纹。
  settings?: Readonly<ParsedAgentsSettings>; // valid 时提供完整严格解析后的 sidecar。
  sourceKind: AgentsSettingsScope; // 当前读取对应的用户级或项目级来源。
  sourcePath: string; // 由 scope 固定构造的 sidecar 绝对路径。
  status: 'missing' | 'valid' | 'invalid'; // 缺失、合法或不可安全修改的物理状态。
};

type AgentsSettingsMutationResult =
  | {fingerprint?: string; ok: true; sourcePath: string} // 写入返回新指纹，删除最后一项时只返回路径。
  | {code: string; kind: 'validation' | 'conflict' | 'io'; message: string; ok: false; sourcePath: string}; // 失败时磁盘原内容保持不变。

type SelectedBuiltinSubagentOverride = {
  override: Readonly<BuiltinSubagentOverride>; // 最高有效来源中的完整内置策略，不跨来源合并字段。
  sourceKind: AgentsSettingsScope; // 实际胜出的用户级或项目级来源。
  sourcePath: string; // 胜出策略所在 sidecar 的固定绝对路径。
};

/** 严格解析版本化内置策略文件，不允许 schema 外字段或隐式类型转换。 */
function parseAgentsSettings(rawContent: string): AgentsSettingsParseResult {
  if (typeof rawContent !== 'string') {
    return settingsFailure('invalid_file', 'Agents settings must be UTF-8 text.');
  }
  if (Buffer.byteLength(rawContent, 'utf8') > MAX_AGENTS_SETTINGS_FILE_BYTES) {
    return settingsFailure('settings_too_large', `Agents settings exceeds ${MAX_AGENTS_SETTINGS_FILE_BYTES} UTF-8 bytes.`);
  }

  let root: unknown;
  try {
    root = JSON.parse(rawContent);
  } catch {
    return settingsFailure('invalid_settings_json', 'Agents settings must contain valid JSON.');
  }
  if (!isPlainObject(root)) {
    return settingsFailure('invalid_settings_root', 'Agents settings root must be an object.');
  }
  if (!hasOnlyKeys(root, ['schemaVersion', 'overrides'])) {
    return settingsFailure('unknown_settings_field', 'Agents settings contains an unknown root field.');
  }
  if (root.schemaVersion !== AGENTS_SETTINGS_SCHEMA_VERSION) {
    return settingsFailure('unsupported_settings_version', `Agents settings schemaVersion must be ${AGENTS_SETTINGS_SCHEMA_VERSION}.`);
  }
  if (!isPlainObject(root.overrides) || !hasOnlyKeys(root.overrides, ['explorer', 'worker'])) {
    return settingsFailure('invalid_settings_overrides', 'Agents settings overrides must contain only explorer or worker objects.');
  }

  const overrides: Partial<Record<BuiltinSubagentName, Readonly<BuiltinSubagentOverride>>> = {};
  for (const name of ['explorer', 'worker'] as const) {
    if (!Object.hasOwn(root.overrides, name)) {
      continue;
    }
    const parsed = parseBuiltinOverride(root.overrides[name], name);
    if (!parsed.ok) {
      return parsed;
    }
    overrides[name] = Object.freeze(parsed.override);
  }

  return {
    ok: true,
    settings: Object.freeze({
      overrides: Object.freeze(overrides),
      schemaVersion: AGENTS_SETTINGS_SCHEMA_VERSION
    })
  };
}

/** 按固定字段顺序序列化已解析 settings，并通过共享 parser 复核输出。 */
function serializeAgentsSettings(settings: Readonly<ParsedAgentsSettings>): string {
  const overrides: Partial<Record<BuiltinSubagentName, BuiltinSubagentOverride>> = {};
  for (const name of ['explorer', 'worker'] as const) {
    const override = settings.overrides[name];
    if (!override) {
      continue;
    }
    overrides[name] = {
      ...(override.modelProfileId ? {modelProfileId: override.modelProfileId} : {}),
      effort: override.effort
    };
  }
  const serialized = `${JSON.stringify({schemaVersion: AGENTS_SETTINGS_SCHEMA_VERSION, overrides}, null, 2)}\n`;
  const parsed = parseAgentsSettings(serialized);
  if (!parsed.ok) {
    throw new Error(`Cannot serialize invalid agents settings: ${parsed.error.message}`);
  }
  return serialized;
}

/** 读取用户和项目两个固定 sidecar；缺失与失效保持可区分，供 catalog 执行遮蔽规则。 */
function loadAgentsSettingsSources(options: AgentsSettingsStoreOptions): readonly Readonly<AgentsSettingsScopeReadResult>[] {
  return Object.freeze([
    readAgentsSettingsScope('user', options),
    readAgentsSettingsScope('project', options)
  ]);
}

/** 选择最高优先级完整策略；任一更高来源失效时禁止回退或跨来源补齐。 */
function selectBuiltinSubagentOverride(
  name: BuiltinSubagentName,
  sources: readonly Readonly<AgentsSettingsScopeReadResult>[]
): Readonly<SelectedBuiltinSubagentOverride> | undefined {
  const user = sources.find((source) => source.sourceKind === 'user');
  const project = sources.find((source) => source.sourceKind === 'project');
  if (project?.status === 'invalid') {
    return undefined;
  }
  const projectOverride = project?.settings?.overrides[name];
  if (projectOverride && project) {
    return Object.freeze({override: projectOverride, sourceKind: 'project', sourcePath: project.sourcePath});
  }
  if (user?.status === 'invalid') {
    return undefined;
  }
  const userOverride = user?.settings?.overrides[name];
  return userOverride && user
    ? Object.freeze({override: userOverride, sourceKind: 'user', sourcePath: user.sourcePath})
    : undefined;
}

/** 安全读取单个 scope 的固定 sidecar，并返回用于后续乐观写入的内容指纹。 */
function readAgentsSettingsScope(scope: AgentsSettingsScope, options: AgentsSettingsStoreOptions): Readonly<AgentsSettingsScopeReadResult> {
  const sourcePath = settingsPath(scope, options);
  const directory = inspectSafeDirectory(scopeRoot(scope, options), ['.echo'], options.operations);
  if (directory.kind === 'missing') {
    return Object.freeze({sourceKind: scope, sourcePath, status: 'missing'});
  }
  if (directory.kind === 'unsafe') {
    return Object.freeze({
      error: Object.freeze({code: directory.code, message: directory.message}),
      sourceKind: scope,
      sourcePath,
      status: 'invalid'
    });
  }
  const read = readRegularFile(sourcePath, options.operations, MAX_AGENTS_SETTINGS_FILE_BYTES);
  if (read.kind === 'missing') {
    return Object.freeze({sourceKind: scope, sourcePath, status: 'missing'});
  }
  if (read.kind === 'unsafe') {
    const error = read.code === 'file_too_large'
      ? {code: 'settings_too_large', message: `Agents settings exceeds ${MAX_AGENTS_SETTINGS_FILE_BYTES} UTF-8 bytes.`}
      : {code: read.code, message: read.message};
    return Object.freeze({
      error: Object.freeze(error),
      sourceKind: scope,
      sourcePath,
      status: 'invalid'
    });
  }
  const parsed = parseAgentsSettings(read.content);
  return parsed.ok
    ? Object.freeze({fingerprint: read.fingerprint, settings: parsed.settings, sourceKind: scope, sourcePath, status: 'valid'})
    : Object.freeze({error: parsed.error, fingerprint: read.fingerprint, sourceKind: scope, sourcePath, status: 'invalid'});
}

/**
 * 在完整 sidecar 指纹仍匹配时设置一个内置 override。
 * expectedFingerprint=null 明确表示调用方只接受 sidecar 当前不存在。
 */
function writeBuiltinSubagentOverride(
  scope: AgentsSettingsScope,
  name: BuiltinSubagentName,
  override: Readonly<BuiltinSubagentOverride>,
  expectedFingerprint: string | null,
  options: AgentsSettingsStoreOptions
): AgentsSettingsMutationResult {
  const sourcePath = settingsPath(scope, options);
  if (name !== 'explorer' && name !== 'worker') {
    return settingsMutationFailure('validation', 'invalid_builtin_name', 'Built-in override name must be explorer or worker.', sourcePath);
  }
  const normalized = parseBuiltinOverride(override, name);
  if (!normalized.ok) {
    return settingsMutationFailure('validation', normalized.error.code, normalized.error.message, sourcePath);
  }
  if (normalized.override.modelProfileId && !readModelProfileIds(options.configSnapshot).has(normalized.override.modelProfileId)) {
    return settingsMutationFailure('validation', 'model_profile_not_found', `Model profile "${safeDiagnosticValue(normalized.override.modelProfileId)}" does not exist in the current configuration snapshot.`, sourcePath);
  }

  const current = readAgentsSettingsScope(scope, options);
  const conflict = checkSettingsFingerprint(current, expectedFingerprint);
  if (conflict) {
    return conflict;
  }
  if (current.status === 'invalid') {
    return settingsMutationFailure('validation', current.error?.code || 'invalid_settings', current.error?.message || 'Agents settings is invalid.', sourcePath);
  }
  const overrides = current.settings ? {...current.settings.overrides} : {};
  overrides[name] = Object.freeze(normalized.override);
  const content = serializeAgentsSettings({schemaVersion: AGENTS_SETTINGS_SCHEMA_VERSION, overrides});

  try {
    ensureSafeDirectory(scopeRoot(scope, options), ['.echo'], options.operations);
    atomicWriteFile(sourcePath, content, current.status === 'missing', options.operations);
    return {ok: true, sourcePath, fingerprint: createContentFingerprint(content)};
  } catch (error: unknown) {
    return isNodeErrorCode(error, 'EEXIST')
      ? settingsMutationFailure('conflict', 'content_conflict', 'Agents settings changed since it was read.', sourcePath)
      : settingsMutationFailure('io', 'settings_write_failed', 'Agents settings could not be written.', sourcePath);
  }
}

/** 删除指纹仍匹配的单个内置 override；最后一项删除时移除空 sidecar。 */
function deleteBuiltinSubagentOverride(
  scope: AgentsSettingsScope,
  name: BuiltinSubagentName,
  expectedFingerprint: string,
  options: AgentsSettingsStoreOptions
): AgentsSettingsMutationResult {
  const sourcePath = settingsPath(scope, options);
  if (name !== 'explorer' && name !== 'worker') {
    return settingsMutationFailure('validation', 'invalid_builtin_name', 'Built-in override name must be explorer or worker.', sourcePath);
  }
  const current = readAgentsSettingsScope(scope, options);
  const conflict = checkSettingsFingerprint(current, expectedFingerprint);
  if (conflict) {
    return conflict;
  }
  if (current.status !== 'valid' || !current.settings) {
    return settingsMutationFailure('validation', current.error?.code || 'override_not_found', current.error?.message || 'Built-in override does not exist.', sourcePath);
  }
  if (!current.settings.overrides[name]) {
    return settingsMutationFailure('validation', 'override_not_found', `Built-in override for ${name} does not exist.`, sourcePath);
  }
  const overrides = {...current.settings.overrides};
  delete overrides[name];

  try {
    if (Object.keys(overrides).length === 0) {
      (options.operations?.unlink || fs.unlinkSync)(sourcePath);
      return {ok: true, sourcePath};
    }
    const content = serializeAgentsSettings({schemaVersion: AGENTS_SETTINGS_SCHEMA_VERSION, overrides});
    atomicWriteFile(sourcePath, content, false, options.operations);
    return {ok: true, sourcePath, fingerprint: createContentFingerprint(content)};
  } catch {
    return settingsMutationFailure('io', 'settings_delete_failed', 'Built-in override could not be deleted.', sourcePath);
  }
}

/** 校验单个内置条目，字段缺省只代表继承父策略，不从低优先级条目补齐。 */
function parseBuiltinOverride(value: unknown, name: BuiltinSubagentName):
  | {ok: true; override: BuiltinSubagentOverride}
  | {ok: false; error: Readonly<AgentsSettingsError>} {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['modelProfileId', 'effort'])) {
    return settingsFailure('invalid_builtin_override', `Agents settings override for ${name} contains unsupported fields.`);
  }
  if (value.modelProfileId !== undefined && (
    typeof value.modelProfileId !== 'string'
    || value.modelProfileId.trim() === ''
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value.modelProfileId)
  )) {
    return settingsFailure('invalid_override_model', `Agents settings override for ${name} requires a non-empty modelProfileId.`);
  }
  if (value.effort !== undefined
    && (typeof value.effort !== 'string' || !(SUBAGENT_EFFORT_POLICIES as readonly string[]).includes(value.effort))) {
    return settingsFailure('invalid_override_effort', `Agents settings override for ${name} has an unsupported effort policy.`);
  }

  return {
    ok: true,
    override: {
      effort: (value.effort || 'inherit') as SubagentEffortPolicy,
      ...(typeof value.modelProfileId === 'string' ? {modelProfileId: value.modelProfileId} : {})
    }
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function settingsFailure(code: string, message: string): {ok: false; error: Readonly<AgentsSettingsError>} {
  return {ok: false, error: Object.freeze({code, message})};
}

function scopeRoot(scope: AgentsSettingsScope, options: AgentsSettingsStoreOptions): string {
  return path.resolve(scope === 'user' ? options.homedir : options.projectRoot);
}

function settingsPath(scope: AgentsSettingsScope, options: AgentsSettingsStoreOptions): string {
  return path.join(scopeRoot(scope, options), '.echo', 'agents.settings.json');
}

function checkSettingsFingerprint(current: Readonly<AgentsSettingsScopeReadResult>, expectedFingerprint: string | null): AgentsSettingsMutationResult | undefined {
  const matchesMissing = current.status === 'missing' && expectedFingerprint === null;
  const matchesFile = current.status !== 'missing' && current.fingerprint === expectedFingerprint;
  return matchesMissing || matchesFile
    ? undefined
    : settingsMutationFailure('conflict', 'content_conflict', 'Agents settings changed since it was read.', current.sourcePath);
}

function readModelProfileIds(snapshot?: AgentUserConfigSnapshot): ReadonlySet<string> {
  if (!snapshot) {
    return new Set();
  }
  try {
    return new Set(snapshot.getLlmModelConfigInfo().models.map((model) => model.id));
  } catch {
    return new Set();
  }
}

function safeDiagnosticValue(value: string): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')).slice(0, 80).join('');
}

function settingsMutationFailure(kind: 'validation' | 'conflict' | 'io', code: string, message: string, sourcePath: string): Extract<AgentsSettingsMutationResult, {ok: false}> {
  return {ok: false, kind, code, message, sourcePath};
}

export {
  AGENTS_SETTINGS_SCHEMA_VERSION,
  MAX_AGENTS_SETTINGS_FILE_BYTES,
  loadAgentsSettingsSources,
  parseAgentsSettings,
  readAgentsSettingsScope,
  selectBuiltinSubagentOverride,
  serializeAgentsSettings,
  writeBuiltinSubagentOverride,
  deleteBuiltinSubagentOverride
};

export type {
  AgentsSettingsError,
  AgentsSettingsParseResult,
  AgentsSettingsMutationResult,
  AgentsSettingsScope,
  AgentsSettingsScopeReadResult,
  AgentsSettingsStoreOptions,
  BuiltinSubagentName,
  BuiltinSubagentOverride,
  ParsedAgentsSettings,
  SelectedBuiltinSubagentOverride
};
