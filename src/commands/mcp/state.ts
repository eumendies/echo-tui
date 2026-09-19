import {validateMcpConfigEditDraft} from '../../config/mcp-config';

import type {CommandMcpInventoryItem, CommandMcpServerFacts, McpCommandRow, McpInventorySection, McpSurfaceView} from '../../types/command';
import type {McpConfigEditDraft, McpConfigEditIssue, McpSecretEntryDraft, McpServerEditDraft} from '../../types/mcp';

type McpEntriesSection = 'args' | 'env' | 'headers';
type McpEditTarget =
  | {kind: 'field'; field: 'name' | 'url' | 'command' | 'cwd' | 'timeoutMs'} // server 视图的标量字段。
  | {kind: 'entryKey'} // entryDetail 的键行。
  | {kind: 'entryValue'}; // entryDetail 的值行（args 也只有这一行）。

type McpPanelData = {
  view: McpSurfaceView; // 当前视图。
  draft: McpConfigEditDraft; // 面板持有的完整草稿。
  initialFingerprint: string; // 脏检查基线。
  overviewIndex: number; // 总览选中行。
  serverIndex: number; // 当前 server 在 draft.servers 中的下标。
  fieldIndex: number; // server 视图选中行。
  entriesSection?: McpEntriesSection; // 当前集合字段子视图所属段。
  entriesIndex: number; // entries 视图选中行。
  entryDetailField: 'key' | 'value'; // entryDetail 当前行。
  inventorySection: McpInventorySection; // inventory 段。
  inventoryIndex: number; // inventory 选中行（窗口滚动用）。
  inventory: CommandMcpInventoryItem[]; // 打开清单时的只读快照。
  factsByName: Record<string, CommandMcpServerFacts>; // 面板打开或保存后刷新的运行事实。
  editTarget?: McpEditTarget; // 当前内联输入作用的目标。
  editBuffer?: string; // 内联输入缓冲。
  editReplacePending?: boolean; // true 表示首次输入替换原值。
  discardIndex: number; // discardConfirm 选项下标（0 丢弃 / 1 取消）。
  deleteIndex?: number; // 待确认删除的 server 下标。
  returnView?: McpSurfaceView; // error 视图返回目标。
  error?: string; // 当前错误提示。
  errorIssues?: McpConfigEditIssue[]; // 保存校验失败的问题列表。
  feedback?: string; // 最近一次成功提示。
};

const SECRET_MASK = '••••';
const SAVE_ROW_ID = 'save';

function createDraftFingerprint(draft: McpConfigEditDraft): string {
  return JSON.stringify(draft);
}

function isDirty(data: Pick<McpPanelData, 'draft' | 'initialFingerprint'>): boolean {
  return createDraftFingerprint(data.draft) !== data.initialFingerprint;
}

function markSaved(data: McpPanelData): McpPanelData {
  return {
    ...data,
    error: undefined,
    errorIssues: undefined,
    feedback: '✓ MCP 配置已保存',
    initialFingerprint: createDraftFingerprint(data.draft)
  };
}

function currentServer(data: McpPanelData): McpServerEditDraft | undefined {
  return data.draft.servers[data.serverIndex];
}

function getOverviewRows(data: McpPanelData): McpCommandRow[] {
  const rows: McpCommandRow[] = [{
    id: 'global',
    kind: 'global',
    label: 'MCP',
    dot: data.draft.enabled ? 'on' : 'off',
    value: data.draft.enabled ? '已启用' : '已停用'
  }];

  data.draft.servers.forEach((server, index) => {
    const facts = getServerFacts(data, server);
    rows.push({
      id: `server:${index}`,
      kind: 'server',
      label: server.name,
      dot: server.enabled ? 'on' : 'off',
      value: createServerSummary(server, facts),
      tone: facts?.initialized ? 'normal' : 'warning'
    });
  });

  rows.push({id: 'addServer', kind: 'action', label: '+ 新增 server'});
  rows.push({id: SAVE_ROW_ID, kind: 'action', label: '保存并重载', detail: isDirty(data) ? '有未保存改动' : '写入 config.json'});
  return rows;
}

function createServerSummary(server: McpServerEditDraft, facts: CommandMcpServerFacts | undefined): string {
  if (!server.editable) {
    return '配置无法解析 · 仅可查看诊断';
  }

  const parts: string[] = [server.transport];

  if (facts) {
    parts.push(`${facts.toolCount} tools`, `${facts.resourceCount} resources`, `${facts.promptCount} prompts`);
  }

  const diagnostic = facts?.diagnostics[0];

  if (diagnostic) {
    parts.push(diagnostic);
  }

  return parts.join(' · ');
}

function getServerRows(data: McpPanelData): McpCommandRow[] {
  const server = currentServer(data);

  if (!server) {
    return [];
  }

  const rows: McpCommandRow[] = [];

  if (server.editable) {
    rows.push(createFieldRow(data, 'name', '名称', server.name));
  }

  rows.push({
    id: 'enabled',
    kind: 'field',
    label: '启用',
    dot: server.enabled ? 'on' : 'off',
    value: server.enabled ? '已启用' : '已停用'
  }, {
    id: 'transport',
    kind: 'field',
    label: 'transport',
    value: server.transport
  });

  if (!server.editable) {
    rows.push({id: 'unparseable', kind: 'field', label: '配置', value: '无法解析', tone: 'warning', detail: getServerFacts(data, server)?.diagnostics[0]});
    return rows;
  }

  if (server.transport === 'stdio') {
    rows.push(createFieldRow(data, 'command', 'command', server.command));
    rows.push(createFieldRow(data, 'args', 'args', `${server.args.length} 项`));
    rows.push(createFieldRow(data, 'cwd', 'cwd', server.cwd));
    rows.push(createFieldRow(data, 'env', 'env', `${server.env.length} 项`));
  } else {
    rows.push(createFieldRow(data, 'url', 'url', server.url));
    rows.push(createFieldRow(data, 'headers', 'headers', `${server.headers.length} 项`));
  }

  rows.push(createFieldRow(data, 'timeoutMs', 'timeoutMs', `${server.timeoutMs} ms`));

  const facts = getServerFacts(data, server);
  const sections: Array<{section: McpInventorySection; label: string; count: number}> = [
    {section: 'tools', label: 'Tools', count: facts?.toolCount || 0},
    {section: 'resources', label: 'Resources', count: facts?.resourceCount || 0},
    {section: 'templates', label: 'Resource templates', count: facts?.resourceTemplateCount || 0},
    {section: 'prompts', label: 'Prompts', count: facts?.promptCount || 0}
  ];

  for (const entry of sections) {
    rows.push({
      id: `inventory:${entry.section}`,
      kind: 'inventory',
      label: entry.label,
      detail: facts?.initialized === true ? `${entry.count} 项` : '未初始化 · 仅可查看诊断',
      disabled: facts?.initialized !== true,
    });
  }

  rows.push({id: 'deleteServer', kind: 'action', label: '删除该 server', detail: '从草稿移除', tone: 'warning'});
  rows.push({id: SAVE_ROW_ID, kind: 'action', label: '保存并重载', detail: isDirty(data) ? '有未保存改动' : '写入 config.json'});
  return rows;
}

function createFieldRow(data: McpPanelData, id: McpCommandRow['id'], label: string, value: string | undefined): McpCommandRow {
  const editing = data.editTarget?.kind === 'field' && data.editTarget.field === id;

  return {
    id,
    kind: 'field',
    label,
    value: editing ? undefined : (value || '（未设置）'),
    ...(editing ? {input: {text: data.editBuffer || '', cursor: Array.from(data.editBuffer || '').length}} : {})
  };
}

function getEntriesRows(data: McpPanelData): McpCommandRow[] {
  const server = currentServer(data);
  const section = data.entriesSection;

  if (!server || !section) {
    return [];
  }

  const rows: McpCommandRow[] = [];

  if (section === 'args') {
    server.args.forEach((argument, index) => rows.push({id: `entry:${index}`, kind: 'entry', label: `#${index + 1}`, value: argument || '（空）'}));
  } else {
    const entries = section === 'env' ? server.env : server.headers;
    entries.forEach((entry, index) => rows.push({
      id: `entry:${index}`,
      kind: 'entry',
      label: entry.key || '（未命名）',
      value: createSecretDisplay(entry),
      tone: entry.key === '' ? 'warning' : 'normal'
    }));
  }

  rows.push({id: 'addEntry', kind: 'action', label: '+ 新增条目', detail: '回车进入编辑'});
  return rows;
}

function createSecretDisplay(entry: McpSecretEntryDraft): string {
  if (entry.value !== undefined) {
    return entry.value === '' ? '（将清空）' : SECRET_MASK;
  }

  return entry.stored ? SECRET_MASK : '（未设置）';
}

function getEntryDetailRows(data: McpPanelData): McpCommandRow[] {
  const rows: McpCommandRow[] = [];
  const kindLabel = data.entriesSection === 'args' ? '参数值' : '键';

  if (data.entriesSection !== 'args') {
    rows.push({id: 'key', kind: 'field', label: kindLabel, value: currentEntryDefinition(data)?.key || '（未设置）'});
  }

  rows.push({id: 'value', kind: 'field', label: '值', value: data.entriesSection === 'args' ? currentArgument(data) : createSecretDisplay(currentEntryDefinition(data) || {key: '', stored: false})});

  const editingRow = data.editTarget?.kind === 'entryKey' ? 'key' : data.editTarget?.kind === 'entryValue' ? 'value' : undefined;

  return rows.map((row) => row.id === editingRow
    ? {
        ...row,
        value: undefined,
        masked: row.id === 'value' && data.entriesSection !== 'args',
        input: {text: data.editBuffer || '', cursor: Array.from(data.editBuffer || '').length}
      }
    : row);
}

function currentArgument(data: McpPanelData): string {
  return currentServer(data)?.args[data.entriesIndex] ?? '';
}

function currentEntryDefinition(data: McpPanelData): McpSecretEntryDraft | undefined {
  const server = currentServer(data);

  if (!server || data.entriesSection === 'args' || !data.entriesSection) {
    return undefined;
  }

  return (data.entriesSection === 'env' ? server.env : server.headers)[data.entriesIndex];
}

function getInventoryRows(data: McpPanelData): McpCommandRow[] {
  return data.inventory.map((item, index) => ({
    id: `inventory:${index}`,
    kind: 'entry',
    label: item.label,
    ...(item.detail ? {detail: item.detail} : {}),
    tone: index === data.inventoryIndex ? 'success' : 'normal'
  }));
}

function getConfirmRows(data: McpPanelData, kind: 'discard' | 'delete'): McpCommandRow[] {
  const target = kind === 'delete' ? data.draft.servers[data.deleteIndex ?? -1]?.name : undefined;

  return [
    {
      id: 'confirm:0',
      kind: 'option',
      label: kind === 'delete' ? `确认删除 ${target || '该 server'}` : '丢弃未保存改动',
      tone: 'warning',
      ...(data.discardIndex === 0 ? {detail: '← 当前选择'} : {})
    },
    {
      id: 'confirm:1',
      kind: 'option',
      label: '取消',
      ...(data.discardIndex === 1 ? {detail: '← 当前选择'} : {})
    }
  ];
}

function getErrorRows(data: McpPanelData): McpCommandRow[] {
  const lines = (data.errorIssues || []).map((issue, index) => ({
    id: `issue:${index}`,
    kind: 'field' as const,
    label: issue.serverName || '配置',
    value: issue.message,
    tone: 'warning' as const
  }));

  return lines.length > 0 ? lines : [{id: 'issue:empty', kind: 'field', label: '保存失败', value: data.error || '未知错误', tone: 'warning'}];
}

/**
 * 按配置中的原始名取运行事实：草稿里重命名后 facts 仍然命中同一个 server,
 * 避免改名瞬间把清单入口显示成"未初始化"。
 */
function getServerFacts(data: McpPanelData, server: McpServerEditDraft | undefined): CommandMcpServerFacts | undefined {
  if (!server) {
    return undefined;
  }

  return data.factsByName[server.originalName || server.name];
}

function validateDraft(draft: McpConfigEditDraft): McpConfigEditIssue[] {
  return validateMcpConfigEditDraft(draft);
}

export {
  SECRET_MASK,
  SAVE_ROW_ID,
  createDraftFingerprint,
  createServerSummary,
  currentEntryDefinition,
  currentServer,
  getConfirmRows,
  getEntriesRows,
  getEntryDetailRows,
  getErrorRows,
  getInventoryRows,
  getOverviewRows,
  getServerRows,
  getServerFacts,
  isDirty,
  markSaved,
  validateDraft
};

export type {
  McpEditTarget,
  McpEntriesSection,
  McpPanelData
};
