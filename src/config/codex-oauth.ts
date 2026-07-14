import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {redactSensitiveText} from '../agent/agent-errors';

const CODEX_OAUTH_BACKEND_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_OAUTH_MODELS_URL = `${CODEX_OAUTH_BACKEND_BASE_URL}/models?client_version=1.0.0`;
const CODEX_OAUTH_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;

type CodexOAuthRuntimeConfig = {
  authFilePath?: string;
};

type CodexOAuthCredential = {
  accessToken: string;
  accountId?: string;
  expiresAt?: number;
  refreshToken?: string;
};

type CodexOAuthCredentialDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
  tokenUrl?: string;
};

type CodexUsageWindow = {
  resetAt: number;
  usedPercent: number;
};

type CodexUsage = {
  primary: CodexUsageWindow;
  secondary?: CodexUsageWindow;
};

type CodexUsageDependencies = {
  fetch?: typeof fetch;
  resolveCredential?: (config: CodexOAuthRuntimeConfig) => Promise<CodexOAuthCredential>;
  usageUrl?: string;
};

class CodexOAuthCredentialError extends Error {
  constructor(message: string) {
    super(redactSensitiveText(message));
    this.name = 'CodexOAuthCredentialError';
  }
}

class CodexUsageError extends Error {
  constructor(message: string) {
    super(redactSensitiveText(message));
    this.name = 'CodexUsageError';
  }
}

function resolveCodexAuthFilePath(config: CodexOAuthRuntimeConfig = {}, env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string {
  const configuredPath = config.authFilePath?.trim();

  if (configuredPath) {
    return configuredPath.startsWith('~/')
      ? path.join(homeDir, configuredPath.slice(2))
      : path.resolve(configuredPath);
  }

  const codexHome = env.CODEX_HOME?.trim();

  if (!codexHome) {
    return path.join(homeDir, '.codex', 'auth.json');
  }

  return path.join(codexHome.startsWith('~/') ? path.join(homeDir, codexHome.slice(2)) : path.resolve(codexHome), 'auth.json');
}

function readCodexOAuthCredential(config: CodexOAuthRuntimeConfig = {}, dependencies: CodexOAuthCredentialDependencies = {}): CodexOAuthCredential {
  const authFilePath = resolveCodexAuthFilePath(config);
  const readFile = dependencies.readFile || fs.readFileSync;
  let rawContent: string;

  try {
    rawContent = readFile(authFilePath, 'utf8');
  } catch (error: unknown) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      throw new CodexOAuthCredentialError(`Codex OAuth auth.json 不存在：${authFilePath}`);
    }

    throw new CodexOAuthCredentialError(`无法读取 Codex OAuth auth.json：${authFilePath}`);
  }

  return parseCodexOAuthCredential(rawContent, authFilePath);
}

function parseCodexOAuthCredential(rawContent: string, sourceLabel = 'auth.json'): CodexOAuthCredential {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new CodexOAuthCredentialError(`Codex OAuth auth.json 不是有效 JSON：${sourceLabel}`);
  }

  if (!isRecord(parsed)) {
    throw new CodexOAuthCredentialError(`Codex OAuth auth.json 根节点必须是对象：${sourceLabel}`);
  }

  const tokens = isRecord(parsed.tokens) ? parsed.tokens : undefined;
  const accessToken = readString(tokens, 'access_token') || readString(parsed, 'access_token');
  const refreshToken = readString(tokens, 'refresh_token') || readString(parsed, 'refresh_token');
  const accountId = readString(tokens, 'account_id') || readString(parsed, 'account_id') || readAccountIdFromJwt(accessToken);

  if (!accessToken) {
    throw new CodexOAuthCredentialError(`Codex OAuth auth.json 缺少 tokens.access_token：${sourceLabel}`);
  }

  return {
    accessToken,
    ...(accountId ? {accountId} : {}),
    expiresAt: readJwtExpiry(accessToken) || readExpiryMetadata(tokens) || readExpiryMetadata(parsed),
    ...(refreshToken ? {refreshToken} : {})
  };
}

function isCodexOAuthCredentialExpired(credential: CodexOAuthCredential, now = Date.now()): boolean {
  return credential.expiresAt !== undefined && credential.expiresAt <= now + ACCESS_TOKEN_EXPIRY_SKEW_MS;
}

async function resolveCodexOAuthCredential(config: CodexOAuthRuntimeConfig = {}, dependencies: CodexOAuthCredentialDependencies = {}): Promise<CodexOAuthCredential> {
  const credential = readCodexOAuthCredential(config, dependencies);

  if (!isCodexOAuthCredentialExpired(credential, dependencies.now?.() || Date.now())) {
    return credential;
  }

  return refreshCodexOAuthCredential(credential, dependencies);
}

async function refreshCodexOAuthCredential(credential: CodexOAuthCredential, dependencies: CodexOAuthCredentialDependencies = {}): Promise<CodexOAuthCredential> {
  if (!credential.refreshToken) {
    throw new CodexOAuthCredentialError('Codex OAuth access token 已过期，auth.json 缺少 refresh token');
  }

  const requestFetch = dependencies.fetch || fetch;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credential.refreshToken,
    client_id: CODEX_OAUTH_CLIENT_ID
  });
  let response: Response;

  try {
    response = await requestFetch(dependencies.tokenUrl || CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body
    });
  } catch (error: unknown) {
    throw new CodexOAuthCredentialError(`Codex OAuth token refresh 请求失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new CodexOAuthCredentialError(`Codex OAuth token refresh 失败：HTTP ${response.status} ${text}`);
  }

  let payload: unknown;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new CodexOAuthCredentialError('Codex OAuth token refresh 返回了无效 JSON');
  }

  if (!isRecord(payload)) {
    throw new CodexOAuthCredentialError('Codex OAuth token refresh 返回值必须是对象');
  }

  const accessToken = readString(payload, 'access_token');
  const refreshToken = readString(payload, 'refresh_token') || credential.refreshToken;
  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? Math.max(0, payload.expires_in)
    : undefined;

  if (!accessToken) {
    throw new CodexOAuthCredentialError('Codex OAuth token refresh 返回值缺少 access_token');
  }

  return {
    accessToken,
    refreshToken,
    accountId: credential.accountId || readAccountIdFromJwt(accessToken),
    expiresAt: expiresIn !== undefined
      ? (dependencies.now?.() || Date.now()) + expiresIn * 1000
      : readJwtExpiry(accessToken)
  };
}

/**
 * 查询 ChatGPT Codex 账户的主、次限额窗口，只返回展示所需的非敏感字段。
 */
async function queryCodexUsage(config: CodexOAuthRuntimeConfig = {}, dependencies: CodexUsageDependencies = {}): Promise<CodexUsage> {
  const resolveCredential = dependencies.resolveCredential || resolveCodexOAuthCredential;
  const requestFetch = dependencies.fetch || fetch;
  let credential: CodexOAuthCredential;

  try {
    credential = await resolveCredential(config);
  } catch (error: unknown) {
    throw new CodexUsageError(`无法读取 Codex OAuth 凭据：${formatError(error)}`);
  }

  let response: Response;

  try {
    response = await requestFetch(dependencies.usageUrl || CODEX_OAUTH_USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        ...(credential.accountId ? {'ChatGPT-Account-ID': credential.accountId} : {})
      }
    });
  } catch (error: unknown) {
    throw new CodexUsageError(`Codex 用量请求失败：${formatError(error)}`);
  }

  if (!response.ok) {
    throw new CodexUsageError(`Codex 用量请求失败：HTTP ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new CodexUsageError('Codex 用量响应不是有效 JSON');
  }

  return parseCodexUsageResponse(payload);
}

/**
 * 校验 Codex usage 响应并把秒级 reset 时间转换成毫秒时间戳。
 */
function parseCodexUsageResponse(payload: unknown): CodexUsage {
  if (!isRecord(payload) || !isRecord(payload.rate_limit)) {
    throw new CodexUsageError('Codex 用量响应缺少 rate_limit');
  }

  const secondary = payload.rate_limit.secondary_window;

  return {
    primary: parseUsageWindow(payload.rate_limit.primary_window, 'primary_window'),
    ...(secondary === null || secondary === undefined
      ? {}
      : {secondary: parseUsageWindow(secondary, 'secondary_window')})
  };
}

function parseUsageWindow(value: unknown, label: string): CodexUsageWindow {
  const window = isRecord(value) ? value : undefined;
  const usedPercent = window?.used_percent;
  const resetAt = window?.reset_at;

  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) {
    throw new CodexUsageError(`Codex 用量响应的 ${label}.used_percent 无效`);
  }

  if (typeof resetAt !== 'number' || !Number.isFinite(resetAt) || resetAt <= 0) {
    throw new CodexUsageError(`Codex 用量响应的 ${label}.reset_at 无效`);
  }

  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetAt: resetAt < 10_000_000_000 ? resetAt * 1000 : resetAt
  };
}

function formatError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '未知错误';
}

function readJwtExpiry(token: string | undefined): number | undefined {
  const payload = readJwtPayload(token);
  const exp = payload && typeof payload.exp === 'number' && Number.isFinite(payload.exp)
    ? payload.exp
    : undefined;

  return exp === undefined ? undefined : exp * 1000;
}

function readAccountIdFromJwt(token: string | undefined): string | undefined {
  const payload = readJwtPayload(token);
  const accountId = payload && typeof payload['https://api.openai.com/auth.chatgpt_account_id'] === 'string'
    ? payload['https://api.openai.com/auth.chatgpt_account_id']
    : undefined;

  return accountId?.trim() || undefined;
}

function readExpiryMetadata(source: Record<string, unknown> | undefined): number | undefined {
  const value = source?.expires_at;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed > 10_000_000_000 ? parsed : parsed * 1000;
    }
  }

  return undefined;
}

function readJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  const payload = token?.split('.')[1];

  if (!payload) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readString(source: Record<string, unknown> | undefined, fieldName: string): string | undefined {
  const value = source?.[fieldName];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

export {
  CODEX_OAUTH_BACKEND_BASE_URL,
  CODEX_OAUTH_MODELS_URL,
  CODEX_OAUTH_USAGE_URL,
  CodexOAuthCredentialError,
  CodexUsageError,
  isCodexOAuthCredentialExpired,
  parseCodexOAuthCredential,
  parseCodexUsageResponse,
  queryCodexUsage,
  readCodexOAuthCredential,
  refreshCodexOAuthCredential,
  resolveCodexAuthFilePath,
  resolveCodexOAuthCredential
};

export type {
  CodexOAuthCredential,
  CodexOAuthCredentialDependencies,
  CodexOAuthRuntimeConfig,
  CodexUsage,
  CodexUsageDependencies,
  CodexUsageWindow
};
