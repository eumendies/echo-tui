const assert = require('node:assert/strict');
const test = require('node:test');

const {MemoryCommandHandler} = require('../../src/commands/memory-command-handler');
const {renderMemorySurface} = require('../../src/render/footer/memory-surface');
const {boxWidth} = require('../../src/render/footer/config-panel-rows');
const {DEFAULT_TUI_THEME} = require('../../src/config/theme-config');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {displayWidth} = require('../../src/render/layout');

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

function press(handler, host, event) {
  handler.handleEvent(host.session.getActive(), event, host);
  return host.session.getActive();
}

/** 把焦点移动到指定行；行不存在时立即失败，避免测试静默走过错误状态。 */
function focusRow(handler, host, id) {
  let session = host.session.getActive();
  const target = session.surface.rows.findIndex((row) => row.id === id);
  assert.notEqual(target, -1, `row not found: ${id}`);

  while (session.surface.selectedIndex !== target) {
    const step = session.surface.selectedIndex < target ? INPUT_EVENTS.MOVE_DOWN : INPUT_EVENTS.MOVE_UP;
    session = press(handler, host, {type: step});
  }

  return session;
}

function rowIds(session) {
  return session.surface.rows.map((row) => row.id);
}

/** 启动 /memory 并进入 user memory 列表；一级焦点固定落在 type:user。 */
function openUserList(handler, host) {
  handler.start('/memory', host);
  press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  return host.session.getActive();
}

test('/memory creates, edits, toggles and deletes through row actions', () => {
  const handler = new MemoryCommandHandler();
  const {calls, host} = createHost([createMemory('memory-1', '已有内容')]);
  let session = openUserList(handler, host);

  assert.equal(session.surface.kind, 'memory');
  assert.equal(session.surface.section, 'user-list');
  assert.deepEqual(rowIds(session), ['entry:memory-1', 'action:add-user']);

  session = focusRow(handler, host, 'action:add-user');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.mode, 'edit');
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: '第一行'});
  session = press(handler, host, {type: INPUT_EVENTS.INSERT_NEWLINE});
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: '第二行'});
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});

  assert.deepEqual(calls.created, ['第一行\n第二行']);
  assert.equal(session.surface.mode, 'list');
  assert.equal(session.surface.section, 'user-list');
  assert.equal(session.surface.rows[session.surface.selectedIndex].id, 'entry:memory-2');

  session = focusRow(handler, host, 'entry:memory-1');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.section, 'user-detail');
  assert.equal(session.surface.detailContent, '已有内容');
  assert.deepEqual(rowIds(session), ['toggle:enabled', 'action:edit-user', 'action:delete-user']);

  session = focusRow(handler, host, 'action:edit-user');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.mode, 'edit');
  press(handler, host, {type: INPUT_EVENTS.TEXT, value: '不会保存'});
  session = press(handler, host, {type: INPUT_EVENTS.ESCAPE});
  assert.deepEqual(calls.updated, []);
  assert.equal(session.surface.section, 'user-detail');
  assert.equal(session.surface.rows[session.surface.selectedIndex].id, 'action:edit-user');

  session = focusRow(handler, host, 'action:delete-user');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.mode, 'deleteConfirm');
  assert.equal(session.surface.rows[session.surface.selectedIndex].id, 'option:cancel');

  session = press(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  assert.equal(session.surface.rows[session.surface.selectedIndex].id, 'option:delete');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(calls.deleted, ['memory-1']);
  assert.equal(session.surface.section, 'user-list');
  assert.deepEqual(rowIds(session), ['entry:memory-2', 'action:add-user']);
});

test('/memory keeps the edit draft open when persistence fails', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost([], {createResult: {ok: false, error: 'disk full'}});
  let session = openUserList(handler, host);

  assert.deepEqual(rowIds(session), ['action:add-user']);
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: '内容'});
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});

  assert.equal(session.surface.mode, 'edit');
  assert.equal(session.surface.editText, '内容');
  assert.match(session.surface.error, /disk full/);
});

test('/memory moves the multiline edit cursor with Up and Down', () => {
  const handler = new MemoryCommandHandler();
  const {calls, host} = createHost();
  let session = openUserList(handler, host);

  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: '第一行\n第二行'});
  session = press(handler, host, {type: INPUT_EVENTS.MOVE_UP});
  assert.equal(session.surface.editCursor, 3);

  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: 'X'});
  assert.equal(session.surface.editText, '第一行X\n第二行');
  session = press(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  assert.equal(session.surface.editCursor, 8);

  press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(calls.created, ['第一行X\n第二行']);
});

test('/memory toggles the selected entry with Space and the detail toggle row', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost([createMemory('memory-1', '可停用')]);
  let session = openUserList(handler, host);

  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: ' '});
  assert.equal(session.surface.rows[0].dot, 'off');

  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.section, 'user-detail');
  assert.equal(session.surface.rows[0].dot, 'off');

  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.rows[0].dot, 'on');
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

  let session = focusRow(handler, host, 'type:project');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.section, 'catalog-list');
  assert.equal(session.surface.scope, 'project');
  assert.equal(session.surface.title, 'AGENT CATALOGS · project');

  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: ' '});
  assert.equal(session.surface.rows[0].dot, 'off');

  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.section, 'catalog-detail');
  assert.equal(session.surface.title, 'CATALOG · rendering');
  assert.equal(listCalls, 1);
  assert.equal(readCalls, 1);
  assert.deepEqual(rowIds(session), [
    'field:name',
    'field:description',
    'toggle:enabled',
    'entry:item-1',
    'action:add-item',
    'action:edit-catalog',
    'action:delete-catalog'
  ]);

  session = focusRow(handler, host, 'entry:item-1');
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: ' '});
  assert.equal(session.surface.rows[session.surface.selectedIndex].dot, 'off');

  session = press(handler, host, {type: INPUT_EVENTS.ESCAPE});
  assert.equal(session.surface.section, 'catalog-list');
  assert.equal(session.surface.rows[session.surface.selectedIndex].id, 'entry:catalog-1');
  assert.equal(session.surface.rows[0].dot, 'off');

  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.section, 'catalog-detail');
  assert.equal(readCalls, 1);
  assert.equal(session.surface.rows[3].dot, 'off');

  host.memory.setAgentItemEnabled = () => ({ok: false, error: 'disk full'});
  session = focusRow(handler, host, 'entry:item-1');
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: ' '});
  assert.equal(session.surface.rows[3].dot, 'off');
  assert.match(session.surface.error, /disk full/);

  session = focusRow(handler, host, 'action:add-item');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: 'Reserve the final column'});
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.section, 'catalog-detail');
  assert.equal(session.surface.rows.filter((row) => row.id.startsWith('entry:')).length, 2);
  assert.equal(session.surface.rows[session.surface.selectedIndex].id, 'entry:item-2');
  assert.equal(session.surface.showCursor, undefined);
});

test('/memory restores the parent row after leaving a detail layer', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost([
    createMemory('memory-1', '第一条'),
    createMemory('memory-2', '第二条'),
    createMemory('memory-3', '第三条')
  ]);
  let session = openUserList(handler, host);

  session = focusRow(handler, host, 'entry:memory-3');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.section, 'user-detail');
  assert.equal(session.surface.detailContent, '第三条');

  session = press(handler, host, {type: INPUT_EVENTS.ESCAPE});
  assert.equal(session.surface.section, 'user-list');
  assert.equal(session.surface.rows[session.surface.selectedIndex].id, 'entry:memory-3');
});

test('/memory cancels the delete confirmation by default', () => {
  const handler = new MemoryCommandHandler();
  const {calls, host} = createHost([createMemory('memory-1', '保留内容')]);
  let session = openUserList(handler, host);

  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  session = focusRow(handler, host, 'action:delete-user');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});

  assert.equal(session.surface.mode, 'deleteConfirm');
  assert.equal(session.surface.rows[session.surface.selectedIndex].id, 'option:cancel');
  assert.match(session.surface.rows[0].value, /保留内容/);

  session = press(handler, host, {type: INPUT_EVENTS.ESCAPE});
  assert.deepEqual(calls.deleted, []);
  assert.equal(session.surface.section, 'user-detail');
});

test('/memory offers an add row for every empty list level', () => {
  const handler = new MemoryCommandHandler();
  const {host} = createHost();
  let session = openUserList(handler, host);

  assert.deepEqual(rowIds(session), ['action:add-user']);

  session = press(handler, host, {type: INPUT_EVENTS.ESCAPE});
  session = focusRow(handler, host, 'type:global');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(rowIds(session), ['action:add-catalog']);

  session = press(handler, host, {type: INPUT_EVENTS.ESCAPE});
  session = focusRow(handler, host, 'type:project');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(rowIds(session), ['action:add-catalog']);
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
  assert.match(host.session.getActive().surface.rows[2].value, /1 items/);
});

test('memory surface renders rows, detail, edit and confirmation states without overflowing', () => {
  const handler = new MemoryCommandHandler();
  const longContent = '很长的 memory 内容，用于验证详情层折行与限高。'.repeat(40);
  const {host} = createHost([createMemory('memory-1', longContent)]);
  const box = boxWidth(36);
  let session = openUserList(handler, host);

  const listLayout = renderMemorySurface(session.surface, 36, DEFAULT_TUI_THEME.footer);
  assert.ok(listLayout.lines.length > 3);
  assert.equal(listLayout.showCursor, false);
  assert.equal(displayWidth(listLayout.lines[0]), box);
  assert.equal(displayWidth(listLayout.lines.at(-1)), box);
  for (const line of listLayout.lines) assert.ok(displayWidth(line) <= box);
  assert.match(listLayout.lines.join('\n'), /\+ 新增 memory/);
  assert.doesNotMatch(listLayout.lines.join('\n'), /按 a 新增/);
  assert.doesNotMatch(listLayout.lines.join('\n'), /a 新增|e 编辑|d 删除/);

  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  const detailLayout = renderMemorySurface(session.surface, 36, DEFAULT_TUI_THEME.footer);
  assert.match(detailLayout.lines.join('\n'), /还有 \d+ 行/);
  assert.match(detailLayout.lines.join('\n'), /删除 memory/);
  for (const line of detailLayout.lines) assert.ok(displayWidth(line) <= box);

  session = focusRow(handler, host, 'action:edit-user');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: '第一行'});
  const editLayout = renderMemorySurface(session.surface, 36, DEFAULT_TUI_THEME.footer);
  assert.equal(editLayout.showCursor, true);
  assert.match(editLayout.lines.join('\n'), /输入 memory/);
  for (const line of editLayout.lines) assert.ok(displayWidth(line) <= box);

  const endCursorLayout = renderMemorySurface(
    {...session.surface, editText: 'abc', editCursor: 3},
    36,
    DEFAULT_TUI_THEME.footer
  );
  assert.equal(endCursorLayout.showCursor, true);
  const cursorLine = endCursorLayout.lines[endCursorLayout.cursorRow];
  assert.match(cursorLine, /abc/);
  assert.doesNotMatch(cursorLine, /█/);

  session = press(handler, host, {type: INPUT_EVENTS.ESCAPE});
  session = focusRow(handler, host, 'action:delete-user');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  const confirmLayout = renderMemorySurface(session.surface, 36, DEFAULT_TUI_THEME.footer);
  assert.match(confirmLayout.lines.join('\n'), /确认删除/);
  assert.match(confirmLayout.lines.join('\n'), /取消/);
  assert.match(confirmLayout.lines.join('\n'), /删除/);
  for (const line of confirmLayout.lines) assert.ok(displayWidth(line) <= box);

  const formLayout = renderMemorySurface({
    ...session.surface,
    mode: 'edit',
    title: 'NEW CATALOG · project',
    section: 'catalog-list',
    catalogForm: {
      selectedIndex: 0,
      fields: [
        {label: '名称', text: 'rendering', cursor: 3},
        {label: '描述', text: 'Terminal rules', cursor: 0},
        {label: '首个 item', text: 'Use real cursors', cursor: 0}
      ]
    }
  }, 80, DEFAULT_TUI_THEME.footer);
  assert.match(formLayout.lines[formLayout.cursorRow], /名称.*│.*rendering/);
  assert.equal(formLayout.cursorColumn, 21);
  for (const line of formLayout.lines) assert.ok(displayWidth(line) <= boxWidth(80));
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
  let session = focusRow(handler, host, 'type:project');
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(rowIds(session), ['action:add-catalog']);

  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(session.surface.title, 'NEW CATALOG · project');
  assert.deepEqual(session.surface.catalogForm.fields.map((field) => field.label), ['名称', '描述', '首个 item']);
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: 'rendering'});
  session = press(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: 'Terminal rules'});
  session = press(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  session = press(handler, host, {type: INPUT_EVENTS.TEXT, value: 'Use real cursors'});
  session = press(handler, host, {type: INPUT_EVENTS.SUBMIT});

  assert.deepEqual(input, {catalog: 'rendering', description: 'Terminal rules', content: 'Use real cursors', scope: 'project'});
  assert.equal(session.surface.mode, 'list');
  assert.equal(session.surface.section, 'catalog-list');
});
