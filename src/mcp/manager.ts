import {redactSensitiveText} from '../agent/agent-errors';
import {createSdkMcpClient} from './client';

import type {CreateMcpClient, EchoMcpClient, McpCallToolResult, McpListedTool} from './client';
import type {McpApprovalMode, McpBootstrapDiagnostic, McpConfig, McpServerConfig, McpToolReference} from '../types/mcp';

type InitializedMcpServer = {
  config: McpServerConfig;
  client: EchoMcpClient;
  tools: McpListedTool[];
};

type McpManagerDependencies = {
  loadConfig: () => McpConfig;
  createClient?: CreateMcpClient;
};

class McpManager {
  private readonly loadConfig: () => McpConfig;
  private readonly createClient: CreateMcpClient;
  private servers: Map<string, InitializedMcpServer>;
  private namespacedToolNames: Set<string>;
  private diagnostics: McpBootstrapDiagnostic[];
  private bootstrapped: boolean;

  constructor(dependencies: McpManagerDependencies) {
    if (!dependencies?.loadConfig) {
      throw new Error('McpManager 必须注入配置加载器');
    }
    this.loadConfig = dependencies.loadConfig;
    this.createClient = dependencies.createClient || createSdkMcpClient;
    this.servers = new Map();
    this.namespacedToolNames = new Set();
    this.diagnostics = [];
    this.bootstrapped = false;
  }

  /**
   * 启动期统一初始化 MCP servers；单个 server 失败只记录诊断，不影响其他 server。
   */
  async bootstrap(): Promise<void> {
    if (this.bootstrapped) {
      return;
    }

    this.bootstrapped = true;
    const config = this.loadConfig();
    this.diagnostics = [...config.diagnostics];

    if (!config.enabled) {
      return;
    }

    for (const server of config.servers) {
      await this.bootstrapServer(server);
    }
  }

  /**
   * 按最新配置重载 MCP servers；第一版采用全量关闭再 bootstrap，保证 tool 集合与配置一致。
   */
  async reload(): Promise<void> {
    await this.close();
    this.diagnostics = [];
    this.bootstrapped = false;
    await this.bootstrap();
  }

  private async bootstrapServer(server: McpServerConfig): Promise<void> {
    let client: EchoMcpClient | undefined;

    try {
      client = await this.createClient(server);
      const tools = await client.listTools();
      const uniqueTools = tools.filter((tool) => {
        const namespacedName = createMcpToolName(server.name, tool.name);

        if (this.namespacedToolNames.has(namespacedName)) {
          this.diagnostics.push({serverName: server.name, message: `MCP tool name conflict: ${namespacedName}`});
          return false;
        }

        this.namespacedToolNames.add(namespacedName);
        return true;
      });

      this.servers.set(server.name, {config: server, client, tools: uniqueTools});
      client = undefined;
    } catch (error: unknown) {
      if (client) {
        await client.close().catch(() => undefined);
      }

      this.diagnostics.push({serverName: server.name, message: sanitizeMcpError(error)});
    }
  }

  listTools(): Array<McpToolReference & {description?: string; inputSchema: Record<string, unknown>}> {
    return Array.from(this.servers.values()).flatMap((server) => server.tools.map((tool) => ({
      serverName: server.config.name,
      toolName: tool.name,
      namespacedName: createMcpToolName(server.config.name, tool.name),
      approval: server.config.approval,
      description: tool.description,
      inputSchema: tool.inputSchema
    })));
  }

  getToolReference(namespacedName: string): McpToolReference | null {
    return this.listTools().find((tool) => tool.namespacedName === namespacedName) || null;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    const server = this.servers.get(serverName);

    if (!server) {
      throw new Error(`MCP server unavailable: ${serverName}`);
    }

    return server.client.callTool(toolName, args);
  }

  getDiagnostics(): McpBootstrapDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({...diagnostic}));
  }

  async close(): Promise<void> {
    const servers = Array.from(this.servers.values());
    this.servers.clear();
    this.namespacedToolNames.clear();
    await Promise.allSettled(servers.map((server) => server.client.close()));
  }
}

function createMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${normalizeToolNamePart(serverName)}__${normalizeToolNamePart(toolName)}`;
}

function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__') && toolName.split('__').length >= 3;
}

function normalizeToolNamePart(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'unnamed';
}

function sanitizeMcpError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message);
}

function getMcpToolApproval(manager: McpManager | undefined, toolName: string): McpApprovalMode | undefined {
  return manager?.getToolReference(toolName)?.approval;
}

export {
  McpManager,
  createMcpToolName,
  getMcpToolApproval,
  isMcpToolName,
  redactSensitiveText,
  sanitizeMcpError
};

export type {
  McpManagerDependencies
};
