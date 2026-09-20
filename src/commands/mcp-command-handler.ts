import {INPUT_EVENTS} from '../input/event-types';
import {DEFAULT_MCP_TIMEOUT_MS} from '../config/mcp-config';
import {
  SAVE_ROW_ID,
  createDraftFingerprint,
  currentEntryDefinition,
  currentServer,
  getConfirmRows,
  getEntriesRows,
  getEntryDetailRows,
  getErrorRows,
  getInventoryRows,
  getOverviewRows,
  getServerRows,
  isDirty,
  markSaved,
  validateDraft
} from './mcp/state';

import type {CommandHandler, CommandHost, CommandMcpServerFacts, CommandSession, McpCommandRow, McpCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {McpSecretEntryDraft, McpServerEditDraft} from '../types/mcp';
import type {McpEditTarget, McpPanelData} from './mcp/state';

const TRANSITIONS: ReadonlyArray<McpServerEditDraft['transport']> = ['stdio', 'http'];
const FIELD_EDIT_TARGETS: ReadonlySet<string> = new Set(['name', 'url', 'command', 'cwd', 'timeoutMs']);

/**
 * `/mcp` 面板 handler：总览 → server 编辑 → 集合子视图 → 只读清单。
 * 所有编辑只作用于 session 草稿，只有显式保存行才写回配置并重载 manager。
 */
export class McpCommandHandler implements CommandHandler<McpPanelData> {
  name = 'mcp';
  description = '查看和管理 MCP servers';

  match(text: string): boolean {
    return text.trimEnd() === '/mcp';
  }

  start(_text: string, host: CommandHost): void {
    const data = createPanelData(host);

    host.session.open({
      commandName: 'mcp',
      handler: this,
      surface: createSurface(data),
      data
    });
  }

  handleEvent(session: CommandSession<McpPanelData>, event: InputEvent, host: CommandHost): void | Promise<void> {
    const data = session.data;

    if (!data) {
      if (event.type === INPUT_EVENTS.SUBMIT || event.type === INPUT_EVENTS.ESCAPE) {
        host.session.close();
      }

      return;
    }

    if (data.editTarget) {
      this.handleEditEvent(data, event, host);
      return;
    }

    switch (data.view) {
      case 'overview':
        return this.handleOverviewEvent(data, event, host);
      case 'server':
        return this.handleServerEvent(data, event, host);
      case 'entries':
        return this.handleEntriesEvent(data, event, host);
      case 'entryDetail':
        return this.handleEntryDetailEvent(data, event, host);
      case 'inventory':
        return this.handleInventoryEvent(data, event, host);
      case 'discardConfirm':
      case 'deleteConfirm':
        return this.handleConfirmEvent(data, event, host);
      case 'error':
        this.update(host, {...data, view: data.returnView || 'overview', error: undefined, errorIssues: undefined});
        return;
    }
  }

  /** 内联输入：首次输入替换原值，Enter 提交、Esc 取消，退格只作用于缓冲。 */
  private handleEditEvent(data: McpPanelData, event: InputEvent, host: CommandHost): void {
    const target = data.editTarget as McpEditTarget;
    const buffer = data.editBuffer || '';

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.update(host, {...data, editTarget: undefined, editBuffer: undefined, editReplacePending: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.BACKSPACE) {
      this.update(host, {...data, editBuffer: Array.from(buffer).slice(0, -1).join(''), editReplacePending: false});
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT) {
      this.update(host, {...data, editBuffer: data.editReplacePending ? event.value : `${buffer}${event.value}`, editReplacePending: false});
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.commitEdit(data, target, buffer, host);
    }
  }

  private commitEdit(data: McpPanelData, target: McpEditTarget, buffer: string, host: CommandHost): void {
    const committed: McpPanelData = {...data, editTarget: undefined, editBuffer: undefined, editReplacePending: undefined, feedback: undefined};

    const server = currentServer(committed);

    if (!server) {
      this.update(host, committed);
      return;
    }

    if (target.kind === 'field') {
      if (target.field === 'name') {
        const name = buffer.trim();

        // 名称在草稿内必须唯一且非空;它与 originalName 分离,保存时按新名写回。
        if (name === '' || committed.draft.servers.some((candidate, index) => index !== committed.serverIndex && candidate.name.trim() === name)) {
          this.update(host, {...committed, error: name === '' ? 'server 名不能为空' : `server 名已存在：${name}`});
          return;
        }

        server.name = name;
        this.update(host, committed);
        return;
      }

      if (target.field === 'timeoutMs') {
        const parsed = Number(buffer.trim());

        if (!Number.isInteger(parsed)) {
          this.update(host, {...committed, error: 'timeoutMs 必须是整数毫秒'});
          return;
        }

        server.timeoutMs = parsed;
      } else {
        const value = buffer.trim();
        server[target.field] = value === '' ? undefined : value;
      }

      this.update(host, committed);
      return;
    }

    if (committed.entriesSection === 'args') {
      server.args[committed.entriesIndex] = buffer;
      this.update(host, committed);
      return;
    }

    const entry = currentEntryDefinition(committed);

    if (!entry) {
      this.update(host, committed);
      return;
    }

    if (target.kind === 'entryKey') {
      entry.key = buffer.trim();
      this.update(host, committed);
      return;
    }

    // 密钥值:空输入表示未改动,显式清空由 entryDetail 的空值动作完成。
    entry.value = buffer === '' ? undefined : buffer;
    this.update(host, committed);
  }

  private handleOverviewEvent(data: McpPanelData, event: InputEvent, host: CommandHost): void | Promise<void> {
    const rows = getOverviewRows(data);
    const row = rows[data.overviewIndex];

    if (event.type === INPUT_EVENTS.ESCAPE) {
      if (isDirty(data)) {
        this.update(host, {...data, view: 'discardConfirm', discardIndex: 0, returnView: 'overview'});
        return;
      }

      host.session.close();
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.update(host, {...data, overviewIndex: clamp(data.overviewIndex + (event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1), rows.length)});
      return;
    }

    if (!row) {
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      if (row.id === 'global') {
        this.update(host, {...data, draft: {...data.draft, enabled: !data.draft.enabled}});
        return;
      }

      if (row.kind === 'server') {
        const server = data.draft.servers[data.overviewIndex - 1];
        server.enabled = !server.enabled;
        this.update(host, {...data});
      }

      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    if (row.kind === 'server') {
      this.update(host, {...data, view: 'server', serverIndex: data.overviewIndex - 1, fieldIndex: 0, error: undefined});
      return;
    }

    if (row.id === 'addServer') {
      // 新增直接进入二级编辑页,名称作为该页第一个字段,由用户就地改名。
      data.draft.servers.push({
        name: createDraftServerName(data.draft),
        editable: true,
        enabled: true,
        transport: 'stdio',
        args: [],
        env: [],
        headers: [],
        timeoutMs: DEFAULT_MCP_TIMEOUT_MS
      });
      this.update(host, {...data, view: 'server', serverIndex: data.draft.servers.length - 1, fieldIndex: 0, error: undefined});
      return;
    }

    if (row.id === SAVE_ROW_ID) {
      return this.saveConfig(data, host);
    }
  }

  private handleServerEvent(data: McpPanelData, event: InputEvent, host: CommandHost): void | Promise<void> {
    const rows = getServerRows(data);
    const row = rows[data.fieldIndex];

    if (event.type === INPUT_EVENTS.ESCAPE) {
      // server 视图的 Esc 只回上一层;丢弃确认只在总览真正退出面板时出现。
      this.update(host, {...data, view: 'overview'});
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.update(host, {...data, fieldIndex: clamp(data.fieldIndex + (event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1), rows.length)});
      return;
    }

    if (!row) {
      return;
    }

    const server = currentServer(data);

    if (!server) {
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === ' ' && row.id === 'enabled') {
      server.enabled = !server.enabled;
      this.update(host, {...data});
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    if (row.id === 'transport') {
      const currentIndex = TRANSITIONS.indexOf(server.transport);
      server.transport = TRANSITIONS[(currentIndex + 1) % TRANSITIONS.length];
      this.update(host, {...data, fieldIndex: clamp(data.fieldIndex, getServerRows(data).length)});
      return;
    }

    if (FIELD_EDIT_TARGETS.has(row.id)) {
      const currentValue = row.id === 'timeoutMs'
        ? String(server.timeoutMs)
        : row.id === 'name'
          ? server.name
          : (server[row.id as 'url' | 'command' | 'cwd'] || '');
      this.update(host, {
        ...data,
        editTarget: {kind: 'field', field: row.id as 'url' | 'command' | 'cwd' | 'timeoutMs'},
        editBuffer: currentValue,
        editReplacePending: true,
        error: undefined
      });
      return;
    }

    if (row.id === 'args' || row.id === 'env' || row.id === 'headers') {
      this.update(host, {...data, view: 'entries', entriesSection: row.id, entriesIndex: 0});
      return;
    }

    if (row.kind === 'inventory') {
      if (row.disabled) {
        return;
      }

      const section = row.id.replace('inventory:', '');
      this.update(host, {
        ...data,
        view: 'inventory',
        inventorySection: section as McpPanelData['inventorySection'],
        inventory: host.mcp.listInventory(server.name, section as McpPanelData['inventorySection']),
        inventoryIndex: 0
      });
      return;
    }

    if (row.id === 'deleteServer') {
      this.update(host, {...data, view: 'deleteConfirm', deleteIndex: data.serverIndex, discardIndex: 0, returnView: 'server'});
      return;
    }

    if (row.id === SAVE_ROW_ID) {
      return this.saveConfig(data, host);
    }
  }

  private handleEntriesEvent(data: McpPanelData, event: InputEvent, host: CommandHost): void {
    const rows = getEntriesRows(data);
    const row = rows[data.entriesIndex];

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.update(host, {...data, view: 'server', entriesSection: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.update(host, {...data, entriesIndex: clamp(data.entriesIndex + (event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1), rows.length)});
      return;
    }

    if (!row) {
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'd' && row.kind === 'entry') {
      this.deleteEntry(data, data.entriesIndex);
      this.update(host, {...data, entriesIndex: clamp(data.entriesIndex, getEntriesRows(data).length)});
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    if (row.id === 'addEntry') {
      this.addEntry(data);
      this.update(host, {...data, view: 'entryDetail', entriesIndex: Math.max(0, getEntriesCount(data) - 1), entryDetailField: data.entriesSection === 'args' ? 'value' : 'key'});
      return;
    }

    this.update(host, {...data, view: 'entryDetail', entryDetailField: data.entriesSection === 'args' ? 'value' : 'key'});
  }

  private handleEntryDetailEvent(data: McpPanelData, event: InputEvent, host: CommandHost): void {
    const rows = getEntryDetailRows(data);

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.update(host, {...data, view: 'entries'});
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const currentIndex = data.entryDetailField === 'key' ? 0 : 1;
      const nextIndex = clamp(currentIndex + (event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1), rows.length);
      this.update(host, {...data, entryDetailField: nextIndex === 0 ? 'key' : 'value'});
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'd' && data.entryDetailField === 'value' && data.entriesSection !== 'args') {
      const entry = currentEntryDefinition(data);

      if (entry) {
        entry.value = '';
        this.update(host, {...data});
      }

      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    const entry = currentEntryDefinition(data);
    const isSecretValue = data.entryDetailField === 'value' && data.entriesSection !== 'args';
    const currentValue = data.entryDetailField === 'key'
      ? (entry?.key || '')
      : data.entriesSection === 'args'
        ? (currentServer(data)?.args[data.entriesIndex] || '')
        : '';

    this.update(host, {
      ...data,
      editTarget: {kind: data.entryDetailField === 'key' ? 'entryKey' : 'entryValue'},
      editBuffer: isSecretValue ? '' : currentValue,
      editReplacePending: true
    });
  }

  private handleInventoryEvent(data: McpPanelData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.update(host, {...data, view: 'server', inventory: []});
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.update(host, {...data, inventoryIndex: clamp(data.inventoryIndex + (event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1), data.inventory.length)});
    }
  }

  private handleConfirmEvent(data: McpPanelData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.cancelConfirm(data, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.update(host, {...data, discardIndex: data.discardIndex === 0 ? 1 : 0});
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    if (data.discardIndex === 1) {
      this.cancelConfirm(data, host);
      return;
    }

    if (data.view === 'discardConfirm') {
      host.session.close();
      return;
    }

    const index = data.deleteIndex ?? -1;

    if (index >= 0) {
      data.draft.servers.splice(index, 1);
    }

    this.update(host, {
      ...data,
      view: 'overview',
      deleteIndex: undefined,
      serverIndex: 0,
      fieldIndex: 0,
      overviewIndex: clamp(index, getOverviewRows(data).length)
    });
  }

  private cancelConfirm(data: McpPanelData, host: CommandHost): void {
    this.update(host, {...data, view: data.returnView || 'overview', deleteIndex: undefined});
  }

  /** 显式保存：先校验草稿，再写回并重载；失败时保留草稿并把问题投影到 error 视图。 */
  private async saveConfig(data: McpPanelData, host: CommandHost): Promise<void> {
    const issues = validateDraft(data.draft);

    if (issues.length > 0) {
      this.update(host, {...data, view: 'error', returnView: data.view, error: '草稿存在需要修正的问题', errorIssues: issues});
      return;
    }

    const result = await host.mcp.saveConfigDraft(data.draft);

    if (!result.ok) {
      this.update(host, {...data, view: 'error', returnView: data.view, error: result.error || '保存失败', errorIssues: result.issues});
      return;
    }

    const next = markSaved({
      ...data,
      draft: host.mcp.readConfigDraft(),
      factsByName: readFacts(host),
      view: 'overview',
      serverIndex: 0,
      fieldIndex: 0,
      overviewIndex: 0,
      entriesSection: undefined,
      entryDetailField: 'key',
      inventory: []
    });

    host.session.update({surface: createSurface(next), data: next});

    if (result.diagnostics && result.diagnostics.length > 0) {
      host.session.open({
        commandName: 'mcp',
        handler: this,
        surface: {
          kind: 'info',
          title: 'MCP reload',
          lines: ['已保存 MCP 配置，但 reload 产生诊断：', ...result.diagnostics],
          dismissHint: 'Enter/Esc close'
        },
        data: null
      });
    }
  }

  private update(host: CommandHost, data: McpPanelData): void {
    host.session.update({surface: createSurface(data), data});
  }

  private addEntry(data: McpPanelData): void {
    const server = currentServer(data);

    if (!server || !data.entriesSection) {
      return;
    }

    if (data.entriesSection === 'args') {
      server.args.push('');
      return;
    }

    const entry: McpSecretEntryDraft = {key: '', stored: false};
    (data.entriesSection === 'env' ? server.env : server.headers).push(entry);
  }

  private deleteEntry(data: McpPanelData, index: number): void {
    const server = currentServer(data);

    if (!server || !data.entriesSection) {
      return;
    }

    if (data.entriesSection === 'args') {
      server.args.splice(index, 1);
      return;
    }

    (data.entriesSection === 'env' ? server.env : server.headers).splice(index, 1);
  }
}

function createPanelData(host: CommandHost): McpPanelData {
  const draft = host.mcp.readConfigDraft();

  return {
    view: 'overview',
    draft,
    initialFingerprint: createDraftFingerprint(draft),
    overviewIndex: 0,
    serverIndex: 0,
    fieldIndex: 0,
    entriesIndex: 0,
    entryDetailField: 'key',
    inventorySection: 'tools',
    inventoryIndex: 0,
    inventory: [],
    factsByName: readFacts(host),
    discardIndex: 0
  };
}

/** 新增 server 的占位名：保证草稿内唯一，用户随后在编辑页改成真正的名字。 */
function createDraftServerName(draft: McpPanelData['draft']): string {
  const base = 'new-server';

  if (!draft.servers.some((server) => server.name === base)) {
    return base;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;

    if (!draft.servers.some((server) => server.name === candidate)) {
      return candidate;
    }
  }
}

function readFacts(host: CommandHost): Record<string, CommandMcpServerFacts> {
  const facts: Record<string, CommandMcpServerFacts> = {};

  for (const server of host.mcp.listServers()) {
    if (server.kind === 'server') {
      facts[server.name] = host.mcp.readServerFacts(server.name);
    }
  }

  return facts;
}

function selectRows(data: McpPanelData): McpCommandRow[] {
  switch (data.view) {
    case 'overview':
      return getOverviewRows(data);
    case 'server':
      return getServerRows(data);
    case 'entries':
      return getEntriesRows(data);
    case 'entryDetail':
      return getEntryDetailRows(data);
    case 'inventory':
      return getInventoryRows(data);
    case 'discardConfirm':
      return getConfirmRows(data, 'discard');
    case 'deleteConfirm':
      return getConfirmRows(data, 'delete');
    case 'error':
      return getErrorRows(data);
  }
}

function createSurface(data: McpPanelData): McpCommandSurface {
  const rows = selectRows(data);
  const server = currentServer(data);
  const facts = server ? data.factsByName[server.name] : undefined;

  return {
    kind: 'mcp',
    view: data.view,
    title: createTitle(data),
    rows,
    selectedIndex: clamp(selectIndex(data), rows.length),
    ...(data.view === 'server' && facts ? {facts} : {}),
    ...(data.view === 'overview' && data.draft.servers.length === 0
      ? {emptyLines: ['当前没有配置 MCP server。', '配置位置：~/.echo/config.json', 'Enter 新增 server，或保持空态退出']}
      : {}),
    ...(data.feedback ? {feedback: data.feedback} : {}),
    ...(data.error ? {error: data.error} : {}),
    dirty: isDirty(data),
    dismissHint: createDismissHint(data)
  };
}

function createTitle(data: McpPanelData): string {
  const serverName = currentServer(data)?.name || '';

  switch (data.view) {
    case 'server':
      return `MCP · ${serverName}`;
    case 'entries':
      return `MCP · ${serverName} · ${data.entriesSection || ''}`;
    case 'entryDetail':
      return `MCP · ${serverName} · 条目 ${data.entriesIndex + 1}`;
    case 'inventory':
      return `MCP · ${serverName} · ${data.inventorySection}`;
    default:
      return 'MCP';
  }
}

function createDismissHint(data: McpPanelData): string {
  if (data.editTarget) {
    return 'Enter 提交 · Esc 取消';
  }

  switch (data.view) {
    case 'overview':
      return 'Space 启停 · Enter 进入/新增/保存 · Esc 退出';
    case 'server':
      return 'Space 启停 · Enter 编辑/进入 · Esc 返回';
    case 'entries':
      return 'd 删除条目 · Enter 编辑/新增 · Esc 返回';
    case 'entryDetail':
      return 'd 清空密钥值 · Enter 编辑 · Esc 返回';
    case 'inventory':
      return '只读浏览 · Esc 返回';
    case 'discardConfirm':
    case 'deleteConfirm':
      return '↑/↓ 选择 · Enter 确认 · Esc 取消';
    case 'error':
      return 'Enter/Esc 返回';
  }
}

function selectIndex(data: McpPanelData): number {
  switch (data.view) {
    case 'overview':
      return data.overviewIndex;
    case 'server':
      return data.fieldIndex;
    case 'entries':
      return data.entriesIndex;
    case 'entryDetail':
      return data.entryDetailField === 'key' ? 0 : 1;
    case 'inventory':
      return data.inventoryIndex;
    case 'discardConfirm':
    case 'deleteConfirm':
      return data.discardIndex;
    case 'error':
      return 0;
  }
}

function getEntriesCount(data: McpPanelData): number {
  const server = currentServer(data);

  if (!server || !data.entriesSection) {
    return 0;
  }

  if (data.entriesSection === 'args') {
    return server.args.length;
  }

  return (data.entriesSection === 'env' ? server.env : server.headers).length;
}

function clamp(value: number, length: number): number {
  return Math.min(Math.max(0, value), Math.max(0, length - 1));
}

export {
  createDraftServerName,
  createPanelData,
  createSurface,
  readFacts,
  selectRows
};
