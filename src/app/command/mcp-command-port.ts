import {sanitizeMcpError} from '../../mcp/manager';
import {createMcpPromptCommandName} from '../../mcp/prompt-command-name';
import {validateMcpConfigEditDraft} from '../../config/mcp-config';

import type {UserConfigContext} from '../../config/user-config-context';
import type {McpManager} from '../../mcp/manager';
import type {CommandHostApp, CommandMcpInventoryItem, CommandMcpServerFacts, CommandMcpServerInfo, McpInventorySection} from '../../types/command';
import type {McpConfigEditDraft, McpPromptArgument} from '../../types/mcp';
import type {AppContext} from '../state/app-context';

type McpCommandContext = Pick<AppContext, 'clearContextUsage' | 'setMcpBootstrapStatus' | 'turnContext'>;

type McpCommandPortOptions = {
  appContext: McpCommandContext;
  mcpManager: McpManager;
  render: () => void;
  userConfigContext: UserConfigContext;
};

/**
 * 创建 MCP 状态查询和配置重载端口，并协调重载期间的 footer 状态。
 */
function createMcpCommandPort(options: McpCommandPortOptions): CommandHostApp['mcp'] {
  const {appContext, mcpManager, render} = options;
  const userConfigContext = options.userConfigContext;

  /** 运行事实只读 manager 的 bootstrap 缓存与配置草稿，不触发新的连接或调用。 */
  function readFacts(serverName: string): CommandMcpServerFacts {
    const tools = mcpManager.listTools().filter((tool) => tool.serverName === serverName);
    const resources = mcpManager.listResources().filter((resource) => resource.serverName === serverName);
    const templates = mcpManager.listResourceTemplates().filter((template) => template.serverName === serverName);
    const prompts = mcpManager.listPrompts().filter((prompt) => prompt.serverName === serverName);
    const capabilities = mcpManager.getServerCapabilities(serverName);
    const configDraft = userConfigContext.capture().getMcpConfigDraft();
    const configDiagnostic = configDraft.servers
      .filter((server) => server.name === serverName && !server.valid)
      .map((server) => server.diagnostic || server.summary);

    return {
      initialized: capabilities !== null,
      capabilities: capabilities || {tools: false, resources: false, prompts: false},
      toolCount: tools.length,
      readOnlyToolCount: tools.filter((tool) => tool.readOnly).length,
      resourceCount: resources.length,
      resourceTemplateCount: templates.length,
      promptCount: prompts.length,
      diagnostics: [
        ...configDiagnostic,
        ...mcpManager.getDiagnostics().filter((diagnostic) => diagnostic.serverName === serverName).map((diagnostic) => diagnostic.message)
      ]
    };
  }

  return {
    listServers() {
      const draft = userConfigContext.capture().getMcpConfigDraft();
      const countsByServer = new Map<string, {tools: number; resources: number; prompts: number}>();
      const diagnosticsByServer = new Map<string, string>();

      if (draft.servers.length === 0) {
        return [];
      }

      const bump = (serverName: string, key: 'tools' | 'resources' | 'prompts'): void => {
        const current = countsByServer.get(serverName) || {tools: 0, resources: 0, prompts: 0};
        current[key] += 1;
        countsByServer.set(serverName, current);
      };

      for (const tool of mcpManager.listTools()) {
        bump(tool.serverName, 'tools');
      }

      for (const resource of mcpManager.listResources()) {
        bump(resource.serverName, 'resources');
      }

      for (const prompt of mcpManager.listPrompts()) {
        bump(prompt.serverName, 'prompts');
      }

      for (const diagnostic of mcpManager.getDiagnostics()) {
        diagnosticsByServer.set(diagnostic.serverName, diagnostic.message);
      }

      return [
        {
          kind: 'global' as const,
          name: 'MCP global',
          enabled: draft.enabled,
          valid: true,
          summary: draft.enabled ? 'enabled' : 'disabled'
        },
        ...draft.servers.map((server): CommandMcpServerInfo => ({
          kind: 'server' as const,
          name: server.name,
          enabled: server.enabled,
          valid: server.valid,
          summary: server.summary,
          ...(server.transport ? {transport: server.transport} : {}),
          ...(server.diagnostic || diagnosticsByServer.get(server.name) ? {diagnostic: server.diagnostic || diagnosticsByServer.get(server.name)} : {}),
          ...(countsByServer.has(server.name)
            ? {
                toolCount: countsByServer.get(server.name)!.tools,
                resourceCount: countsByServer.get(server.name)!.resources,
                promptCount: countsByServer.get(server.name)!.prompts
              }
            : {})
        }))
      ];
    },
    readConfigDraft(): McpConfigEditDraft {
      return userConfigContext.capture().getMcpConfigEditDraft();
    },
    readServerFacts(serverName: string): CommandMcpServerFacts {
      return readFacts(serverName);
    },
    listInventory(serverName: string, section: McpInventorySection): CommandMcpInventoryItem[] {
      if (section === 'tools') {
        return mcpManager.listTools()
          .filter((tool) => tool.serverName === serverName)
          .map((tool) => ({label: tool.namespacedName, detail: [tool.readOnly ? '只读' : '', tool.description || ''].filter(Boolean).join(' · ')}));
      }

      if (section === 'resources') {
        return mcpManager.listResources()
          .filter((resource) => resource.serverName === serverName)
          .map((resource) => ({label: resource.uri, detail: [resource.name, resource.mimeType, resource.description].filter(Boolean).join(' · ')}));
      }

      if (section === 'templates') {
        return mcpManager.listResourceTemplates()
          .filter((template) => template.serverName === serverName)
          .map((template) => ({label: template.uriTemplate, detail: [template.name, template.mimeType].filter(Boolean).join(' · ')}));
      }

      return mcpManager.listPrompts()
        .filter((prompt) => prompt.serverName === serverName)
        .map((prompt) => ({label: createMcpPromptCommandName(prompt.serverName, prompt.promptName), detail: formatPromptArguments(prompt.arguments)}));
    },
    async saveConfigDraft(draft) {
      const issues = validateMcpConfigEditDraft(draft);

      if (issues.length > 0) {
        return {ok: false, issues};
      }

      appContext.setMcpBootstrapStatus('initializing');
      appContext.turnContext.startSpinner('working');
      render();

      try {
        userConfigContext.saveMcpConfigEditDraft(draft);
        await mcpManager.reload();
        appContext.clearContextUsage();
        const diagnostics = mcpManager.getDiagnostics().map((diagnostic) => `${diagnostic.serverName}: ${diagnostic.message}`);
        return {ok: true, diagnostics};
      } catch (error: unknown) {
        return {ok: false, error: sanitizeMcpError(error)};
      } finally {
        appContext.turnContext.stopSpinner();
        appContext.turnContext.clearWorking();
        appContext.setMcpBootstrapStatus('ready');
        render();
      }
    },
    listPrompts() {
      return mcpManager.listPrompts().map((prompt) => ({
        serverName: prompt.serverName,
        promptName: prompt.promptName,
        commandName: createMcpPromptCommandName(prompt.serverName, prompt.promptName),
        ...(prompt.description ? {description: prompt.description} : {}),
        arguments: prompt.arguments.map((argument) => ({...argument}))
      }));
    },
    listPromptCommands() {
      return mcpManager.listPrompts().map((prompt) => ({
        name: createMcpPromptCommandName(prompt.serverName, prompt.promptName),
        description: prompt.description || `MCP prompt ${prompt.promptName} from server ${prompt.serverName}`
      }));
    },
    async getPromptMessages(serverName, promptName, args) {
      const known = mcpManager.listPrompts().some((prompt) => prompt.serverName === serverName && prompt.promptName === promptName);

      if (!known) {
        return {ok: false, reason: 'missing' as const, message: `MCP prompt not found: ${serverName}:${promptName}`};
      }

      try {
        const result = await mcpManager.getPrompt(serverName, promptName, args);
        return {ok: true as const, messages: result.messages};
      } catch (error: unknown) {
        return {ok: false, reason: 'failed' as const, message: sanitizeMcpError(error)};
      }
    }
  };
}

export {
  formatPromptArguments,
  createMcpCommandPort
};

/** prompt 参数签名：必填用尖括号，可选用方括号，顺序与服务端声明一致。 */
function formatPromptArguments(args: McpPromptArgument[]): string {
  return args.map((argument) => argument.required ? `<${argument.name}>` : `[${argument.name}]`).join(' ');
}

export type {
  McpCommandPortOptions
};
