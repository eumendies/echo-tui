import {INPUT_EVENTS} from '../input/event-types';
import * as composer from '../input/composer';
import {
  GENERAL_SUBAGENT_TOOL_CEILING,
  READONLY_SUBAGENT_TOOL_CEILING
} from '../agent/subagent/definition';
import {SUBAGENT_EFFORT_POLICIES} from '../agent/subagent/manifest';

import type {ComposerState} from '../types/composer';
import type {
  AgentsCommandDraft,
  AgentsCommandRow,
  AgentsCommandSurface,
  AgentsCommandTab,
  CommandAgentsSnapshot,
  CommandHandler,
  CommandHost,
  CommandSession
} from '../types/command';
import type {InputEvent} from '../types/input';
import type {AgentManagementItem, AgentManagementScope} from '../agent/subagent/management-store';
import type {BuiltinSubagentName, BuiltinSubagentOverride} from '../agent/subagent/settings';
import type {CustomSubagentManifest} from '../agent/subagent/manifest';

type AgentsSelection = {
  name: string; // 当前详情对应的稳定 Agent 名称。
  sourceKind: 'builtin' | AgentManagementScope; // 当前详情的物理来源层级。
};

type AgentsCustomForm = {
  draft: AgentsCommandDraft; // 与已加载文件隔离的完整可编辑草稿。
  fieldIndex: number; // 自定义表单当前可聚焦字段或动作行。
  fingerprint?: string; // 编辑已有定义时打开文件取得的乐观冲突指纹。
  kind: 'create' | 'edit'; // 当前表单是排他创建还是指纹更新。
  returnMode: 'detail' | 'list'; // 取消表单时返回的父层级。
  scope: AgentManagementScope; // 新文件或已有文件所在的受控 scope。
};

type AgentsBuiltinForm = {
  draft: Readonly<BuiltinSubagentOverride>; // 仅包含 model 与 effort 的内置策略草稿。
  fieldIndex: number; // 内置策略表单当前字段或动作焦点。
  fingerprint: string | null; // 打开 sidecar 时的完整文件指纹；null 表示预期缺失。
  name: BuiltinSubagentName; // Explorer 或 Worker 固定名称。
  scope: AgentManagementScope; // 当前编辑的用户级或项目级 sidecar。
};

type AgentsFieldEdit = {
  composer: ComposerState; // 当前 name/description 行内编辑器状态。
  field: 'name' | 'description'; // 提交后写回的自定义草稿字段。
  original: string; // Esc 取消字段编辑时恢复的原值。
};

type AgentsConfirmation = {
  kind: 'create' | 'delete' | 'removeOverride'; // 需要二次确认的破坏或排他创建动作。
  selectedIndex: number; // 0 固定为默认取消，1 才是明确执行动作。
  sourcePath: string; // 确认页显示的受控目标路径。
};

type AgentsManageData = {
  activeTab: AgentsCommandTab; // 当前顶层来源范围。
  builtinForm?: AgentsBuiltinForm; // 内置策略编辑中的隔离草稿。
  confirm?: AgentsConfirmation; // 当前默认取消的二次确认状态。
  customForm?: AgentsCustomForm; // 自定义定义创建或编辑草稿。
  edit?: AgentsFieldEdit; // 最内层行内字段编辑状态。
  error?: string; // 最近一次校验、冲突或 I/O 失败提示。
  feedback?: string; // 成功刷新后的下一 turn 生效提示。
  instructionsComposer?: ComposerState; // instructions 独立多行 composer 状态。
  mode: AgentsCommandSurface['mode']; // 当前列表、详情、表单或子页面层级。
  selected?: AgentsSelection; // 当前详情或删除目标身份。
  selectedIndex: number; // 当前页面 rows 中的焦点位置。
  snapshot: CommandAgentsSnapshot; // 当前管理扫描、sidecar 与模型目录快照。
};

const AGENTS_TABS: AgentsCommandSurface['tabs'] = [
  {id: 'overview', label: 'Overview'},
  {id: 'project', label: 'Project'},
  {id: 'user', label: 'User'},
  {id: 'builtin', label: 'Built-in'}
];
const CUSTOM_FORM_ROW_IDS = ['name', 'description', 'capability', 'model', 'effort', 'tools', 'mcp', 'instructions', 'save', 'cancel'] as const;
const BUILTIN_FORM_ROW_IDS = ['model', 'effort', 'save', 'remove', 'cancel'] as const;
const NEXT_TURN_FEEDBACK = '✓ 已保存，将在下一次 assistant turn 生效';

/** 把 controller 状态投影为与文件系统完全隔离的 Agents surface 快照。 */
function createAgentsSurface(data: AgentsManageData): AgentsCommandSurface {
  const rows = getRows(data);
  const selectedIndex = clampIndex(data.selectedIndex, rows.length);
  const editText = data.edit ? composer.getText(data.edit.composer) : data.instructionsComposer ? composer.getText(data.instructionsComposer) : undefined;
  const editCursor = data.edit?.composer.cursor ?? data.instructionsComposer?.cursor;
  return {
    activeTab: data.activeTab,
    dismissHint: createDismissHint(data),
    ...(editCursor !== undefined ? {editCursor} : {}),
    ...(data.edit ? {editField: data.edit.field} : {}),
    ...(editText !== undefined ? {editText} : {}),
    ...(data.error ? {error: data.error} : {}),
    ...(data.feedback ? {feedback: data.feedback} : {}),
    kind: 'agents',
    mode: data.mode,
    rows,
    selectedIndex,
    tabs: AGENTS_TABS.map((tab) => ({...tab})),
    title: createTitle(data, editText)
  };
}

function createTitle(data: AgentsManageData, editText?: string): string {
  if (data.mode === 'instructions') return `AGENTS · INSTRUCTIONS · ${editText === undefined ? '' : 'EDIT'}`;
  if (data.mode === 'tools') return 'AGENTS · TOOLS';
  if (data.mode === 'confirm') return 'AGENTS · CONFIRM';
  if (data.customForm) return `AGENTS · ${data.customForm.kind.toUpperCase()} · ${data.customForm.scope}`;
  if (data.builtinForm) return `AGENTS · ${data.builtinForm.name} · ${data.builtinForm.scope} POLICY`;
  if (data.mode === 'detail') return `AGENTS · ${data.selected?.name || 'DETAIL'}`;
  return `AGENTS · ${AGENTS_TABS.find((tab) => tab.id === data.activeTab)?.label || 'Overview'}`;
}

function createDismissHint(data: AgentsManageData): string {
  if (data.edit) return '输入字段 · Enter 应用 · Esc 取消字段编辑';
  if (data.mode === 'instructions') return '编辑 instructions · Ctrl+J 换行 · Enter/Esc 返回表单';
  if (data.mode === 'tools') return '↑/↓ 选择 · Space 多选 · Enter 激活可见选项 · Esc 返回表单';
  if (data.mode === 'confirm') return '↑/↓ 选择 · Enter 激活 · Esc 取消并保留草稿';
  if (data.mode === 'form') return '↑/↓ 选择 · ←/→ 调整策略 · Enter 激活可见选项 · Esc 返回';
  if (data.mode === 'detail') return '↑/↓ 选择 · Enter 激活可见选项 · Esc 返回列表';
  return 'Tab/Shift+Tab 切换范围 · ↑/↓ 选择 · Enter 打开 · Esc 关闭';
}

function getRows(data: AgentsManageData): AgentsCommandRow[] {
  if (data.mode === 'confirm' && data.confirm) return createConfirmRows(data);
  if (data.mode === 'tools' && data.customForm) return createToolRows(data.customForm.draft);
  if (data.mode === 'instructions') return [{id: 'instructions-done', kind: 'action', label: '完成 instructions 编辑'}];
  if (data.mode === 'form' && data.customForm) return createCustomFormRows(data.customForm);
  if (data.mode === 'form' && data.builtinForm) return createBuiltinFormRows(data);
  if (data.mode === 'detail') return createDetailRows(data);
  return createListRows(data);
}

function createListRows(data: AgentsManageData): AgentsCommandRow[] {
  const source = data.activeTab;
  let items: Readonly<AgentManagementItem>[];
  if (source === 'overview') {
    items = data.snapshot.items.filter((item) => item.status === 'active');
  } else if (source === 'builtin') {
    items = data.snapshot.items.filter((item) => item.sourceKind === 'builtin');
  } else {
    items = data.snapshot.items.filter((item) => item.sourceKind === source);
  }
  const rows = items.map((item): AgentsCommandRow => {
    const builtin = item.sourceKind === 'builtin'
      ? data.snapshot.builtins.find((candidate) => candidate.name === item.name)
      : undefined;
    const draft = item.draft;
    return {
      ...(builtin || draft ? {capability: builtin?.capability || draft?.capability} : {}),
      description: draft?.description || item.diagnostics[0]?.message || builtin?.description,
      ...(builtin || draft ? {effort: builtin?.effort || draft?.effort} : {}),
      id: `agent:${item.sourceKind}:${item.name}`,
      kind: 'agent',
      label: item.name,
      ...(builtin || draft ? {mcp: builtin?.includeMcpTools || draft?.mcp || false} : {}),
      ...(builtin?.modelProfileId || draft?.modelProfileId ? {model: builtin?.modelProfileId || draft?.modelProfileId} : {}),
      sourceKind: item.sourceKind,
      status: item.status,
      ...(builtin || draft ? {toolCount: builtin?.localToolNames.length || draft?.tools.length || 0} : {})
    };
  });
  if (source === 'project' || source === 'user') {
    rows.push({description: `在 ${source} scope 创建规范化 Markdown 定义`, id: `create:${source}`, kind: 'action', label: '新建 Agent'});
  }
  if (source === 'overview') {
    for (const [index, diagnostic] of data.snapshot.diagnostics.entries()) {
      rows.push({description: diagnostic.message, id: `overview:diagnostic:${index}`, kind: 'field', label: diagnostic.code, readonly: true, status: 'diagnostic'});
    }
    for (const item of data.snapshot.items.filter((candidate) => candidate.status === 'invalid' || candidate.status === 'reserved')) {
      const diagnostic = item.diagnostics[0];
      if (diagnostic) rows.push({description: `${item.sourceKind} · ${diagnostic.message}`, id: `overview:item-diagnostic:${item.sourceKind}:${item.name}`, kind: 'field', label: `${item.name} · ${diagnostic.code}`, readonly: true, status: item.status});
    }
  }
  return rows;
}

function createDetailRows(data: AgentsManageData): AgentsCommandRow[] {
  const item = getSelectedItem(data);
  if (!item) return [];
  if (item.sourceKind === 'builtin') {
    const builtin = data.snapshot.builtins.find((candidate) => candidate.name === item.name);
    if (!builtin) return [];
    return [
      {id: 'builtin:description', kind: 'field', label: 'description', description: builtin.description, readonly: true},
      {id: 'builtin:capability', kind: 'field', label: 'capability', description: builtin.capability, readonly: true},
      {id: 'builtin:model', kind: 'field', label: 'model', description: builtin.modelProfileId || '继承父模型', readonly: true},
      {id: 'builtin:effort', kind: 'field', label: 'effort', description: builtin.effort, readonly: true},
      {id: 'builtin:tools', kind: 'field', label: 'tools', description: `${builtin.localToolNames.length} 个（只读）`, readonly: true},
      {id: 'builtin:mcp', kind: 'field', label: 'MCP', description: builtin.includeMcpTools ? '启用（固定）' : '关闭（固定）', readonly: true},
      {id: 'builtin:project', kind: 'action', label: '配置项目级策略'},
      {id: 'builtin:user', kind: 'action', label: '配置用户级策略'}
    ];
  }
  const rows: AgentsCommandRow[] = [
    {id: 'custom:path', kind: 'field', label: 'source', description: item.sourcePath, readonly: true},
    {id: 'custom:status', kind: 'field', label: 'status', description: item.status, readonly: true},
    ...item.diagnostics.map((diagnostic, index) => ({id: `diagnostic:${index}`, kind: 'field' as const, label: diagnostic.code, description: diagnostic.message, readonly: true}))
  ];
  if (item.draft) {
    rows.push({id: 'custom:edit', kind: 'action', label: '编辑配置'});
  }
  rows.push({id: 'custom:delete', kind: 'action', label: '删除 Agent'});
  return rows;
}

function createCustomFormRows(form: AgentsCustomForm): AgentsCommandRow[] {
  const draft = form.draft;
  const ceiling = new Set(getToolCeiling(draft.capability));
  const disallowed = draft.tools.filter((tool) => !ceiling.has(tool));
  return [
    {id: 'name', kind: 'field', label: 'name', description: draft.name || '<必填>', readonly: form.kind === 'edit'},
    {id: 'description', kind: 'field', label: 'description', description: draft.description || '<必填>'},
    {id: 'capability', kind: 'field', label: 'capability', description: draft.capability},
    {id: 'model', kind: 'field', label: 'model', description: draft.modelProfileId || '继承父模型'},
    {id: 'effort', kind: 'field', label: 'effort', description: draft.effort},
    {id: 'tools', kind: 'field', label: 'tools', description: disallowed.length > 0 ? `${draft.tools.length} 个；需移除 ${disallowed.join(', ')}` : `${draft.tools.length} 个`},
    {id: 'mcp', kind: 'field', label: 'MCP', description: draft.capability === 'readonly' ? '关闭（readonly）' : draft.mcp ? '启用' : '关闭'},
    {id: 'instructions', kind: 'field', label: 'instructions', description: draft.instructions ? `${Array.from(draft.instructions).length} 字符` : '<必填>'},
    {id: 'save', kind: 'action', label: form.kind === 'edit' ? '保存更改' : '创建 Agent'},
    {id: 'cancel', kind: 'action', label: '取消'}
  ];
}

function createBuiltinFormRows(data: AgentsManageData): AgentsCommandRow[] {
  const form = data.builtinForm!;
  const source = data.snapshot.overrides.find((candidate) => candidate.sourceKind === form.scope);
  const hasOverride = Boolean(source?.settings?.overrides[form.name]);
  return [
    {id: 'model', kind: 'field', label: 'model', description: form.draft.modelProfileId || '继承父模型'},
    {id: 'effort', kind: 'field', label: 'effort', description: form.draft.effort},
    {id: 'save', kind: 'action', label: '保存策略'},
    {id: 'remove', kind: 'action', label: '移除 override', description: hasOverride ? '恢复低优先级或父策略' : '当前 scope 未配置'},
    {id: 'cancel', kind: 'action', label: '取消'}
  ];
}

function createToolRows(draft: AgentsCommandDraft): AgentsCommandRow[] {
  const ceiling = getToolCeiling(draft.capability);
  const allTools = [...new Set([...ceiling, ...draft.tools])];
  return [
    ...allTools.map((tool): AgentsCommandRow => ({
      description: ceiling.includes(tool) ? undefined : '当前 capability 不允许，保存前必须取消选择',
      id: `tool:${tool}`,
      kind: 'tool',
      label: tool,
      selected: draft.tools.includes(tool),
      status: ceiling.includes(tool) ? undefined : 'invalid'
    })),
    {id: 'tools:done', kind: 'action', label: '完成工具选择'}
  ];
}

function createConfirmRows(data: AgentsManageData): AgentsCommandRow[] {
  const confirm = data.confirm!;
  const actionLabel = confirm.kind === 'create'
    ? `创建 ${data.customForm?.draft.name || 'Agent'}`
    : confirm.kind === 'delete'
      ? `删除 ${data.selected?.name || 'Agent'}`
      : `移除 ${data.builtinForm?.name || 'Agent'} override`;
  const lowerPriority = confirm.kind === 'delete' && data.selected?.sourceKind === 'project'
    && data.snapshot.items.some((item) => item.sourceKind === 'user' && item.name === data.selected?.name && item.draft)
    ? '；删除后同名用户级定义将在下一 turn 重新生效'
    : confirm.kind === 'removeOverride' && data.builtinForm?.scope === 'project'
      ? '；移除后用户级策略可能在下一 turn 重新生效'
      : '';
  return [
    {description: '默认安全选项', id: 'confirm:cancel', kind: 'confirm', label: '取消'},
    {description: `${confirm.sourcePath}${lowerPriority}`, id: 'confirm:execute', kind: 'confirm', label: actionLabel}
  ];
}

export class AgentsCommandHandler implements CommandHandler<AgentsManageData> {
  name = 'agents';
  description = '查看和管理自定义与内置 Agents';

  match(text: string): boolean {
    return text.trimEnd() === '/agents';
  }

  start(_text: string, host: CommandHost): void {
    const data = normalizeData({activeTab: 'overview', mode: 'list', selectedIndex: 0, snapshot: host.agents.list()});
    host.session.open({commandName: 'agents', handler: this, surface: createAgentsSurface(data), data});
  }

  handleEvent(session: CommandSession<AgentsManageData>, event: InputEvent, host: CommandHost): void {
    const data = session.data;
    if (!data) return;
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.handleEscape(data, host);
      return;
    }
    if (data.edit) {
      this.handleFieldEdit(data, event, host);
      return;
    }
    if (data.mode === 'instructions') {
      this.handleInstructions(data, event, host);
      return;
    }
    if (data.mode === 'confirm') {
      this.handleConfirm(data, event, host);
      return;
    }
    if (data.mode === 'tools') {
      this.handleTools(data, event, host);
      return;
    }
    if (data.mode === 'form') {
      this.handleForm(data, event, host);
      return;
    }
    if (data.mode === 'detail') {
      this.handleDetail(data, event, host);
      return;
    }
    this.handleList(data, event, host);
  }

  /** Esc 只退出最内层：字段/确认/子页、表单、详情、列表，最后才关闭 command。 */
  private handleEscape(data: AgentsManageData, host: CommandHost): void {
    if (data.edit) {
      const customForm = data.customForm ? {...data.customForm, draft: {...data.customForm.draft, [data.edit.field]: data.edit.original}} : undefined;
      this.update(host, {...data, customForm, edit: undefined, error: undefined});
      return;
    }
    if (data.mode === 'instructions' || data.mode === 'tools') {
      this.update(host, {...data, instructionsComposer: undefined, mode: 'form', selectedIndex: data.customForm?.fieldIndex || 0, error: undefined});
      return;
    }
    if (data.mode === 'confirm') {
      this.update(host, {...data, confirm: undefined, mode: data.confirm?.kind === 'delete' ? 'detail' : 'form', selectedIndex: data.confirm?.kind === 'delete' ? 0 : data.customForm?.fieldIndex || data.builtinForm?.fieldIndex || 0, error: undefined});
      return;
    }
    if (data.mode === 'form') {
      const returnMode = data.customForm?.returnMode || 'detail';
      this.update(host, {...data, builtinForm: undefined, customForm: undefined, mode: returnMode, selectedIndex: 0, error: undefined});
      return;
    }
    if (data.mode === 'detail') {
      this.update(host, {...data, mode: 'list', selected: undefined, selectedIndex: 0, error: undefined});
      return;
    }
    host.session.close();
  }

  private handleList(data: AgentsManageData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.TAB || event.type === INPUT_EVENTS.SHIFT_TAB) {
      const direction = event.type === INPUT_EVENTS.TAB ? 1 : -1;
      const current = AGENTS_TABS.findIndex((tab) => tab.id === data.activeTab);
      const next = (current + direction + AGENTS_TABS.length) % AGENTS_TABS.length;
      this.update(host, {...data, activeTab: AGENTS_TABS[next].id, selectedIndex: 0, error: undefined, feedback: undefined});
      return;
    }
    if (isMove(event)) {
      this.update(host, {...data, selectedIndex: data.selectedIndex + moveDirection(event), error: undefined});
      return;
    }
    if (event.type !== INPUT_EVENTS.SUBMIT) return;
    const rows = getRows(data);
    const row = rows[clampIndex(data.selectedIndex, rows.length)];
    if (!row) return;
    if (row.id.startsWith('create:')) {
      this.beginCustomForm(data, row.id.endsWith('project') ? 'project' : 'user', 'create', createEmptyDraft(), 'list', host);
      return;
    }
    if (row.id.startsWith('agent:')) {
      const [, sourceKind, ...nameParts] = row.id.split(':');
      this.update(host, {...data, mode: 'detail', selected: {name: nameParts.join(':'), sourceKind: sourceKind as AgentsSelection['sourceKind']}, selectedIndex: 0, error: undefined, feedback: undefined});
    }
  }

  private handleDetail(data: AgentsManageData, event: InputEvent, host: CommandHost): void {
    if (isMove(event)) {
      this.update(host, {...data, selectedIndex: data.selectedIndex + moveDirection(event), error: undefined});
      return;
    }
    if (event.type !== INPUT_EVENTS.SUBMIT) return;
    const rows = getRows(data);
    const row = rows[clampIndex(data.selectedIndex, rows.length)];
    const item = getSelectedItem(data);
    if (!row || !item) return;
    if (row.id === 'custom:edit' && item.draft && item.sourceKind !== 'builtin') {
      this.beginCustomForm(data, item.sourceKind, 'edit', fromManifest(item.name, item.draft), 'detail', host, item.fingerprint);
    } else if (row.id === 'custom:delete') {
      this.beginDelete(data, item, host);
    } else if (row.id === 'builtin:project' || row.id === 'builtin:user') {
      this.beginBuiltinForm(data, row.id.endsWith('project') ? 'project' : 'user', item.name as BuiltinSubagentName, host);
    }
  }

  private handleForm(data: AgentsManageData, event: InputEvent, host: CommandHost): void {
    const form = data.customForm || data.builtinForm;
    if (!form) return;
    if (isMove(event)) {
      const next = form.fieldIndex + moveDirection(event);
      if (data.customForm) this.update(host, {...data, customForm: {...data.customForm, fieldIndex: next}, selectedIndex: next, error: undefined});
      else this.update(host, {...data, builtinForm: {...data.builtinForm!, fieldIndex: next}, selectedIndex: next, error: undefined});
      return;
    }
    if (event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      this.cycleFormField(data, event.type === INPUT_EVENTS.MOVE_RIGHT ? 1 : -1, host);
      return;
    }
    if (event.type !== INPUT_EVENTS.SUBMIT) return;
    if (data.customForm) this.activateCustomFormRow(data, host);
    else this.activateBuiltinFormRow(data, host);
  }

  private activateCustomFormRow(data: AgentsManageData, host: CommandHost): void {
    const form = data.customForm!;
    const rowId = CUSTOM_FORM_ROW_IDS[clampIndex(form.fieldIndex, CUSTOM_FORM_ROW_IDS.length)];
    if (rowId === 'name' || rowId === 'description') {
      if (rowId === 'name' && form.kind === 'edit') return;
      const value = form.draft[rowId];
      this.update(host, {...data, edit: {composer: composer.createComposer(value), field: rowId, original: value}, error: undefined});
    } else if (rowId === 'capability' || rowId === 'model' || rowId === 'effort') {
      this.cycleFormField(data, 1, host);
    } else if (rowId === 'tools') {
      this.update(host, {...data, mode: 'tools', selectedIndex: 0, error: undefined});
    } else if (rowId === 'mcp') {
      if (form.draft.capability === 'general') this.updateCustomDraft(data, {...form.draft, mcp: !form.draft.mcp}, host);
    } else if (rowId === 'instructions') {
      this.update(host, {...data, instructionsComposer: composer.createComposer(form.draft.instructions), mode: 'instructions', selectedIndex: 0, error: undefined});
    } else if (rowId === 'save') {
      if (form.kind === 'edit') this.saveCustomEdit(data, host);
      else this.beginCreateConfirmation(data, host);
    } else if (rowId === 'cancel') {
      this.handleEscape(data, host);
    }
  }

  private activateBuiltinFormRow(data: AgentsManageData, host: CommandHost): void {
    const form = data.builtinForm!;
    const rowId = BUILTIN_FORM_ROW_IDS[clampIndex(form.fieldIndex, BUILTIN_FORM_ROW_IDS.length)];
    if (rowId === 'model' || rowId === 'effort') {
      this.cycleFormField(data, 1, host);
    } else if (rowId === 'save') {
      const result = host.agents.writeBuiltinOverride(form.scope, form.name, form.draft, form.fingerprint);
      if (result.ok) this.finishSuccess(data, host);
      else this.update(host, {...data, error: formatMutationError(result)});
    } else if (rowId === 'remove') {
      const source = data.snapshot.overrides.find((candidate) => candidate.sourceKind === form.scope);
      if (!source?.settings?.overrides[form.name] || !source.fingerprint) {
        this.update(host, {...data, error: '当前 scope 没有可移除的 override。'});
        return;
      }
      this.update(host, {...data, confirm: {kind: 'removeOverride', selectedIndex: 0, sourcePath: source.sourcePath}, mode: 'confirm', selectedIndex: 0, error: undefined});
    } else if (rowId === 'cancel') {
      this.handleEscape(data, host);
    }
  }

  private cycleFormField(data: AgentsManageData, direction: number, host: CommandHost): void {
    if (data.customForm) {
      const form = data.customForm;
      const rowId = CUSTOM_FORM_ROW_IDS[clampIndex(form.fieldIndex, CUSTOM_FORM_ROW_IDS.length)];
      let draft = cloneDraft(form.draft);
      if (rowId === 'capability') {
        draft.capability = draft.capability === 'readonly' ? 'general' : 'readonly';
        if (draft.capability === 'readonly') draft.mcp = false;
      } else if (rowId === 'model') {
        draft.modelProfileId = cycleOptionalValue(draft.modelProfileId, data.snapshot.models.map((model) => model.id), direction);
      } else if (rowId === 'effort') {
        draft.effort = cycleValue(draft.effort, [...SUBAGENT_EFFORT_POLICIES], direction);
      } else {
        return;
      }
      this.updateCustomDraft(data, draft, host);
      return;
    }
    if (data.builtinForm) {
      const form = data.builtinForm;
      const rowId = BUILTIN_FORM_ROW_IDS[clampIndex(form.fieldIndex, BUILTIN_FORM_ROW_IDS.length)];
      let draft = {...form.draft};
      if (rowId === 'model') draft = {...draft, modelProfileId: cycleOptionalValue(draft.modelProfileId, data.snapshot.models.map((model) => model.id), direction)};
      else if (rowId === 'effort') draft = {...draft, effort: cycleValue(draft.effort, [...SUBAGENT_EFFORT_POLICIES], direction)};
      else return;
      this.update(host, {...data, builtinForm: {...form, draft}, error: undefined});
    }
  }

  private handleFieldEdit(data: AgentsManageData, event: InputEvent, host: CommandHost): void {
    const edit = data.edit!;
    if (event.type === INPUT_EVENTS.SUBMIT) {
      const value = composer.getText(edit.composer);
      this.updateCustomDraft(data, {...data.customForm!.draft, [edit.field]: value}, host, {edit: undefined});
      return;
    }
    if (!composer.applyComposerEditEvent(edit.composer, event)) return;
    this.update(host, {...data, edit: {...edit, composer: edit.composer}, error: undefined});
  }

  private handleInstructions(data: AgentsManageData, event: InputEvent, host: CommandHost): void {
    const state = data.instructionsComposer || composer.createComposer(data.customForm?.draft.instructions || '');
    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.updateCustomDraft(data, {...data.customForm!.draft, instructions: composer.getText(state)}, host, {instructionsComposer: undefined, mode: 'form', selectedIndex: data.customForm!.fieldIndex});
      return;
    }
    if (event.type === INPUT_EVENTS.INSERT_NEWLINE) composer.insertNewline(state);
    else if (event.type === INPUT_EVENTS.MOVE_UP) composer.moveUp(state);
    else if (event.type === INPUT_EVENTS.MOVE_DOWN) composer.moveDown(state);
    else if (!composer.applyComposerEditEvent(state, event)) return;
    this.updateCustomDraft(data, {...data.customForm!.draft, instructions: composer.getText(state)}, host, {instructionsComposer: state});
  }

  private handleTools(data: AgentsManageData, event: InputEvent, host: CommandHost): void {
    if (isMove(event)) {
      this.update(host, {...data, selectedIndex: data.selectedIndex + moveDirection(event), error: undefined});
      return;
    }
    const rows = getRows(data);
    const row = rows[clampIndex(data.selectedIndex, rows.length)];
    if (!row) return;
    if (event.type === INPUT_EVENTS.SUBMIT && row.id === 'tools:done') {
      this.update(host, {...data, mode: 'form', selectedIndex: data.customForm!.fieldIndex, error: undefined});
      return;
    }
    if ((event.type === INPUT_EVENTS.TEXT && event.value === ' ') || (event.type === INPUT_EVENTS.SUBMIT && row.kind === 'tool')) {
      const tool = row.id.slice('tool:'.length);
      const tools = data.customForm!.draft.tools.includes(tool)
        ? data.customForm!.draft.tools.filter((candidate) => candidate !== tool)
        : [...data.customForm!.draft.tools, tool];
      this.updateCustomDraft(data, {...data.customForm!.draft, tools}, host);
    }
  }

  private handleConfirm(data: AgentsManageData, event: InputEvent, host: CommandHost): void {
    if (isMove(event)) {
      const selectedIndex = clampIndex(data.confirm!.selectedIndex + moveDirection(event), 2);
      this.update(host, {...data, confirm: {...data.confirm!, selectedIndex}, selectedIndex, error: undefined});
      return;
    }
    if (event.type !== INPUT_EVENTS.SUBMIT) return;
    if (data.confirm!.selectedIndex === 0) {
      this.handleEscape(data, host);
      return;
    }
    if (data.confirm!.kind === 'create') {
      const form = data.customForm!;
      const result = host.agents.create(form.scope, form.draft.name, toManifest(form.draft));
      if (result.ok) this.finishSuccess(data, host);
      else this.update(host, {...data, confirm: undefined, mode: 'form', selectedIndex: form.fieldIndex, error: formatMutationError(result)});
    } else if (data.confirm!.kind === 'delete') {
      const item = getSelectedItem(data);
      if (!item || item.sourceKind === 'builtin' || !item.fingerprint) return;
      const result = host.agents.delete(item.sourceKind, item.name, item.fingerprint);
      if (result.ok) this.finishSuccess(data, host);
      else this.update(host, {...data, confirm: undefined, mode: 'detail', selectedIndex: 0, error: formatMutationError(result)});
    } else {
      const form = data.builtinForm!;
      const source = data.snapshot.overrides.find((candidate) => candidate.sourceKind === form.scope);
      if (!source?.fingerprint) return;
      const result = host.agents.deleteBuiltinOverride(form.scope, form.name, source.fingerprint);
      if (result.ok) this.finishSuccess(data, host);
      else this.update(host, {...data, confirm: undefined, mode: 'form', selectedIndex: form.fieldIndex, error: formatMutationError(result)});
    }
  }

  private beginCustomForm(data: AgentsManageData, scope: AgentManagementScope, kind: AgentsCustomForm['kind'], draft: AgentsCommandDraft, returnMode: AgentsCustomForm['returnMode'], host: CommandHost, fingerprint?: string): void {
    this.update(host, {...data, customForm: {draft: cloneDraft(draft), fieldIndex: 0, fingerprint, kind, returnMode, scope}, builtinForm: undefined, mode: 'form', selectedIndex: 0, error: undefined, feedback: undefined});
  }

  private beginBuiltinForm(data: AgentsManageData, scope: AgentManagementScope, name: BuiltinSubagentName, host: CommandHost): void {
    const source = data.snapshot.overrides.find((candidate) => candidate.sourceKind === scope);
    if (source?.status === 'invalid') {
      this.update(host, {...data, error: `无法编辑无效 settings：${source.error?.message || '格式无效'}`});
      return;
    }
    const existing = source?.settings?.overrides[name];
    this.update(host, {...data, builtinForm: {draft: existing ? {...existing} : {effort: 'inherit'}, fieldIndex: 0, fingerprint: source?.fingerprint || null, name, scope}, customForm: undefined, mode: 'form', selectedIndex: 0, error: undefined, feedback: undefined});
  }

  private beginCreateConfirmation(data: AgentsManageData, host: CommandHost): void {
    const form = data.customForm!;
    const validation = host.agents.validate(form.scope, form.draft.name, toManifest(form.draft));
    if (!validation.ok) {
      this.update(host, {...data, error: formatMutationError(validation)});
      return;
    }
    this.update(host, {...data, confirm: {kind: 'create', selectedIndex: 0, sourcePath: validation.sourcePath}, mode: 'confirm', selectedIndex: 0, error: undefined});
  }

  private beginDelete(data: AgentsManageData, item: Readonly<AgentManagementItem>, host: CommandHost): void {
    if (item.sourceKind === 'builtin') return;
    if (!item.fingerprint || !item.sourcePath) {
      this.update(host, {...data, error: '该无效文件当前不可安全删除；请刷新后重试。'});
      return;
    }
    this.update(host, {...data, confirm: {kind: 'delete', selectedIndex: 0, sourcePath: item.sourcePath}, mode: 'confirm', selectedIndex: 0, error: undefined});
  }

  private saveCustomEdit(data: AgentsManageData, host: CommandHost): void {
    const form = data.customForm!;
    if (!form.fingerprint) {
      this.update(host, {...data, error: '缺少打开文件时的内容指纹，请返回列表刷新。'});
      return;
    }
    const result = host.agents.update(form.scope, form.draft.name, toManifest(form.draft), form.fingerprint);
    if (result.ok) this.finishSuccess(data, host);
    else this.update(host, {...data, error: formatMutationError(result)});
  }

  private finishSuccess(data: AgentsManageData, host: CommandHost): void {
    this.update(host, {...data, builtinForm: undefined, confirm: undefined, customForm: undefined, edit: undefined, error: undefined, feedback: NEXT_TURN_FEEDBACK, instructionsComposer: undefined, mode: 'list', selected: undefined, selectedIndex: 0, snapshot: host.agents.list()});
  }

  private updateCustomDraft(data: AgentsManageData, draft: AgentsCommandDraft, host: CommandHost, patch: Partial<AgentsManageData> = {}): void {
    this.update(host, {...data, ...patch, customForm: {...data.customForm!, draft: cloneDraft(draft)}, error: undefined});
  }

  private update(host: CommandHost, data: AgentsManageData): void {
    const normalized = normalizeData(data);
    host.session.update({data: normalized, surface: createAgentsSurface(normalized)});
  }
}

function normalizeData(data: AgentsManageData): AgentsManageData {
  const rows = getRows(data);
  const selectedIndex = clampIndex(data.selectedIndex, rows.length);
  const customForm = data.customForm ? {...data.customForm, fieldIndex: clampIndex(data.customForm.fieldIndex, CUSTOM_FORM_ROW_IDS.length)} : undefined;
  const builtinForm = data.builtinForm ? {...data.builtinForm, fieldIndex: clampIndex(data.builtinForm.fieldIndex, BUILTIN_FORM_ROW_IDS.length)} : undefined;
  return {...data, builtinForm, customForm, selectedIndex};
}

function getSelectedItem(data: AgentsManageData): Readonly<AgentManagementItem> | undefined {
  return data.selected
    ? data.snapshot.items.find((item) => item.name === data.selected!.name && item.sourceKind === data.selected!.sourceKind)
    : undefined;
}

function createEmptyDraft(): AgentsCommandDraft {
  return {capability: 'readonly', description: '', effort: 'inherit', instructions: '', mcp: false, name: '', tools: ['read_files', 'glob', 'grep']};
}

function fromManifest(name: string, manifest: Readonly<CustomSubagentManifest>): AgentsCommandDraft {
  return {name, capability: manifest.capability, description: manifest.description, effort: manifest.effort, instructions: manifest.instructions, mcp: manifest.mcp, ...(manifest.modelProfileId ? {modelProfileId: manifest.modelProfileId} : {}), tools: [...manifest.tools]};
}

function toManifest(draft: AgentsCommandDraft): CustomSubagentManifest {
  return {capability: draft.capability, description: draft.description, effort: draft.effort, instructions: draft.instructions, mcp: draft.mcp, ...(draft.modelProfileId ? {modelProfileId: draft.modelProfileId} : {}), tools: [...draft.tools]};
}

function cloneDraft(draft: AgentsCommandDraft): AgentsCommandDraft {
  return {...draft, tools: [...draft.tools]};
}

function getToolCeiling(capability: AgentsCommandDraft['capability']): string[] {
  return [...(capability === 'readonly' ? READONLY_SUBAGENT_TOOL_CEILING : GENERAL_SUBAGENT_TOOL_CEILING)];
}

function cycleOptionalValue(current: string | undefined, values: string[], direction: number): string | undefined {
  const options: Array<string | undefined> = [undefined, ...values];
  return cycleValue(current, options, direction);
}

function cycleValue<T>(current: T, values: T[], direction: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + direction + values.length) % values.length];
}

function formatMutationError(result: {code: string; kind: 'validation' | 'conflict' | 'io'; message: string}): string {
  const kind = result.kind === 'conflict' ? '冲突' : result.kind === 'validation' ? '校验失败' : 'I/O 失败';
  return `${kind}（${result.code}）：${result.message}`;
}

function isMove(event: InputEvent): boolean {
  return event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN;
}

function moveDirection(event: InputEvent): number {
  return event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
}

function clampIndex(index: number, length: number): number {
  return length <= 0 ? 0 : Math.min(Math.max(0, index), length - 1);
}

export {createAgentsSurface};
