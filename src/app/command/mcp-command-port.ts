import {readMcpConfigDraft, saveMcpEnabledStateDraft} from '../../config/mcp-config';
import {sanitizeMcpError} from '../../mcp/manager';

import type {McpManager} from '../../mcp/manager';
import type {CommandHostApp, CommandMcpServerInfo} from '../../types/command';
import type {AppContext} from '../state/app-context';

type McpCommandContext = Pick<AppContext, 'clearContextUsage' | 'setMcpBootstrapStatus' | 'turnContext'>;

type McpCommandPortOptions = {
  appContext: McpCommandContext;
  mcpManager?: McpManager;
  renderFooter: () => void;
};

/**
 * 创建 MCP 状态查询和配置重载端口，并协调重载期间的 footer 状态。
 */
function createMcpCommandPort(options: McpCommandPortOptions): CommandHostApp['mcp'] {
  const {appContext, mcpManager, renderFooter} = options;

  return {
    listServers() {
      const draft = readMcpConfigDraft();
      const toolCountByServer = new Map<string, number>();
      const diagnosticsByServer = new Map<string, string>();

      if (draft.servers.length === 0) {
        return [];
      }

      for (const tool of mcpManager?.listTools() || []) {
        toolCountByServer.set(tool.serverName, (toolCountByServer.get(tool.serverName) || 0) + 1);
      }

      for (const diagnostic of mcpManager?.getDiagnostics() || []) {
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
          ...(toolCountByServer.has(server.name) ? {toolCount: toolCountByServer.get(server.name)} : {})
        }))
      ];
    },
    async saveServerStates(servers) {
      appContext.setMcpBootstrapStatus('initializing');
      appContext.turnContext.startSpinner('working');
      renderFooter();

      try {
        const globalState = servers.find((server) => server.kind === 'global');
        saveMcpEnabledStateDraft({
          enabled: globalState ? globalState.enabled : true,
          servers: servers
            .filter((server) => server.kind === 'server')
            .map((server) => ({name: server.name, enabled: server.enabled}))
        });
        await mcpManager?.reload();
        appContext.clearContextUsage();
        const diagnostics = (mcpManager?.getDiagnostics() || []).map((diagnostic) => `${diagnostic.serverName}: ${diagnostic.message}`);
        return {ok: true, diagnostics};
      } catch (error: unknown) {
        return {ok: false, error: sanitizeMcpError(error)};
      } finally {
        appContext.turnContext.stopSpinner();
        appContext.turnContext.clearWorking();
        appContext.setMcpBootstrapStatus('ready');
        renderFooter();
      }
    }
  };
}

export {
  createMcpCommandPort
};

export type {
  McpCommandPortOptions
};
