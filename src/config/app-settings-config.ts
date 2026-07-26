import {JsonConfigFile, type JsonConfigFileOptions} from './json-config-file';
import {getDefaultUserConfigPath, readOptionalUserConfig} from './user-config';

import type {ReadUserConfigOptions, UserConfigSource} from './user-config';

type AppSettings = {
  compactionThresholdRatio: number;
  defaultInteractionMode: DefaultInteractionMode;
  skillCatalogContextRatio: number;
  showReasoningSummary: boolean;
  slashSuggestionMaxVisible: number;
};

type DefaultInteractionMode = 'normal' | 'plan';

type AppRenderPreferences = Pick<AppSettings, 'showReasoningSummary' | 'slashSuggestionMaxVisible'>;

type AppSettingsConfigOptions = ReadUserConfigOptions & JsonConfigFileOptions;

type AppSettingsValidationResult =
  | {ok: true}
  | {ok: false; error: string};

const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = {
  compactionThresholdRatio: 0.8,
  defaultInteractionMode: 'normal',
  skillCatalogContextRatio: 0.02,
  showReasoningSummary: true,
  slashSuggestionMaxVisible: 8
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
function validateAppSettingsDraft(draft: AppSettings): AppSettingsValidationResult {
  if (!isFiniteNumberInRange(draft.compactionThresholdRatio, MIN_COMPACTION_THRESHOLD_RATIO, MAX_COMPACTION_THRESHOLD_RATIO)) {
    return {ok: false, error: '自动压缩阈值必须在 50% 到 95% 之间'};
  }

  if (!isFiniteNumberInRange(draft.skillCatalogContextRatio, MIN_SKILL_CATALOG_CONTEXT_RATIO, MAX_SKILL_CATALOG_CONTEXT_RATIO)) {
    return {ok: false, error: '技能列表上下文占比上限必须在 1% 到 10% 之间'};
  }

  if (!isDefaultInteractionMode(draft.defaultInteractionMode)) {
    return {ok: false, error: '默认启动模式必须是普通或规划'};
  }

  if (!Number.isInteger(draft.slashSuggestionMaxVisible)
    || draft.slashSuggestionMaxVisible < MIN_SLASH_SUGGESTION_MAX_VISIBLE
    || draft.slashSuggestionMaxVisible > MAX_SLASH_SUGGESTION_MAX_VISIBLE) {
    return {ok: false, error: 'Slash suggestion 显示数量必须在 1 到 20 之间'};
  }

  if (typeof draft.showReasoningSummary !== 'boolean') {
    return {ok: false, error: 'Reasoning summary 显示设置必须是布尔值'};
  }

  return {ok: true};
}

/**
 * 原子更新常规设置所有字段，并保留同一用户配置文件中的其他领域节点。
 */
function saveAppSettingsDraft(draft: AppSettings, options: AppSettingsConfigOptions = {}): void {
  const validation = validateAppSettingsDraft(draft);

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const configPath = options.configPath || getDefaultUserConfigPath();
  const configFile = new JsonConfigFile(configPath, options);
  configFile.update((rootConfig) => {
    const compaction = isPlainObject(rootConfig.compaction) ? {...rootConfig.compaction} : {};
    const skills = isPlainObject(rootConfig.skills) ? {...rootConfig.skills} : {};
    const ui = isPlainObject(rootConfig.ui) ? {...rootConfig.ui} : {};

    compaction.thresholdRatio = draft.compactionThresholdRatio;
    skills.catalogContextRatio = draft.skillCatalogContextRatio;
    ui.defaultInteractionMode = draft.defaultInteractionMode;
    ui.slashSuggestionMaxVisible = draft.slashSuggestionMaxVisible;
    ui.showReasoningSummary = draft.showReasoningSummary;
    rootConfig.compaction = compaction;
    rootConfig.skills = skills;
    rootConfig.ui = ui;
  });
}

function normalizeAppSettings(rootConfig: UserConfigSource): AppSettings {
  const compaction = isPlainObject(rootConfig.compaction) ? rootConfig.compaction : {};
  const skills = isPlainObject(rootConfig.skills) ? rootConfig.skills : {};
  const ui = isPlainObject(rootConfig.ui) ? rootConfig.ui : {};
  const thresholdRatio = compaction.thresholdRatio;
  const skillCatalogRatio = skills.catalogContextRatio;
  const slashMaxVisible = ui.slashSuggestionMaxVisible;

  return {
    compactionThresholdRatio: isFiniteNumberInRange(thresholdRatio, MIN_COMPACTION_THRESHOLD_RATIO, MAX_COMPACTION_THRESHOLD_RATIO)
      ? thresholdRatio
      : DEFAULT_APP_SETTINGS.compactionThresholdRatio,
    defaultInteractionMode: isDefaultInteractionMode(ui.defaultInteractionMode)
      ? ui.defaultInteractionMode
      : DEFAULT_APP_SETTINGS.defaultInteractionMode,
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
      : DEFAULT_APP_SETTINGS.slashSuggestionMaxVisible
  };
}

function isDefaultInteractionMode(value: unknown): value is DefaultInteractionMode {
  return value === 'normal' || value === 'plan';
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
  DefaultInteractionMode
};
