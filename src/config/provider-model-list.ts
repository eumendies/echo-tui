import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import {redactSensitiveText} from '../agent/agent-errors';
import {CODEX_OAUTH_MODELS_URL, resolveCodexOAuthCredential} from './codex-oauth';
import {getProviderPreset, providerRequiresApiKey} from './provider-presets';
import type {AgentType, CodexOAuthCredential, CodexOAuthRuntimeConfig} from '../types/agent';
import type {CommandConfigListModelsResult, ConfigProviderDraft, ConfigRemoteModel} from '../types/command';

type ClientOptions = {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number};

type OpenAiModelListClient = {
  models?: {
    list?: () => Promise<unknown>;
  };
};

type AnthropicModelListClient = {
  models?: {
    list?: (params?: unknown) => Promise<unknown>;
  };
};

type ProviderModelListDependencies = {
  AnthropicClient?: new (options: ClientOptions) => unknown;
  fetch?: typeof fetch;
  OpenAIClient?: new (options: ClientOptions) => unknown;
  resolveCodexOAuthCredential?: (config: CodexOAuthRuntimeConfig) => Promise<CodexOAuthCredential>;
};

type ProviderModelListKind = 'openai' | 'anthropic' | 'codex';

type ProviderConnection = {
  apiKey: string;
  baseURL?: string;
  codexAuthFile?: string;
  headers?: Record<string, string>;
  listKind: ProviderModelListKind;
};

const MODEL_LIST_KIND_BY_AGENT_TYPE: Partial<Record<AgentType, ProviderModelListKind>> = {
  'openai': 'openai',
  'openai-chat': 'openai',
  'anthropic': 'anthropic',
  'codex': 'codex'
};

const MODEL_LIST_MAX_RETRIES = 3;
const MODEL_LIST_LIMIT = 100;

function resolveProviderConnection(provider: ConfigProviderDraft): CommandConfigListModelsResult | ProviderConnection {
  const preset = getProviderPreset(provider.preset);
  const providerLabel = provider.label || provider.id;

  if (!preset) {
    return {ok: false, reason: 'invalid', error: `provider ${providerLabel} 的 preset 不存在：${provider.preset || '<empty>'}`};
  }

  const listKind = MODEL_LIST_KIND_BY_AGENT_TYPE[preset.agentType];

  if (!listKind) {
    return {ok: false, reason: 'unsupported', error: `provider ${providerLabel} 不支持自动列出模型`};
  }

  if (providerRequiresApiKey(preset) && provider.apiKey.trim() === '') {
    return {ok: false, reason: 'invalid', error: `provider ${providerLabel} 缺少 API key`};
  }

  if (preset.baseURLMode === 'required' && !provider.baseURL) {
    return {ok: false, reason: 'invalid', error: `provider ${providerLabel} 缺少 Base URL`};
  }

  const headers = {
    ...(preset.headers || {}),
    ...(provider.headers || {})
  };

  return {
    apiKey: provider.apiKey || preset.defaultApiKey || '',
    baseURL: preset.baseURLMode === 'fixed' ? preset.baseURL : provider.baseURL,
    codexAuthFile: provider.codexAuthFile,
    ...(Object.keys(headers).length > 0 ? {headers} : {}),
    listKind
  };
}

/**
 * 基于 provider 草稿调用对应厂商 models API；只返回 UI 需要的模型 id。
 */
async function listProviderModels(provider: ConfigProviderDraft, dependencies: ProviderModelListDependencies = {}): Promise<CommandConfigListModelsResult> {
  const connection = resolveProviderConnection(provider);

  if ('ok' in connection) {
    return connection;
  }

  try {
    const response = connection.listKind === 'codex'
      ? await listCodexModels(connection, dependencies.fetch || fetch, dependencies.resolveCodexOAuthCredential || resolveCodexOAuthCredential)
      : connection.listKind === 'openai'
        ? await listOpenAiModels(connection, dependencies.OpenAIClient || OpenAI)
        : await listAnthropicModels(connection, dependencies.AnthropicClient || Anthropic);
    const models = connection.listKind === 'codex' ? extractCodexModels(response) : extractModels(response);

    return {
      ok: true,
      models: models.slice(0, MODEL_LIST_LIMIT),
      ...(models.length > MODEL_LIST_LIMIT ? {truncated: true} : {})
    };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: 'error',
      error: redactProviderModelListError(error, provider)
    };
  }
}

async function listOpenAiModels(connection: ProviderConnection, OpenAIClient: new (options: ClientOptions) => unknown): Promise<unknown> {
  const client = new OpenAIClient({
    apiKey: connection.apiKey,
    baseURL: connection.baseURL,
    defaultHeaders: connection.headers,
    maxRetries: MODEL_LIST_MAX_RETRIES
  }) as OpenAiModelListClient;

  if (typeof client.models?.list !== 'function') {
    throw new Error('OpenAI client does not support models.list');
  }

  return client.models.list();
}

async function listAnthropicModels(connection: ProviderConnection, AnthropicClient: new (options: ClientOptions) => unknown): Promise<unknown> {
  const client = new AnthropicClient({
    apiKey: connection.apiKey,
    baseURL: connection.baseURL,
    defaultHeaders: connection.headers,
    maxRetries: MODEL_LIST_MAX_RETRIES
  }) as AnthropicModelListClient;

  if (typeof client.models?.list !== 'function') {
    throw new Error('Anthropic client does not support models.list');
  }

  return client.models.list({limit: MODEL_LIST_LIMIT});
}

async function listCodexModels(connection: ProviderConnection, requestFetch: typeof fetch, credentialResolver: (config: CodexOAuthRuntimeConfig) => Promise<CodexOAuthCredential>): Promise<unknown> {
  const credential = await credentialResolver(connection.codexAuthFile ? {authFilePath: connection.codexAuthFile} : {});
  const response = await requestFetch(CODEX_OAUTH_MODELS_URL, {
    method: 'GET',
    headers: {
      ...(connection.headers || {}),
      Authorization: `Bearer ${credential.accessToken}`,
      ...(credential.accountId ? {'ChatGPT-Account-ID': credential.accountId} : {})
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

function extractModels(response: unknown): ConfigRemoteModel[] {
  const entries = Array.isArray(response)
    ? response
    : isRecord(response) && Array.isArray(response.data)
      ? response.data
      : [];
  const seen = new Set<string>();
  const models: ConfigRemoteModel[] = [];

  for (const entry of entries) {
    const id = readModelId(entry);

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    models.push({id});
  }

  return models;
}

function readModelId(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    return entry.trim() || undefined;
  }

  if (!isRecord(entry)) {
    return undefined;
  }

  const id = typeof entry.id === 'string' ? entry.id : typeof entry.model === 'string' ? entry.model : undefined;
  return id?.trim() || undefined;
}

function extractCodexModels(response: unknown): ConfigRemoteModel[] {
  const entries = isRecord(response) && Array.isArray(response.models)
    ? response.models
    : isRecord(response) && Array.isArray(response.data)
      ? response.data
      : Array.isArray(response)
        ? response
        : [];
  const seen = new Set<string>();
  const models: ConfigRemoteModel[] = [];

  for (const entry of entries) {
    if (isRecord(entry) && typeof entry.visibility === 'string' && entry.visibility !== 'list') {
      continue;
    }

    const id = readCodexModelId(entry);

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    models.push({id});
  }

  return models;
}

function readCodexModelId(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    return entry.trim() || undefined;
  }

  if (!isRecord(entry)) {
    return undefined;
  }

  const id = typeof entry.slug === 'string'
    ? entry.slug
    : typeof entry.id === 'string'
      ? entry.id
      : typeof entry.model === 'string'
        ? entry.model
        : undefined;

  return id?.trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function redactProviderModelListError(error: unknown, provider: ConfigProviderDraft): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '无法列出模型');
  let message = redactSensitiveText(rawMessage);
  const secrets = [provider.apiKey, ...Object.values(provider.headers || {})]
    .filter((value) => value.trim().length >= 4);

  for (const secret of secrets) {
    message = message.replace(new RegExp(escapeRegExp(secret), 'g'), '<redacted>');
  }

  return `无法列出模型：${message}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
  MODEL_LIST_KIND_BY_AGENT_TYPE,
  listProviderModels,
  resolveProviderConnection
};

export type {
  ProviderModelListDependencies,
  ProviderModelListKind
};
