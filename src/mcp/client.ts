import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {PromptListChangedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';

import type {McpPromptArgument, McpPromptContentBlock, McpPromptMessage, McpPromptResult, McpServerConfig} from '../types/mcp';

const MAX_MCP_LIST_PAGES = 10;

type McpListedTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
};

type McpListedResource = {
  uri: string; // server 暴露的稳定资源标识，读取时原样回传。
  name: string; // server 指定的资源名称。
  title?: string; // 可选展示标题。
  description?: string; // 可选人类可读描述。
  mimeType?: string; // 可选内容类型。
};

type McpListedResourceTemplate = {
  uriTemplate: string; // RFC 6570 模板，供模型构造具体 uri。
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

type McpResourceContent = {
  uri: string; // 内容项对应的资源 uri。
  mimeType?: string; // 可选内容类型。
  text?: string; // 文本内容；与 blobBytes 互斥。
  blobBytes?: number; // 二进制内容字节数；只保留大小,不保留 payload。
};

type McpResourceReadResult = {
  contents: McpResourceContent[]; // 按 server 返回顺序排列的内容项。
};

type McpListedPrompt = {
  name: string; // server 侧 prompt 名称。
  description?: string; // 可选说明。
  arguments: McpPromptArgument[]; // 按声明顺序排列的参数。
};

type McpCallToolResult = {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  toolResult?: unknown;
};

type EchoMcpClient = {
  supportsResources: () => boolean;
  supportsPrompts: () => boolean;
  listTools: () => Promise<McpListedTool[]>;
  listResources: (limit: number) => Promise<McpListedResource[]>;
  listResourceTemplates: (limit: number) => Promise<McpListedResourceTemplate[]>;
  readResource: (uri: string) => Promise<McpResourceReadResult>;
  listPrompts: (limit: number) => Promise<McpListedPrompt[]>;
  getPrompt: (promptName: string, args: Record<string, string>) => Promise<McpPromptResult>;
  setPromptsListChangedHandler: (handler: () => void) => void;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<McpCallToolResult>;
  close: () => Promise<void>;
};

type CreateMcpClient = (server: McpServerConfig) => Promise<EchoMcpClient>;

/** 只按 base64 长度推算原始字节数,避免为二进制占位符解码整个 payload。 */
function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

/**
 * 把 prompt message 的内容块窄投影到领域类型；未知类型保留为显式文本占位符,避免静默丢弃。
 */
function projectPromptContent(content: unknown): McpPromptContentBlock {
  const block = (content || {}) as {
    type?: unknown;
    text?: unknown;
    data?: unknown;
    mimeType?: unknown;
    uri?: unknown;
    name?: unknown;
    resource?: {uri?: unknown; mimeType?: unknown; text?: unknown};
  };

  switch (block.type) {
    case 'text':
      return {kind: 'text', text: typeof block.text === 'string' ? block.text : ''};
    case 'image':
    case 'audio':
      return {
        kind: block.type,
        mimeType: typeof block.mimeType === 'string' ? block.mimeType : 'application/octet-stream',
        sizeBytes: typeof block.data === 'string' ? base64ByteLength(block.data) : 0
      };
    case 'resource': {
      const resource = block.resource || {};

      return {
        kind: 'resource',
        uri: typeof resource.uri === 'string' ? resource.uri : '',
        ...(typeof resource.mimeType === 'string' ? {mimeType: resource.mimeType} : {}),
        ...(typeof resource.text === 'string' ? {text: resource.text} : {})
      };
    }
    case 'resource_link':
      return {
        kind: 'resource_link',
        uri: typeof block.uri === 'string' ? block.uri : '',
        ...(typeof block.name === 'string' ? {name: block.name} : {})
      };
    default:
      return {kind: 'text', text: `[unsupported content block: ${String(block.type || 'unknown')}]`};
  }
}

async function createSdkMcpClient(server: McpServerConfig): Promise<EchoMcpClient> {
  const client = new Client({name: 'echo_tui', version: '0.1.0'});
  const transport = server.transport === 'stdio'
    ? new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
      stderr: 'ignore'
    })
    : new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: server.headers ? {headers: server.headers} : undefined
    });

  try {
    await client.connect(transport, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs});
  } catch (error: unknown) {
    await client.close().catch(() => undefined);
    throw error;
  }

  return {
    supportsResources() {
      return client.getServerCapabilities()?.resources !== undefined;
    },
    supportsPrompts() {
      return client.getServerCapabilities()?.prompts !== undefined;
    },
    async listTools() {
      const result = await client.listTools(undefined, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs});
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        // annotations 是 server 提供的 hint；这里只归一出后续放行策略需要的只读布尔值，缺失按 false 处理。
        readOnly: tool.annotations?.readOnlyHint === true
      }));
    },
    // 分页上限与条目上限双重约束:server 持续返回游标时也不无限拉取。
    async listResources(limit) {
      const resources: McpListedResource[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < MAX_MCP_LIST_PAGES && resources.length < limit; page += 1) {
        const result = await client.listResources(cursor ? {cursor} : undefined, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs});

        for (const resource of result.resources) {
          resources.push({
            uri: resource.uri,
            name: resource.name,
            ...(resource.title ? {title: resource.title} : {}),
            ...(resource.description ? {description: resource.description} : {}),
            ...(resource.mimeType ? {mimeType: resource.mimeType} : {})
          });
        }

        cursor = result.nextCursor;
        if (!cursor) {
          break;
        }
      }

      return resources.slice(0, limit);
    },
    async listResourceTemplates(limit) {
      const templates: McpListedResourceTemplate[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < MAX_MCP_LIST_PAGES && templates.length < limit; page += 1) {
        const result = await client.listResourceTemplates(cursor ? {cursor} : undefined, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs});

        for (const template of result.resourceTemplates) {
          templates.push({
            uriTemplate: template.uriTemplate,
            name: template.name,
            ...(template.title ? {title: template.title} : {}),
            ...(template.description ? {description: template.description} : {}),
            ...(template.mimeType ? {mimeType: template.mimeType} : {})
          });
        }

        cursor = result.nextCursor;
        if (!cursor) {
          break;
        }
      }

      return templates.slice(0, limit);
    },
    async readResource(uri) {
      const result = await client.readResource({uri}, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs});

      return {
        contents: result.contents.map((content): McpResourceContent => {
          const base: McpResourceContent = {
            uri: content.uri,
            ...(content.mimeType ? {mimeType: content.mimeType} : {})
          };

          return 'text' in content
            ? {...base, text: content.text}
            : {...base, blobBytes: base64ByteLength(content.blob)};
        })
      };
    },
    async listPrompts(limit) {
      const prompts: McpListedPrompt[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < MAX_MCP_LIST_PAGES && prompts.length < limit; page += 1) {
        const result = await client.listPrompts(cursor ? {cursor} : undefined, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs});

        for (const prompt of result.prompts) {
          prompts.push({
            name: prompt.name,
            ...(prompt.description ? {description: prompt.description} : {}),
            arguments: (prompt.arguments || []).map((argument) => ({
              name: argument.name,
              ...(argument.description ? {description: argument.description} : {}),
              required: argument.required === true
            }))
          });
        }

        cursor = result.nextCursor;
        if (!cursor) {
          break;
        }
      }

      return prompts.slice(0, limit);
    },
    async getPrompt(promptName, args) {
      const result = await client.getPrompt({name: promptName, arguments: args}, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs});

      return {
        ...(result.description ? {description: result.description} : {}),
        messages: result.messages.map((message): McpPromptMessage => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: projectPromptContent(message.content)
        }))
      };
    },
    setPromptsListChangedHandler(handler) {
      client.setNotificationHandler(PromptListChangedNotificationSchema, () => handler());
    },
    callTool(toolName, args) {
      return client.callTool({name: toolName, arguments: args}, undefined, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs}) as Promise<McpCallToolResult>;
    },
    close() {
      return client.close();
    }
  };
}

export {
  createSdkMcpClient
};

export type {
  CreateMcpClient,
  EchoMcpClient,
  McpCallToolResult,
  McpListedPrompt,
  McpListedResource,
  McpListedResourceTemplate,
  McpListedTool,
  McpResourceContent,
  McpResourceReadResult
};
