import {redactSensitiveText} from '../agent/agent-errors';
import {capUtf8Text} from '../tools/tool-handler-utils';
import {createSdkMcpClient} from './client';

import type {CreateMcpClient, EchoMcpClient, McpCallToolResult, McpListedResource, McpListedResourceTemplate, McpListedTool, McpResourceReadResult} from './client';
import type {McpBootstrapDiagnostic, McpConfig, McpResourceReference, McpResourceTemplateReference, McpServerConfig, McpToolReference} from '../types/mcp';

const MAX_MCP_RESOURCES_PER_SERVER = 100;
const MAX_MCP_RESOURCE_TEMPLATES_PER_SERVER = 50;
const MAX_MCP_RESOURCE_TEXT_BYTES = 512;

type InitializedMcpServer = {
  config: McpServerConfig;
  client: EchoMcpClient;
  tools: McpListedTool[];
  resources: McpListedResource[]; // bootstrap 时物化的有界资源目录。
  resourceTemplates: McpListedResourceTemplate[]; // bootstrap 时物化的有界模板目录。
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
      const {resources, resourceTemplates} = await this.listServerResources(server.name, client);
      const uniqueTools = tools.filter((tool) => {
        const namespacedName = createMcpToolName(server.name, tool.name);

        if (this.namespacedToolNames.has(namespacedName)) {
          this.diagnostics.push({serverName: server.name, message: `MCP tool name conflict: ${namespacedName}`});
          return false;
        }

        this.namespacedToolNames.add(namespacedName);
        return true;
      });

      this.servers.set(server.name, {config: server, client, tools: uniqueTools, resources, resourceTemplates});
      client = undefined;
    } catch (error: unknown) {
      if (client) {
        await client.close().catch(() => undefined);
      }

      this.diagnostics.push({serverName: server.name, message: sanitizeMcpError(error)});
    }
  }

  /**
   * 按 server 声明的 resources capability 拉取资源与模板目录；未声明时不做任何调用。
   * 两个可选子能力分别容错:其一失败只降级为空目录并记录脱敏诊断,不丢弃另一个,也不影响工具能力。
   */
  private async listServerResources(serverName: string, client: EchoMcpClient): Promise<{resources: McpListedResource[]; resourceTemplates: McpListedResourceTemplate[]}> {
    if (!client.supportsResources()) {
      return {resources: [], resourceTemplates: []};
    }

    let resources: McpListedResource[] = [];
    let resourceTemplates: McpListedResourceTemplate[] = [];

    try {
      resources = (await client.listResources(MAX_MCP_RESOURCES_PER_SERVER)).map(capListedResource);
    } catch (error: unknown) {
      this.diagnostics.push({serverName, message: sanitizeMcpError(error)});
    }

    try {
      resourceTemplates = (await client.listResourceTemplates(MAX_MCP_RESOURCE_TEMPLATES_PER_SERVER)).map(capListedResourceTemplate);
    } catch (error: unknown) {
      this.diagnostics.push({serverName, message: sanitizeMcpError(error)});
    }

    return {resources, resourceTemplates};
  }

  listTools(): Array<McpToolReference & {description?: string; inputSchema: Record<string, unknown>}> {
    return Array.from(this.servers.values()).flatMap((server) => server.tools.map((tool) => ({
      serverName: server.config.name,
      toolName: tool.name,
      namespacedName: createMcpToolName(server.config.name, tool.name),
      readOnly: tool.readOnly === true,
      description: tool.description,
      inputSchema: tool.inputSchema
    })));
  }

  getToolReference(namespacedName: string): McpToolReference | null {
    return this.listTools().find((tool) => tool.namespacedName === namespacedName) || null;
  }

  /** 返回当前缓存的资源目录；按 server 名为资源补齐定位信息。 */
  listResources(): McpResourceReference[] {
    return Array.from(this.servers.values()).flatMap((server) => server.resources.map((resource) => ({
      serverName: server.config.name,
      ...resource
    })));
  }

  /** 返回当前已初始化 server 的稳定名称列表，供工具参数提示与错误信息使用。 */
  listServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  /** 返回当前缓存的 resource templates；模板只描述 uri 形态，不保证可直接读取。 */
  listResourceTemplates(): McpResourceTemplateReference[] {
    return Array.from(this.servers.values()).flatMap((server) => server.resourceTemplates.map((template) => ({
      serverName: server.config.name,
      ...template
    })));
  }

  async readResource(serverName: string, uri: string): Promise<McpResourceReadResult> {
    const server = this.servers.get(serverName);

    if (!server) {
      throw new Error(`MCP server unavailable: ${serverName}`);
    }

    return server.client.readResource(uri);
  }

  /**
   * 物化当前工具目录的只读工具名称集合；普通审批判定与只读运行准入共用这份 run 启动事实。
   */
  listReadonlyToolNames(): ReadonlySet<string> {
    return new Set(this.listTools().filter((tool) => tool.readOnly).map((tool) => tool.namespacedName));
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

/** 资源名称、标题与描述只保留有界文本,避免 server 用超长字段撑爆工具输出。 */
function capListedText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : capUtf8Text(value, MAX_MCP_RESOURCE_TEXT_BYTES).text;
}

function capListedResource(resource: McpListedResource): McpListedResource {
  return {
    uri: resource.uri,
    name: capListedText(resource.name) || resource.name,
    ...(resource.title ? {title: capListedText(resource.title)} : {}),
    ...(resource.description ? {description: capListedText(resource.description)} : {}),
    ...(resource.mimeType ? {mimeType: resource.mimeType} : {})
  };
}

function capListedResourceTemplate(template: McpListedResourceTemplate): McpListedResourceTemplate {
  return {
    uriTemplate: template.uriTemplate,
    name: capListedText(template.name) || template.name,
    ...(template.title ? {title: capListedText(template.title)} : {}),
    ...(template.description ? {description: capListedText(template.description)} : {}),
    ...(template.mimeType ? {mimeType: template.mimeType} : {})
  };
}

export {
  McpManager,
  createMcpToolName,
  isMcpToolName,
  redactSensitiveText,
  sanitizeMcpError
};

export type {
  McpManagerDependencies
};
