import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type {McpServerConfig} from '../types/mcp';

type McpListedTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type McpCallToolResult = {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  toolResult?: unknown;
};

type EchoMcpClient = {
  listTools: () => Promise<McpListedTool[]>;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<McpCallToolResult>;
  close: () => Promise<void>;
};

type CreateMcpClient = (server: McpServerConfig) => Promise<EchoMcpClient>;

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
    async listTools() {
      const result = await client.listTools(undefined, {timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs});
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));
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
  McpListedTool
};
