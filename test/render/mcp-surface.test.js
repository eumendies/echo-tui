const test = require('node:test');
const assert = require('node:assert/strict');

const {stripAnsi} = require('../../src/render/layout');
const {renderMcpSurface} = require('../../src/render/footer/mcp-surface');

test('renderMcpSurface renders dot markers, two-column rows and action hints', () => {
  const layout = renderMcpSurface({
    kind: 'mcp',
    view: 'server',
    title: 'MCP · docs',
    selectedIndex: 2,
    dirty: true,
    rows: [
      {id: 'enabled', kind: 'field', label: '启用', dot: 'on', value: '已启用'},
      {id: 'transport', kind: 'field', label: 'transport', value: 'http'},
      {id: 'url', kind: 'field', label: 'url', value: 'https://example.invalid/mcp'},
      {id: 'headers', kind: 'field', label: 'headers', value: '2 项'},
      {id: 'inventory:tools', kind: 'inventory', label: 'Tools', detail: '3 项'},
      {id: 'deleteServer', kind: 'action', label: '删除该 server', detail: '从草稿移除', tone: 'warning'}
    ],
    dismissHint: 'Space 启停 · Enter 编辑/进入 · Esc 返回'
  }, 100);

  const text = stripAnsi(layout.lines.join('\n'));

  assert.equal(layout.showCursor, false);
  assert.match(text, /MCP · docs/);
  assert.match(text, /未保存/);
  assert.match(text, /● 启用/);
  assert.match(text, /已启用/);
  assert.match(text, /https:\/\/example\.invalid\/mcp/);
  assert.match(text, /Tools/);
  assert.match(text, /3 项/);
  assert.match(text, /删除该 server/);
  assert.match(text, /从草稿移除/);
  // 编辑视图不再输出能力/计数块,避免浪费空间。
  assert.doesNotMatch(text, /能力：/);
  assert.doesNotMatch(text, /计数：/);
  assert.match(text, /Space 启停/);
});

test('renderMcpSurface renders empty state, off dot and inline block cursor', () => {
  const empty = renderMcpSurface({
    kind: 'mcp',
    view: 'overview',
    title: 'MCP',
    rows: [],
    selectedIndex: 0,
    emptyLines: ['当前没有配置 MCP server。'],
    dirty: false,
    dismissHint: 'Esc 关闭'
  }, 80);

  assert.match(stripAnsi(empty.lines.join('\n')), /当前没有配置 MCP server/);
  assert.equal(empty.showCursor, false);

  const editing = renderMcpSurface({
    kind: 'mcp',
    view: 'overview',
    title: 'MCP',
    selectedIndex: 1,
    dirty: false,
    rows: [
      {id: 'global', kind: 'global', label: 'MCP', dot: 'off', value: '已停用'},
      {id: 'addServer', kind: 'field', label: '+ 新增 server', input: {text: 'docs', cursor: 4}}
    ],
    dismissHint: 'Enter 提交 · Esc 取消'
  }, 80);
  const editingText = stripAnsi(editing.lines.join('\n'));

  assert.match(editingText, /○ MCP/);
  assert.match(editingText, /docs█/);
  assert.equal(editing.showCursor, false);
});

test('renderMcpSurface masks secret input buffers', () => {
  const layout = renderMcpSurface({
    kind: 'mcp',
    view: 'entryDetail',
    title: 'MCP · docs · 条目 1',
    selectedIndex: 1,
    dirty: true,
    rows: [
      {id: 'key', kind: 'field', label: '键', value: 'Authorization'},
      {id: 'value', kind: 'field', label: '值', input: {text: 'tvly-secret', cursor: 12}, masked: true}
    ],
    dismissHint: 'd 清空密钥值 · Enter 编辑 · Esc 返回'
  }, 90);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /Authorization/);
  assert.match(text, /•••••••••••/);
  assert.doesNotMatch(text, /tvly-secret/);
});
