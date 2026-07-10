import {INPUT_EVENTS} from '../input/event-types';

import type {CommandHandler, CommandHost, CommandMcpServerInfo, CommandSession, McpCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';

type McpManageData = {
  initialStateKey: string;
  selectedIndex: number;
  servers: CommandMcpServerInfo[];
};

function createMcpSurface(data: McpManageData): McpCommandSurface {
  return {
    kind: 'mcp',
    title: 'MCP',
    servers: data.servers,
    selectedIndex: data.selectedIndex,
    emptyLines: [
      '当前没有配置 MCP server。',
      '配置位置：~/.echo/config.json',
      '示例字段：mcp.servers.<name>'
    ],
    dismissHint: 'Space 切换 · Enter 保存并重载 · Esc 取消'
  };
}

function normalizeMcpManageData(source: McpManageData): McpManageData {
  const maxIndex = Math.max(0, source.servers.length - 1);
  const selectedIndex = Math.min(Math.max(0, source.selectedIndex), maxIndex);

  return {
    initialStateKey: source.initialStateKey,
    selectedIndex,
    servers: source.servers.map((server) => ({...server}))
  };
}

function createMcpManageData(servers: CommandMcpServerInfo[]): McpManageData {
  return normalizeMcpManageData({
    initialStateKey: createEnabledStateKey(servers),
    selectedIndex: 0,
    servers
  });
}

function createEnabledStateKey(servers: CommandMcpServerInfo[]): string {
  return servers.map((server) => `${server.kind}:${server.name}:${server.enabled ? '1' : '0'}`).join('\n');
}

export class McpCommandHandler implements CommandHandler<McpManageData> {
  name = 'mcp';
  description = '查看和管理 MCP servers';

  match(text: string): boolean {
    return String(text).trim() === '/mcp';
  }

  start(_text: string, host: CommandHost): void {
    const data = createMcpManageData(host.mcp.listServers());
    host.composer.reset();
    host.session.open({
      commandName: 'mcp',
      handler: this,
      surface: createMcpSurface(data),
      data
    });
  }

  handleEvent(session: CommandSession<McpManageData>, event: InputEvent, host: CommandHost): void | Promise<void> {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      host.composer.reset();
      return undefined;
    }

    const data = session.data;

    if (!data) {
      if (event.type === INPUT_EVENTS.SUBMIT) {
        host.session.close();
        host.composer.reset();
      }

      return undefined;
    }

    if (data.servers.length === 0) {
      return undefined;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const direction = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      const nextData = normalizeMcpManageData({...data, selectedIndex: data.selectedIndex + direction});
      host.session.update({surface: createMcpSurface(nextData), data: nextData});
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      const nextData = normalizeMcpManageData({
        ...data,
        servers: data.servers.map((server, index) => index === data.selectedIndex ? {...server, enabled: !server.enabled} : server)
      });
      host.session.update({surface: createMcpSurface(nextData), data: nextData});
      return undefined;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      const servers = data.servers.map((server) => ({...server}));
      host.session.close();
      host.composer.reset();

      if (createEnabledStateKey(servers) === data.initialStateKey) {
        return undefined;
      }

      return host.mcp.saveServerStates(servers).then((result) => {
        if (result.ok) {
          if (!result.diagnostics || result.diagnostics.length === 0) {
            return;
          }

          host.session.open({
            commandName: 'mcp',
            handler: this,
            surface: {
              kind: 'info',
              title: 'MCP reload',
              lines: ['已保存 MCP 配置，但 reload 产生诊断：', ...result.diagnostics],
              dismissHint: 'Enter/Esc close'
            }
          });
          return;
        }

        host.session.open({
          commandName: 'mcp',
          handler: this,
          surface: {
            kind: 'info',
            title: 'MCP reload',
            lines: [`保存 MCP 配置失败：${result.error || 'unknown error'}`],
            dismissHint: 'Enter/Esc close'
          }
        });
      });
    }

    return undefined;
  }
}

export {createMcpSurface};
