import type {McpApprovalMode, McpConfig, McpConfigDiagnostic, McpConfigDraft, McpEnabledStateDraft, McpServerConfig, McpServerConfigDraft} from '../types/mcp';
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

/** 只更新 MCP 全局与现有 server 开关，不改写 transport、凭据或诊断字段。 */
function applyMcpEnabledStateDraft(rootConfig: ConfigSource, draft: McpEnabledStateDraft): void {
  const mcp = isPlainObject(rootConfig.mcp) ? {...rootConfig.mcp} : {};
  const servers = isPlainObject(mcp.servers) ? {...mcp.servers} : {};

  mcp.enabled = Boolean(draft.enabled);

  for (const serverState of draft.servers) {
    if (typeof serverState.name !== 'string' || serverState.name.trim() === '') {
      continue;
    }

    const currentServer = servers[serverState.name];

    if (isPlainObject(currentServer)) {
      servers[serverState.name] = {...currentServer, enabled: Boolean(serverState.enabled)};
    }
  }

  mcp.servers = servers;
  rootConfig.mcp = mcp;
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
  const approval = readApproval(rawServer.approval);

  if (!approval.ok) {
    return {ok: false, message: approval.message};
  }

  const timeoutMs = readOptionalIntegerInRange(rawServer.timeoutMs, DEFAULT_MCP_TIMEOUT_MS);
  const common = {name: serverName, enabled, timeoutMs, approval: approval.value};

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

function readApproval(value: unknown): {ok: true; value: McpApprovalMode} | {ok: false; message: string} {
  if (value === undefined || value === null || value === '') {
    return {ok: true, value: 'always'};
  }

  return value === 'always' || value === 'never'
    ? {ok: true, value}
    : {ok: false, message: 'MCP server approval 必须是 always 或 never'};
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
  applyMcpEnabledStateDraft,
  createMcpConfig,
  createMcpConfigDraft,
  parseMcpConfigModel
};
