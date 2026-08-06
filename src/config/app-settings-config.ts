import {JsonConfigFile, type JsonConfigFileOptions} from './json-config-file';
import {getDefaultUserConfigPath, readOptionalUserConfig} from './user-config';

import type {ReadUserConfigOptions, UserConfigSource} from './user-config';
import type {AgentInstructionFileName, FileEditToolMode} from '../types/agent';

type AppSettings = {
  agentInstructionFileName: AgentInstructionFileName;
  autoCompressImages: boolean; // 控制本地图片超过最终附件上限时是否自动缩小。
  compactionThresholdRatio: number;
  defaultInteractionMode: DefaultInteractionMode;
  fileEditMode: FileEditToolMode;
  skillCatalogContextRatio: number;
  showReasoningSummary: boolean;
  slashSuggestionMaxVisible: number;
  toolApprovalMode: ToolApprovalMode; // 控制交互式 approval-required 调用先人工确认还是先由模型判断。
  toolApprovalModelProfileId?: string; // 自动审批严格引用的已保存模型 profile；manual 模式仅保留该选择。
};

type DefaultInteractionMode = 'normal' | 'plan';
type ToolApprovalMode = 'manual' | 'auto';

type ToolApprovalSettings = {
  mode: ToolApprovalMode; // 当前交互式工具审批策略，不改变 interaction mode。
  modelProfileId?: string; // auto 模式使用的本地模型 profile id。
};

type AppRenderPreferences = Pick<AppSettings, 'showReasoningSummary' | 'slashSuggestionMaxVisible'>;

type AppSettingsConfigOptions = ReadUserConfigOptions & JsonConfigFileOptions;

type AppSettingsValidationResult =
  | {ok: true}
  | {ok: false; error: string};

const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = {
  agentInstructionFileName: 'AGENTS.md',
  autoCompressImages: true,
  compactionThresholdRatio: 0.8,
  defaultInteractionMode: 'normal',
  fileEditMode: 'apply_patch',
  skillCatalogContextRatio: 0.02,
  showReasoningSummary: true,
  slashSuggestionMaxVisible: 8,
  toolApprovalMode: 'manual'
};
const DEFAULT_RENDER_PREFERENCES: Readonly<AppRenderPreferences> = {
  showReasoningSummary: DEFAULT_APP_SETTINGS.showReasoningSummary,
  slashSuggestionMaxVisible: DEFAULT_APP_SETTINGS.slashSuggestionMaxVisible
};
const MIN_COMPACTION_THRESHOLD_RATIO = 0.5;
const MAX_COMPACTION_THRESHOLD_RATIO = 0.95;
const MIN_SKILL_CATALOG_CONTEXT_RATIO = 0.01;
const MAX_SKILL_CATALOG_CONTEXT_RATIO = 0.1;
const MIN_SLASH_SUGGESTION_MAX_VISIBLE = 1;
const MAX_SLASH_SUGGESTION_MAX_VISIBLE = 20;

/**
 * 容错读取运行时常规设置；每个非法字段独立回退，避免可选展示配置阻断应用。
 */
function readAppSettings(options: ReadUserConfigOptions = {}): AppSettings {
  return normalizeAppSettings(readOptionalUserConfig(options));
}

/**
 * 严格读取配置面板草稿；文件缺失使用默认值，坏 JSON 交给面板显示错误。
 */
function readAppSettingsDraft(options: AppSettingsConfigOptions = {}): AppSettings {
  const configPath = options.configPath || getDefaultUserConfigPath();
  const rootConfig = new JsonConfigFile(configPath, options).readOrEmpty();
  return normalizeAppSettings(rootConfig);
}

/**
 * 校验面板草稿范围，确保写入后的值能被运行时无损读取。
 */
function validateAppSettingsDraft(draft: AppSettings, modelProfileIds?: ReadonlySet<string>): AppSettingsValidationResult {
  if (!isAgentInstructionFileName(draft.agentInstructionFileName)) {
    return {ok: false, error: '项目指令文件必须是 AGENTS.md 或 CLAUDE.md'};
  }

  if (!isFiniteNumberInRange(draft.compactionThresholdRatio, MIN_COMPACTION_THRESHOLD_RATIO, MAX_COMPACTION_THRESHOLD_RATIO)) {
    return {ok: false, error: '自动压缩阈值必须在 50% 到 95% 之间'};
  }

  if (!isFiniteNumberInRange(draft.skillCatalogContextRatio, MIN_SKILL_CATALOG_CONTEXT_RATIO, MAX_SKILL_CATALOG_CONTEXT_RATIO)) {
    return {ok: false, error: '技能列表上下文占比上限必须在 1% 到 10% 之间'};
  }

  if (!isDefaultInteractionMode(draft.defaultInteractionMode)) {
    return {ok: false, error: '默认启动模式必须是普通或规划'};
  }

  if (draft.fileEditMode !== 'apply_patch' && draft.fileEditMode !== 'edit_file') {
    return {ok: false, error: '文件编辑工具必须是 apply_patch 或 edit_file'};
  }

  if (typeof draft.autoCompressImages !== 'boolean') {
    return {ok: false, error: '超限图片自动压缩设置必须是布尔值'};
  }

  if (!Number.isInteger(draft.slashSuggestionMaxVisible)
    || draft.slashSuggestionMaxVisible < MIN_SLASH_SUGGESTION_MAX_VISIBLE
    || draft.slashSuggestionMaxVisible > MAX_SLASH_SUGGESTION_MAX_VISIBLE) {
    return {ok: false, error: 'Slash suggestion 显示数量必须在 1 到 20 之间'};
  }

  if (typeof draft.showReasoningSummary !== 'boolean') {
    return {ok: false, error: 'Reasoning summary 显示设置必须是布尔值'};
  }

  if (!isToolApprovalMode(draft.toolApprovalMode)) {
    return {ok: false, error: '工具审批模式必须是 manual 或 auto'};
  }

  if (draft.toolApprovalModelProfileId !== undefined
    && (typeof draft.toolApprovalModelProfileId !== 'string' || draft.toolApprovalModelProfileId.trim() === '')) {
    return {ok: false, error: '工具审批模型必须引用有效的模型 profile'};
  }

  if (draft.toolApprovalMode === 'auto'
    && (!draft.toolApprovalModelProfileId || !modelProfileIds?.has(draft.toolApprovalModelProfileId))) {
    return {ok: false, error: '自动工具审批需要选择一个已保存的有效模型 profile'};
  }

  return {ok: true};
}

/**
 * 原子更新常规设置所有字段，并保留同一用户配置文件中的其他领域节点。
 */
function saveAppSettingsDraft(draft: AppSettings, options: AppSettingsConfigOptions = {}): void {
  const configPath = options.configPath || getDefaultUserConfigPath();
  const configFile = new JsonConfigFile(configPath, options);
  configFile.update((rootConfig) => {
    const validation = validateAppSettingsDraft(draft, readModelProfileIds(rootConfig));

    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const compaction = isPlainObject(rootConfig.compaction) ? {...rootConfig.compaction} : {};
    const instructions = isPlainObject(rootConfig.instructions) ? {...rootConfig.instructions} : {};
    const skills = isPlainObject(rootConfig.skills) ? {...rootConfig.skills} : {};
    const ui = isPlainObject(rootConfig.ui) ? {...rootConfig.ui} : {};
    const tools = isPlainObject(rootConfig.tools) ? {...rootConfig.tools} : {};
    const fileEdit = isPlainObject(tools.fileEdit) ? {...tools.fileEdit} : {};
    const readFiles = isPlainObject(tools.readFiles) ? {...tools.readFiles} : {};
    const approval = isPlainObject(tools.approval) ? {...tools.approval} : {};

    compaction.thresholdRatio = draft.compactionThresholdRatio;
    instructions.fileName = draft.agentInstructionFileName;
    skills.catalogContextRatio = draft.skillCatalogContextRatio;
    ui.defaultInteractionMode = draft.defaultInteractionMode;
    ui.slashSuggestionMaxVisible = draft.slashSuggestionMaxVisible;
    ui.showReasoningSummary = draft.showReasoningSummary;
    fileEdit.mode = draft.fileEditMode;
    readFiles.autoCompressImages = draft.autoCompressImages;
    approval.mode = draft.toolApprovalMode;
    if (draft.toolApprovalModelProfileId !== undefined) {
      approval.modelProfileId = draft.toolApprovalModelProfileId;
    }
    tools.fileEdit = fileEdit;
    tools.readFiles = readFiles;
    tools.approval = approval;
    rootConfig.compaction = compaction;
    rootConfig.instructions = instructions;
    rootConfig.skills = skills;
    rootConfig.ui = ui;
    rootConfig.tools = tools;
  });
}

function normalizeAppSettings(rootConfig: UserConfigSource): AppSettings {
  const compaction = isPlainObject(rootConfig.compaction) ? rootConfig.compaction : {};
  const instructions = isPlainObject(rootConfig.instructions) ? rootConfig.instructions : {};
  const skills = isPlainObject(rootConfig.skills) ? rootConfig.skills : {};
  const ui = isPlainObject(rootConfig.ui) ? rootConfig.ui : {};
  const tools = isPlainObject(rootConfig.tools) ? rootConfig.tools : {};
  const fileEdit = isPlainObject(tools.fileEdit) ? tools.fileEdit : {};
  const readFiles = isPlainObject(tools.readFiles) ? tools.readFiles : {};
  const approval = isPlainObject(tools.approval) ? tools.approval : {};
  const thresholdRatio = compaction.thresholdRatio;
  const skillCatalogRatio = skills.catalogContextRatio;
  const slashMaxVisible = ui.slashSuggestionMaxVisible;

  return {
    agentInstructionFileName: isAgentInstructionFileName(instructions.fileName)
      ? instructions.fileName
      : DEFAULT_APP_SETTINGS.agentInstructionFileName,
    autoCompressImages: typeof readFiles.autoCompressImages === 'boolean'
      ? readFiles.autoCompressImages
      : DEFAULT_APP_SETTINGS.autoCompressImages,
    compactionThresholdRatio: isFiniteNumberInRange(thresholdRatio, MIN_COMPACTION_THRESHOLD_RATIO, MAX_COMPACTION_THRESHOLD_RATIO)
      ? thresholdRatio
      : DEFAULT_APP_SETTINGS.compactionThresholdRatio,
    defaultInteractionMode: isDefaultInteractionMode(ui.defaultInteractionMode)
      ? ui.defaultInteractionMode
      : DEFAULT_APP_SETTINGS.defaultInteractionMode,
    fileEditMode: fileEdit.mode === 'edit_file' ? 'edit_file' : DEFAULT_APP_SETTINGS.fileEditMode,
    skillCatalogContextRatio: isFiniteNumberInRange(skillCatalogRatio, MIN_SKILL_CATALOG_CONTEXT_RATIO, MAX_SKILL_CATALOG_CONTEXT_RATIO)
      ? skillCatalogRatio
      : DEFAULT_APP_SETTINGS.skillCatalogContextRatio,
    showReasoningSummary: typeof ui.showReasoningSummary === 'boolean'
      ? ui.showReasoningSummary
      : DEFAULT_APP_SETTINGS.showReasoningSummary,
    slashSuggestionMaxVisible: Number.isInteger(slashMaxVisible)
      && Number(slashMaxVisible) >= MIN_SLASH_SUGGESTION_MAX_VISIBLE
      && Number(slashMaxVisible) <= MAX_SLASH_SUGGESTION_MAX_VISIBLE
      ? Number(slashMaxVisible)
      : DEFAULT_APP_SETTINGS.slashSuggestionMaxVisible,
    toolApprovalMode: isToolApprovalMode(approval.mode) ? approval.mode : DEFAULT_APP_SETTINGS.toolApprovalMode,
    ...(typeof approval.modelProfileId === 'string' && approval.modelProfileId.trim() !== ''
      ? {toolApprovalModelProfileId: approval.modelProfileId}
      : {})
  };
}

function isAgentInstructionFileName(value: unknown): value is AgentInstructionFileName {
  return value === 'AGENTS.md' || value === 'CLAUDE.md';
}

function isDefaultInteractionMode(value: unknown): value is DefaultInteractionMode {
  return value === 'normal' || value === 'plan';
}

function isToolApprovalMode(value: unknown): value is ToolApprovalMode {
  return value === 'manual' || value === 'auto';
}

/**
 * 从同一份持久化配置提取可引用的模型 id，避免 auto 设置在保存时接受陈旧草稿。
 */
function readModelProfileIds(rootConfig: UserConfigSource): Set<string> {
  const llm = isPlainObject(rootConfig.llm) ? rootConfig.llm : {};
  const models = Array.isArray(llm.models) ? llm.models : [];
  return new Set(models.flatMap((model) => isPlainObject(model) && typeof model.id === 'string' && model.id.trim() !== '' ? [model.id] : []));
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is UserConfigSource {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export {
  DEFAULT_APP_SETTINGS,
  DEFAULT_RENDER_PREFERENCES,
  MAX_COMPACTION_THRESHOLD_RATIO,
  MAX_SKILL_CATALOG_CONTEXT_RATIO,
  MAX_SLASH_SUGGESTION_MAX_VISIBLE,
  MIN_COMPACTION_THRESHOLD_RATIO,
  MIN_SKILL_CATALOG_CONTEXT_RATIO,
  MIN_SLASH_SUGGESTION_MAX_VISIBLE,
  readAppSettings,
  readAppSettingsDraft,
  saveAppSettingsDraft,
  validateAppSettingsDraft
};

export type {
  AppRenderPreferences,
  AppSettings,
  AppSettingsConfigOptions,
  AppSettingsValidationResult,
  DefaultInteractionMode,
  ToolApprovalMode,
  ToolApprovalSettings
};
