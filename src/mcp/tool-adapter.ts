import {createToolRegistry} from '../tools/tool-registry';
import {sanitizeMcpError} from './manager';

import type {McpCallToolResult} from './client';
import type {McpManager} from './manager';
import type {ToolExecutionResult, ToolHandler, ToolRegistry} from '../types/tool';

const MAX_MCP_TOOL_RESULT_CHARS = 20_000;

function createMcpToolRegistry(manager: McpManager): ToolRegistry {
  return createToolRegistry(manager.listTools().map((tool): ToolHandler => ({
    definition: {
      name: tool.namespacedName,
      description: tool.description || `MCP tool ${tool.toolName} from server ${tool.serverName}`,
      parameters: tool.inputSchema
    },
    async execute(args, call) {
      try {
        const result = await manager.callTool(tool.serverName, tool.toolName, args);
        return createMcpToolExecutionResult(call.callId, call.toolName, result);
      } catch (error: unknown) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          text: `MCP tool failed: ${sanitizeMcpError(error)}`
        };
      }
    }
  })));
}

function mergeToolRegistries(primary: ToolRegistry, secondary: ToolRegistry): ToolRegistry {
  const handlers = [
    ...primary.listDefinitions().map((definition) => primary.getHandler(definition.name)).filter((handler): handler is ToolHandler => Boolean(handler)),
    ...secondary.listDefinitions().map((definition) => secondary.getHandler(definition.name)).filter((handler): handler is ToolHandler => Boolean(handler))
  ];
  const registry = createToolRegistry(handlers);

  return {
    ...registry,
    listSkillCatalog: primary.listSkillCatalog
  };
}

function createMcpToolExecutionResult(callId: string, toolName: string, result: McpCallToolResult): ToolExecutionResult {
  return {
    callId,
    toolName,
    ok: !result.isError,
    text: formatMcpToolResult(result)
  };
}

function formatMcpToolResult(result: McpCallToolResult): string {
  if ('toolResult' in result) {
    return truncateMcpToolResult(stringifyMcpValue(result.toolResult));
  }

  const parts = Array.isArray(result.content) ? result.content.map(formatMcpContentBlock) : [];

  if (result.structuredContent) {
    parts.push(stringifyMcpValue(result.structuredContent));
  }

  return truncateMcpToolResult(parts.filter((part) => part.trim() !== '').join('\n\n') || '(MCP tool returned no content)');
}

function formatMcpContentBlock(block: unknown): string {
  if (!block || typeof block !== 'object') {
    return stringifyMcpValue(block);
  }

  const typedBlock = block as {type?: unknown; text?: unknown; mimeType?: unknown; uri?: unknown; name?: unknown};

  if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
    return typedBlock.text;
  }

  if (typedBlock.type === 'resource' && typeof typedBlock.text === 'string') {
    return typedBlock.text;
  }

  if (typedBlock.type === 'resource_link') {
    return `[resource_link] ${String(typedBlock.name || typedBlock.uri || '')}`.trim();
  }

  return `[${String(typedBlock.type || 'content')}] ${stringifyMcpValue(block)}`;
}

function stringifyMcpValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateMcpToolResult(text: string): string {
  if (text.length <= MAX_MCP_TOOL_RESULT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_MCP_TOOL_RESULT_CHARS)}\n\n[MCP tool result truncated: ${text.length - MAX_MCP_TOOL_RESULT_CHARS} characters omitted]`;
}

export {
  MAX_MCP_TOOL_RESULT_CHARS,
  createMcpToolExecutionResult,
  createMcpToolRegistry,
  formatMcpToolResult,
  mergeToolRegistries
};
