import type {McpConfig, McpConfigDiagnostic, McpConfigDraft, McpConfigEditDraft, McpConfigEditIssue, McpServerConfig, McpServerConfigDraft, McpSecretEntryDraft, McpServerEditDraft} from '../types/mcp';
import type {UserConfigSource} from './user-config';

const DEFAULT_MCP_TIMEOUT_MS = 30_000;
const MIN_MCP_TIMEOUT_MS = 1_000;
const MAX_MCP_TIMEOUT_MS = 120_000;

type ConfigSource = UserConfigSource;
type ParsedMcpServerEntry = {
  name: string;
  rawServer: unknown;
  result: ReturnType<typeof parseMcpServerConfig>;
};

function createMcpConfig(model: {enabled: boolean; servers: ParsedMcpServerEntry[]}): McpConfig {
  const diagnostics: McpConfigDiagnostic[] = [];

  if (!model.enabled) {
    return {enabled: false, servers: [], diagnostics};
  }

  const servers: McpServerConfig[] = [];

  for (const {name, result} of model.servers) {
    if (result.ok) {
      if (result.server.enabled) {
        servers.push(result.server);
      }
      continue;
    }

    diagnostics.push({serverName: name, message: result.message});
  }

  return {enabled: true, servers, diagnostics};
}

function createMcpConfigDraft(model: {enabled: boolean; servers: ParsedMcpServerEntry[]}): McpConfigDraft {
  const servers: McpServerConfigDraft[] = [];

  for (const {name, rawServer, result} of model.servers) {
    if (result.ok) {
      servers.push(createValidServerDraft(result.server));
      continue;
    }

    const rawEnabled = isPlainObject(rawServer) ? rawServer.enabled : undefined;
    servers.push({
      name,
      enabled: readOptionalBoolean(rawEnabled, true),
      valid: false,
      summary: result.message,
      diagnostic: result.message
    });
  }

  return {enabled: model.enabled, servers};
}

/**
 * 把配置投影成面板编辑草稿：可解析的 server 展开为字段草稿，不可解析的只保留诊断占位。
 * 草稿刻意不携带凭据明文，只用 stored 标记该键当前是否有值。
 */
function createMcpConfigEditDraft(rootConfig: ConfigSource): McpConfigEditDraft {
  const model = parseMcpConfigModel(rootConfig);

  return {
    enabled: model.enabled,
    servers: model.servers.map((entry): McpServerEditDraft => entry.result.ok
      ? createServerEditDraft(entry.name, entry.result.server)
      : {name: entry.name, originalName: entry.name, editable: false, enabled: readRawEnabled(entry.rawServer), transport: 'stdio', args: [], env: [], headers: [], timeoutMs: DEFAULT_MCP_TIMEOUT_MS})
  };
}

/**
 * 校验编辑草稿：只检查可编辑 server（不可解析节点不参与，避免误判用户手写配置）。
 * 返回逐条问题；空数组表示可以写回。
 */
function validateMcpConfigEditDraft(draft: McpConfigEditDraft): McpConfigEditIssue[] {
  const issues: McpConfigEditIssue[] = [];
  const seenNames = new Set<string>();

  for (const server of draft.servers) {
    const name = server.name.trim();

    if (name === '') {
      issues.push({serverName: server.name, message: 'server 名不能为空'});
      continue;
    }

    if (seenNames.has(name)) {
      issues.push({serverName: name, message: `server 名重复：${name}`});
      continue;
    }

    seenNames.add(name);

    if (!server.editable) {
      continue;
    }

    if (server.transport === 'stdio' && !server.command?.trim()) {
      issues.push({serverName: name, message: 'stdio server 缺少 command'});
    }

    if (server.transport === 'http' && !server.url?.trim()) {
      issues.push({serverName: name, message: 'http server 缺少 url'});
    }

    if (!Number.isInteger(server.timeoutMs) || server.timeoutMs < MIN_MCP_TIMEOUT_MS || server.timeoutMs > MAX_MCP_TIMEOUT_MS) {
      issues.push({serverName: name, message: `timeoutMs 必须是 ${MIN_MCP_TIMEOUT_MS}–${MAX_MCP_TIMEOUT_MS} 之间的整数`});
    }

    issues.push(...validateSecretEntries(name, 'env', server.env));
    issues.push(...validateSecretEntries(name, 'headers', server.headers));
  }

  return issues;
}

/**
 * 字段级写回：以现有节点为基线只覆盖草稿携带的字段，保留未知字段与未改动凭据；
 * 草稿中缺失的现有 server 视为删除，不可解析的节点原样保留。
 */
function applyMcpConfigEditDraft(rootConfig: ConfigSource, draft: McpConfigEditDraft): void {
  const mcp = isPlainObject(rootConfig.mcp) ? {...rootConfig.mcp} : {};
  const baselineServers = isPlainObject(mcp.servers) ? mcp.servers : {};
  const nextServers: ConfigSource = {};

  for (const server of draft.servers) {
    const trimmedName = server.name.trim();
    const baselineName = server.originalName || trimmedName;
    const baseline = isPlainObject(baselineServers[baselineName]) ? baselineServers[baselineName] : {};

    if (!server.editable) {
      // 无法解析的节点不属于面板编辑范围:原样保留,避免把用户手写配置改写坏。
      nextServers[baselineName] = baseline;
      continue;
    }

    nextServers[trimmedName] = applyServerEditDraft(baseline, server);
  }

  mcp.enabled = Boolean(draft.enabled);
  mcp.servers = nextServers;
  rootConfig.mcp = mcp;
}

function applyServerEditDraft(baseline: ConfigSource, draft: McpServerEditDraft): ConfigSource {
  const next: ConfigSource = {...baseline};

  next.enabled = draft.enabled;
  next.transport = draft.transport;
  next.timeoutMs = draft.timeoutMs;

  // 只写当前 transport 暴露的字段:另一侧的键不在面板展示范围内,保留在配置里而不做隐式删除。
  if (draft.transport === 'stdio') {
    writeOptionalField(next, 'command', draft.command);
    writeOptionalField(next, 'cwd', draft.cwd);
    writeOptionalField(next, 'args', draft.args.length > 0 ? [...draft.args] : undefined);
    writeOptionalField(next, 'env', applySecretEntries(baseline.env, draft.env));
  } else {
    writeOptionalField(next, 'url', draft.url);
    writeOptionalField(next, 'headers', applySecretEntries(baseline.headers, draft.headers));
  }

  return next;
}

function writeOptionalField(target: ConfigSource, key: string, value: unknown): void {
  if (value === undefined) {
    delete target[key];
    return;
  }

  target[key] = value;
}

/**
 * 重建 env/headers：未改动条目按原始键名取回基线值（键被重命名时值跟随条目移动），
 * 其它条目使用草稿值（空串表示显式清空）。
 */
function applySecretEntries(baselineRaw: unknown, entries: McpSecretEntryDraft[]): Record<string, string> | undefined {
  const baseline = isPlainObject(baselineRaw) ? baselineRaw : {};
  const next: Record<string, string> = {};

  for (const entry of entries) {
    const key = entry.key.trim();

    if (key === '') {
      continue;
    }

    if (entry.value !== undefined) {
      next[key] = entry.value;
      continue;
    }

    const keptValue = baseline[entry.originalKey ?? key];
    next[key] = typeof keptValue === 'string' ? keptValue : '';
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function validateSecretEntries(serverName: string, field: 'env' | 'headers', entries: McpSecretEntryDraft[]): McpConfigEditIssue[] {
  const issues: McpConfigEditIssue[] = [];
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const key = entry.key.trim();

    if (key === '') {
      issues.push({serverName, message: `${field} 存在空键名`});
      continue;
    }

    if (seenKeys.has(key)) {
      issues.push({serverName, message: `${field} 键名重复：${key}`});
    }

    seenKeys.add(key);
  }

  return issues;
}

function createServerEditDraft(name: string, server: McpServerConfig): McpServerEditDraft {
  return {
    name,
    originalName: name,
    editable: true,
    enabled: server.enabled,
    transport: server.transport,
    args: server.transport === 'stdio' ? [...(server.args || [])] : [],
    env: server.transport === 'stdio' ? createSecretEntryDrafts(server.env) : [],
    headers: server.transport === 'http' ? createSecretEntryDrafts(server.headers) : [],
    timeoutMs: server.timeoutMs,
    ...(server.transport === 'stdio' ? {command: server.command, ...(server.cwd ? {cwd: server.cwd} : {})} : {url: server.url})
  };
}

function createSecretEntryDrafts(record: Record<string, string> | undefined): McpSecretEntryDraft[] {
  return Object.entries(record || {}).map(([key, value]) => ({key, originalKey: key, stored: value !== ''}));
}

function readRawEnabled(rawServer: unknown): boolean {
  return isPlainObject(rawServer) ? readOptionalBoolean(rawServer.enabled, true) : true;
}

function parseMcpConfigModel(root: ConfigSource): {enabled: boolean; servers: ParsedMcpServerEntry[]} {
  const mcp = isPlainObject(root.mcp) ? root.mcp : {};
  const serversRoot = isPlainObject(mcp.servers) ? mcp.servers : {};

  return {
    enabled: readOptionalBoolean(mcp.enabled, true),
    servers: Object.entries(serversRoot).map(([name, rawServer]) => ({
      name,
      rawServer,
      result: parseMcpServerConfig(name, rawServer)
    }))
  };
}

function createValidServerDraft(server: McpServerConfig): McpServerConfigDraft {
  return {
    name: server.name,
    enabled: server.enabled,
    valid: true,
    transport: server.transport,
    summary: createServerSummary(server)
  };
}

function createServerSummary(server: McpServerConfig): string {
  if (server.transport === 'stdio') {
    return server.command;
  }

  return server.url;
}

function parseMcpServerConfig(serverName: string, rawServer: unknown): {ok: true; server: McpServerConfig} | {ok: false; message: string} {
  if (serverName.trim() === '') {
    return {ok: false, message: 'MCP server name 不能为空'};
  }

  if (!isPlainObject(rawServer)) {
    return {ok: false, message: 'MCP server 配置必须是对象'};
  }

  const enabled = readOptionalBoolean(rawServer.enabled, true);
  const timeoutMs = readOptionalIntegerInRange(rawServer.timeoutMs, DEFAULT_MCP_TIMEOUT_MS);
  const common = {name: serverName, enabled, timeoutMs};

  if (rawServer.transport === 'stdio') {
    if (typeof rawServer.command !== 'string' || rawServer.command.trim() === '') {
      return {ok: false, message: 'stdio MCP server 缺少有效 command'};
    }

    const args = readOptionalStringArray(rawServer.args);
    const env = readOptionalStringRecord(rawServer.env);
    const cwd = readOptionalString(rawServer.cwd);

    if (!args.ok || !env.ok || !cwd.ok) {
      return {ok: false, message: (!args.ok && args.message) || (!env.ok && env.message) || (!cwd.ok && cwd.message) || 'MCP server 配置无效'};
    }

    return {
      ok: true,
      server: {
        ...common,
        transport: 'stdio',
        command: rawServer.command,
        ...(args.value ? {args: args.value} : {}),
        ...(env.value ? {env: env.value} : {}),
        ...(cwd.value ? {cwd: cwd.value} : {})
      }
    };
  }

  if (rawServer.transport === 'http') {
    if (typeof rawServer.url !== 'string' || rawServer.url.trim() === '') {
      return {ok: false, message: 'http MCP server 缺少有效 url'};
    }

    const headers = readOptionalStringRecord(rawServer.headers);

    if (!headers.ok) {
      return {ok: false, message: headers.message};
    }

    return {
      ok: true,
      server: {
        ...common,
        transport: 'http',
        url: rawServer.url,
        ...(headers.value ? {headers: headers.value} : {})
      }
    };
  }

  return {ok: false, message: 'MCP server transport 必须是 stdio 或 http'};
}

function isPlainObject(value: unknown): value is ConfigSource {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readOptionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readOptionalIntegerInRange(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_MCP_TIMEOUT_MS && value <= MAX_MCP_TIMEOUT_MS
    ? value
    : fallback;
}

function readOptionalString(value: unknown): {ok: true; value?: string} | {ok: false; message: string} {
  if (value === undefined || value === null || value === '') {
    return {ok: true};
  }

  return typeof value === 'string'
    ? {ok: true, value}
    : {ok: false, message: 'MCP server cwd 必须是字符串'};
}

function readOptionalStringArray(value: unknown): {ok: true; value?: string[]} | {ok: false; message: string} {
  if (value === undefined || value === null || value === '') {
    return {ok: true};
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return {ok: false, message: 'MCP server args 必须是字符串数组'};
  }

  return {ok: true, value};
}

function readOptionalStringRecord(value: unknown): {ok: true; value?: Record<string, string>} | {ok: false; message: string} {
  if (value === undefined || value === null || value === '') {
    return {ok: true};
  }

  if (!isPlainObject(value)) {
    return {ok: false, message: 'MCP server headers/env 必须是对象'};
  }

  const record: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      return {ok: false, message: `MCP server ${key} 必须是字符串`};
    }

    record[key] = entry;
  }

  return Object.keys(record).length > 0 ? {ok: true, value: record} : {ok: true};
}

export {
  DEFAULT_MCP_TIMEOUT_MS,
  applyMcpConfigEditDraft,
  createMcpConfigEditDraft,
  createMcpConfig,
  createMcpConfigDraft,
  parseMcpConfigModel,
  validateMcpConfigEditDraft
};
