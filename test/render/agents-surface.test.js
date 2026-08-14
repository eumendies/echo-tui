const assert = require('node:assert/strict');
const {test} = require('node:test');

const {renderAgentsSurface} = require('../../src/render/footer/agents-surface');
const {displayWidth, stripAnsi} = require('../../src/render/layout');

function createSurface(overrides = {}) {
  return {
    activeTab: 'overview',
    dismissHint: 'Tab 切换 · Enter 打开 · Esc 关闭',
    kind: 'agents',
    mode: 'list',
    rows: [
      {
        capability: 'readonly',
        description: 'Inspect project files and return evidence.',
        effort: 'low',
        id: 'agent:builtin:explorer',
        kind: 'agent',
        label: 'explorer',
        mcp: false,
        model: 'fast-model',
        sourceKind: 'builtin',
        status: 'active',
        toolCount: 7
      },
      {
        capability: 'readonly',
        description: 'Project security review.',
        effort: 'high',
        id: 'agent:project:security-reviewer',
        kind: 'agent',
        label: 'security-reviewer',
        mcp: false,
        model: 'reviewer',
        sourceKind: 'project',
        status: 'active',
        toolCount: 3
      },
      {
        description: 'A project definition with the same name takes precedence.',
        id: 'agent:user:reviewer',
        kind: 'agent',
        label: 'reviewer',
        sourceKind: 'user',
        status: 'shadowed'
      }
    ],
    selectedIndex: 0,
    tabs: [
      {id: 'overview', label: 'Overview'},
      {id: 'project', label: 'Project'},
      {id: 'user', label: 'User'},
      {id: 'builtin', label: 'Built-in'}
    ],
    title: 'AGENTS · Overview',
    ...overrides
  };
}

test('renderAgentsSurface shows tabs, source, policy and overlay status inside a stable frame', () => {
  const layout = renderAgentsSurface(createSurface(), 100);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.equal(layout.showCursor, false);
  assert.match(text, /\[Overview\].*Project.*User.*Built-in/);
  assert.match(text, /explorer.*BUILTIN.*active/);
  assert.match(text, /readonly.*fast-model.*low.*7 tools.*MCP off/);
  assert.match(text, /reviewer.*USER.*shadowed/);
  assert.match(text, /Tab 切换/);
  assert.equal(new Set(layout.lines.map(displayWidth)).size, 1);
});

test('renderAgentsSurface keeps the selected action and feedback visible under width and height limits', () => {
  const rows = Array.from({length: 14}, (_value, index) => ({
    id: `action:${index}`,
    kind: 'action',
    label: index === 13 ? '新建 Agent' : `动作 ${index + 1}`,
    description: 'A very long action description that must be safely clamped inside a narrow terminal.'
  }));
  const layout = renderAgentsSurface(createSurface({
    activeTab: 'project',
    feedback: '✓ 已保存，将在下一次 assistant turn 生效',
    rows,
    selectedIndex: 13,
    title: 'AGENTS · Project'
  }), 54, 9);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.ok(layout.lines.length <= 9);
  assert.match(text, /新建 Agent/);
  assert.doesNotMatch(text, /›/);
  assert.match(text, /下一次 assistant turn/);
  assert.match(text, /↑/);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 53));
});

test('renderAgentsSurface follows the file picker width and keeps complete built-in policy labels', () => {
  const layout = renderAgentsSurface(createSurface({
    mode: 'detail',
    rows: [
      {id: 'builtin:project', kind: 'action', label: '配置项目级策略'},
      {id: 'builtin:user', kind: 'action', label: '配置用户级策略'}
    ],
    selectedIndex: 1,
    title: 'AGENTS · explorer'
  }), 160, 8);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.ok(layout.lines.every((line) => displayWidth(line) === 155));
  assert.match(text, /配置项目级策略/);
  assert.match(text, /配置用户级策略/);
  assert.doesNotMatch(text, /配置项目级策略…|配置用户级策略…|复制为.*自定义 Agent|›/);
});

test('renderAgentsSurface renders both confirmation choices with cancel selected by default', () => {
  const layout = renderAgentsSurface(createSurface({
    activeTab: 'project',
    mode: 'confirm',
    rows: [
      {description: '默认安全选项', id: 'confirm:cancel', kind: 'confirm', label: '取消'},
      {description: '/repo/.echo/agents/reviewer.md；删除后用户级定义将在下一 turn 重新生效', id: 'confirm:execute', kind: 'confirm', label: '删除 reviewer'}
    ],
    selectedIndex: 0,
    title: 'AGENTS · CONFIRM'
  }), 82, 7);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /取消.*默认安全选项/);
  assert.match(text, /删除 reviewer/);
  assert.match(text, /删除后用户级定义/);
  assert.equal(layout.showCursor, false);
});

test('renderAgentsSurface uses skills-style round markers for tool selection', () => {
  const layout = renderAgentsSurface(createSurface({
    mode: 'tools',
    rows: [
      {id: 'tool:read_files', kind: 'tool', label: 'read_files', selected: true},
      {id: 'tool:grep', kind: 'tool', label: 'grep', selected: false},
      {id: 'tools:done', kind: 'action', label: '完成工具选择'}
    ],
    selectedIndex: 0,
    title: 'AGENTS · TOOLS'
  }), 80, 7);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /● read_files/);
  assert.match(text, /○ grep/);
  assert.doesNotMatch(text, /☑|☐/);
});

test('renderAgentsSurface projects inline field editing with a real terminal cursor', () => {
  const value = 'a-very-long-security-reviewer-name';
  const cursor = value.indexOf('security') + 4;
  const layout = renderAgentsSurface(createSurface({
    activeTab: 'project',
    editCursor: cursor,
    editField: 'name',
    editText: value,
    mode: 'form',
    rows: [
      {description: value, id: 'name', kind: 'field', label: 'name'},
      {description: 'Review auth.', id: 'description', kind: 'field', label: 'description'},
      {id: 'save', kind: 'action', label: '创建 Agent…'}
    ],
    selectedIndex: 0,
    title: 'AGENTS · CREATE · project'
  }), 48, 8);
  const plainLines = layout.lines.map(stripAnsi);

  assert.equal(layout.showCursor, true);
  assert.match(plainLines[layout.cursorRow], /name/);
  assert.match(plainLines[layout.cursorRow], /a-very-long-security-reviewer-name/);
  assert.doesNotMatch(plainLines[layout.cursorRow], /…/);
  assert.ok(layout.cursorColumn > plainLines[layout.cursorRow].indexOf('name'));
  assert.ok(layout.cursorColumn < displayWidth(plainLines[layout.cursorRow]) - 1);
});

test('renderAgentsSurface right-aligns row details and only truncates when the split columns require it', () => {
  const wide = renderAgentsSurface(createSurface({
    mode: 'detail',
    rows: [
      {description: 'readonly', id: 'capability', kind: 'field', label: 'capability', readonly: true},
      {description: '继承父模型', id: 'model', kind: 'field', label: 'model', readonly: true},
      {description: '写入项目级配置', id: 'save', kind: 'action', label: '保存策略'}
    ],
    selectedIndex: 0,
    title: 'AGENTS · explorer'
  }), 100, 8);
  const wideLines = wide.lines.map(stripAnsi);

  assert.match(wideLines.find((line) => line.includes('capability')), /capability\s+readonly │$/);
  assert.match(wideLines.find((line) => line.includes('model')), /model\s+继承父模型 │$/);
  assert.match(wideLines.find((line) => line.includes('保存策略')), /保存策略\s+写入项目级配置 │$/);

  const narrow = renderAgentsSurface(createSurface({
    mode: 'detail',
    rows: [{
      description: '这是需要在狭窄终端中安全截断的很长具体说明',
      id: 'copy',
      kind: 'action',
      label: '复制为项目级自定义 Agent'
    }],
    selectedIndex: 0,
    title: 'AGENTS · explorer'
  }), 40, 5);
  const narrowLine = narrow.lines.map(stripAnsi).find((line) => line.includes('复制为'));

  assert.match(narrowLine, /复制为.*….*这是.*… │$/);
  assert.ok(narrow.lines.every((line) => displayWidth(line) <= 39));
});

test('renderAgentsSurface follows a multiline instructions cursor and preserves narrow line limits', () => {
  const text = ['first line', 'second line', 'third 中文 line', 'final line'].join('\n');
  const cursor = Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text), (entry) => entry.segment)
    .findIndex((_entry, index, values) => values.slice(0, index).join('').endsWith('third 中'));
  const layout = renderAgentsSurface(createSurface({
    activeTab: 'project',
    editCursor: cursor,
    editText: text,
    mode: 'instructions',
    rows: [{id: 'instructions-done', kind: 'action', label: '完成 instructions 编辑'}],
    selectedIndex: 0,
    title: 'AGENTS · INSTRUCTIONS · EDIT'
  }), 44, 7);
  const plainLines = layout.lines.map(stripAnsi);

  assert.equal(layout.showCursor, true);
  assert.ok(layout.lines.length <= 7);
  assert.match(plainLines[layout.cursorRow], /third/);
  assert.ok(layout.cursorColumn >= 2);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 43));
});

test('renderAgentsSurface renders an empty scope without exposing hidden shortcut keys', () => {
  const layout = renderAgentsSurface(createSurface({rows: [], dismissHint: 'Enter 打开 · Esc 关闭'}), 70);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /当前范围没有 Agent/);
  assert.doesNotMatch(text, /按 a|按 d|按 e/);
});

test('renderAgentsSurface neutralizes terminal control characters from physical Agent metadata', () => {
  const layout = renderAgentsSurface(createSurface({
    rows: [{
      description: 'invalid\u001b]2;owned\u0007diagnostic',
      id: 'agent:project:unsafe',
      kind: 'agent',
      label: 'unsafe\u001b]2;owned\u0007name',
      sourceKind: 'project',
      status: 'invalid'
    }]
  }), 72);
  const output = layout.lines.join('\n');
  const text = stripAnsi(output);

  assert.doesNotMatch(output, /\u001b\]2;owned/u);
  assert.doesNotMatch(output, /\u0007/u);
  assert.match(text, /unsafe.*owned.*name/u);
  assert.match(text, /invalid.*owned.*diagnostic/u);
});
