import {REASONING_EFFORTS, REASONING_SUMMARIES} from '../types/agent';
import {getProviderPreset, providerRequiresApiKey} from './provider-presets';
import {DEFAULT_APP_SETTINGS} from './app-settings-config';
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

type ParsedLlmConfiguration = {
  llmConfig: ConfigSource; // 当前 snapshot 的 llm 节点，保留全局模型选择语义。
  models: LlmModelProfile[]; // 已校验且 provider 引用有效的模型目录。
  providers: Map<string, LlmProviderProfile>; // 已解析 preset 与凭据的 provider 索引。
};

type ParsedProviderProfiles = {
  providers: Map<string, LlmProviderProfile>; // 已解析 preset 与运行字段的 provider 索引。
  ignoredProviders: Map<string, string>; // 因 preset 未知而忽略的 provider id 到 preset id 映射。
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
    const apiKey = source.apiKey;
    return typeof apiKey === 'string' && apiKey !== '' ? apiKey : preset.defaultApiKey || '';
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

function readOptionalProfilePositiveInteger(source: ConfigSource, fieldName: string): number | undefined {
  const value = source[fieldName];

  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readConfiguredSelectedModelId(llmConfig: ConfigSource): string | undefined {
  const selectedModel = llmConfig.selectedModel;

  if (selectedModel === undefined || selectedModel === null || selectedModel === '') {
    return undefined;
  }

  if (typeof selectedModel !== 'string') {
    return undefined;
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

function parseProviderProfiles(llmConfig: ConfigSource): ParsedProviderProfiles {
  const providers = llmConfig.providers;

  if (providers === undefined || providers === null || providers === '') {
    throw new LlmConfigError('LLM 配置缺少 providers');
  }

  assertPlainObject(providers, 'providers');

  const parsedProviders = new Map<string, LlmProviderProfile>();
  const ignoredProviders = new Map<string, string>();

  for (const [providerId, rawProvider] of Object.entries(providers)) {
    if (providerId.trim() === '') {
      throw new LlmConfigError('LLM provider id 不能为空');
    }

    assertPlainObject(rawProvider, `providers.${providerId}`);

    const presetId = readRequiredProviderString(rawProvider, 'preset', providerId);
    const preset = getProviderPreset(presetId);
    if (!preset) {
      ignoredProviders.set(providerId, presetId);
      continue;
    }

    const userBaseURL = preset.baseURLMode === 'optional' || preset.baseURLMode === 'required'
      ? readOptionalProviderString(rawProvider, 'baseURL', providerId)
      : undefined;
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

  return {providers: parsedProviders, ignoredProviders};
}

function parseModelProfile(rawProfile: ConfigSource, index: number, provider: string, providers: Map<string, LlmProviderProfile>): LlmModelProfile {
  const id = readRequiredProfileString(rawProfile, 'id', `#${index + 1}`);

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
    contextWindow: readOptionalProfilePositiveInteger(rawProfile, 'contextWindow')
  };
}

function parseModelProfiles(llmConfig: ConfigSource, providers: Map<string, LlmProviderProfile>, ignoredProviders: Map<string, string>): LlmModelProfile[] {
  const models = llmConfig.models;

  if (!hasUsableModels(models)) {
    return [];
  }

  const seenIds = new Set<string>();
  const parsedModels: LlmModelProfile[] = [];

  for (const [index, profile] of models.entries()) {
    assertPlainObject(profile, `models[${index}]`);
    const profileLabel = typeof profile.id === 'string' && profile.id.trim() !== '' ? profile.id : `#${index + 1}`;
    const provider = readRequiredProfileProvider(profile, profileLabel);
    if (ignoredProviders.has(provider)) {
      continue;
    }

    const parsedProfile = parseModelProfile(profile, index, provider, providers);

    if (seenIds.has(parsedProfile.id)) {
      throw new LlmConfigError(`LLM 模型 id 重复：${parsedProfile.id}`);
    }

    seenIds.add(parsedProfile.id);
    parsedModels.push(parsedProfile);
  }

  return parsedModels;
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

/**
 * 从同一用户配置根解析 provider/model 图；不访问文件，供 revision snapshot 复用。
 */
function parseLlmConfiguration(rootConfig: ConfigSource): ParsedLlmConfiguration {
  assertPlainObject(rootConfig.llm, 'llm');
  const llmConfig = rootConfig.llm;
  const {providers, ignoredProviders} = parseProviderProfiles(llmConfig);
  const models = parseModelProfiles(llmConfig, providers, ignoredProviders);

  if (hasUsableModels(llmConfig.models) && models.length === 0 && ignoredProviders.size > 0) {
    const ignored = [...ignoredProviders].map(([providerId, presetId]) => `${providerId} (${presetId})`).join('、');
    throw new LlmConfigError(`LLM 配置没有可解析的有效 models；以下 provider 使用未知 preset：${ignored}`);
  }

  return {llmConfig, models, providers};
}

function parseToolRuntimeConfig(rootConfig: ConfigSource): ToolRuntimeConfig {
  const toolsConfig = rootConfig.tools && typeof rootConfig.tools === 'object' && !Array.isArray(rootConfig.tools)
    ? rootConfig.tools as ConfigSource
    : {};
  const bashConfig = toolsConfig.bash && typeof toolsConfig.bash === 'object' && !Array.isArray(toolsConfig.bash)
    ? toolsConfig.bash as ConfigSource
    : {};
  const fileEditConfig = toolsConfig.fileEdit && typeof toolsConfig.fileEdit === 'object' && !Array.isArray(toolsConfig.fileEdit)
    ? toolsConfig.fileEdit as ConfigSource
    : {};
  const readFilesConfig = toolsConfig.readFiles && typeof toolsConfig.readFiles === 'object' && !Array.isArray(toolsConfig.readFiles)
    ? toolsConfig.readFiles as ConfigSource
    : {};

  return {
    autoCompressImages: typeof readFilesConfig.autoCompressImages === 'boolean'
      ? readFilesConfig.autoCompressImages
      : DEFAULT_APP_SETTINGS.autoCompressImages,
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

/** 从已解析图创建不含凭据的模型目录。 */
function createLlmModelConfigInfo(parsed: ParsedLlmConfiguration): LlmModelConfigInfo {
  if (parsed.models.length === 0) {
    throw new LlmConfigError('LLM 配置缺少 models');
  }

  const selectedProfile = resolveSelectedProfile(parsed.llmConfig, parsed.models);

  return {
    kind: 'profiles',
    selectedModelId: selectedProfile.id,
    models: parsed.models
  };
}

/** 从已解析图和工具投影创建运行配置；无效的宽松 override 回退全局选择。 */
function resolveLlmConfig(parsed: ParsedLlmConfiguration, tools: ToolRuntimeConfig, options: ResolveLlmConfigOptions = {}): LlmConfig {
  if (parsed.models.length === 0) {
    throw new LlmConfigError('LLM 配置缺少 models');
  }

  const selectedProfile = resolveSelectedProfile(parsed.llmConfig, parsed.models, options.modelProfileId);
  return createResolvedProfileConfig(selectedProfile, parsed.providers, tools, options);
}

/** 严格解析指定 profile；审批等安全边界不得回退全局模型。 */
function resolveLlmConfigForProfile(parsed: ParsedLlmConfiguration, tools: ToolRuntimeConfig, modelProfileId: string): LlmConfig {
  return createResolvedProfileConfig(requireModelProfile(parsed.models, modelProfileId), parsed.providers, tools);
}

/** 严格解析指定 profile 及其默认或显式 effort；失效引用不得落到全局选择。 */
function resolveLlmConfigStrict(parsed: ParsedLlmConfiguration, tools: ToolRuntimeConfig, options: Required<Pick<ResolveLlmConfigOptions, 'modelProfileId'>> & Pick<ResolveLlmConfigOptions, 'reasoningEffortOverride'>): LlmConfig {
  return createResolvedProfileConfig(requireModelProfile(parsed.models, options.modelProfileId), parsed.providers, tools, options);
}

/** 严格查找显式 profile，统一审批与 Subagent 的禁止回退语义。 */
function requireModelProfile(models: readonly LlmModelProfile[], modelProfileId: string): LlmModelProfile {
  const selectedProfile = models.find((profile) => profile.id === modelProfileId);
  if (!selectedProfile) {
    throw new LlmConfigError(`LLM 模型 profile 不存在：${modelProfileId}`);
  }
  return selectedProfile;
}

/** 从已确认的 profile 组装 provider 配置；reasoningOptions 缺省时刻意不启用推理字段。 */
function createResolvedProfileConfig(
  selectedProfile: LlmModelProfile,
  providers: Map<string, LlmProviderProfile>,
  tools: ToolRuntimeConfig,
  reasoningOptions?: Pick<ResolveLlmConfigOptions, 'reasoningEffortOverride'>
): LlmConfig {
  const reasoningEffort = reasoningOptions
    ? reasoningOptions.reasoningEffortOverride ?? selectedProfile.reasoningEffort
    : undefined;
  return {
    ...resolveSelectedProviderConfig(selectedProfile, providers),
    model: selectedProfile.model,
    ...(reasoningEffort ? {reasoningEffort} : {}),
    ...(reasoningOptions && selectedProfile.reasoningSummary ? {reasoningSummary: selectedProfile.reasoningSummary} : {}),
    contextWindow: selectedProfile.contextWindow,
    tools
  };
}

type ResolveLlmConfigOptions = {
  modelProfileId?: string;
  reasoningEffortOverride?: ReasoningEffort;
};

export {
  COMPACTION_RECENT_KEEP_COUNT,
  COMPACTION_THRESHOLD_RATIO,
  DEFAULT_BASH_TOOL_MAX_OUTPUT_BYTES,
  DEFAULT_BASH_TOOL_TIMEOUT_MS,
  DEFAULT_CONTEXT_WINDOW,
  LlmConfigError,
  createLlmModelConfigInfo,
  parseLlmConfiguration,
  parseToolRuntimeConfig,
  resolveLlmConfig,
  resolveLlmConfigForProfile,
  resolveLlmConfigStrict,
  resolveContextWindow
};

export type {
  LlmModelConfigInfo,
  LlmModelProfile,
  ParsedLlmConfiguration,
  ResolveLlmConfigOptions
};
