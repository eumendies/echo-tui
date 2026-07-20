const test = require('node:test');
const assert = require('node:assert/strict');

const {stripAnsi} = require('../../src/render/layout');
const {renderMcpSurface} = require('../../src/render/footer/mcp-surface');

test('renderMcpSurface renders global row, servers, diagnostics, and hints', () => {
  const layout = renderMcpSurface({
    kind: 'mcp',
    title: 'MCP',
    selectedIndex: 1,
    servers: [
      {kind: 'global', name: 'MCP global', enabled: true, valid: true, summary: 'enabled'},
      {kind: 'server', name: 'docs', enabled: true, valid: true, transport: 'http', summary: 'https://example.invalid/mcp', toolCount: 2},
      {kind: 'server', name: 'bad', enabled: false, valid: false, summary: 'missing command', diagnostic: 'missing command'}
    ],
    dismissHint: 'Space 切换 · Enter 保存并重载 · Esc 取消'
  }, 100);

  const text = stripAnsi(layout.lines.join('\n'));

  assert.equal(layout.showCursor, false);
  assert.match(text, /MCP/);
  assert.match(text, /MCP global/);
  assert.match(text, /docs/);
  assert.match(text, /2 tools/);
  assert.match(text, /bad/);
  assert.match(text, /无效/);
  assert.match(text, /missing command/);
  assert.match(text, /Space 切换/);
});

test('renderMcpSurface renders empty state', () => {
  const layout = renderMcpSurface({
    kind: 'mcp',
    title: 'MCP',
    servers: [],
    selectedIndex: 0,
    emptyLines: ['当前没有配置 MCP server。'],
    dismissHint: 'Esc 关闭'
  }, 80);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /当前没有配置 MCP server/);
});
