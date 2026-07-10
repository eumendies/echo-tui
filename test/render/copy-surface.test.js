const test = require('node:test');
const assert = require('node:assert/strict');

const {stripAnsi, displayWidth} = require('../../src/render/layout');
const {renderCopySurface} = require('../../src/render/footer/copy-surface');

test('renderCopySurface renders two-column copy panel with focus and selection markers', () => {
  const layout = renderCopySurface({
    kind: 'copy',
    title: '/copy 复制消息',
    selectedIndex: 1,
    selectedIds: ['message-1'],
    messages: [
      {id: 'message-0', role: 'user', text: 'first question', selected: false},
      {id: 'message-1', role: 'assistant', text: 'answer line one\nanswer line two', selected: true}
    ],
    dismissHint: '↑↓ 移动 · Space 选择 · Enter 复制 · Esc 取消'
  }, 100);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.equal(layout.showCursor, false);
  assert.match(text, /\/copy 复制消息/);
  assert.match(text, /● 已选择 1/);
  assert.match(text, /○ User first question/);
  assert.match(text, /▌ ● Assistant answer line one/);
  assert.match(text, /answer line one/);
  assert.match(text, /answer line two/);
  assert.match(text, /Space 选择/);
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;0;200;220mUser \x1b[39m')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;96;210;165m\x1b[1mAssistant \x1b[22m\x1b[39m')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;205;213;222mfirst question\x1b[39m')));
});

test('renderCopySurface respects width and height budgets', () => {
  const layout = renderCopySurface({
    kind: 'copy',
    selectedIndex: 5,
    selectedIds: ['message-5'],
    messages: Array.from({length: 12}, (_value, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `message ${index} ${'very long text '.repeat(8)}`,
      selected: index === 5
    })),
    dismissHint: 'hint'
  }, 48, 10);

  assert.equal(layout.lines.length, 10);
  for (const line of layout.lines) {
    assert.ok(displayWidth(line) <= 48, `line too wide: ${stripAnsi(line)}`);
  }
  assert.match(stripAnsi(layout.lines.join('\n')), /更多|message 5/);
});

test('renderCopySurface highlights preview focus and applies preview scroll', () => {
  const layout = renderCopySurface({
    kind: 'copy',
    focus: 'preview',
    previewScroll: 1,
    selectedIndex: 0,
    selectedIds: ['message-0'],
    messages: [{
      id: 'message-0',
      role: 'assistant',
      text: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n'),
      selected: true
    }],
    dismissHint: 'hint'
  }, 80, 9);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /↑ 1 更多/);
  assert.match(text, /↓ 1 更多/);
  assert.doesNotMatch(text, /▌ ● Assistant/);
  assert.doesNotMatch(text, /▌ ↑ 1 更多/);
});
