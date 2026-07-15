import {redactSensitiveText} from '../agent/agent-errors';
import {JsonConfigFile, JsonConfigFileError, type JsonConfigFileOptions} from './json-config-file';
import {getDefaultConfigPath} from './llm-config';
import {getProviderPreset, providerRequiresApiKey} from './provider-presets';
import type {ConfigModelDraft, ConfigProviderDraft, LlmConfigDraft} from '../types/command';

type JsonObject = Record<string, unknown>;

type ConfigEditorOptions = JsonConfigFileOptions & {
  configPath?: string;
};

type ConfigValidationResult =
  | {ok: true}
  | {ok: false; error: string};

class LlmConfigEditorError extends Error {
  constructor(message: string) {
    super(redactSensitiveText(message));
    this.name = 'LlmConfigEditorError';
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getConfigPath(options: ConfigEditorOptions = {}): string {
  return options.configPath || getDefaultConfigPath();
}

function readRootConfig(options: ConfigEditorOptions = {}): JsonObject {
  const configPath = getConfigPath(options);

  try {
    return new JsonConfigFile(configPath, options).readOrEmpty();
  } catch (error: unknown) {
    if (error instanceof JsonConfigFileError && error.kind === 'invalid_json') {
      throw new LlmConfigEditorError(`LLM 配置文件不是有效 JSON：${configPath}`);
    }

    if (error instanceof JsonConfigFileError && error.kind === 'invalid_root') {
      throw new LlmConfigEditorError(`LLM 配置文件根节点必须是对象：${configPath}`);
    }

    throw new LlmConfigEditorError(`无法读取 LLM 配置文件：${configPath}`);
  }
}

function readOptionalString(source: JsonObject, fieldName: string): string | undefined {
  const value = source[fieldName];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalStringRecord(source: JsonObject, fieldName: string): Record<string, string> | undefined {
  const value = source[fieldName];

  if (!isJsonObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readOptionalObject(source: JsonObject, fieldName: string): JsonObject | undefined {
  const value = source[fieldName];
  return isJsonObject(value) ? cloneJsonObject(value) : undefined;
}

/**
 * 读取用户配置为面板草稿；缺失配置文件时返回空草稿，便于首次配置。
 */
function readLlmConfigDraft(options: ConfigEditorOptions = {}): LlmConfigDraft {
  const rootConfig = readRootConfig(options);
  const llmConfig = isJsonObject(rootConfig.llm) ? rootConfig.llm : {};
  const rawProviders = isJsonObject(llmConfig.providers) ? llmConfig.providers : {};
  const rawModels = Array.isArray(llmConfig.models) ? llmConfig.models : [];
  const providers = Object.entries(rawProviders).map(([providerId, rawProvider]) => {
    const providerObject = isJsonObject(rawProvider) ? rawProvider : {};
    const preset = readOptionalString(providerObject, 'preset') || '';
    const label = readOptionalString(providerObject, 'label') || providerId;
    const providerModels = rawModels
      .filter((model): model is JsonObject => isJsonObject(model) && model.provider === providerId)
      .map((model) => {
        const reasoning = readOptionalObject(model, 'reasoning');

        return {
          id: readOptionalString(model, 'id') || '',
          model: readOptionalString(model, 'model') || '',
          ...(typeof model.contextWindow === 'number' ? {contextWindow: model.contextWindow} : {}),
          ...(reasoning ? {reasoning} : {})
        };
      });

    return {
      id: providerId,
      label,
      preset,
      apiKey: readOptionalString(providerObject, 'apiKey') || '',
      baseURL: readOptionalString(providerObject, 'baseURL'),
      codexAuthFile: readOptionalString(providerObject, 'codexAuthFile'),
      headers: readOptionalStringRecord(providerObject, 'headers'),
      models: providerModels
    };
  });

  return normalizeConfigDraft({
    providers,
    selectedModelId: readOptionalString(llmConfig, 'selectedModel'),
    rootConfig: cloneJsonObject(rootConfig)
  });
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function normalizeConfigDraft(draft: LlmConfigDraft): LlmConfigDraft {
  const usedProviderIds = new Set<string>();
  const usedModelIds = new Set<string>();
  const providers = draft.providers.map((provider, providerIndex) => {
    const fallbackProviderId = provider.preset || `provider-${providerIndex + 1}`;
    const id = uniqueId(slugify(provider.id || provider.label || fallbackProviderId), usedProviderIds);
    const models = provider.models.map((model, modelIndex) => {
      const fallbackModelId = `${id}-${model.model || `model-${modelIndex + 1}`}`;
      return {
        id: uniqueId(slugify(model.id || fallbackModelId), usedModelIds),
        model: model.model.trim(),
        ...(model.contextWindow !== undefined ? {contextWindow: model.contextWindow} : {}),
        ...(model.reasoning ? {reasoning: cloneJsonObject(model.reasoning)} : {})
      };
    });

    return {
      ...provider,
      id,
      label: provider.label.trim() || id,
      apiKey: provider.apiKey,
      baseURL: provider.baseURL?.trim() || undefined,
      codexAuthFile: provider.codexAuthFile?.trim() || undefined,
      headers: provider.headers ? {...provider.headers} : undefined,
      models
    };
  });
  const modelIds = new Set(providers.flatMap((provider) => provider.models.map((model) => model.id)));
  const selectedModelId = draft.selectedModelId && modelIds.has(draft.selectedModelId)
    ? draft.selectedModelId
    : providers.flatMap((provider) => provider.models)[0]?.id;

  return {
    providers,
    selectedModelId,
    rootConfig: cloneJsonObject(draft.rootConfig || {})
  };
}

function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'item';
}

function uniqueId(candidate: string, usedIds: Set<string>): string {
  let id = candidate;
  let index = 2;

  while (usedIds.has(id)) {
    id = `${candidate}-${index}`;
    index += 1;
  }

  usedIds.add(id);
  return id;
}

function validateConfigDraft(draft: LlmConfigDraft): ConfigValidationResult {
  const normalized = normalizeConfigDraft(draft);

  if (normalized.providers.length === 0) {
    return {ok: false, error: '至少需要配置一个 provider'};
  }

  for (const provider of normalized.providers) {
    const preset = getProviderPreset(provider.preset);

    if (!preset) {
      return {ok: false, error: `provider ${provider.label || provider.id} 的 preset 不存在：${provider.preset || '<empty>'}`};
    }

    if (providerRequiresApiKey(preset) && provider.apiKey.trim() === '') {
      return {ok: false, error: `provider ${provider.label || provider.id} 缺少 API key`};
    }

    if (preset.baseURLMode === 'required' && !provider.baseURL) {
      return {ok: false, error: `provider ${provider.label || provider.id} 缺少 Base URL`};
    }

    if (provider.models.length === 0) {
      return {ok: false, error: `provider ${provider.label || provider.id} 至少需要一个模型`};
    }

    if (provider.headers) {
      const headerNames = new Set<string>();

      for (const [headerName, headerValue] of Object.entries(provider.headers)) {
        const normalizedName = headerName.trim().toLowerCase();

        if (!normalizedName || /[\r\n]/.test(headerName)) {
          return {ok: false, error: `provider ${provider.label || provider.id} 存在无效 header name`};
        }

        if (headerNames.has(normalizedName)) {
          return {ok: false, error: `provider ${provider.label || provider.id} 存在重复 header：${headerName.trim()}`};
        }

        if (headerValue === '' || /[\r\n]/.test(headerValue)) {
          return {ok: false, error: `provider ${provider.label || provider.id} 的 header ${headerName.trim()} value 无效`};
        }

        headerNames.add(normalizedName);
      }
    }

    for (const model of provider.models) {
      if (model.model.trim() === '') {
        return {ok: false, error: `provider ${provider.label || provider.id} 存在空模型`};
      }

      if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
        return {ok: false, error: `模型 ${model.model || model.id} 的 context window 必须是正整数`};
      }
    }
  }

  if (!normalized.selectedModelId) {
    return {ok: false, error: '至少需要一个可选择的模型'};
  }

  return {ok: true};
}

/**
 * 保存配置草稿到用户配置文件；仅替换 llm provider/model 相关节点。
 */
function saveLlmConfigDraft(draft: LlmConfigDraft, options: ConfigEditorOptions = {}): void {
  const normalized = normalizeConfigDraft(draft);
  const validation = validateConfigDraft(normalized);

  if (!validation.ok) {
    throw new LlmConfigEditorError(validation.error);
  }

  const targetPath = getConfigPath(options);
  const configFile = new JsonConfigFile(targetPath, options);
  const providers: JsonObject = {};
  const models: JsonObject[] = [];

  for (const provider of normalized.providers) {
    const preset = getProviderPreset(provider.preset)!;
    const providerProfile: JsonObject = {preset: provider.preset};

    if (providerRequiresApiKey(preset) || provider.apiKey !== '') {
      providerProfile.apiKey = provider.apiKey;
    }

    if (preset.codexOAuth && provider.codexAuthFile) {
      providerProfile.codexAuthFile = provider.codexAuthFile;
    }

    if (provider.label && provider.label !== provider.id) {
      providerProfile.label = provider.label;
    }

    if (preset.baseURLMode !== 'fixed' && preset.baseURLMode !== 'hidden' && provider.baseURL) {
      providerProfile.baseURL = provider.baseURL;
    }

    if (provider.headers && Object.keys(provider.headers).length > 0) {
      providerProfile.headers = {...provider.headers};
    }

    providers[provider.id] = providerProfile;

    for (const model of provider.models) {
      models.push({
        id: model.id,
        provider: provider.id,
        model: model.model,
        ...(model.contextWindow !== undefined ? {contextWindow: model.contextWindow} : {}),
        ...(model.reasoning ? {reasoning: cloneJsonObject(model.reasoning)} : {})
      });
    }
  }

  try {
    let rootConfig: JsonObject;

    try {
      rootConfig = configFile.read();
    } catch (error: unknown) {
      if (!(error instanceof JsonConfigFileError) || error.kind !== 'missing') {
        throw error;
      }

      rootConfig = cloneJsonObject(normalized.rootConfig);
    }

    const llmConfig = isJsonObject(rootConfig.llm) ? {...rootConfig.llm} : {};

    llmConfig.providers = providers;
    llmConfig.models = models;
    llmConfig.selectedModel = normalized.selectedModelId;
    rootConfig.llm = llmConfig;
    configFile.write(rootConfig);
  } catch (error: unknown) {
    if (error instanceof JsonConfigFileError && error.kind === 'invalid_json') {
      throw new LlmConfigEditorError(`LLM 配置文件不是有效 JSON：${targetPath}`);
    }

    if (error instanceof JsonConfigFileError && error.kind === 'invalid_root') {
      throw new LlmConfigEditorError(`LLM 配置文件根节点必须是对象：${targetPath}`);
    }

    throw error;
  }
}

export {
  LlmConfigEditorError,
  normalizeConfigDraft,
  readLlmConfigDraft,
  saveLlmConfigDraft,
  validateConfigDraft
};

export type {
  ConfigEditorOptions,
  ConfigValidationResult
};
