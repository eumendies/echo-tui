import {INPUT_EVENTS} from '../input/event-types';
import * as composer from '../input/composer';

import type {ComposerState} from '../types/composer';
import type {CommandHandler, CommandHost, CommandSession, MemoryCatalogForm, MemoryCommandSection, MemoryCommandSurface, MemoryCommandSurfaceMode, MemoryItemCounts} from '../types/command';
import type {InputEvent} from '../types/input';
import type {AgentMemoryCatalog, AgentMemoryItem, AgentMemoryScope, UserMemory} from '../types/memory';

type EditTarget = 'user' | 'catalog-new' | 'catalog-edit' | 'item-new' | 'item-edit';
type MemoryCache = {
  memories: UserMemory[];
  catalogs: AgentMemoryCatalog[];
  itemsByCatalogId: Record<string, AgentMemoryItem[]>;
};

type MemoryData = {
  section: MemoryCommandSection;
  scope?: AgentMemoryScope['kind'];
  memories: UserMemory[];
  catalogs: AgentMemoryCatalog[];
  agentItems: AgentMemoryItem[];
  itemCounts: MemoryItemCounts;
  cache: MemoryCache;
  selectedCatalog?: AgentMemoryCatalog;
  selectedIndex: number;
  mode: MemoryCommandSurfaceMode;
  draft?: ComposerState;
  catalogDrafts?: ComposerState[];
  formIndex?: number;
  editTarget?: EditTarget;
  editingId?: string;
  error?: string;
};

function createMemorySurface(data: MemoryData): MemoryCommandSurface {
  return {
    kind: 'memory',
    title: createTitle(data),
    mode: data.mode,
    section: data.section,
    scope: data.scope,
    memories: data.memories.map((item) => ({...item})),
    catalogs: data.catalogs.map(cloneCatalog),
    agentItems: data.agentItems.map((item) => ({...item})),
    itemCounts: {...data.itemCounts},
    ...(data.selectedCatalog ? {selectedCatalog: cloneCatalog(data.selectedCatalog)} : {}),
    selectedIndex: data.selectedIndex,
    ...(data.draft ? {editText: composer.getText(data.draft), editCursor: data.draft.cursor} : {}),
    ...(data.catalogDrafts ? {catalogForm: createCatalogForm(data)} : {}),
    ...(data.error ? {error: data.error} : {}),
    dismissHint: createDismissHint(data)
  };
}

function createTitle(data: MemoryData): string {
  if (data.editTarget === 'catalog-new') return `NEW CATALOG · ${data.scope || 'project'}`;
  if (data.editTarget === 'catalog-edit') return `EDIT CATALOG · ${data.scope || 'project'}`;
  if (data.section === 'user') return 'USER MEMORIES';
  if (data.section === 'catalogs') return `AGENT CATALOGS · ${data.scope || 'project'}`;
  if (data.section === 'items') return `CATALOG · ${data.selectedCatalog?.name || 'UNKNOWN'}`;
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

function createDismissHint(data: MemoryData): string {
  if (data.mode === 'edit') {
    if (data.editTarget === 'catalog-new') {
      return '↑/↓ 切换字段 · Enter 保存 · Ctrl+J 换行 · Esc 取消';
    }

    if (data.editTarget === 'catalog-edit') {
      return '↑/↓ 切换字段 · Enter 保存 · Ctrl+J 换行 · Esc 取消';
    }

    return '编辑 memory · Enter 保存 · Ctrl+J 换行 · Esc 取消';
  }

  if (data.mode === 'deleteConfirm') {
    return 'Enter 确认删除 · Esc 返回';
  }

  if (data.section === 'types') {
    return '↑/↓ 选择 · Enter 打开 · Esc 关闭';
  }

  if (data.section === 'user') {
    return '↑/↓ 选择 · Space 启停 · Enter/e 编辑 · a 新增 · d 删除 · Esc 返回';
  }

  if (data.section === 'catalogs') {
    return '↑/↓ 选择 · Space 启停 · Enter 查看 · a 新增 · e 编辑 · d 删除 · Esc 返回';
  }

  return '↑/↓ 选择 · Space 启停 · Enter/e 编辑 · a 新增 · d 删除 · Esc 返回';
}

/** 复制 session 数据并钳制选择位置，避免删除或刷新后索引越界。 */
function normalizeData(data: MemoryData): MemoryData {
  const length = getSectionLength(data);
  const selectedIndex = length === 0
    ? 0
    : Math.min(Math.max(0, data.selectedIndex), length - 1);

  return {
    ...data,
    selectedIndex,
    memories: data.memories.map((item) => ({...item})),
    catalogs: data.catalogs.map(cloneCatalog),
    agentItems: data.agentItems.map((item) => ({...item})),
    itemCounts: {...data.itemCounts},
    cache: cloneCache(data.cache),
    ...(data.draft ? {draft: {chars: [...data.draft.chars], cursor: data.draft.cursor}} : {})
    ,...(data.catalogDrafts ? {catalogDrafts: data.catalogDrafts.map((draft) => ({chars: [...draft.chars], cursor: draft.cursor}))} : {})
  };
}

function getSectionLength(data: MemoryData): number {
  if (data.section === 'types') {
    return 3;
  }

  if (data.section === 'user') {
    return data.memories.length;
  }

  if (data.section === 'catalogs') {
    return data.catalogs.length;
  }

  return data.agentItems.length;
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
    return text.trim() === '/memory';
  }

  start(_text: string, host: CommandHost): void {
    const data = this.loadTypeData(host);
    host.composer.reset();
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
      if (event.type === INPUT_EVENTS.SUBMIT) {
        this.confirmDelete(data, host);
      }
      return;
    }

    this.handleList(data, event, host);
  }

  /** Esc 先关闭 modal，再按 item → catalog → type 层级返回。 */
  private handleEscape(data: MemoryData, host: CommandHost): void {
    if (data.mode !== 'list') {
      this.update(host, {
        ...data,
        mode: 'list',
        draft: undefined,
        catalogDrafts: undefined,
        formIndex: undefined,
        editTarget: undefined,
        editingId: undefined,
        error: undefined
      });
      return;
    }

    if (data.section === 'items') {
      this.update(host, {
        ...data,
        section: 'catalogs',
        agentItems: [],
        selectedCatalog: undefined,
        selectedIndex: 0
      });
      return;
    }

    if (data.section !== 'types') {
      this.update(host, this.createTypeDataFromCache(data.cache));
      return;
    }

    host.session.close();
    host.composer.reset();
  }

  private handleList(data: MemoryData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const offset = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.update(host, {...data, selectedIndex: data.selectedIndex + offset, error: undefined});
      return;
    }

    if (data.section === 'types') {
      if (event.type === INPUT_EVENTS.SUBMIT) {
        this.openType(data, host);
      }
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'a') {
      this.beginCreate(data, host);
      return;
    }

    if (data.section === 'user' && event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      this.toggleSelectedUserMemory(data, host);
      return;
    }

    if (data.section === 'catalogs' && event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      this.toggleSelectedAgentCatalog(data, host);
      return;
    }

    if (data.section === 'items' && event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      this.toggleSelectedAgentItem(data, host);
      return;
    }

    const selected = this.getSelected(data);
    if (!selected) {
      return;
    }

    if (data.section === 'catalogs' && event.type === INPUT_EVENTS.SUBMIT) {
      this.openCatalog(data, selected as AgentMemoryCatalog, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT || (event.type === INPUT_EVENTS.TEXT && event.value === 'e')) {
      this.beginEdit(data, selected, host);
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'd') {
      this.update(host, {...data, mode: 'deleteConfirm', error: undefined});
    }
  }

  private openType(data: MemoryData, host: CommandHost): void {
    if (data.selectedIndex === 0) {
      this.update(host, {
        ...data,
        section: 'user',
        memories: data.cache.memories,
        catalogs: [],
        agentItems: [],
        selectedIndex: 0,
        mode: 'list'
      });
      return;
    }

    const scope = data.selectedIndex === 1 ? 'global' : 'project';
    this.update(host, {
      ...data,
      section: 'catalogs',
      scope,
      memories: [],
      catalogs: data.cache.catalogs.filter((catalog) => catalog.scope.kind === scope),
      agentItems: [],
      selectedIndex: 0,
      mode: 'list'
    });
  }

  private openCatalog(data: MemoryData, catalog: AgentMemoryCatalog, host: CommandHost): void {
    const cachedItems = data.cache.itemsByCatalogId[catalog.id];
    const result = cachedItems
      ? {ok: true as const, memories: cachedItems}
      : host.memory.readAgentCatalog(catalog.name, catalog.scope.kind);
    this.update(host, {
      ...data,
      section: 'items',
      selectedCatalog: catalog,
      agentItems: result.ok ? result.memories : [],
      selectedIndex: 0,
      ...(result.ok ? {error: undefined} : {error: result.error})
    });
  }

  private beginCreate(data: MemoryData, host: CommandHost): void {
    if (data.section === 'catalogs') {
      this.beginCatalogForm(data, 'catalog-new', [composer.createComposer(), composer.createComposer(), composer.createComposer()], host);
      return;
    }

    const editTarget = data.section === 'user'
      ? 'user'
      : 'item-new';
    this.update(host, {
      ...data,
      mode: 'edit',
      editTarget,
      draft: composer.createComposer(),
      editingId: undefined,
      error: undefined
    });
  }

  private beginEdit(data: MemoryData, selected: UserMemory | AgentMemoryCatalog | AgentMemoryItem, host: CommandHost): void {
    if (data.section === 'catalogs') {
      const catalog = selected as AgentMemoryCatalog;
      this.beginCatalogForm(data, 'catalog-edit', [composer.createComposer(catalog.name), composer.createComposer(catalog.description)], host, catalog.id);
      return;
    }

    const editTarget = data.section === 'user'
      ? 'user'
      : 'item-edit';
    const text = (selected as UserMemory | AgentMemoryItem).content;
    this.update(host, {
      ...data,
      mode: 'edit',
      editTarget,
      draft: composer.createComposer(text),
      editingId: selected.id,
      error: undefined
    });
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

  /** catalog 表单以独立 composer 保存每个字段，避免通过文本换行编码字段边界。 */
  private beginCatalogForm(data: MemoryData, editTarget: 'catalog-new' | 'catalog-edit', catalogDrafts: ComposerState[], host: CommandHost, editingId?: string): void {
    this.update(host, {...data, mode: 'edit', editTarget, catalogDrafts, formIndex: 0, draft: undefined, editingId, error: undefined});
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
      this.refreshCatalogs({...data, cache}, host, result.catalog?.id);
      return;
    }
    if (!data.selectedCatalog) return;
    const result = host.memory.updateAgentCatalog(data.selectedCatalog.name, {name: values[0] || '', description: values[1] || ''}, data.scope);
    if (!result.ok) { this.update(host, {...data, error: result.error}); return; }
    this.refreshCatalogs(data, host, result.catalog?.id);
  }

  private saveUserMemory(data: MemoryData, draft: ComposerState, host: CommandHost): void {
    const text = composer.getText(draft);
    const result = data.editingId
      ? host.memory.update(data.editingId, text)
      : host.memory.create(text);

    if (!result.ok) {
      this.update(host, {...data, draft, error: result.error});
      return;
    }

    const selectedIndex = data.editingId
      ? Math.max(0, result.memories.findIndex((item) => item.id === data.editingId))
      : result.memories.length - 1;
    this.update(host, {
      ...data,
      memories: result.memories,
      cache: {...data.cache, memories: result.memories},
      selectedIndex,
      mode: 'list',
      draft: undefined,
      catalogDrafts: undefined,
      formIndex: undefined,
      editTarget: undefined,
      editingId: undefined,
      error: undefined
    });
  }

  private saveAgentItem(data: MemoryData, draft: ComposerState, host: CommandHost): void {
    if (!data.selectedCatalog) {
      return;
    }

    const text = composer.getText(draft);
    const result = data.editTarget === 'item-edit' && data.editingId
      ? host.memory.updateAgentItem(data.selectedCatalog.name, data.editingId, text, data.scope)
      : host.memory.addAgentMemory({catalog: data.selectedCatalog.name, content: text, scope: data.scope});

    if (!result.ok) {
      this.update(host, {...data, draft, error: result.error});
      return;
    }

    const memories = result.memories || [];
    const selectedIndex = data.editingId
      ? Math.max(0, memories.findIndex((item) => item.id === data.editingId))
      : Math.max(0, memories.length - 1);
    this.update(host, {
      ...data,
      selectedCatalog: result.catalog || data.selectedCatalog,
      agentItems: memories,
      cache: {...data.cache, itemsByCatalogId: {...data.cache.itemsByCatalogId, [data.selectedCatalog.id]: memories}},
      selectedIndex,
      mode: 'list',
      draft: undefined,
      editTarget: undefined,
      editingId: undefined,
      error: undefined
    });
  }

  private confirmDelete(data: MemoryData, host: CommandHost): void {
    const selected = this.getSelected(data);

    if (!selected) {
      this.update(host, {...data, mode: 'list'});
      return;
    }

    if (data.section === 'user') {
      this.deleteUserMemory(data, selected as UserMemory, host);
      return;
    }

    if (data.section === 'catalogs') {
      this.deleteCatalog(data, selected as AgentMemoryCatalog, host);
      return;
    }

    this.deleteAgentItem(data, selected as AgentMemoryItem, host);
  }

  private deleteUserMemory(data: MemoryData, selected: UserMemory, host: CommandHost): void {
    const result = host.memory.delete(selected.id);

    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    this.update(host, {...data, memories: result.memories, cache: {...data.cache, memories: result.memories}, mode: 'list', error: undefined});
  }

  private deleteCatalog(data: MemoryData, selected: AgentMemoryCatalog, host: CommandHost): void {
    const result = host.memory.removeAgentCatalog(selected.name, data.scope);

    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    this.refreshCatalogs(data, host);
  }

  private deleteAgentItem(data: MemoryData, selected: AgentMemoryItem, host: CommandHost): void {
    if (!data.selectedCatalog) {
      return;
    }

    const result = host.memory.removeAgentItem(data.selectedCatalog.name, selected.id, data.scope);

    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    if (result.removedCatalog) {
      this.refreshCatalogs({...data, section: 'catalogs'}, host);
      return;
    }

    const memories = result.memories || [];
    this.update(host, {
      ...data,
      agentItems: memories,
      cache: {...data.cache, itemsByCatalogId: {...data.cache.itemsByCatalogId, [data.selectedCatalog.id]: memories}},
      mode: 'list',
      error: undefined
    });
  }

  private toggleSelectedUserMemory(data: MemoryData, host: CommandHost): void {
    const selected = data.memories[data.selectedIndex];

    if (!selected) {
      return;
    }

    const result = host.memory.setEnabled(selected.id, !selected.enabled);
    this.update(host, result.ok
      ? {...data, memories: result.memories, cache: {...data.cache, memories: result.memories}, error: undefined}
      : {...data, error: result.error});
  }

  private toggleSelectedAgentCatalog(data: MemoryData, host: CommandHost): void {
    const selected = data.catalogs[data.selectedIndex];

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
      cache: {...data.cache, catalogs: data.cache.catalogs.map(replaceCatalog)},
      error: undefined
    });
  }

  private toggleSelectedAgentItem(data: MemoryData, host: CommandHost): void {
    const selected = data.agentItems[data.selectedIndex];

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
  private refreshCatalogs(data: MemoryData, host: CommandHost, selectedId?: string): void {
    const result = host.memory.listAgentCatalogs();

    if (!result.ok) {
      this.update(host, {...data, mode: 'list', error: result.error});
      return;
    }

    const catalogs = result.catalogs.filter((catalog) => catalog.scope.kind === data.scope);
    const catalogIds = new Set(result.catalogs.map((catalog) => catalog.id));
    const itemsByCatalogId = Object.fromEntries(Object.entries(data.cache.itemsByCatalogId).filter(([id]) => catalogIds.has(id)));
    const selectedIndex = selectedId
      ? Math.max(0, catalogs.findIndex((catalog) => catalog.id === selectedId))
      : data.selectedIndex;
    this.update(host, {
      ...data,
      section: 'catalogs',
      catalogs,
      cache: {...data.cache, catalogs: result.catalogs, itemsByCatalogId},
      agentItems: [],
      selectedCatalog: undefined,
      selectedIndex,
      mode: 'list',
      draft: undefined,
      editTarget: undefined,
      editingId: undefined,
      error: undefined
    });
  }

  private getSelected(data: MemoryData): UserMemory | AgentMemoryCatalog | AgentMemoryItem | undefined {
    if (data.section === 'user') {
      return data.memories[data.selectedIndex];
    }

    if (data.section === 'catalogs') {
      return data.catalogs[data.selectedIndex];
    }

    return data.agentItems[data.selectedIndex];
  }

  private update(host: CommandHost, data: MemoryData): void {
    const next = normalizeData(data);
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

export {createMemorySurface};
