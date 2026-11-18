import {INPUT_EVENTS} from '../input/event-types';
import * as composer from '../input/composer';

import type {ComposerState} from '../types/composer';
import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  MemoryCatalogForm,
  MemoryCommandRow,
  MemoryCommandSection,
  MemoryCommandSurface,
  MemoryCommandSurfaceMode,
  MemoryItemCounts
} from '../types/command';
import type {InputEvent} from '../types/input';
import type {AgentMemoryCatalog, AgentMemoryItem, AgentMemoryScope, UserMemory} from '../types/memory';

type EditTarget = 'user' | 'catalog-new' | 'catalog-edit' | 'item-new' | 'item-edit';

type MemoryDeleteTarget = {
  kind: 'user' | 'catalog' | 'item'; // 被删除对象的存储类别。
  id: string; // 稳定 id；详情层的焦点索引指向动作行，不能反推删除对象。
};

type MemoryCache = {
  memories: UserMemory[]; // 一级菜单与 user 列表复用的 user memory 快照。
  catalogs: AgentMemoryCatalog[]; // 全部 scope 的 catalog 索引快照。
  itemsByCatalogId: Record<string, AgentMemoryItem[]>; // 按 catalog id 缓存的 item 列表。
};

type MemoryData = {
  section: MemoryCommandSection; // 当前层级，决定行集合与 Esc 返回目标。
  scope?: AgentMemoryScope['kind']; // agent 层级的 global/project 范围。
  memories: UserMemory[]; // user memory 列表数据。
  catalogs: AgentMemoryCatalog[]; // 当前 scope 的 catalog 列表数据。
  agentItems: AgentMemoryItem[]; // 当前 catalog 的 item 列表数据。
  itemCounts: MemoryItemCounts; // 一级类型菜单的条目统计。
  cache: MemoryCache; // 跨层级复用的读取快照。
  selectedCatalog?: AgentMemoryCatalog; // catalog 详情层对应的 catalog。
  selectedIndex: number; // 当前层级 rows 中的焦点索引。
  focusId?: string; // 进入详情或编辑前的行 id，返回父层时据此恢复焦点。
  detailEntryId?: string; // 详情层对应的条目 id。
  mode: MemoryCommandSurfaceMode; // 行列表、编辑或删除确认。
  draft?: ComposerState; // 单行/多行编辑器草稿。
  catalogDrafts?: ComposerState[]; // catalog 表单的逐字段草稿。
  formIndex?: number; // catalog 表单当前字段索引。
  editTarget?: EditTarget; // 当前编辑器写入的目标。
  editingId?: string; // 编辑已有条目时的稳定 id；新建时缺省。
  editReturnSection?: MemoryCommandSection; // 保存或取消编辑后返回的层级。
  deleteTarget?: MemoryDeleteTarget; // 确认层要删除的对象。
  deleteIndex?: number; // 确认层焦点索引：0 目标摘要、1 取消、2 删除。
  deleteReturnSection?: MemoryCommandSection; // 取消删除后返回的层级。
  deleteReturnIndex?: number; // 对象在父列表中的原索引，删除后用于收敛焦点。
  error?: string; // 最近一次校验或持久化失败的中文说明。
};

const CATALOG_DETAIL_HEADER_ROWS = 3;
const DELETE_ROW_COUNT = 3;
const DELETE_CANCEL_INDEX = 1;

function cloneCatalog(value: AgentMemoryCatalog): AgentMemoryCatalog {
  return {...value, scope: {...value.scope}};
}

function cloneCache(cache: MemoryCache): MemoryCache {
  return {
    memories: cache.memories.map((memory) => ({...memory})),
    catalogs: cache.catalogs.map(cloneCatalog),
    itemsByCatalogId: Object.fromEntries(Object.entries(cache.itemsByCatalogId).map(([id, items]) => [id, items.map((item) => ({...item}))]))
  };
}

/** 把多行内容压成单行预览，供列表行与删除摘要复用。 */
function previewMemory(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.min(Math.max(Number.isInteger(value) ? value : 0, 0), length - 1);
}

/** 从稳定行 id 取出对象 id；前缀不匹配时返回 undefined。 */
function rowEntryId(row: MemoryCommandRow): string | undefined {
  return row.id.startsWith('entry:') ? row.id.slice('entry:'.length) : undefined;
}

function createToggleRow(enabled: boolean): MemoryCommandRow {
  return {
    id: 'toggle:enabled',
    kind: 'toggle',
    label: '启用',
    dot: enabled ? 'on' : 'off',
    value: enabled ? '已启用' : '已停用'
  };
}

function createEntryRow(id: string, label: string, enabled: boolean, value?: string): MemoryCommandRow {
  return {
    id: `entry:${id}`,
    kind: 'entry',
    label,
    dot: enabled ? 'on' : 'off',
    ...(value ? {value} : {})
  };
}

/** 一级菜单统计全部条目，包含 disabled。 */
function rowsForTypes(data: MemoryData): MemoryCommandRow[] {
  const counts = data.itemCounts;
  return [
    {id: 'type:user', kind: 'entry', label: 'User memories', value: `${counts.user} items`},
    {id: 'type:global', kind: 'entry', label: 'Agent memories · global', value: `${counts.global} items`},
    {id: 'type:project', kind: 'entry', label: 'Agent memories · project', value: `${counts.project} items`}
  ];
}

/** 新增动作行固定在末尾，使条目行下标与数据数组下标一致。 */
function rowsForUserList(data: MemoryData): MemoryCommandRow[] {
  return [
    ...data.memories.map((memory) => createEntryRow(memory.id, previewMemory(memory.content), memory.enabled)),
    {id: 'action:add-user', kind: 'action', label: '+ 新增 memory'}
  ];
}

function rowsForUserDetail(data: MemoryData): MemoryCommandRow[] {
  const memory = data.memories.find((item) => item.id === data.detailEntryId);

  if (!memory) {
    return [];
  }

  return [
    createToggleRow(memory.enabled),
    {id: 'action:edit-user', kind: 'action', label: '编辑内容'},
    {id: 'action:delete-user', kind: 'action', label: '删除 memory', tone: 'danger'}
  ];
}

function rowsForCatalogList(data: MemoryData): MemoryCommandRow[] {
  return [
    ...data.catalogs.map((catalog) => createEntryRow(catalog.id, catalog.name, catalog.enabled, catalog.description)),
    {id: 'action:add-catalog', kind: 'action', label: '+ 新建 catalog'}
  ];
}

/** catalog 详情同时承载元信息、item 列表与 catalog 自身的动作。 */
function rowsForCatalogDetail(data: MemoryData): MemoryCommandRow[] {
  const catalog = data.selectedCatalog;

  if (!catalog) {
    return [];
  }

  return [
    {id: 'field:name', kind: 'field', label: '名称', value: catalog.name},
    {id: 'field:description', kind: 'field', label: '描述', value: catalog.description},
    createToggleRow(catalog.enabled),
    ...data.agentItems.map((item) => createEntryRow(item.id, previewMemory(item.content), item.enabled)),
    {id: 'action:add-item', kind: 'action', label: '+ 新增 item'},
    {id: 'action:edit-catalog', kind: 'action', label: '编辑 catalog'},
    {id: 'action:delete-catalog', kind: 'action', label: '删除 catalog', tone: 'danger'}
  ];
}

function rowsForItemDetail(data: MemoryData): MemoryCommandRow[] {
  const item = data.agentItems.find((candidate) => candidate.id === data.detailEntryId);

  if (!item) {
    return [];
  }

  return [
    createToggleRow(item.enabled),
    {id: 'action:edit-item', kind: 'action', label: '编辑内容'},
    {id: 'action:delete-item', kind: 'action', label: '删除 item', tone: 'danger'}
  ];
}

/** 确认层同时提供目标摘要与默认取消的两个选项行。 */
function rowsForDeleteConfirm(data: MemoryData): MemoryCommandRow[] {
  return [
    {id: 'field:delete-target', kind: 'field', label: '目标', value: createDeleteSummary(data)},
    {id: 'option:cancel', kind: 'option', label: '取消'},
    {id: 'option:delete', kind: 'option', label: '删除', tone: 'danger'}
  ];
}

function createDeleteSummary(data: MemoryData): string {
  const target = data.deleteTarget;

  if (!target) {
    return '（未选择）';
  }

  if (target.kind === 'user') {
    return previewMemory(data.memories.find((item) => item.id === target.id)?.content || '');
  }

  if (target.kind === 'item') {
    return previewMemory(data.agentItems.find((item) => item.id === target.id)?.content || '');
  }

  const catalog = data.catalogs.find((item) => item.id === target.id);
  return catalog ? `${catalog.name} — ${catalog.description}` : '';
}

function getRows(data: MemoryData): MemoryCommandRow[] {
  if (data.section === 'types') return rowsForTypes(data);
  if (data.section === 'user-list') return rowsForUserList(data);
  if (data.section === 'user-detail') return rowsForUserDetail(data);
  if (data.section === 'catalog-list') return rowsForCatalogList(data);
  if (data.section === 'catalog-detail') return rowsForCatalogDetail(data);
  return rowsForItemDetail(data);
}

function getSurfaceRows(data: MemoryData): MemoryCommandRow[] {
  return data.mode === 'deleteConfirm' ? rowsForDeleteConfirm(data) : getRows(data);
}

/** 详情正文只在行列表模式投影，编辑与确认层不叠加正文。 */
function getDetailContent(data: MemoryData): string | undefined {
  if (data.mode !== 'list') {
    return undefined;
  }

  if (data.section === 'user-detail') {
    return data.memories.find((item) => item.id === data.detailEntryId)?.content;
  }

  if (data.section === 'item-detail') {
    return data.agentItems.find((item) => item.id === data.detailEntryId)?.content;
  }

  return undefined;
}

function createMemorySurface(data: MemoryData): MemoryCommandSurface {
  const rows = getSurfaceRows(data);
  const selectedIndex = data.mode === 'deleteConfirm'
    ? clampIndex(data.deleteIndex ?? DELETE_CANCEL_INDEX, DELETE_ROW_COUNT)
    : clampIndex(data.selectedIndex, rows.length);
  const detailContent = getDetailContent(data);

  return {
    kind: 'memory',
    title: createTitle(data),
    mode: data.mode,
    section: data.section,
    scope: data.scope,
    rows: rows.map((row) => ({...row})),
    selectedIndex,
    ...(detailContent !== undefined ? {detailContent} : {}),
    itemCounts: {...data.itemCounts},
    ...(data.catalogDrafts ? {catalogForm: createCatalogForm(data)} : {}),
    ...(data.draft ? {editText: composer.getText(data.draft), editCursor: data.draft.cursor} : {}),
    ...(data.error ? {error: data.error} : {}),
    dismissHint: createDismissHint(data)
  };
}

function createTitle(data: MemoryData): string {
  if (data.editTarget === 'catalog-new') return `NEW CATALOG · ${data.scope || 'project'}`;
  if (data.editTarget === 'catalog-edit') return `EDIT CATALOG · ${data.scope || 'project'}`;

  const base = createSectionTitle(data);
  return data.mode === 'deleteConfirm' ? `${base} · 确认删除` : base;
}

function createSectionTitle(data: MemoryData): string {
  if (data.section === 'user-list') return 'USER MEMORIES';
  if (data.section === 'user-detail') return 'USER MEMORY';
  if (data.section === 'catalog-list') return `AGENT CATALOGS · ${data.scope || 'project'}`;
  if (data.section === 'catalog-detail') return `CATALOG · ${data.selectedCatalog?.name || 'UNKNOWN'}`;
  if (data.section === 'item-detail') return `CATALOG ITEM · ${data.selectedCatalog?.name || 'UNKNOWN'}`;
  return 'MEMORY';
}

function createCatalogForm(data: MemoryData): MemoryCatalogForm {
  return {
    fields: (data.catalogDrafts || []).map((draft, index) => ({
      label: data.editTarget === 'catalog-new'
        ? ['名称', '描述', '首个 item'][index]
        : ['名称', '描述'][index],
      text: composer.getText(draft),
      cursor: draft.cursor
    })),
    selectedIndex: data.formIndex || 0
  };
}

/** 提示只描述导航与确认按键，不再暴露字母动作键。 */
function createDismissHint(data: MemoryData): string {
  if (data.mode === 'edit') {
    if (data.catalogDrafts) {
      return '↑/↓ 切换字段 · Enter 保存 · Ctrl+J 换行 · Esc 取消';
    }

    return '编辑 memory · Enter 保存 · Ctrl+J 换行 · Esc 取消';
  }

  if (data.mode === 'deleteConfirm') {
    return '↑/↓ 选择 · Enter 确认 · Esc 取消';
  }

  if (data.section === 'types') {
    return '↑/↓ 选择 · Enter 打开 · Esc 关闭';
  }

  if (data.section === 'user-detail' || data.section === 'item-detail') {
    return '↑/↓ 选择 · Enter/Space 激活 · Esc 返回';
  }

  return '↑/↓ 选择 · Enter 打开 · Space 启停 · Esc 返回';
}

/** 复制 session 数据并钳制焦点，避免删除或刷新后索引越界。 */
function normalizeData(data: MemoryData): MemoryData {
  const rows = getRows(data);

  return {
    ...data,
    selectedIndex: clampIndex(data.selectedIndex, rows.length),
    deleteIndex: clampIndex(data.deleteIndex ?? DELETE_CANCEL_INDEX, DELETE_ROW_COUNT),
    memories: data.memories.map((item) => ({...item})),
    catalogs: data.catalogs.map(cloneCatalog),
    agentItems: data.agentItems.map((item) => ({...item})),
    itemCounts: {...data.itemCounts},
    cache: cloneCache(data.cache),
    ...(data.draft ? {draft: structuredClone(data.draft)} : {}),
    ...(data.catalogDrafts ? {catalogDrafts: data.catalogDrafts.map((draft) => structuredClone(draft))} : {})
  };
}

function createTypeData(): MemoryData {
  return {
    section: 'types',
    memories: [],
    catalogs: [],
    agentItems: [],
    itemCounts: {user: 0, global: 0, project: 0},
    cache: {memories: [], catalogs: [], itemsByCatalogId: {}},
    selectedIndex: 0,
    mode: 'list'
  };
}

export class MemoryCommandHandler implements CommandHandler<MemoryData> {
  name = 'memory';
  description = '查看和管理持久 memory';

  match(text: string): boolean {
    return text.trimEnd() === '/memory';
  }

  start(_text: string, host: CommandHost): void {
    const data = this.loadTypeData(host);
    host.session.open({
      commandName: 'memory',
      handler: this,
      surface: createMemorySurface(data),
      data
    });
  }

  handleEvent(session: CommandSession<MemoryData>, event: InputEvent, host: CommandHost): void {
    const data = session.data;

    if (!data) {
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.handleEscape(data, host);
      return;
    }

    if (data.mode === 'edit') {
      this.handleEdit(data, event, host);
      return;
    }

    if (data.mode === 'deleteConfirm') {
      this.handleDeleteConfirm(data, event, host);
      return;
    }

    this.handleRows(data, event, host);
  }

  /** Esc 逐级返回：确认层与编辑层先回进入前层级，行列表按 section 回上一层，types 关闭面板。 */
  private handleEscape(data: MemoryData, host: CommandHost): void {
    if (data.mode === 'deleteConfirm') {
      this.cancelDelete(data, host);
      return;
    }

    if (data.mode === 'edit') {
      this.cancelEdit(data, host);
      return;
    }

    if (data.section === 'types') {
      host.session.close();
      return;
    }

    if (data.section === 'user-list' || data.section === 'catalog-list') {
      this.update(host, this.createTypeDataFromCache(data.cache));
      return;
    }

    if (data.section === 'user-detail') {
      this.returnTo(data, 'user-list', host);
      return;
    }

    if (data.section === 'catalog-detail') {
      this.returnTo(data, 'catalog-list', host);
      return;
    }

    this.returnTo(data, 'catalog-detail', host);
  }

  /** 返回父层并尽量把焦点恢复到进入前的同一行。 */
  private returnTo(data: MemoryData, section: MemoryCommandSection, host: CommandHost): void {
    const leavingCatalogDetail = section === 'catalog-list';

    this.update(host, {
      ...data,
      section,
      mode: 'list',
      detailEntryId: undefined,
      error: undefined,
      ...(leavingCatalogDetail ? {selectedCatalog: undefined, agentItems: []} : {})
    }, data.focusId);
  }

  private cancelEdit(data: MemoryData, host: CommandHost): void {
    this.update(host, {
      ...data,
      section: data.editReturnSection || data.section,
      mode: 'list',
      draft: undefined,
      catalogDrafts: undefined,
      formIndex: undefined,
      editTarget: undefined,
      editingId: undefined,
      editReturnSection: undefined,
      error: undefined
    }, data.focusId);
  }

  private cancelDelete(data: MemoryData, host: CommandHost): void {
    this.update(host, {
      ...data,
      section: data.deleteReturnSection || data.section,
      mode: 'list',
      deleteTarget: undefined,
      deleteIndex: undefined,
      deleteReturnSection: undefined,
      deleteReturnIndex: undefined,
      error: undefined
    }, data.focusId);
  }

  private handleDeleteConfirm(data: MemoryData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const offset = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.update(host, {...data, deleteIndex: clampIndex((data.deleteIndex ?? DELETE_CANCEL_INDEX) + offset, DELETE_ROW_COUNT)});
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    const rows = rowsForDeleteConfirm(data);
    const row = rows[clampIndex(data.deleteIndex ?? DELETE_CANCEL_INDEX, rows.length)];

    if (row?.id === 'option:delete') {
      this.confirmDelete(data, host);
      return;
    }

    if (row?.id === 'option:cancel') {
      this.cancelDelete(data, host);
    }
  }

  private handleRows(data: MemoryData, event: InputEvent, host: CommandHost): void {
    const rows = getRows(data);

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const offset = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.update(host, {...data, selectedIndex: data.selectedIndex + offset, error: undefined});
      return;
    }

    const row = rows[clampIndex(data.selectedIndex, rows.length)];

    if (!row) {
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      this.toggleRow(data, row, host);
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    this.activateRow(data, row, host);
  }

  /** Enter 语义完全由行角色决定，避免同层出现查看与编辑两种隐含行为。 */
  private activateRow(data: MemoryData, row: MemoryCommandRow, host: CommandHost): void {
    if (data.section === 'types') {
      this.openType(data, row.id, host);
      return;
    }

    if (row.kind === 'toggle') {
      this.toggleRow(data, row, host);
      return;
    }

    if (row.kind === 'entry') {
      this.openEntry(data, row, host);
      return;
    }

    if (row.kind === 'action') {
      this.runAction(data, row, host);
    }
  }

  private openType(data: MemoryData, typeRowId: string, host: CommandHost): void {
    if (typeRowId === 'type:user') {
      this.update(host, {
        ...data,
        section: 'user-list',
        scope: undefined,
        memories: data.cache.memories,
        catalogs: [],
        agentItems: [],
        selectedIndex: 0,
        focusId: undefined,
        error: undefined
      });
      return;
    }

    const scope = typeRowId === 'type:global' ? 'global' : 'project';
    this.update(host, {
      ...data,
      section: 'catalog-list',
      scope,
      memories: [],
      catalogs: data.cache.catalogs.filter((catalog) => catalog.scope.kind === scope),
      agentItems: [],
      selectedIndex: 0,
      focusId: undefined,
      error: undefined
    });
  }

  private openEntry(data: MemoryData, row: MemoryCommandRow, host: CommandHost): void {
    const entryId = rowEntryId(row);

    if (!entryId) {
      return;
    }

    if (data.section === 'user-list') {
      this.update(host, {
        ...data,
        section: 'user-detail',
        detailEntryId: entryId,
        focusId: row.id,
        selectedIndex: 0,
        error: undefined
      });
      return;
    }

    if (data.section === 'catalog-list') {
      this.openCatalogDetail(data, entryId, row.id, host);
      return;
    }

    if (data.section === 'catalog-detail') {
      this.update(host, {
        ...data,
        section: 'item-detail',
        detailEntryId: entryId,
        focusId: row.id,
        selectedIndex: 0,
        error: undefined
      });
    }
  }

  private openCatalogDetail(data: MemoryData, catalogId: string, focusId: string, host: CommandHost): void {
    const catalog = data.catalogs.find((candidate) => candidate.id === catalogId);

    if (!catalog) {
      return;
    }

    const cachedItems = data.cache.itemsByCatalogId[catalog.id];
    const result = cachedItems
      ? {ok: true as const, memories: cachedItems}
      : host.memory.readAgentCatalog(catalog.name, catalog.scope.kind);

    this.update(host, {
      ...data,
      section: 'catalog-detail',
      selectedCatalog: catalog,
      agentItems: result.ok ? result.memories : [],
      selectedIndex: 0,
      focusId,
      ...(result.ok
        ? {cache: {...data.cache, itemsByCatalogId: {...data.cache.itemsByCatalogId, [catalog.id]: result.memories}}, error: undefined}
        : {error: result.error})
    });
  }

  private runAction(data: MemoryData, row: MemoryCommandRow, host: CommandHost): void {
    if (row.id === 'action:add-user') {
      this.beginEdit(data, {target: 'user', returnSection: 'user-list', focusId: row.id}, host);
      return;
    }

    if (row.id === 'action:edit-user') {
      const memory = data.memories.find((item) => item.id === data.detailEntryId);
      this.beginEdit(data, {
        target: 'user',
        editingId: memory?.id,
        text: memory?.content,
        returnSection: 'user-detail',
        focusId: row.id
      }, host);
      return;
    }

    if (row.id === 'action:add-item') {
      this.beginEdit(data, {target: 'item-new', returnSection: 'catalog-detail', focusId: row.id}, host);
      return;
    }

    if (row.id === 'action:edit-item') {
      const item = data.agentItems.find((candidate) => candidate.id === data.detailEntryId);
      this.beginEdit(data, {
        target: 'item-edit',
        editingId: item?.id,
        text: item?.content,
        returnSection: 'item-detail',
        focusId: row.id
      }, host);
      return;
    }

    if (row.id === 'action:add-catalog') {
      this.beginEdit(data, {
        target: 'catalog-new',
        catalogDrafts: [composer.createComposer(), composer.createComposer(), composer.createComposer()],
        returnSection: 'catalog-list',
        focusId: row.id
      }, host);
      return;
    }

    if (row.id === 'action:edit-catalog' && data.selectedCatalog) {
      this.beginEdit(data, {
        target: 'catalog-edit',
        editingId: data.selectedCatalog.id,
        catalogDrafts: [composer.createComposer(data.selectedCatalog.name), composer.createComposer(data.selectedCatalog.description)],
        returnSection: 'catalog-detail',
        focusId: row.id
      }, host);
      return;
    }

    this.beginDelete(data, row.id, row.id, host);
  }

  private beginEdit(data: MemoryData, options: {
    target: EditTarget; // 编辑器写入目标。
    editingId?: string; // 编辑已有条目时的稳定 id。
    text?: string; // 单字段编辑器的初始文本。
    catalogDrafts?: ComposerState[]; // catalog 表单的逐字段草稿。
    returnSection: MemoryCommandSection; // 保存或取消后返回的层级。
    focusId: string; // 进入编辑前的行 id。
  }, host: CommandHost): void {
    this.update(host, {
      ...data,
      mode: 'edit',
      editTarget: options.target,
      editingId: options.editingId,
      editReturnSection: options.returnSection,
      focusId: options.focusId,
      draft: options.catalogDrafts ? undefined : composer.createComposer(options.text || ''),
      catalogDrafts: options.catalogDrafts,
      formIndex: options.catalogDrafts ? 0 : undefined,
      error: undefined
    });
  }

  /** Space 与 toggle 行的 Enter 共用同一入口；只对启停语义的行生效。 */
  private toggleRow(data: MemoryData, row: MemoryCommandRow, host: CommandHost): void {
    if (row.kind === 'toggle') {
      if (data.section === 'user-detail' && data.detailEntryId) {
        this.toggleUserMemory(data, data.detailEntryId, host);
        return;
      }

      if (data.section === 'catalog-detail' && data.selectedCatalog) {
        this.toggleAgentCatalog(data, data.selectedCatalog.id, host);
        return;
      }

      if (data.section === 'item-detail' && data.detailEntryId) {
        this.toggleAgentItem(data, data.detailEntryId, host);
      }

      return;
    }

    if (row.kind !== 'entry') {
      return;
    }

    const entryId = rowEntryId(row);

    if (!entryId) {
      return;
    }

    if (data.section === 'user-list') {
      this.toggleUserMemory(data, entryId, host);
      return;
    }

    if (data.section === 'catalog-list') {
      this.toggleAgentCatalog(data, entryId, host);
      return;
    }

    if (data.section === 'catalog-detail') {
      this.toggleAgentItem(data, entryId, host);
    }
  }

  private handleEdit(data: MemoryData, event: InputEvent, host: CommandHost): void {
    if (data.catalogDrafts) {
      this.handleCatalogForm(data, event, host);
      return;
    }

    const draft = data.draft || composer.createComposer();

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.saveEdit(data, draft, host);
      return;
    }

    if (event.type === INPUT_EVENTS.INSERT_NEWLINE) {
      composer.insertNewline(draft);
    } else if (event.type === INPUT_EVENTS.MOVE_UP) {
      composer.moveUp(draft);
    } else if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      composer.moveDown(draft);
    } else if (!composer.applyComposerEditEvent(draft, event)) {
      return;
    }

    this.update(host, {...data, draft, error: undefined});
  }

  /** 普通编辑器只处理 user memory 和 agent item；catalog 由独立表单提前接管。 */
  private saveEdit(data: MemoryData, draft: ComposerState, host: CommandHost): void {
    if (data.editTarget === 'user') {
      this.saveUserMemory(data, draft, host);
      return;
    }

    this.saveAgentItem(data, draft, host);
  }

  private handleCatalogForm(data: MemoryData, event: InputEvent, host: CommandHost): void {
    const drafts = data.catalogDrafts || [];
    const formIndex = data.formIndex || 0;
    const draft = drafts[formIndex];

    if (!draft) return;
    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.saveCatalogForm(data, host);
      return;
    }
    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const offset = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.update(host, {...data, formIndex: Math.min(Math.max(0, formIndex + offset), drafts.length - 1), error: undefined});
      return;
    }
    if (event.type === INPUT_EVENTS.INSERT_NEWLINE) composer.insertNewline(draft);
    else if (!composer.applyComposerEditEvent(draft, event)) return;
    this.update(host, {...data, catalogDrafts: drafts, error: undefined});
  }

  private saveCatalogForm(data: MemoryData, host: CommandHost): void {
    const values = (data.catalogDrafts || []).map(composer.getText);

    if (data.editTarget === 'catalog-new') {
      const result = host.memory.addAgentMemory({catalog: values[0] || '', description: values[1] || '', content: values[2] || '', scope: data.scope});
      if (!result.ok) { this.update(host, {...data, error: result.error}); return; }
      const cache = result.catalog && result.memories
        ? {...data.cache, itemsByCatalogId: {...data.cache.itemsByCatalogId, [result.catalog.id]: result.memories}}
        : data.cache;
      this.refreshCatalogs({...data, cache}, host, {selectedId: result.catalog?.id, section: 'catalog-list'});
      return;
    }

    if (!data.selectedCatalog) return;
    const result = host.memory.updateAgentCatalog(data.selectedCatalog.name, {name: values[0] || '', description: values[1] || ''}, data.scope);
    if (!result.ok) { this.update(host, {...data, error: result.error}); return; }
    this.refreshCatalogs(data, host, {selectedId: result.catalog?.id, section: data.editReturnSection || 'catalog-detail'});
  }

  private saveUserMemory(data: MemoryData, draft: ComposerState, host: CommandHost): void {
    const text = composer.getText(draft);
    const editingId = data.editingId;
    const result = editingId
      ? host.memory.update(editingId, text)
      : host.memory.create(text);

    if (!result.ok) {
      this.update(host, {...data, draft, error: result.error});
      return;
    }

    const section = data.editReturnSection || 'user-list';
    const saved = editingId
      ? result.memories.find((item) => item.id === editingId)
      : result.memories[result.memories.length - 1];

    this.update(host, {
      ...data,
      memories: result.memories,
      cache: {...data.cache, memories: result.memories},
      section,
      mode: 'list',
      detailEntryId: editingId ? data.detailEntryId : undefined,
      selectedIndex: 0,
      draft: undefined,
      catalogDrafts: undefined,
      formIndex: undefined,
      editTarget: undefined,
      editingId: undefined,
      editReturnSection: undefined,
      error: undefined
    }, editingId ? 'toggle:enabled' : saved ? `entry:${saved.id}` : undefined);
  }

  private saveAgentItem(data: MemoryData, draft: ComposerState, host: CommandHost): void {
    if (!data.selectedCatalog) {
      return;
    }

    const text = composer.getText(draft);
    const editingId = data.editTarget === 'item-edit' ? data.editingId : undefined;
    const result = editingId
      ? host.memory.updateAgentItem(data.selectedCatalog.name, editingId, text, data.scope)
      : host.memory.addAgentMemory({catalog: data.selectedCatalog.name, content: text, scope: data.scope});

    if (!result.ok) {
      this.update(host, {...data, draft, error: result.error});
      return;
    }

    const memories = result.memories || [];
    const saved = editingId
      ? memories.find((item) => item.id === editingId)
      : memories[memories.length - 1];

    this.update(host, {
      ...data,
      selectedCatalog: result.catalog || data.selectedCatalog,
      agentItems: memories,
      cache: {...data.cache, itemsByCatalogId: {...data.cache.itemsByCatalogId, [data.selectedCatalog.id]: memories}},
      section: data.editReturnSection || 'catalog-detail',
      mode: 'list',
      detailEntryId: editingId ? data.detailEntryId : undefined,
      selectedIndex: 0,
      draft: undefined,
      catalogDrafts: undefined,
      formIndex: undefined,
      editTarget: undefined,
      editingId: undefined,
      editReturnSection: undefined,
      error: undefined
    }, editingId ? 'toggle:enabled' : saved ? `entry:${saved.id}` : undefined);
  }

  private beginDelete(data: MemoryData, actionId: string, focusId: string, host: CommandHost): void {
    const target = this.resolveDeleteTarget(data, actionId);

    if (!target) {
      return;
    }

    this.update(host, {
      ...data,
      mode: 'deleteConfirm',
      deleteTarget: target,
      deleteIndex: DELETE_CANCEL_INDEX,
      deleteReturnSection: data.section,
      deleteReturnIndex: this.resolveDeleteIndex(data, target),
      focusId,
      error: undefined
    });
  }

  private resolveDeleteTarget(data: MemoryData, actionId: string): MemoryDeleteTarget | undefined {
    if (actionId === 'action:delete-user' && data.detailEntryId) {
      return {kind: 'user', id: data.detailEntryId};
    }

    if (actionId === 'action:delete-item' && data.detailEntryId) {
      return {kind: 'item', id: data.detailEntryId};
    }

    if (actionId === 'action:delete-catalog' && data.selectedCatalog) {
      return {kind: 'catalog', id: data.selectedCatalog.id};
    }

    return undefined;
  }

  private resolveDeleteIndex(data: MemoryData, target: MemoryDeleteTarget): number {
    if (target.kind === 'user') return data.memories.findIndex((item) => item.id === target.id);
    if (target.kind === 'item') return data.agentItems.findIndex((item) => item.id === target.id);
    return data.catalogs.findIndex((item) => item.id === target.id);
  }

  private confirmDelete(data: MemoryData, host: CommandHost): void {
    const target = data.deleteTarget;

    if (!target) {
      this.cancelDelete(data, host);
      return;
    }

    if (target.kind === 'user') {
      this.deleteUserMemory(data, target.id, host);
      return;
    }

    if (target.kind === 'catalog') {
      this.deleteCatalog(data, target.id, host);
      return;
    }

    this.deleteAgentItem(data, target.id, host);
  }

  private deleteUserMemory(data: MemoryData, id: string, host: CommandHost): void {
    const result = host.memory.delete(id);

    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    this.update(host, {
      ...data,
      section: 'user-list',
      mode: 'list',
      memories: result.memories,
      cache: {...data.cache, memories: result.memories},
      detailEntryId: undefined,
      selectedIndex: data.deleteReturnIndex ?? 0,
      deleteTarget: undefined,
      deleteIndex: undefined,
      deleteReturnSection: undefined,
      deleteReturnIndex: undefined,
      error: undefined
    });
  }

  private deleteCatalog(data: MemoryData, id: string, host: CommandHost): void {
    const catalog = data.catalogs.find((item) => item.id === id);

    if (!catalog) {
      this.cancelDelete(data, host);
      return;
    }

    const result = host.memory.removeAgentCatalog(catalog.name, data.scope);

    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    this.refreshCatalogs({...data, detailEntryId: undefined, selectedCatalog: undefined, agentItems: []}, host, {
      section: 'catalog-list',
      selectedIndex: data.deleteReturnIndex ?? 0
    });
  }

  private deleteAgentItem(data: MemoryData, id: string, host: CommandHost): void {
    if (!data.selectedCatalog) {
      return;
    }

    const result = host.memory.removeAgentItem(data.selectedCatalog.name, id, data.scope);

    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    if (result.removedCatalog) {
      this.refreshCatalogs({...data, detailEntryId: undefined, selectedCatalog: undefined, agentItems: []}, host, {
        section: 'catalog-list',
        selectedIndex: data.deleteReturnIndex ?? 0
      });
      return;
    }

    const memories = result.memories || [];
    const nextIndex = Math.min(Math.max(0, data.deleteReturnIndex ?? 0), Math.max(0, memories.length - 1));

    this.update(host, {
      ...data,
      section: 'catalog-detail',
      mode: 'list',
      agentItems: memories,
      cache: {...data.cache, itemsByCatalogId: {...data.cache.itemsByCatalogId, [data.selectedCatalog.id]: memories}},
      detailEntryId: undefined,
      selectedIndex: CATALOG_DETAIL_HEADER_ROWS + nextIndex,
      deleteTarget: undefined,
      deleteIndex: undefined,
      deleteReturnSection: undefined,
      deleteReturnIndex: undefined,
      error: undefined
    });
  }

  private toggleUserMemory(data: MemoryData, id: string, host: CommandHost): void {
    const selected = data.memories.find((item) => item.id === id);

    if (!selected) {
      return;
    }

    const result = host.memory.setEnabled(selected.id, !selected.enabled);
    this.update(host, result.ok
      ? {...data, memories: result.memories, cache: {...data.cache, memories: result.memories}, error: undefined}
      : {...data, error: result.error});
  }

  private toggleAgentCatalog(data: MemoryData, id: string, host: CommandHost): void {
    const selected = data.catalogs.find((item) => item.id === id);

    if (!selected) {
      return;
    }

    const result = host.memory.setAgentCatalogEnabled(selected.name, !selected.enabled, selected.scope.kind);
    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    const catalog = result.catalog || result.catalogs.find((item) => item.id === selected.id);
    if (!catalog) {
      this.update(host, {...data, error: 'agent memory catalog 启停结果无效'});
      return;
    }

    const replaceCatalog = (item: AgentMemoryCatalog): AgentMemoryCatalog => item.id === catalog.id ? catalog : item;
    this.update(host, {
      ...data,
      catalogs: data.catalogs.map(replaceCatalog),
      selectedCatalog: data.selectedCatalog?.id === catalog.id ? catalog : data.selectedCatalog,
      cache: {...data.cache, catalogs: data.cache.catalogs.map(replaceCatalog)},
      error: undefined
    });
  }

  private toggleAgentItem(data: MemoryData, id: string, host: CommandHost): void {
    const selected = data.agentItems.find((item) => item.id === id);

    if (!selected || !data.selectedCatalog) {
      return;
    }

    const result = host.memory.setAgentItemEnabled(data.selectedCatalog.name, selected.id, !selected.enabled, data.selectedCatalog.scope.kind);
    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    if (!result.memories) {
      this.update(host, {...data, error: 'agent memory item 启停结果无效'});
      return;
    }

    this.update(host, {
      ...data,
      agentItems: result.memories,
      cache: {...data.cache, itemsByCatalogId: {...data.cache.itemsByCatalogId, [data.selectedCatalog.id]: result.memories}},
      error: undefined
    });
  }

  /** catalog 写入后重新读取索引，确保 rename、删除和 scope 筛选使用持久化后的事实。 */
  private refreshCatalogs(data: MemoryData, host: CommandHost, options: {selectedId?: string; section?: MemoryCommandSection; selectedIndex?: number} = {}): void {
    const result = host.memory.listAgentCatalogs();

    if (!result.ok) {
      this.update(host, {...data, section: options.section || 'catalog-list', mode: 'list', error: result.error});
      return;
    }

    const catalogs = result.catalogs.filter((catalog) => catalog.scope.kind === data.scope);
    const catalogIds = new Set(result.catalogs.map((catalog) => catalog.id));
    const itemsByCatalogId = Object.fromEntries(Object.entries(data.cache.itemsByCatalogId).filter(([id]) => catalogIds.has(id)));
    const section = options.section || 'catalog-list';
    const selected = options.selectedId ? catalogs.find((catalog) => catalog.id === options.selectedId) : undefined;
    const detail = section === 'catalog-detail';
    const focusId = !detail && selected ? `entry:${selected.id}` : undefined;

    this.update(host, {
      ...data,
      section,
      catalogs,
      cache: {...data.cache, catalogs: result.catalogs, itemsByCatalogId},
      selectedCatalog: detail ? selected : undefined,
      agentItems: detail && selected ? itemsByCatalogId[selected.id] || [] : [],
      selectedIndex: options.selectedIndex ?? 0,
      mode: 'list',
      detailEntryId: undefined,
      draft: undefined,
      catalogDrafts: undefined,
      formIndex: undefined,
      editTarget: undefined,
      editingId: undefined,
      editReturnSection: undefined,
      deleteTarget: undefined,
      deleteIndex: undefined,
      deleteReturnSection: undefined,
      deleteReturnIndex: undefined,
      error: undefined
    }, focusId);
  }

  /** 焦点优先按行 id 恢复；行已不存在时保留调用方给出的钳制索引。 */
  private update(host: CommandHost, data: MemoryData, focusId?: string): void {
    const next = normalizeData(data);

    if (focusId) {
      const index = getRows(next).findIndex((row) => row.id === focusId);

      if (index >= 0) {
        next.selectedIndex = index;
      }
    }

    host.session.update({surface: createMemorySurface(next), data: next});
  }

  /** 一级菜单需读取各 catalog 的 item，统计值不依赖未持久化的 session 列表。 */
  private loadTypeData(host: CommandHost): MemoryData {
    const userResult = host.memory.list();
    const catalogResult = host.memory.listAgentCatalogs();
    const itemCounts: MemoryItemCounts = {
      user: userResult.ok ? userResult.memories.length : 0,
      global: 0,
      project: 0
    };
    let error = userResult.ok ? undefined : userResult.error;
    const itemsByCatalogId: Record<string, AgentMemoryItem[]> = {};

    if (catalogResult.ok) {
      for (const catalog of catalogResult.catalogs) {
        const result = host.memory.readAgentCatalog(catalog.name, catalog.scope.kind);

        if (!result.ok) {
          error = error || result.error;
          continue;
        }

        itemCounts[catalog.scope.kind] += result.memories.length;
        itemsByCatalogId[catalog.id] = result.memories;
      }
    } else {
      error = error || catalogResult.error;
    }

    const cache: MemoryCache = {
      memories: userResult.ok ? userResult.memories : [],
      catalogs: catalogResult.ok ? catalogResult.catalogs : [],
      itemsByCatalogId
    };
    return normalizeData({...createTypeData(), itemCounts, cache, ...(error ? {error} : {})});
  }

  private createTypeDataFromCache(cache: MemoryCache): MemoryData {
    const itemCounts: MemoryItemCounts = {user: cache.memories.length, global: 0, project: 0};
    for (const catalog of cache.catalogs) {
      itemCounts[catalog.scope.kind] += cache.itemsByCatalogId[catalog.id]?.length || 0;
    }
    return normalizeData({...createTypeData(), cache, itemCounts});
  }
}

export {createMemorySurface};
