import {sanitizeMcpError} from '../mcp/manager';
import {capUtf8Text} from './tool-handler-utils';
import {createOffloadedTextPreview} from './tool-result-offloading';

import type {McpManager} from '../mcp/manager';
import type {McpResourceReference, McpResourceTemplateReference} from '../types/mcp';
import type {ToolCall, ToolExecutionResult, ToolHandler} from '../types/tool';
import type {McpResourceReadResult} from '../mcp/client';
import type {ToolResultStore} from './tool-result-offloading';

const LIST_MCP_RESOURCES_TOOL_NAME = 'list_mcp_resources';
const READ_MCP_RESOURCE_TOOL_NAME = 'read_mcp_resource';
const MCP_RESOURCE_TOOL_NAMES: ReadonlySet<string> = new Set([LIST_MCP_RESOURCES_TOOL_NAME, READ_MCP_RESOURCE_TOOL_NAME]);
const MAX_MCP_RESOURCE_RESULT_BYTES = 20_000;
const LIST_TRUNCATION_MESSAGE = '[MCP resource catalog truncated. Filter by server name to narrow the listing.]';
const READ_TRUNCATION_MESSAGE = '[MCP resource result truncated. Read a narrower resource or split it into smaller requests.]';

type McpResourceToolHandlersOptions = {
  manager: McpManager;
  toolResultStore?: ToolResultStore;
};

/**
 * 创建 MCP 资源读取工具；资源与工具分属不同能力，这里只暴露目录查询与按 uri 读取。
 * 两个工具都是只读观察工具:风险分类直接判安全,不进入审批。
 */
function createMcpResourceToolHandlers(options: McpResourceToolHandlersOptions): ToolHandler[] {
  const {manager, toolResultStore} = options;

  return [
    {
      definition: {
        name: LIST_MCP_RESOURCES_TOOL_NAME,
        description: 'List MCP resources exposed by the configured servers, including resource templates. Use read_mcp_resource to read a specific uri. Optionally filter by server name.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            server: {
              type: 'string',
              description: 'Optional MCP server name filter. Omit to list resources from every server.'
            }
          }
        }
      },
      execute(args: Record<string, unknown>, call: ToolCall): ToolExecutionResult {
        const serverFilter = readOptionalString(args.server);
        const resources = manager.listResources().filter((resource) => serverFilter === undefined || resource.serverName === serverFilter);
        const templates = manager.listResourceTemplates().filter((template) => serverFilter === undefined || template.serverName === serverFilter);

        if (serverFilter !== undefined && resources.length === 0 && templates.length === 0) {
          return createTextResult(call, formatUnknownServerMessage(manager, serverFilter), toolResultStore, LIST_TRUNCATION_MESSAGE);
        }

        return createTextResult(call, formatResourceCatalog(resources, templates), toolResultStore, LIST_TRUNCATION_MESSAGE);
      }
    },
    {
      definition: {
        name: READ_MCP_RESOURCE_TOOL_NAME,
        description: 'Read one MCP resource by server name and uri. Also use it to resolve resource_link uris returned by MCP tools. Binary contents are reported as a placeholder with mime type and size only.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['server', 'uri'],
          properties: {
            server: {
              type: 'string',
              description: 'MCP server name that exposes the resource.'
            },
            uri: {
              type: 'string',
              description: 'Resource uri exactly as returned by list_mcp_resources or an MCP tool result.'
            }
          }
        }
      },
      async execute(args: Record<string, unknown>, call: ToolCall): Promise<ToolExecutionResult> {
        const serverName = readRequiredString(args.server);
        const uri = readRequiredString(args.uri);

        if (serverName === undefined || uri === undefined) {
          return {
            callId: call.callId,
            toolName: call.toolName,
            ok: false,
            details: {kind: 'generic'},
            text: 'read_mcp_resource requires non-empty string parameters: server and uri.'
          };
        }

        try {
          const result = await manager.readResource(serverName, uri);
          return createTextResult(call, formatResourceContents(serverName, uri, result), toolResultStore, READ_TRUNCATION_MESSAGE);
        } catch (error: unknown) {
          return createFailedResult(call, `MCP resource read failed: ${sanitizeMcpError(error)}`);
        }
      }
    }
  ];
}

/** 统一走 tool-result offloading:超限时保留 head 预览并落盘完整内容。 */
function createTextResult(call: ToolCall, text: string, toolResultStore: ToolResultStore | undefined, truncationMessage: string): ToolExecutionResult {
  const preview = createOffloadedTextPreview({
    maxPreviewBytes: MAX_MCP_RESOURCE_RESULT_BYTES,
    strategy: 'head',
    store: toolResultStore,
    text,
    truncationMessage
  });

  return {
    callId: call.callId,
    toolName: call.toolName,
    ok: true,
    details: {kind: 'generic'},
    text: preview.text
  };
}

function createFailedResult(call: ToolCall, text: string): ToolExecutionResult {
  return {
    callId: call.callId,
    toolName: call.toolName,
    ok: false,
    details: {kind: 'generic'},
    text: capUtf8Text(text, MAX_MCP_RESOURCE_RESULT_BYTES).text
  };
}

function formatUnknownServerMessage(manager: McpManager, serverFilter: string): string {
  const knownServers = manager.listServerNames();
  const suffix = knownServers.length > 0
    ? ` Known servers: ${knownServers.join(', ')}.`
    : ' No MCP server is currently initialized.';

  return `(no MCP resources found for server "${serverFilter}".${suffix})`;
}

function formatResourceCatalog(resources: McpResourceReference[], templates: McpResourceTemplateReference[]): string {
  if (resources.length === 0 && templates.length === 0) {
    return '(no MCP resources available; the configured servers advertise no resources capability or expose an empty catalog)';
  }

  const lines: string[] = [];

  for (const resource of resources) {
    lines.push(`- [${resource.serverName}] ${resource.uri}${formatResourceSuffix(resource)}`);
  }

  if (templates.length > 0) {
    lines.push('');
    lines.push('Resource templates (construct a concrete uri from the template, then read it):');

    for (const template of templates) {
      lines.push(`- [${template.serverName}] ${template.uriTemplate}${formatTemplateSuffix(template)}`);
    }
  }

  return lines.join('\n');
}

function formatResourceSuffix(resource: McpResourceReference): string {
  const details = [
    `name: ${resource.name}`,
    ...(resource.title ? [`title: ${resource.title}`] : []),
    ...(resource.mimeType ? [`mime: ${resource.mimeType}`] : [])
  ];
  const description = resource.description ? `\n  ${resource.description}` : '';

  return ` (${details.join(', ')})${description}`;
}

function formatTemplateSuffix(template: McpResourceTemplateReference): string {
  const details = [
    `name: ${template.name}`,
    ...(template.title ? [`title: ${template.title}`] : []),
    ...(template.mimeType ? [`mime: ${template.mimeType}`] : [])
  ];
  const description = template.description ? `\n  ${template.description}` : '';

  return ` (${details.join(', ')})${description}`;
}

function formatResourceContents(serverName: string, uri: string, result: McpResourceReadResult): string {
  const parts = result.contents.map((content) => content.text !== undefined
    ? content.text
    : `[Binary resource content ${content.mimeType || 'application/octet-stream'}, ${content.blobBytes ?? 0} bytes]`);
  const body = parts.filter((part) => part.trim() !== '').join('\n\n');

  return body === ''
    ? `Resource: ${uri} (server: ${serverName})\n\n(no content returned)`
    : `Resource: ${uri} (server: ${serverName})\n\n${body}`;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readRequiredString(value: unknown): string | undefined {
  return readOptionalString(value);
}

export {
  LIST_MCP_RESOURCES_TOOL_NAME,
  MAX_MCP_RESOURCE_RESULT_BYTES,
  MCP_RESOURCE_TOOL_NAMES,
  READ_MCP_RESOURCE_TOOL_NAME,
  createMcpResourceToolHandlers
};

export type {
  McpResourceToolHandlersOptions
};
