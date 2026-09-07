import {createToolRegistry} from '../tools/tool-registry';
import {createOffloadedTextPreview} from '../tools/tool-result-offloading';
import {capUtf8Text} from '../tools/tool-handler-utils';
import {sanitizeMcpError} from './manager';

import type {McpCallToolResult} from './client';
import type {McpManager} from './manager';
import type {ToolExecutionResult, ToolHandler, ToolRegistry} from '../types/tool';
import type {ToolResultStore} from '../tools/tool-result-offloading';

const MAX_MCP_TOOL_RESULT_BYTES = 20_000;

function createMcpToolRegistry(manager: McpManager, toolResultStore?: ToolResultStore): ToolRegistry {
  return createToolRegistry(manager.listTools().map((tool): ToolHandler => ({
    definition: {
      name: tool.namespacedName,
      description: tool.description || `MCP tool ${tool.toolName} from server ${tool.serverName}`,
      parameters: tool.inputSchema
    },
    async execute(args, call) {
      try {
        const result = await manager.callTool(tool.serverName, tool.toolName, args);
        return createMcpToolExecutionResult(call.callId, call.toolName, result, toolResultStore);
      } catch (error: unknown) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          details: {kind: 'generic'},
          text: capUtf8Text(`MCP tool failed: ${sanitizeMcpError(error)}`, MAX_MCP_TOOL_RESULT_BYTES).text
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

function createMcpToolExecutionResult(callId: string, toolName: string, result: McpCallToolResult, toolResultStore?: ToolResultStore): ToolExecutionResult {
  return {
    callId,
    toolName,
    ok: !result.isError,
    details: {kind: 'generic'},
    text: formatMcpToolResult(result, toolResultStore)
  };
}

function formatMcpToolResult(result: McpCallToolResult, toolResultStore?: ToolResultStore): string {
  if ('toolResult' in result) {
    return truncateMcpToolResult(stringifyMcpValue(result.toolResult), toolResultStore);
  }

  const parts = Array.isArray(result.content) ? result.content.map(formatMcpContentBlock) : [];

  if (result.structuredContent) {
    parts.push(stringifyMcpValue(result.structuredContent));
  }

  return truncateMcpToolResult(parts.filter((part) => part.trim() !== '').join('\n\n') || '(MCP tool returned no content)', toolResultStore);
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

function truncateMcpToolResult(text: string, toolResultStore?: ToolResultStore): string {
  const preview = createOffloadedTextPreview({
    maxPreviewBytes: MAX_MCP_TOOL_RESULT_BYTES,
    strategy: 'head',
    store: toolResultStore,
    text,
    truncationMessage: '[MCP tool result truncated. Narrow the request or split it into smaller calls.]'
  });

  return preview.text;
}

export {
  MAX_MCP_TOOL_RESULT_BYTES,
  createMcpToolExecutionResult,
  createMcpToolRegistry,
  formatMcpToolResult,
  mergeToolRegistries
};
