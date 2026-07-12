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
  const calls = {created: [], updated: [], deleted: [], resets: 0};
  let memories = initialMemories.map((memory) => ({...memory}));
  let activeSession = null;
  const host = {
    composer: {
      reset() {
        calls.resets += 1;
      },
      leaveHistoryBrowsing() {}
    },
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
      }
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
});
