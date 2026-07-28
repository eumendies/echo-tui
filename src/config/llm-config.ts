import {REASONING_EFFORTS, REASONING_SUMMARIES} from '../types/agent';
import {JsonConfigFile, JsonConfigFileError} from './json-config-file';
import {getDefaultUserConfigPath} from './user-config';
import {getProviderPreset, providerRequiresApiKey} from './provider-presets';
import type {AgentType, BashToolConfig, LlmConfig, ReasoningEffort, ReasoningSummary, ToolRuntimeConfig} from '../types/agent';
import type {ProviderPreset} from './provider-presets';

const DEFAULT_BASH_TOOL_TIMEOUT_MS = null;
const DEFAULT_BASH_TOOL_MAX_OUTPUT_BYTES = 65_536;

// 上下文压缩相关默认值：未知模型回退窗口、触发阈值比例、保留最近 K 条。
const DEFAULT_CONTEXT_WINDOW = 128_000;
const COMPACTION_THRESHOLD_RATIO = 0.8;
const COMPACTION_RECENT_KEEP_COUNT = 20;

// 内置常见模型→上下文窗口映射表；仅按完整模型名匹配，避免同系列不同模型互相误命中。
const BUILTIN_MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  'gpt-3.5-turbo': 16_385,
  'gpt-4': 8_192,
  'gpt-4-turbo': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,
  'gpt-5': 272_000,
  'gpt-5-2025-08-07': 272_000,
  'gpt-5-mini': 272_000,
  'gpt-5-mini-2025-08-07': 272_000,
  'gpt-5-nano': 272_000,
  'gpt-5-nano-2025-08-07': 272_000,
  'gpt-5-chat': 128_000,
  'gpt-5-chat-latest': 128_000,
  'gpt-5.1': 272_000,
  'gpt-5.1-2025-11-13': 272_000,
  'gpt-5.1-chat-latest': 128_000,
  'gpt-5.2': 272_000,
  'gpt-5.2-2025-12-11': 272_000,
  'gpt-5.2-chat-latest': 128_000,
  'gpt-5.3-chat-latest': 128_000,
  'gpt-5.4': 1_050_000,
  'gpt-5.4-2026-03-05': 1_050_000,
  'gpt-5.4-mini': 272_000,
  'gpt-5.4-mini-2026-03-17': 272_000,
  'gpt-5.4-nano': 272_000,
  'gpt-5.4-nano-2026-03-17': 272_000,
  'gpt-5.5': 1_050_000,
  'gpt-5.5-2026-04-23': 1_050_000,
  'gpt-5.6': 1_050_000,
  'gpt-5.6-sol': 1_050_000,
  'gpt-5.6-terra': 1_050_000,
  'gpt-5.6-luna': 1_050_000,
  'o1': 200_000,
  'o1-mini': 128_000,
  'o1-preview': 128_000,
  'o3': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  'claude-3-haiku-20240307': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-7-sonnet-20250219': 200_000,
  'claude-opus-4': 200_000,
  'claude-sonnet-4': 1_000_000,
  'claude-4-opus-20250514': 200_000,
  'claude-4-sonnet-20250514': 1_000_000,
  'claude-opus-4-20250514': 200_000,
  'claude-opus-4-1': 200_000,
  'claude-opus-4-1-20250805': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-opus-4-5-20251101': 200_000,
  'claude-opus-4-6': 1_000_000,
  'claude-opus-4-6-20260205': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-7-20260416': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-sonnet-4-20250514': 1_000_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'gemini-3-pro-preview': 1_048_576,
  'gemini-3-flash-preview': 1_048_576,
  'gemini-3.1-pro-preview': 1_048_576,
  'gemini-3.1-flash-lite-preview': 1_048_576,
  'gemini-3.1-flash-lite': 1_048_576,
  'gemini-3.5-flash': 1_048_576,
  'deepseek-chat': 131_072,
  'deepseek-reasoner': 131_072,
  'deepseek-r1': 65_536,
  'deepseek-v3.2': 163_840,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  'qwen3-coder-flash': 997_952,
  'qwen3-coder-plus': 997_952,
  'qwen3-max': 258_048,
  'qwen3-next-80b-a3b-instruct': 262_144,
  'qwen3-next-80b-a3b-thinking': 262_144,
  'qwen3.5-plus': 991_808,
  'qwen2.5-coder': 32_768,
  'glm-4.6': 200_000,
  'glm-4.7': 200_000,
  'glm-5': 200_000,
  'glm-5-code': 200_000,
  'glm-5.1': 200_000,
  'glm-5.2': 1_000_000,
  'kimi-k2.5': 262_144,
  'kimi-k2.6': 262_144,
  'kimi-k2-thinking': 262_144,
  'minimax-m2': 200_000,
  'minimax-m2.1': 1_000_000,
  'minimax-m2.5': 1_000_000,
  'minimax-m3': 1_000_000,
  'mimo-v2-flash': 262_144,
  'mimo-v2.5': 1_048_576,
  'mimo-v2.5-pro': 1_048_576,
  'doubao-seed-2-0-pro-260215': 256_000,
  'doubao-seed-2-0-lite-260215': 256_000,
  'doubao-seed-2-0-mini-260215': 256_000,
  'doubao-seed-2-0-code-preview-260215': 256_000
};

/**
 * 解析当前生效模型的上下文窗口：用户配置 → 内置映射表 → 默认值三级回退。
 */
function resolveContextWindow(config: {model: string; contextWindow?: number}): number {
  if (typeof config.contextWindow === 'number' && Number.isFinite(config.contextWindow) && config.contextWindow > 0) {
    return config.contextWindow;
  }

  const model = String(config.model || '').toLowerCase();

  return BUILTIN_MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
}

class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

function getDefaultConfigPath(): string {
  return getDefaultUserConfigPath();
}

type ConfigSource = Record<string, unknown>;

type LlmModelProfile = {
  id: string;
  provider: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummary;
  contextWindow?: number;
};

type LlmProviderProfile = {
  id: string;
  agentType: AgentType;
  apiKey: string;
  baseURL?: string;
  codexOAuth?: LlmConfig['codexOAuth'];
  headers?: Record<string, string>;
};

type LlmModelConfigInfo =
  {
    kind: 'profiles';
    selectedModelId: string;
    models: LlmModelProfile[];
  };

function assertPlainObject(value: unknown, fieldName: string): asserts value is ConfigSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LlmConfigError(`LLM 配置 ${fieldName} 必须是对象`);
  }
}

function readOptionalIntegerInRange(source: ConfigSource, fieldName: string, min: number, max: number, fallback: number): number {
  const value = source[fieldName];

  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }

  return value;
}

function readOptionalPositiveInteger(source: ConfigSource, fieldName: string): number | undefined {
  const value = source[fieldName];

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function hasUsableModels(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function readOptionalProviderString(source: ConfigSource, fieldName: string, providerId: string): string | undefined {
  const value = source[fieldName];

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new LlmConfigError(`LLM provider ${providerId} 的 ${fieldName} 必须是字符串`);
  }

  return value;
}

function readRequiredProviderPreset(source: ConfigSource, providerId: string): ProviderPreset {
  const presetId = readRequiredProviderString(source, 'preset', providerId);
  const preset = getProviderPreset(presetId);

  if (!preset) {
    throw new LlmConfigError(`LLM provider ${providerId} 的 preset 不存在：${presetId}`);
  }

  return preset;
}

function readRequiredProviderString(source: ConfigSource, fieldName: string, providerId: string): string {
  const value = source[fieldName];

  if (value === undefined || value === null || value === '') {
    throw new LlmConfigError(`LLM provider ${providerId} 缺少 ${fieldName}`);
  }

  if (typeof value !== 'string') {
    throw new LlmConfigError(`LLM provider ${providerId} 的 ${fieldName} 必须是字符串`);
  }

  if (value.trim() === '') {
    throw new LlmConfigError(`LLM provider ${providerId} 缺少 ${fieldName}`);
  }

  return value;
}

function readProviderApiKey(source: ConfigSource, providerId: string, preset: ProviderPreset): string {
  if (!providerRequiresApiKey(preset)) {
    return readOptionalProviderString(source, 'apiKey', providerId) || '';
  }

  return readRequiredProviderString(source, 'apiKey', providerId);
}

function readOptionalHeaders(source: ConfigSource, fieldName: string, fieldOwner: string): Record<string, string> | undefined {
  const value = source[fieldName];

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LlmConfigError(`${fieldOwner} ${fieldName} 必须是对象`);
  }

  const headers: Record<string, string> = {};

  for (const [headerName, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== 'string') {
      throw new LlmConfigError(`${fieldOwner} ${fieldName}.${headerName} 必须是字符串`);
    }

    headers[headerName] = headerValue;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isReasoningSummary(value: unknown): value is ReasoningSummary {
  return typeof value === 'string' && (REASONING_SUMMARIES as readonly string[]).includes(value);
}

function readOptionalReasoningObject(source: ConfigSource, profileId: string): ConfigSource | undefined {
  const reasoning = source.reasoning;

  if (reasoning === undefined || reasoning === null || reasoning === '') {
    return undefined;
  }

  if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) {
    throw new LlmConfigError(`LLM 模型 ${profileId} 的 reasoning 必须是对象`);
  }

  return reasoning as ConfigSource;
}

function readOptionalReasoningEffort(source: ConfigSource, profileId: string): ReasoningEffort | undefined {
  const effort = readOptionalReasoningObject(source, profileId)?.effort;

  if (effort === undefined || effort === null || effort === '') {
    return undefined;
  }

  if (!isReasoningEffort(effort)) {
    throw new LlmConfigError(`LLM 模型 ${profileId} 的 reasoning.effort 必须是 ${REASONING_EFFORTS.join('、')}`);
  }

  return effort;
}

function readOptionalReasoningSummary(source: ConfigSource, profileId: string): ReasoningSummary | undefined {
  const summary = readOptionalReasoningObject(source, profileId)?.summary;

  if (summary === undefined || summary === null || summary === '') {
    return undefined;
  }

  if (!isReasoningSummary(summary)) {
    throw new LlmConfigError(`LLM 模型 ${profileId} 的 reasoning.summary 必须是 ${REASONING_SUMMARIES.join('、')}`);
  }

  return summary;
}

function readRequiredProfileString(source: ConfigSource, fieldName: string, profileId: string): string {
  const value = source[fieldName];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new LlmConfigError(`LLM 模型 ${profileId} 缺少 ${fieldName}`);
  }

  return value;
}

function readRequiredProfileProvider(source: ConfigSource, profileId: string): string {
  const value = source.provider;

  if (value === undefined || value === null || value === '') {
    throw new LlmConfigError(`LLM 模型 ${profileId} 缺少 provider`);
  }

  if (typeof value !== 'string') {
    throw new LlmConfigError(`LLM 模型 ${profileId} 的 provider 必须是字符串`);
  }

  return value;
}

function readOptionalProfilePositiveInteger(source: ConfigSource, fieldName: string, profileId: string): number | undefined {
  const value = source[fieldName];

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new LlmConfigError(`LLM 模型 ${profileId} 的 ${fieldName} 必须是正整数`);
  }

  return value;
}

function readConfiguredSelectedModelId(llmConfig: ConfigSource): string | undefined {
  const selectedModel = llmConfig.selectedModel;

  if (selectedModel === undefined || selectedModel === null || selectedModel === '') {
    return undefined;
  }

  if (typeof selectedModel !== 'string') {
    throw new LlmConfigError('LLM 配置 selectedModel 必须是字符串');
  }

  return selectedModel;
}

function resolveSelectedProfile(llmConfig: ConfigSource, models: LlmModelProfile[], modelProfileId?: string): LlmModelProfile {
  const overrideProfile = modelProfileId
    ? models.find((profile) => profile.id === modelProfileId)
    : undefined;
  const selectedModelId = readConfiguredSelectedModelId(llmConfig);
  const selectedProfile = selectedModelId
    ? models.find((profile) => profile.id === selectedModelId)
    : undefined;

  return overrideProfile || selectedProfile || models[0];
}

function parseProviderProfiles(llmConfig: ConfigSource): Map<string, LlmProviderProfile> {
  const providers = llmConfig.providers;

  if (providers === undefined || providers === null || providers === '') {
    throw new LlmConfigError('LLM 配置缺少 providers');
  }

  assertPlainObject(providers, 'providers');

  const parsedProviders = new Map<string, LlmProviderProfile>();

  for (const [providerId, rawProvider] of Object.entries(providers)) {
    if (providerId.trim() === '') {
      throw new LlmConfigError('LLM provider id 不能为空');
    }

    assertPlainObject(rawProvider, `providers.${providerId}`);

    const preset = readRequiredProviderPreset(rawProvider, providerId);
    const userBaseURL = readOptionalProviderString(rawProvider, 'baseURL', providerId);
    const baseURL = preset.baseURLMode === 'fixed' ? preset.baseURL : userBaseURL;
    const userHeaders = readOptionalHeaders(rawProvider, 'headers', `LLM provider ${providerId}`);
    const headers = {
      ...(preset.headers || {}),
      ...(userHeaders || {})
    };
    const codexAuthFile = preset.codexOAuth
      ? readOptionalProviderString(rawProvider, 'codexAuthFile', providerId)
      : undefined;

    parsedProviders.set(providerId, {
      id: providerId,
      agentType: preset.agentType,
      apiKey: readProviderApiKey(rawProvider, providerId, preset),
      baseURL,
      ...(preset.codexOAuth ? {codexOAuth: codexAuthFile ? {authFilePath: codexAuthFile} : {}} : {}),
      ...(Object.keys(headers).length > 0 ? {headers} : {})
    });
  }

  return parsedProviders;
}

function parseModelProfile(rawProfile: unknown, index: number, providers: Map<string, LlmProviderProfile>): LlmModelProfile {
  assertPlainObject(rawProfile, `models[${index}]`);

  const id = readRequiredProfileString(rawProfile, 'id', `#${index + 1}`);
  const provider = readRequiredProfileProvider(rawProfile, id);

  if (!providers.has(provider)) {
    throw new LlmConfigError(`LLM 模型 ${id} 引用了不存在的 provider：${provider}`);
  }

  const providerProfile = providers.get(provider)!;
  const reasoningEffort = providerProfile.agentType === 'openai' || providerProfile.agentType === 'openai-chat' || providerProfile.agentType === 'anthropic' || providerProfile.agentType === 'codex'
    ? readOptionalReasoningEffort(rawProfile, id)
    : undefined;
  const reasoningSummary = providerProfile.agentType === 'openai'
    ? readOptionalReasoningSummary(rawProfile, id)
    : undefined;

  return {
    id,
    provider,
    model: readRequiredProfileString(rawProfile, 'model', id),
    ...(reasoningEffort ? {reasoningEffort} : {}),
    ...(reasoningSummary ? {reasoningSummary} : {}),
    contextWindow: readOptionalProfilePositiveInteger(rawProfile, 'contextWindow', id)
  };
}

function parseModelProfiles(llmConfig: ConfigSource, providers: Map<string, LlmProviderProfile>): LlmModelProfile[] {
  const models = llmConfig.models;

  if (!hasUsableModels(models)) {
    return [];
  }

  const seenIds = new Set<string>();

  return models.map((profile, index) => {
    const parsedProfile = parseModelProfile(profile, index, providers);

    if (seenIds.has(parsedProfile.id)) {
      throw new LlmConfigError(`LLM 模型 id 重复：${parsedProfile.id}`);
    }

    seenIds.add(parsedProfile.id);
    return parsedProfile;
  });
}

function withOptionalHeaders(config: Pick<LlmConfig, 'agentType' | 'apiKey' | 'baseURL' | 'codexOAuth'>, headers?: Record<string, string>): Pick<LlmConfig, 'agentType' | 'apiKey' | 'baseURL' | 'codexOAuth' | 'headers'> {
  return headers ? {...config, headers} : config;
}

function resolveSelectedProviderConfig(selectedProfile: LlmModelProfile, providers: Map<string, LlmProviderProfile>): Pick<LlmConfig, 'agentType' | 'apiKey' | 'baseURL' | 'codexOAuth' | 'headers'> {
  const provider = providers.get(selectedProfile.provider);

  if (!provider) {
    throw new LlmConfigError(`LLM 模型 ${selectedProfile.id} 引用了不存在的 provider：${selectedProfile.provider}`);
  }

  return withOptionalHeaders({
    agentType: provider.agentType,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    ...(provider.codexOAuth ? {codexOAuth: provider.codexOAuth} : {})
  }, provider.headers);
}

function readParsedConfig(options: ReadLlmConfigOptions = {}): ConfigSource {
  const configPath = options.configPath || getDefaultConfigPath();

  try {
    return new JsonConfigFile(configPath, {readFile: options.readFile}).read();
  } catch (error: unknown) {
    if (error instanceof JsonConfigFileError && error.kind === 'missing') {
      throw new LlmConfigError(`LLM 配置文件不存在：${configPath}`);
    }

    if (error instanceof JsonConfigFileError && error.kind === 'invalid_json') {
      throw new LlmConfigError(`LLM 配置文件不是有效 JSON：${configPath}`);
    }

    if (error instanceof JsonConfigFileError && error.kind === 'invalid_root') {
      throw new LlmConfigError('LLM 配置 根节点必须是对象');
    }

    throw new LlmConfigError(`无法读取 LLM 配置文件：${configPath}`);
  }
}

function readLlmConfigSource(options: ReadLlmConfigOptions = {}): ConfigSource {
  const parsedConfig = readParsedConfig(options);

  assertPlainObject(parsedConfig.llm, 'llm');

  return parsedConfig.llm;
}

function readToolRuntimeConfig(rootConfig: ConfigSource): ToolRuntimeConfig {
  const toolsConfig = rootConfig.tools && typeof rootConfig.tools === 'object' && !Array.isArray(rootConfig.tools)
    ? rootConfig.tools as ConfigSource
    : {};
  const bashConfig = toolsConfig.bash && typeof toolsConfig.bash === 'object' && !Array.isArray(toolsConfig.bash)
    ? toolsConfig.bash as ConfigSource
    : {};
  const fileEditConfig = toolsConfig.fileEdit && typeof toolsConfig.fileEdit === 'object' && !Array.isArray(toolsConfig.fileEdit)
    ? toolsConfig.fileEdit as ConfigSource
    : {};

  return {
    bash: readBashToolConfig(bashConfig),
    fileEditMode: fileEditConfig.mode === 'edit_file' ? 'edit_file' : 'apply_patch'
  };
}

function readBashToolConfig(bashConfig: ConfigSource): BashToolConfig {
  return {
    timeoutMs: readOptionalPositiveInteger(bashConfig, 'timeoutMs') ?? DEFAULT_BASH_TOOL_TIMEOUT_MS,
    maxOutputBytes: readOptionalIntegerInRange(bashConfig, 'maxOutputBytes', 1_024, 65_536, DEFAULT_BASH_TOOL_MAX_OUTPUT_BYTES)
  };
}

/**
 * 读取用户级配置中的模型展示信息，供 /model 命令使用。
 */
function readLlmModelConfigInfo(options: ReadLlmConfigOptions = {}): LlmModelConfigInfo {
  const llmConfig = readLlmConfigSource(options);
  const providers = parseProviderProfiles(llmConfig);
  const models = parseModelProfiles(llmConfig, providers);

  if (models.length === 0) {
    throw new LlmConfigError('LLM 配置缺少 models');
  }

  const selectedProfile = resolveSelectedProfile(llmConfig, models);

  return {
    kind: 'profiles',
    selectedModelId: selectedProfile.id,
    models
  };
}

type ReadLlmConfigOptions = {
  configPath?: string;
  modelProfileId?: string;
  reasoningEffortOverride?: ReasoningEffort;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
};

/**
 * 从用户级配置文件读取真实 LLM adapter 配置；可为当前运行指定 profile，失效时回退全局选择。
 */
function readLlmConfig(options: ReadLlmConfigOptions = {}): LlmConfig {
  const rootConfig = readParsedConfig(options);

  assertPlainObject(rootConfig.llm, 'llm');

  const llmConfig = rootConfig.llm;
  const providers = parseProviderProfiles(llmConfig);
  const models = parseModelProfiles(llmConfig, providers);

  if (models.length === 0) {
    throw new LlmConfigError('LLM 配置缺少 models');
  }

  const selectedProfile = resolveSelectedProfile(llmConfig, models, options.modelProfileId);
  const providerConfig = resolveSelectedProviderConfig(selectedProfile, providers);
  const reasoningEffort = options.reasoningEffortOverride ?? selectedProfile.reasoningEffort;

  return {
    ...providerConfig,
    model: selectedProfile.model,
    ...(reasoningEffort ? {reasoningEffort} : {}),
    ...(selectedProfile.reasoningSummary ? {reasoningSummary: selectedProfile.reasoningSummary} : {}),
    contextWindow: selectedProfile.contextWindow,
    tools: readToolRuntimeConfig(rootConfig)
  };
}

export {
  COMPACTION_RECENT_KEEP_COUNT,
  COMPACTION_THRESHOLD_RATIO,
  DEFAULT_BASH_TOOL_MAX_OUTPUT_BYTES,
  DEFAULT_BASH_TOOL_TIMEOUT_MS,
  DEFAULT_CONTEXT_WINDOW,
  LlmConfigError,
  getDefaultConfigPath,
  readLlmConfig,
  readLlmModelConfigInfo,
  readToolRuntimeConfig,
  resolveContextWindow
};

export type {
  LlmModelConfigInfo,
  LlmModelProfile,
  ReadLlmConfigOptions
};
