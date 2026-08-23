import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {findProjectRoot} from '../agent-instructions';
import {
  BUILTIN_SUBAGENT_DEFINITIONS,
  GENERAL_SUBAGENT_TOOL_CEILING,
  READONLY_SUBAGENT_TOOL_CEILING,
  createCustomSubagentPrompt,
  freezeSubagentDefinition
} from './definition';
import {parseCustomSubagentManifest} from './manifest';
import {MAX_CUSTOM_SUBAGENT_FILE_BYTES} from './manifest';
import {isBuiltinSubagentName, isValidSubagentName} from './name';
import {inspectSafeDirectory} from './safe-storage';
import {loadAgentsSettingsSources, selectBuiltinSubagentOverride} from './settings';

import type {AgentUserConfigSnapshot} from '../../types/agent';
import type {BuiltinSubagentName, SelectedBuiltinSubagentOverride} from './settings';
import type {CustomSubagentManifest} from './manifest';
import type {SubagentDefinition} from './definition';

const MAX_CUSTOM_SUBAGENTS = 32;
const MAX_SUBAGENT_DIAGNOSTICS = 64;
const MAX_SUBAGENT_DIAGNOSTIC_MESSAGE_CODE_POINTS = 500;

type SubagentCatalogDescriptor = {
  description: string; // 主 Agent schema 可见的有界能力说明。
  name: string; // 运行期查找定义使用的稳定名称。
};

type SubagentCatalogDiagnostic = {
  code: string; // 可供 debug 或后续管理界面分类的稳定错误码。
  message: string; // 不含 manifest 正文的有界操作提示。
  sourceKind: 'user' | 'project'; // 产生诊断的自定义来源层级。
  sourcePath: string; // 规范化绝对候选路径，便于定位错误文件。
};

type SubagentCatalog = {
  diagnostics: readonly Readonly<SubagentCatalogDiagnostic>[]; // 本次加载形成的冻结有界诊断快照。
  get: (name: string) => Readonly<SubagentDefinition> | undefined; // 从同一冻结快照按名称取定义。
  listDescriptors: () => readonly Readonly<SubagentCatalogDescriptor>[]; // 按确定性目录顺序列出 schema 投影。
};

type SubagentCatalogLoadOptions = {
  configSnapshot?: AgentUserConfigSnapshot; // 父 run 捕获的同一配置 revision，用于严格验证非敏感模型引用。
  cwd?: string; // 项目根发现的起始工作目录。
  homedir?: string | (() => string); // 用户级 agents 路径和项目根边界使用的 home。
  readDir?: (dirPath: string) => readonly fs.Dirent[]; // 可注入的同步目录枚举依赖。
  readFile?: (filePath: string, encoding: BufferEncoding) => string; // 可注入的 UTF-8 文件读取依赖。
  stat?: (filePath: string) => fs.Stats; // 可注入的项目 marker 与候选文件状态依赖。
};

type CustomSubagentCandidate = {
  name: string; // 从合法小写 .md 文件基础名派生的稳定名称。
  sourceKind: 'user' | 'project'; // 候选所属优先级层级。
  sourcePath: string; // 规范化绝对定义文件路径。
};

type CandidateScan = {
  candidates: readonly CustomSubagentCandidate[]; // 当前层按文件名排序的合法名称候选。
  diagnostics: readonly Readonly<SubagentCatalogDiagnostic>[]; // 当前层扫描时产生的文件名或目录诊断。
};

type CustomSubagentManifestValidationResult =
  | {ok: true} // manifest 同时满足 capability ceiling 与当前模型目录约束。
  | {code: string; message: string; ok: false}; // 校验失败时返回不包含正文的稳定诊断。

/**
 * 扫描用户级和项目级目录并形成一次性的冻结 Subagent 目录。
 * 项目候选覆盖同名用户候选；高层候选解析失败时不会回退低层定义。
 */
function loadSubagentCatalog(options: SubagentCatalogLoadOptions = {}): Readonly<SubagentCatalog> {
  const cwd = path.resolve(options.cwd || process.cwd());
  const homedirValue = typeof options.homedir === 'function' ? options.homedir() : (options.homedir || os.homedir());
  const homedir = path.resolve(homedirValue);
  const stat = options.stat || fs.statSync;
  const readDir = options.readDir || ((dirPath: string) => fs.readdirSync(dirPath, {withFileTypes: true}));
  const readFile = options.readFile || fs.readFileSync;
  const projectRoot = path.resolve(findProjectRoot(cwd, homedir, stat) || cwd);
  const modelProfileIds = readModelProfileIds(options.configSnapshot);
  const userScan = scanCandidateDirectory(homedir, 'user', readDir);
  const projectScan = scanCandidateDirectory(projectRoot, 'project', readDir);
  const diagnostics: SubagentCatalogDiagnostic[] = [];
  appendDiagnostics(diagnostics, userScan.diagnostics);
  appendDiagnostics(diagnostics, projectScan.diagnostics);

  const settingsSources = loadAgentsSettingsSources({homedir, projectRoot});
  const definitionsByName = new Map<string, Readonly<SubagentDefinition>>();
  appendSettingsSourceDiagnostics(diagnostics, settingsSources);
  for (const builtin of BUILTIN_SUBAGENT_DEFINITIONS) {
    definitionsByName.set(builtin.name, applyBuiltinOverride(
      builtin,
      selectBuiltinSubagentOverride(builtin.name as BuiltinSubagentName, settingsSources),
      modelProfileIds,
      diagnostics
    ));
  }
  const userByName = new Map(userScan.candidates.map((candidate) => [candidate.name, candidate]));
  const projectByName = new Map(projectScan.candidates.map((candidate) => [candidate.name, candidate]));

  for (const candidate of [...userScan.candidates, ...projectScan.candidates]) {
    if (isBuiltinSubagentName(candidate.name)) {
      appendDiagnostic(diagnostics, {
        code: 'reserved_name',
        message: `Custom subagent name "${candidate.name}" is reserved by a built-in definition.`,
        sourceKind: candidate.sourceKind,
        sourcePath: candidate.sourcePath
      });
    }
  }

  const selectedNames = Array.from(new Set([...userByName.keys(), ...projectByName.keys()]))
    .filter((name) => !isBuiltinSubagentName(name))
    .sort((left, right) => left.localeCompare(right, 'en'));

  for (const [index, name] of selectedNames.entries()) {
    const candidate = projectByName.get(name) || userByName.get(name)!;
    if (index >= MAX_CUSTOM_SUBAGENTS) {
      appendDiagnostic(diagnostics, {
        code: 'custom_limit_exceeded',
        message: `Custom subagent limit of ${MAX_CUSTOM_SUBAGENTS} definitions was exceeded.`,
        sourceKind: candidate.sourceKind,
        sourcePath: candidate.sourcePath
      });
      continue;
    }

    const loaded = loadCandidate(candidate, {modelProfileIds, readFile, stat});
    if (!loaded.ok) {
      appendDiagnostic(diagnostics, loaded.diagnostic);
      continue;
    }
    definitionsByName.set(name, loaded.definition);
  }

  const definitions = Object.freeze(Array.from(definitionsByName.values()));
  const descriptors = Object.freeze(definitions.map((definition) => Object.freeze({
    description: definition.description,
    name: definition.name
  })));
  const frozenDiagnostics = Object.freeze(diagnostics.map((diagnostic) => Object.freeze({...diagnostic})));
  const catalog: SubagentCatalog = {
    diagnostics: frozenDiagnostics,
    get(name) {
      return definitionsByName.get(name);
    },
    listDescriptors() {
      return descriptors;
    }
  };
  return Object.freeze(catalog);
}

/**
 * 从父 snapshot 读取非敏感目录；主配置错误仍由主 runtime 的统一装配路径报告。
 * 目录不可用时返回空集合，使任何显式 Subagent 引用保持 fail-closed。
 */
function readModelProfileIds(snapshot?: AgentUserConfigSnapshot): ReadonlySet<string> {
  if (!snapshot || typeof snapshot.getLlmModelConfigInfo !== 'function') {
    return new Set();
  }
  try {
    return new Set(snapshot.getLlmModelConfigInfo().models.map((model) => model.id));
  } catch {
    return new Set();
  }
}

/** 复用 runtime catalog 的 capability、MCP 与模型目录规则校验管理端草稿。 */
function validateCustomSubagentManifest(
  manifest: Readonly<CustomSubagentManifest>,
  configSnapshot?: AgentUserConfigSnapshot
): CustomSubagentManifestValidationResult {
  return validateManifestPolicy(manifest, readModelProfileIds(configSnapshot));
}

/** 检查固定目录链后枚举直接子项，仅接纳小写 .md 普通文件。 */
function scanCandidateDirectory(rootPath: string, sourceKind: 'user' | 'project', readDir: (dirPath: string) => readonly fs.Dirent[]): CandidateScan {
  const inspected = inspectSafeDirectory(rootPath, ['.echo', 'agents']);
  const dirPath = path.join(path.resolve(rootPath), '.echo', 'agents');
  if (inspected.kind === 'missing') {
    return {candidates: [], diagnostics: []};
  }
  if (inspected.kind === 'unsafe') {
    return {
      candidates: [],
      diagnostics: [createDiagnostic({
        code: inspected.code,
        message: 'Custom subagent directory could not be safely read and was treated as empty.',
        sourceKind,
        sourcePath: dirPath
      })]
    };
  }
  let entries: readonly fs.Dirent[];
  try {
    entries = readDir(dirPath);
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return {candidates: [], diagnostics: []};
    }
    return {
      candidates: [],
      diagnostics: [createDiagnostic({
        code: 'directory_unreadable',
        message: 'Custom subagent directory could not be read and was treated as empty.',
        sourceKind,
        sourcePath: path.resolve(dirPath)
      })]
    };
  }

  const candidates: CustomSubagentCandidate[] = [];
  const diagnostics: SubagentCatalogDiagnostic[] = [];
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const sourcePath = path.resolve(dirPath, entry.name);
    const name = entry.name.slice(0, -3);
    if (!isValidSubagentName(name)) {
      appendDiagnostic(diagnostics, {
        code: 'invalid_name',
        message: 'Custom subagent filename must match [a-z0-9][a-z0-9_-]{0,63}.md.',
        sourceKind,
        sourcePath
      });
      continue;
    }
    candidates.push({name, sourceKind, sourcePath});
  }
  return {candidates: Object.freeze(candidates), diagnostics: Object.freeze(diagnostics)};
}

/** 读取并验证胜出的候选；解析失败仅形成诊断，不暴露部分定义。 */
function loadCandidate(candidate: CustomSubagentCandidate, dependencies: {
  modelProfileIds: ReadonlySet<string>;
  readFile: (filePath: string, encoding: BufferEncoding) => string;
  stat: (filePath: string) => fs.Stats;
}): {ok: true; definition: Readonly<SubagentDefinition>} | {ok: false; diagnostic: Readonly<SubagentCatalogDiagnostic>} {
  let stats: fs.Stats;
  try {
    stats = dependencies.stat(candidate.sourcePath);
    if (!stats.isFile()) {
      return candidateFailure(candidate, 'not_regular_file', 'Custom subagent candidate is not a regular file.');
    }
  } catch {
    return candidateFailure(candidate, 'file_unreadable', 'Custom subagent file could not be inspected.');
  }
  if (stats.size > MAX_CUSTOM_SUBAGENT_FILE_BYTES) {
    return candidateFailure(candidate, 'file_too_large', `Agent manifest exceeds ${MAX_CUSTOM_SUBAGENT_FILE_BYTES} UTF-8 bytes.`);
  }

  let rawContent: string;
  try {
    rawContent = dependencies.readFile(candidate.sourcePath, 'utf8');
  } catch {
    return candidateFailure(candidate, 'file_unreadable', 'Custom subagent file could not be read as UTF-8 text.');
  }

  const parsed = parseCustomSubagentManifest(rawContent);
  if (!parsed.ok) {
    return candidateFailure(candidate, parsed.error.code, parsed.error.message);
  }

  const converted = convertManifest(candidate, parsed.manifest, dependencies.modelProfileIds);
  return converted.ok ? converted : candidateFailure(candidate, converted.code, converted.message);
}

/** 把 manifest 能力映射到固定策略与工具上限，声明只能收窄代码拥有的权限。 */
function convertManifest(candidate: CustomSubagentCandidate, manifest: Readonly<CustomSubagentManifest>, modelProfileIds: ReadonlySet<string>):
  | {ok: true; definition: Readonly<SubagentDefinition>}
  | {ok: false; code: string; message: string} {
  const validation = validateManifestPolicy(manifest, modelProfileIds);
  if (!validation.ok) {
    return validation;
  }

  const localToolNames = manifest.tools.flatMap((tool) => tool === 'file_edit' ? ['apply_patch', 'edit_file'] : [tool]);
  const definition: SubagentDefinition = {
    description: manifest.description,
    effortPolicy: manifest.effort,
    executionPolicy: manifest.capability === 'readonly' ? 'readonly_investigation' : 'general_purpose',
    includeMcpTools: manifest.capability === 'general' && manifest.mcp,
    localToolNames,
    ...(manifest.modelProfileId ? {modelProfileId: manifest.modelProfileId} : {}),
    name: candidate.name,
    prompt: createCustomSubagentPrompt(manifest.capability, candidate.name, manifest.instructions)
  };
  return {ok: true, definition: freezeSubagentDefinition(definition)};
}

/** 执行不依赖候选路径的共享权限与模型引用校验。 */
function validateManifestPolicy(manifest: Readonly<CustomSubagentManifest>, modelProfileIds: ReadonlySet<string>): CustomSubagentManifestValidationResult {
  const ceiling = new Set(manifest.capability === 'readonly'
    ? READONLY_SUBAGENT_TOOL_CEILING
    : GENERAL_SUBAGENT_TOOL_CEILING);
  for (const tool of manifest.tools) {
    if (!ceiling.has(tool as never)) {
      return {ok: false, code: 'tool_not_allowed', message: `Tool "${tool}" is not allowed by the ${manifest.capability} capability ceiling.`};
    }
  }
  if (manifest.capability === 'readonly' && manifest.mcp) {
    return {ok: false, code: 'mcp_not_allowed', message: 'readonly custom subagents cannot enable MCP tools.'};
  }
  if (manifest.modelProfileId && !modelProfileIds.has(manifest.modelProfileId)) {
    return {ok: false, code: 'model_profile_not_found', message: `Model profile "${safeDiagnosticValue(manifest.modelProfileId)}" does not exist in the current configuration snapshot.`};
  }

  return {ok: true};
}

/** 只复制模型策略字段；内置 prompt、工具、MCP 和执行策略继续取代码拥有的冻结定义。 */
function applyBuiltinOverride(
  definition: Readonly<SubagentDefinition>,
  selected: Readonly<SelectedBuiltinSubagentOverride> | undefined,
  modelProfileIds: ReadonlySet<string>,
  diagnostics: SubagentCatalogDiagnostic[]
): Readonly<SubagentDefinition> {
  if (!selected) {
    return definition;
  }
  if (selected.override.modelProfileId && !modelProfileIds.has(selected.override.modelProfileId)) {
    appendDiagnostic(diagnostics, {
      code: 'builtin_model_profile_not_found',
      message: `Built-in subagent model profile "${safeDiagnosticValue(selected.override.modelProfileId)}" does not exist in the current configuration snapshot; the built-in inherits the complete parent model policy.`,
      sourceKind: selected.sourceKind,
      sourcePath: selected.sourcePath
    });
    return definition;
  }

  return freezeSubagentDefinition({
    ...definition,
    effortPolicy: selected.override.effort,
    ...(selected.override.modelProfileId ? {modelProfileId: selected.override.modelProfileId} : {})
  });
}

/** 每个无效 settings 物理来源只发布一条有界诊断，避免按内置名称重复放大。 */
function appendSettingsSourceDiagnostics(diagnostics: SubagentCatalogDiagnostic[], sources: ReturnType<typeof loadAgentsSettingsSources>): void {
  for (const source of sources) {
    if (source.status === 'invalid' && source.error) {
      appendDiagnostic(diagnostics, {
        code: source.error.code,
        message: source.error.message,
        sourceKind: source.sourceKind,
        sourcePath: source.sourcePath
      });
    }
  }
}

/** 将候选错误补全为固定来源诊断。 */
function candidateFailure(candidate: CustomSubagentCandidate, code: string, message: string): {ok: false; diagnostic: Readonly<SubagentCatalogDiagnostic>} {
  return {ok: false, diagnostic: createDiagnostic({...candidate, code, message})};
}

/** 创建不包含控制字符且消息长度固定有界的诊断对象。 */
function createDiagnostic(diagnostic: SubagentCatalogDiagnostic): Readonly<SubagentCatalogDiagnostic> {
  const message = Array.from(diagnostic.message.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' '))
    .slice(0, MAX_SUBAGENT_DIAGNOSTIC_MESSAGE_CODE_POINTS)
    .join('');
  return Object.freeze({...diagnostic, message, sourcePath: path.resolve(diagnostic.sourcePath)});
}

/** 限制模型 profile 等不可信标量进入诊断的字符和长度。 */
function safeDiagnosticValue(value: string): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')).slice(0, 80).join('');
}

/** 在全局诊断预算内追加单项，防止异常目录放大内存和 debug 输出。 */
function appendDiagnostic(target: SubagentCatalogDiagnostic[], diagnostic: SubagentCatalogDiagnostic | Readonly<SubagentCatalogDiagnostic>): void {
  if (target.length < MAX_SUBAGENT_DIAGNOSTICS) {
    target.push(createDiagnostic({...diagnostic}));
  }
}

/** 在全局诊断预算内按扫描顺序追加一组诊断。 */
function appendDiagnostics(target: SubagentCatalogDiagnostic[], diagnostics: readonly Readonly<SubagentCatalogDiagnostic>[]): void {
  for (const diagnostic of diagnostics) {
    appendDiagnostic(target, diagnostic);
  }
}

/** 识别可选目录不存在错误；其他失败保留一条有界诊断。 */
function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export {
  MAX_CUSTOM_SUBAGENTS,
  loadSubagentCatalog,
  validateCustomSubagentManifest
};

export type {
  CustomSubagentManifestValidationResult,
  SubagentCatalog,
  SubagentCatalogDescriptor,
  SubagentCatalogDiagnostic,
  SubagentCatalogLoadOptions
};
