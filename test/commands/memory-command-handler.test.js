const assert = require('node:assert/strict');
const test = require('node:test');

const {MemoryCommandHandler} = require('../../src/commands/memory-command-handler');
const {renderMemorySurface} = require('../../src/render/footer/memory-surface');
const {DEFAULT_TUI_THEME} = require('../../src/config/theme-config');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {displayWidth, safeRenderWidth} = require('../../src/render/layout');

function createMemory(id, content) {
  return {id, content, enabled: true, createdAt: '2026-07-12T07:00:00.000Z', updatedAt: '2026-07-12T07:00:00.000Z'};
}

function createHost(initialMemories = [], options = {}) {
  const calls = {created: [], updated: [], deleted: []};
  let memories = initialMemories.map((memory) => ({...memory}));
  let activeSession = null;
  const host = {
    memory: {
      list() {
        return options.listResult || {ok: true, memories: memories.map((memory) => ({...memory}))};
      },
      create(content) {
        calls.created.push(content);
        if (options.createResult) {
          return options.createResult;
        }
        memories = [...memories, createMemory(`memory-${memories.length + 1}`, content.trim())];
        return {ok: true, memories: memories.map((memory) => ({...memory}))};
      },
      update(id, content) {
        calls.updated.push({id, content});
        if (options.updateResult) {
          return options.updateResult;
        }
        memories = memories.map((memory) => memory.id === id ? {...memory, content: content.trim()} : memory);
        return {ok: true, memories: memories.map((memory) => ({...memory}))};
      },
      setEnabled(id, enabled) {
        memories = memories.map((memory) => memory.id === id ? {...memory, enabled} : memory);
        return {ok: true, memories: memories.map((memory) => ({...memory}))};
      },
      delete(id) {
        calls.deleted.push(id);
        if (options.deleteResult) {
          return options.deleteResult;
        }
        memories = memories.filter((memory) => memory.id !== id);
        return {ok: true, memories: memories.map((memory) => ({...memory}))};
      },
      listAgentCatalogs() { return {ok: true, catalogs: []}; },
      readAgentCatalog() { return {ok: false, error: 'missing'}; },
      addAgentMemory() { return {ok: false, error: 'unsupported'}; },
      updateAgentCatalog() { return {ok: false, error: 'unsupported'}; },
      setAgentCatalogEnabled() { return {ok: false, error: 'unsupported'}; },
      updateAgentItem() { return {ok: false, error: 'unsupported'}; },
      setAgentItemEnabled() { return {ok: false, error: 'unsupported'}; },
      removeAgentCatalog() { return {ok: false, error: 'unsupported'}; },
      removeAgentItem() { return {ok: false, error: 'unsupported'}; }
    },
    session: {
      open(session) {
        activeSession = session;
      },
      update(patch) {
        activeSession = {...activeSession, ...patch};
      },
      close() {
        activeSession = null;
      },
      getActive() {
        return activeSession;
      }
    }
  };

  return {calls, host};
}

function start(handler, host) {
  handler.start('/memory', host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  return host.session.getActive();
}

test('/memory supports multiline create, edit cancellation, and delete confirmation', () => {
  const handler = new MemoryCommandHandler();
  const {calls, host} = createHost([createMemory('memory-1', '已有内容')]);
  let session = start(handler, host);

  assert.equal(session.surface.kind, 'memory');
  assert.equal(session.surface.mode, 'list');
  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'a'}, host);
  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: '第一行'}, host);
  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.INSERT_NEWLINE}, host);
  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: '第二行'}, host);
  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);

  assert.deepEqual(calls.created, ['第一行\n第二行']);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'list');
  assert.equal(session.surface.memories.length, 2);

  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'e'}, host);
  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: '不会保存'}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.ESCAPE}, host);
  assert.deepEqual(calls.updated, []);

  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'd'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'deleteConfirm');
  handler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);
  assert.deepEqual(calls.deleted, ['memory-2']);
  assert.equal(host.session.getActive().surface.memories.length, 1);
});

test('/memory keeps the edit draft open when persistence fails', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost([], {createResult: {ok: false, error: 'disk full'}});
  let session = start(handler, host);

  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'a'}, host);
  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: '内容'}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  session = host.session.getActive();

  assert.equal(session.surface.mode, 'edit');
  assert.equal(session.surface.editText, '内容');
  assert.match(session.surface.error, /disk full/);
});

test('/memory moves the multiline edit cursor with Up and Down', () => {
  const handler = new MemoryCommandHandler();
  const {calls, host} = createHost();
  let session = start(handler, host);

  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'a'}, host);
  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: '第一行\n第二行'}, host);
  session = host.session.getActive();
  handler.handleEvent(session, {type: INPUT_EVENTS.MOVE_UP}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editCursor, 3);

  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'X'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editText, '第一行X\n第二行');
  handler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editCursor, 8);

  handler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);
  assert.deepEqual(calls.created, ['第一行X\n第二行']);
});

test('/memory toggles the selected entry with Space', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost([createMemory('memory-1', '可停用')]);
  const session = start(handler, host);

  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: ' '}, host);

  assert.equal(host.session.getActive().surface.memories[0].enabled, false);
});

test('/memory browses scoped agent catalogs and adds an item', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost();
  let catalog = {id: 'catalog-1', name: 'rendering', description: 'Terminal rules', enabled: true, scope: {kind: 'project', projectRoot: '/repo'}};
  let items = [{id: 'item-1', content: 'Use real cursors', enabled: true, createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z'}];
  let listCalls = 0;
  let readCalls = 0;
  host.memory.listAgentCatalogs = () => {
    listCalls += 1;
    return {ok: true, catalogs: [catalog]};
  };
  host.memory.readAgentCatalog = () => {
    readCalls += 1;
    return {ok: true, catalog, memories: items};
  };
  host.memory.addAgentMemory = (input) => {
    items = [...items, {id: 'item-2', content: input.content, enabled: true, createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z'}];
    return {ok: true, catalogs: [catalog], catalog, memories: items};
  };
  host.memory.setAgentCatalogEnabled = (_name, enabled) => {
    catalog = {...catalog, enabled};
    return {ok: true, catalogs: [catalog], catalog};
  };
  host.memory.setAgentItemEnabled = (_name, itemId, enabled) => {
    items = items.map((item) => item.id === itemId ? {...item, enabled} : item);
    return {ok: true, catalogs: [catalog], catalog, memories: items};
  };
  handler.start('/memory', host);
  assert.deepEqual(host.session.getActive().surface.itemCounts, {user: 0, global: 0, project: 1});
  assert.equal(listCalls, 1);
  assert.equal(readCalls, 1);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(host.session.getActive().surface.section, 'catalogs');
  assert.equal(host.session.getActive().surface.scope, 'project');
  assert.equal(host.session.getActive().surface.title, 'AGENT CATALOGS · project');
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: ' '}, host);
  assert.equal(host.session.getActive().surface.catalogs[0].enabled, false);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(host.session.getActive().surface.section, 'items');
  assert.equal(host.session.getActive().surface.title, 'CATALOG · rendering');
  assert.equal(listCalls, 1);
  assert.equal(readCalls, 1);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: ' '}, host);
  assert.equal(host.session.getActive().surface.agentItems[0].enabled, false);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.ESCAPE}, host);
  assert.equal(host.session.getActive().surface.catalogs[0].enabled, false);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(host.session.getActive().surface.agentItems[0].enabled, false);
  assert.equal(readCalls, 1);
  host.memory.setAgentItemEnabled = () => ({ok: false, error: 'disk full'});
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: ' '}, host);
  assert.equal(host.session.getActive().surface.agentItems[0].enabled, false);
  assert.match(host.session.getActive().surface.error, /disk full/);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'a'}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'Reserve the final column'}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(host.session.getActive().surface.agentItems.length, 2);
  assert.equal(host.session.getActive().surface.showCursor, undefined);
});

test('/memory counts disabled agent items in the type menu', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost();
  const catalog = {id: 'catalog-1', name: 'rendering', description: 'Terminal rules', enabled: false, scope: {kind: 'project', projectRoot: '/repo'}};
  const item = {id: 'item-1', content: 'Disabled rule', enabled: false, createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z'};
  host.memory.listAgentCatalogs = () => ({ok: true, catalogs: [catalog]});
  host.memory.readAgentCatalog = () => ({ok: true, catalog, memories: [item]});

  handler.start('/memory', host);

  assert.deepEqual(host.session.getActive().surface.itemCounts, {user: 0, global: 0, project: 1});
});

test('memory surface renders list, edit and confirmation states without overflowing the requested width', () => {
  const base = {
    kind: 'memory',
    title: 'MEMORY',
    memories: [createMemory('memory-1', '这是一个很长的 memory 内容，用于验证渲染时的安全截断。')],
    selectedIndex: 0,
    dismissHint: 'Esc 关闭'
  };

  for (const surface of [
    {...base, mode: 'list'},
    {...base, mode: 'deleteConfirm'}
  ]) {
    const layout = renderMemorySurface(surface, 36, DEFAULT_TUI_THEME.footer);
    assert.ok(layout.lines.length > 3);
    assert.equal(layout.showCursor, false);
    assert.equal(displayWidth(layout.lines[0]), safeRenderWidth(36));
    assert.equal(displayWidth(layout.lines.at(-1)), safeRenderWidth(36));
  }

  const narrowEdit = renderMemorySurface({...base, mode: 'edit', editText: '第一行\n第二行', editCursor: 4}, 36, DEFAULT_TUI_THEME.footer);
  assert.ok(narrowEdit.lines.length > 3);
  assert.equal(narrowEdit.showCursor, true);
  assert.equal(displayWidth(narrowEdit.lines[0]), safeRenderWidth(36));
  assert.equal(displayWidth(narrowEdit.lines.at(-1)), safeRenderWidth(36));

  const editing = renderMemorySurface({...base, mode: 'edit', editText: '新增内容', editCursor: 4}, 80, DEFAULT_TUI_THEME.footer);
  assert.match(editing.lines.join('\n'), /这是一个很长的 memory/);
  assert.match(editing.lines.join('\n'), /输入 memory/);

  const cursorLayout = renderMemorySurface({...base, mode: 'edit', editText: '甲乙丙', editCursor: 1}, 80, DEFAULT_TUI_THEME.footer);
  const cursorLine = cursorLayout.lines.find((line) => line.includes('甲'));
  assert.equal(cursorLayout.showCursor, true);
  assert.equal(cursorLayout.cursorColumn, 2 + displayWidth('甲'));
  assert.equal(cursorLayout.lines[cursorLayout.cursorRow], cursorLine);
  assert.match(cursorLine, /甲乙丙/);
  assert.doesNotMatch(cursorLine, /█/);
  assert.doesNotMatch(cursorLine, /\x1b\[7m/);

  const endCursorLayout = renderMemorySurface({...base, mode: 'edit', editText: 'abc', editCursor: 3}, 80, DEFAULT_TUI_THEME.footer);
  const endCursorLine = endCursorLayout.lines.find((line) => line.includes('abc'));
  assert.equal(endCursorLayout.showCursor, true);
  assert.equal(endCursorLayout.cursorColumn, 2 + displayWidth('abc'));
  assert.equal(endCursorLayout.lines[endCursorLayout.cursorRow], endCursorLine);
  assert.doesNotMatch(endCursorLine, /█/);

  const typeLayout = renderMemorySurface({...base, section: 'types', mode: 'list'}, 80, DEFAULT_TUI_THEME.footer);
  assert.match(typeLayout.lines.join('\n'), /User memories/);
  assert.match(typeLayout.lines.join('\n'), /Agent memories · project/);
  const countedTypeLayout = renderMemorySurface({...base, section: 'types', mode: 'list', itemCounts: {user: 2, global: 3, project: 4}}, 80, DEFAULT_TUI_THEME.footer);
  assert.match(countedTypeLayout.lines.join('\n'), /User memories · 2 items/);
  assert.match(countedTypeLayout.lines.join('\n'), /global · 3 items/);
  assert.match(countedTypeLayout.lines.join('\n'), /project · 4 items/);
  const catalogLayout = renderMemorySurface({...base, section: 'catalogs', scope: 'project', mode: 'list', catalogs: [{id: 'c1', name: 'rendering', description: 'Terminal rules', enabled: false, scope: {kind: 'project', projectRoot: '/repo'}}]}, 80, DEFAULT_TUI_THEME.footer);
  assert.match(catalogLayout.lines.join('\n'), /rendering — Terminal rules/);
  assert.match(catalogLayout.lines.join('\n'), /off/);
  assert.doesNotMatch(catalogLayout.lines.join('\n'), /\[project\]/);
  const itemLayout = renderMemorySurface({...base, section: 'items', mode: 'list', agentItems: [{id: 'i1', content: 'Disabled rule', enabled: false, createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z'}]}, 80, DEFAULT_TUI_THEME.footer);
  assert.match(itemLayout.lines.join('\n'), /off.*Disabled rule/);

  const formLayout = renderMemorySurface({...base, title: 'NEW CATALOG · project', section: 'catalogs', mode: 'edit', catalogForm: {
    selectedIndex: 0,
    fields: [
      {label: '名称', text: 'rendering', cursor: 3},
      {label: '描述', text: 'Terminal rules', cursor: 0},
      {label: '首个 item', text: 'Use real cursors', cursor: 0}
    ]
  }}, 80, DEFAULT_TUI_THEME.footer);
  assert.match(formLayout.lines[formLayout.cursorRow], /名称.*│.*rendering/);
  assert.equal(formLayout.cursorColumn, 21);
  assert.doesNotMatch(formLayout.lines.join('\n'), /这是一个很长的 memory/);

  const longFormLayout = renderMemorySurface({...base, section: 'catalogs', mode: 'edit', catalogForm: {
    selectedIndex: 1,
    fields: [
      {label: '名称', text: 'rendering', cursor: 0},
      {label: '描述', text: '很长的描述'.repeat(30), cursor: 100},
      {label: '首个 item', text: '', cursor: 0}
    ]
  }}, 36, DEFAULT_TUI_THEME.footer);
  assert.equal(longFormLayout.showCursor, true);
  assert.ok(longFormLayout.cursorColumn < safeRenderWidth(36));
  assert.match(longFormLayout.lines[longFormLayout.cursorRow], /….*…/);
  for (const line of longFormLayout.lines) assert.ok(displayWidth(line) <= safeRenderWidth(36));
});

test('/memory edits a new catalog through separate form fields', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost();
  let input;
  host.memory.listAgentCatalogs = () => ({ok: true, catalogs: []});
  host.memory.addAgentMemory = (value) => {
    input = value;
    const catalog = {id: 'catalog-1', name: value.catalog, description: value.description, enabled: true, scope: {kind: 'project', projectRoot: '/repo'}};
    return {ok: true, catalogs: [catalog], catalog, memories: []};
  };

  handler.start('/memory', host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'a'}, host);
  assert.equal(host.session.getActive().surface.title, 'NEW CATALOG · project');
  assert.deepEqual(host.session.getActive().surface.catalogForm.fields.map((field) => field.label), ['名称', '描述', '首个 item']);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'rendering'}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'Terminal rules'}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'Use real cursors'}, host);
  handler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.deepEqual(input, {catalog: 'rendering', description: 'Terminal rules', content: 'Use real cursors', scope: 'project'});
});
