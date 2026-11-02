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
    stats: {agentCount: 3, issueCount: 0},
    summary: {
      description: 'Inspect project files and return evidence.',
      diagnostics: [],
      fields: [
        {label: '模型', value: 'fast-model'},
        {label: 'Effort', value: 'low'},
        {label: '工具', value: '7 个'},
        {label: 'Skills', value: '全部 enabled Skills'},
        {label: 'MCP', value: '关闭'}
      ],
      sourceKind: 'builtin',
      status: 'active',
      title: 'explorer'
    },
    tabs: [
      {id: 'overview', label: '总览'},
      {id: 'project', label: '项目'},
      {id: 'user', label: '用户'},
      {id: 'builtin', label: '内置'}
    ],
    title: 'AGENTS · 总览',
    ...overrides
  };
}

test('renderAgentsSurface shows compact identities and a structured selected summary', () => {
  const layout = renderAgentsSurface(createSurface(), 100);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.equal(layout.showCursor, false);
  assert.match(text, /\[总览\].*项目.*用户.*内置/);
  assert.match(text, /3 Agent/);
  assert.match(text, /explorer.*生效.*内置.*只读/);
  assert.match(text, /模型 fast-model.*Effort low.*工具 7 个/);
  assert.match(text, /Skills 全部 enabled Skills.*MCP 关闭/);
  // 描述行与字段行同层：带“描述”标签并使用 dim，而不是无标签的默认前景色。
  const descriptionLine = layout.lines.find((line) => line.includes('Inspect project files'));
  assert.match(descriptionLine, /描述 Inspect project files and return evidence\./u);
  assert.match(descriptionLine, /\u001b\[2m描述/u);
  assert.match(text, /reviewer.*被覆盖.*用户/);
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
    stats: {agentCount: 0, issueCount: 0},
    summary: {
      description: '在 project scope 创建规范化 Markdown 定义',
      diagnostics: [],
      fields: [],
      sourceKind: 'project',
      title: '新建 Agent'
    },
    title: 'AGENTS · Project'
  }), 54, 9);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.ok(layout.lines.length <= 9);
  assert.match(text, /新建 Agent/);
  assert.doesNotMatch(text, /›/);
  assert.match(text, /下一次 assistant turn/);
  assert.match(text, /动作 13/);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 53));
});

test('renderAgentsSurface shows the configured skill summary and marks stale skill rows', () => {
  const layout = renderAgentsSurface(createSurface({
    mode: 'skills',
    rows: [
      {id: 'skill:review-skill', kind: 'tool', label: 'review-skill', selected: true},
      {id: 'skill:missing-skill', kind: 'tool', label: 'missing-skill', selected: true, status: 'stale', description: '已配置但当前 disabled 或缺失；保留以备再次启用'},
      {id: 'skills:done', kind: 'action', label: '完成 Skills 选择'}
    ],
    title: 'AGENTS · SKILLS'
  }), 100);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /review-skill/u);
  assert.match(text, /missing-skill/u);
  assert.match(text, /完成 Skills 选择/u);
  assert.equal(new Set(layout.lines.map(displayWidth)).size, 1);
});

test('renderAgentsSurface follows the file picker width and keeps complete built-in policy labels', () => {
  const layout = renderAgentsSurface(createSurface({
    mode: 'detail',
    rows: [
      {id: 'builtin:project', kind: 'action', label: '配置项目级策略', section: 'actions'},
      {id: 'builtin:user', kind: 'action', label: '配置用户级策略', section: 'actions'}
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
      {description: '/repo/.echo/agents/reviewer.md；删除后用户级定义将在下一 turn 重新生效', id: 'confirm:execute', kind: 'confirm', label: '删除 reviewer', tone: 'danger'}
    ],
    selectedIndex: 0,
    title: 'AGENTS · CONFIRM'
  }), 82, 7);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /取消.*默认安全选项/);
  assert.match(text, /删除 reviewer/);
  assert.match(text, /删除后用户级定义/);
  // 确认页保持专属布局：不引入“操作”等分区标题占用有限行数。
  assert.doesNotMatch(text, /操作/u);
  assert.equal(layout.showCursor, false);
});

test('renderAgentsSurface keeps every line inside the card across narrow widths', () => {
  const rows = Array.from({length: 12}, (_value, index) => ({
    id: `agent:project:agent-${index}`,
    kind: 'agent',
    label: `agent-${index}`,
    sourceKind: 'project',
    status: index === 5 ? 'invalid' : 'active',
    capability: 'readonly'
  }));

  // 覆盖曾经溢出的顶栏统计窗口（13/14、23/24 列）以及列表更多提示所在的极窄宽度。
  for (let width = 7; width <= 160; width += 1) {
    const layout = renderAgentsSurface(createSurface({
      rows,
      selectedIndex: 5,
      stats: {agentCount: 12, issueCount: 3},
      summary: {diagnostics: [], fields: [{label: '模型', value: 'fast-model'}], sourceKind: 'project', status: 'active', title: 'agent-5'}
    }), width, 10);
    const offenders = layout.lines.filter((line) => displayWidth(line) > Math.max(1, width - 1));

    assert.ok(offenders.length === 0, `width=${width} overflow: ${offenders.map((line) => stripAnsi(line)).join(' | ')}`);
  }
});

test('renderAgentsSurface keeps both confirmation choices visible when a message competes for the budget', () => {
  const surface = {
    activeTab: 'project',
    feedback: '✓ 已保存，将在下一次 assistant turn 生效',
    mode: 'confirm',
    rows: [
      {description: '默认安全选项', id: 'confirm:cancel', kind: 'confirm', label: '取消'},
      {description: '/repo/.echo/agents/reviewer.md', id: 'confirm:execute', kind: 'confirm', label: '删除 reviewer', tone: 'danger'}
    ],
    selectedIndex: 0,
    title: 'AGENTS · CONFIRM'
  };
  const layout = renderAgentsSurface(createSurface(surface), 80, 5);
  const text = stripAnsi(layout.lines.join('\n'));

  // 预算不足时优先让出 dismiss hint，而不是隐藏待确认动作。
  assert.ok(layout.lines.length <= 5);
  assert.match(text, /取消/u);
  assert.match(text, /删除 reviewer/u);

  // 只够一行时不渲染 chrome，但仍保留默认取消项而不是危险的待确认动作。
  const tight = renderAgentsSurface(createSurface({...surface, feedback: undefined}), 80, 1);
  const tightText = stripAnsi(tight.lines.join('\n'));
  assert.match(tightText, /取消/u);
  assert.doesNotMatch(tightText, /删除 reviewer/u);
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
      {description: value, id: 'name', kind: 'field', label: 'name', section: 'identity'},
      {description: 'Review auth.', id: 'description', kind: 'field', label: 'description', section: 'identity'},
      {id: 'save', kind: 'action', label: '创建 Agent…', section: 'actions'}
    ],
    selectedIndex: 0,
    title: 'AGENTS · CREATE · project'
  }), 48, 8);
  const plainLines = layout.lines.map(stripAnsi);

  assert.equal(layout.showCursor, true);
  assert.match(plainLines.join('\n'), /身份/);
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
      {description: 'readonly', id: 'capability', kind: 'field', label: 'capability', readonly: true, section: 'capability'},
      {description: '继承父模型', id: 'model', kind: 'field', label: 'model', readonly: true, section: 'policy'},
      {description: '写入项目级配置', id: 'save', kind: 'action', label: '保存策略', section: 'actions'}
    ],
    selectedIndex: 0,
    title: 'AGENTS · explorer'
  }), 100, 10);
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
      label: '复制为项目级自定义 Agent',
      section: 'actions'
    }],
    selectedIndex: 0,
    title: 'AGENTS · explorer'
  }), 40, 5);
  const narrowLine = narrow.lines.map(stripAnsi).find((line) => line.includes('复制为'));

  assert.match(narrowLine, /复制为.*….*这是.*… │$/);
  assert.ok(narrow.lines.every((line) => displayWidth(line) <= 39));
});

test('renderAgentsSurface follows a multiline instructions cursor below an overflow hint', () => {
  const text = ['first line', 'second line', 'third line', 'fourth line', 'fifth line', 'sixth 中文 line', 'final line'].join('\n');
  const cursor = Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text), (entry) => entry.segment)
    .findIndex((_entry, index, values) => values.slice(0, index).join('').endsWith('sixth 中'));
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
  assert.match(plainLines.join('\n'), /↑/);
  assert.match(plainLines[layout.cursorRow], /sixth/);
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
    }],
    stats: {agentCount: 1, issueCount: 1},
    summary: {
      diagnostics: ['invalid\u001b]2;owned\u0007diagnostic'],
      fields: [{label: '来源路径', value: '/repo/\u001b]2;owned\u0007unsafe.md'}],
      sourceKind: 'project',
      status: 'invalid',
      title: 'unsafe\u001b]2;owned\u0007name'
    }
  }), 72);
  const output = layout.lines.join('\n');
  const text = stripAnsi(output);

  assert.doesNotMatch(output, /\u001b\]2;owned/u);
  assert.doesNotMatch(output, /\u0007/u);
  assert.match(text, /unsafe.*owned.*name/u);
  assert.match(text, /invalid.*owned.*diagnostic/u);
});

test('renderAgentsSurface explains the effective built-in policy source inside 80 columns', () => {
  const layout = renderAgentsSurface(createSurface({
    activeTab: 'builtin',
    mode: 'detail',
    rows: [
      {description: 'Inspect project files and return evidence.', id: 'builtin:description', kind: 'field', label: 'description', readonly: true, section: 'identity'},
      {description: '项目级 override 生效 · /repo/.echo/agents.settings.json', id: 'builtin:policy', kind: 'field', label: 'policy', readonly: true, section: 'policy'},
      {description: 'fast-model（项目级策略）', id: 'builtin:model', kind: 'field', label: 'model', readonly: true, section: 'policy'},
      {description: 'high（项目级策略）', id: 'builtin:effort', kind: 'field', label: 'effort', readonly: true, section: 'policy'},
      {description: '2 个（项目级策略）', id: 'builtin:skills', kind: 'field', label: 'skills', readonly: true, section: 'capability'},
      {description: '当前生效', id: 'builtin:project', kind: 'action', label: '配置项目级策略', section: 'actions'},
      {description: '未配置', id: 'builtin:user', kind: 'action', label: '配置用户级策略', section: 'actions'}
    ],
    selectedIndex: 1,
    title: 'AGENTS · explorer'
  }), 80, 16);
  const text = layout.lines.map(stripAnsi).join('\n');

  assert.match(text, /policy\s+项目级 override 生效 · \/repo\/\.echo\/agents\.settings\.json/u);
  assert.match(text, /model\s+fast-model（项目级策略）/u);
  assert.match(text, /effort\s+high（项目级策略）/u);
  assert.match(text, /配置项目级策略\s+当前生效/u);
  assert.match(text, /配置用户级策略\s+未配置/u);
  assert.match(text, /身份.*运行策略.*能力与权限.*操作/us);
  assert.doesNotMatch(text, /…/u);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 79));
});

test('renderAgentsSurface switches between stacked and split list layouts at stable widths', () => {
  for (const width of [50, 80, 96, 120]) {
    const layout = renderAgentsSurface(createSurface(), width, 12);
    const text = layout.lines.map(stripAnsi).join('\n');
    const explorerLine = layout.lines.map(stripAnsi).find((line) => line.includes('explorer'));

    assert.match(text, /explorer.*生效/u);
    assert.match(text, /fast-model/u);
    assert.ok(layout.lines.length <= 12);
    assert.ok(layout.lines.every((line) => displayWidth(line) <= width - 1));
    if (width >= 96) {
      assert.ok((explorerLine.match(/│/gu) || []).length >= 3);
    } else {
      assert.match(text, /当前项/u);
    }
  }
});

test('renderAgentsSurface keeps the selected row and core summary under severe height limits', () => {
  const layout = renderAgentsSurface(createSurface({
    selectedIndex: 2,
    summary: {
      description: 'A project definition with the same name takes precedence.',
      diagnostics: ['Project wins.'],
      fields: [{label: '来源路径', value: '/home/.echo/agents/reviewer.md'}],
      sourceKind: 'user',
      status: 'shadowed',
      title: 'reviewer'
    }
  }), 54, 4);
  const text = layout.lines.map(stripAnsi).join('\n');

  assert.ok(layout.lines.length <= 4);
  assert.match(text, /reviewer/u);
  assert.match(text, /被覆盖/u);
});

test('renderAgentsSurface displays unknown statuses without misreporting them as active', () => {
  const layout = renderAgentsSurface(createSurface({
    rows: [{id: 'agent:project:future', kind: 'agent', label: 'future', sourceKind: 'project', status: 'future-state'}],
    selectedIndex: 0,
    stats: {agentCount: 1, issueCount: 0},
    summary: {diagnostics: [], fields: [], sourceKind: 'project', status: 'future-state', title: 'future'}
  }), 80, 9);
  const text = layout.lines.map(stripAnsi).join('\n');

  assert.match(text, /\? future-state/u);
  assert.doesNotMatch(text, /future.*生效/u);
});

test('renderAgentsSurface separates definition selection from name enablement and candidate statistics', () => {
  const surface = createSurface();
  surface.stats = {agentCount: 3, enabledCount: 1, disabledCount: 2, issueCount: 0};
  surface.rows[0].enablement = {enabled: false};
  surface.rows[1].enablement = {enabled: true};
  surface.rows[2].enablement = {enabled: false};
  surface.notice = '委派工具已关闭（run_subagent）；启用候选不会开启主工具';
  const text = stripAnsi(renderAgentsSurface(surface, 160, 16).lines.join('\n'));
  assert.match(text, /1 启用候选 · 2 停用/);
  assert.match(text, /生效 · 停用/);
  assert.match(text, /被覆盖 · 停用/);
  assert.doesNotMatch(text, /有效启停/);
  assert.match(text, /委派工具已关闭/);
  assert.equal(text.includes('当前可调用'), false);
});

test('renderAgentsSurface does not report effective enabled counts under invalid settings and respects all line budgets', () => {
  const surface = createSurface({notice: '配置异常，委派不可用；有效值/来源不可用', error: '冲突：文件已被外部修改', feedback: '先前操作反馈'});
  surface.stats = {agentCount: 3, issueCount: 1, unavailable: true};
  surface.rows = surface.rows.map((row) => ({...row, enablement: {enabled: undefined}}));
  const text = stripAnsi(renderAgentsSurface(surface, 160, 16).lines.join('\n'));
  assert.match(text, /配置异常 · 委派不可用 · 1 异常/);
  assert.match(text, /生效 · 启停不可用/);
  assert.equal(/\d+ 启用候选|\d+ 停用/u.test(text), false);
  for (const width of [12, 32, 60, 80, 100, 160]) {
    for (const budget of [1, 2, 3, 4, 5, 6, 8, 12]) {
      const layout = renderAgentsSurface(surface, width, budget);
      assert.ok(layout.lines.length <= budget, `width=${width}, budget=${budget}, got=${layout.lines.length}`);
      for (const line of layout.lines) assert.ok(displayWidth(line) <= width);
      if (width >= 36) assert.ok(stripAnsi(layout.lines.join('\n')).includes('explorer'));
      else assert.match(stripAnsi(layout.lines.join('\n')), /▌/);
      if (budget >= 5 && width >= 60) assert.match(stripAnsi(layout.lines.join('\n')), /配置异常，委派不可用/);
    }
  }
});

function createEnablementData() {
  const draft = {capability: 'readonly', description: 'Review files', effort: 'inherit', instructions: 'Inspect safely', mcp: false, tools: ['read_files']};
  return {
    activeTab: 'user', mode: 'detail', selected: {name: 'reviewer', sourceKind: 'user'}, selectedIndex: 4,
    enablement: {value: false, original: false, fingerprint: 'user-settings-fp'},
    snapshot: {
      builtins: [], models: [], skills: [], diagnostics: [], delegationToolEnabled: true,
      items: [{name: 'reviewer', sourceKind: 'user', status: 'shadowed', diagnostics: [], draft}],
      overrides: [
        {sourceKind: 'user', sourcePath: '/home/.echo/agents.settings.json', status: 'valid', fingerprint: 'user-settings-fp', settings: {schemaVersion: 3, enabled: {reviewer: false}, overrides: {}}},
        {sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'valid', fingerprint: 'project-settings-fp', settings: {schemaVersion: 2, overrides: {}}}
      ]
    }
  };
}

test('renderAgentsSurface keeps the first-level global toggle and save/cancel accessible across all budgets', () => {
  const {createAgentsSurface} = require('../../src/commands/agents-command-handler');
  for (const builtin of [false, true]) {
    const data = createEnablementData();
    if (builtin) {
      data.selected = {name: 'explorer', sourceKind: 'builtin'};
      data.snapshot.items = [{name: 'explorer', sourceKind: 'builtin', status: 'active', diagnostics: []}];
      data.snapshot.builtins = [{name: 'explorer', description: 'Explore safely', capability: 'readonly', effort: 'inherit', includeMcpTools: false, localToolNames: ['read_files'], policy: {fields: [], status: 'none'}}];
      data.snapshot.overrides[0].settings.enabled.explorer = false;
      data.selectedIndex = 2;
    }
    const initial = structuredClone(data);
    const surface = createAgentsSurface(data);
    const toggles = surface.rows.filter((row) => row.id === 'enablement:toggle');
    assert.deepEqual(toggles.map((row) => [row.label, row.selected]), [['全局启用', false]]);
    for (const width of [24, 36, 60, 80, 100, 160]) {
      for (const budget of [1, 2, 4, 5, 6, 9, 12, 18]) {
        for (const id of ['enablement:toggle', 'enablement:save', 'enablement:cancel']) {
          const selectedIndex = surface.rows.findIndex((row) => row.id === id);
          const layout = renderAgentsSurface({...surface, selectedIndex}, width, budget);
          const text = stripAnsi(layout.lines.join('\n'));
          assert.ok(layout.lines.length <= budget, `width=${width}, budget=${budget}`);
          assert.equal(layout.showCursor, false);
          for (const line of layout.lines) assert.ok(displayWidth(line) <= width);
          assert.match(text, new RegExp(surface.rows[selectedIndex].label));
          assert.equal(layout.lines.join('\n').includes('\u001b[?1049h'), false);
        }
      }
    }
    assert.deepEqual(data, initial);
    const fullText = stripAnsi(renderAgentsSurface(surface, 160, 30).lines.join('\n'));
    assert.match(fullText, /○ 全局启用.*停用/);
    assert.doesNotMatch(fullText, /有效启停/);
    assert.match(fullText, /取消/);
    assert.equal(/保存启停|按名称控制|保存后预期|被项目覆盖/.test(fullText), false);
  }
});

test('renderAgentsSurface renders malformed first-level toggle as unavailable, not as a false default', () => {
  const {createAgentsSurface} = require('../../src/commands/agents-command-handler');
  const data = createEnablementData();
  data.snapshot.overrides[0].status = 'invalid';
  delete data.snapshot.overrides[0].settings;
  data.snapshot.overrides[0].error = {code: 'invalid_settings_json', message: 'Invalid JSON'};
  data.enablement.value = undefined;
  data.enablement.original = undefined;
  const surface = createAgentsSurface(data);
  assert.equal(surface.rows.find((row) => row.id === 'enablement:toggle').readonly, true);
  assert.equal(surface.rows.find((row) => row.id === 'enablement:toggle').selected, undefined);
  const text = stripAnsi(renderAgentsSurface(surface, 160, 30).lines.join('\n'));
  assert.match(text, /配置异常，委派不可用/);
  assert.match(text, /全局启用.*不可用.*只读/);
  assert.equal(/○ 全局启用|● 全局启用/.test(text), false);
});

test('renderAgentsSurface marks unsaved drafts in hints without an effective enablement row', () => {
  const {createAgentsSurface} = require('../../src/commands/agents-command-handler');
  const data = createEnablementData();
  data.enablement.original = true;
  data.snapshot.overrides[0].sourcePath = `/home/${'very-long-directory/'.repeat(10)}.echo/agents.settings.json`;
  const surface = createAgentsSurface(data);
  surface.selectedIndex = surface.rows.findIndex((row) => row.id === 'enablement:toggle');
  const text = stripAnsi(renderAgentsSurface(surface, 80, 6).lines.join('\n'));
  assert.match(text, /未保存/);
  assert.doesNotMatch(text, /有效启停/);
});

test('renderAgentsSurface keeps deletion confirmation to two actions with constraints in the delete hint', () => {
  const {createAgentsSurface} = require('../../src/commands/agents-command-handler');
  const data = createEnablementData();
  data.mode = 'confirm';
  data.customForm = undefined;
  data.confirm = {kind: 'delete', selectedIndex: 0, sourcePath: '/repo/.echo/agents/reviewer.md'};
  data.selectedIndex = 0;
  data.selected.sourceKind = 'project';
  data.snapshot.items.push({name: 'reviewer', sourceKind: 'project', status: 'active', diagnostics: []});
  data.snapshot.items[0].draft = {};
  const surface = createAgentsSurface(data);
  assert.deepEqual(surface.rows.map((row) => row.id), ['confirm:cancel', 'confirm:execute']);
  assert.equal(surface.rows[1].description, '/repo/.echo/agents/reviewer.md；用户定义接替·停用');
  const text = stripAnsi(renderAgentsSurface(surface, 120, 16).lines.join('\n'));
  assert.match(text, /删除 reviewer.*停用/);
  assert.doesNotMatch(text, /目标路径|下一主运行|启停执行约束|名称启停偏好/);
  for (const width of [36, 80, 120]) {
    for (const budget of [5, 6, 7]) {
      const constrained = renderAgentsSurface(surface, width, budget);
      const content = stripAnsi(constrained.lines.join('\n'));
      assert.ok(constrained.lines.length <= budget);
      for (const line of constrained.lines) assert.ok(displayWidth(line) <= width);
      assert.match(content, /取消/);
      assert.match(content, width >= 80 ? /删除 reviewer/ : /删除/);
      if (width >= 80) {
        assert.match(content, /\/repo\/\.echo\/agents\/reviewer.md/);
        assert.match(content, /用户定义接替·停用/);
      }
    }
  }
});

test('renderAgentsSurface reports unknown delegation tool availability without disabling the global toggle', () => {
  const {createAgentsSurface} = require('../../src/commands/agents-command-handler');
  const data = createEnablementData();
  data.snapshot.delegationToolEnabled = undefined;
  const surface = createAgentsSurface(data);
  const text = stripAnsi(renderAgentsSurface(surface, 120, 12).lines.join('\n'));
  assert.match(text, /主工具配置异常，委派工具状态不可用/);
  assert.doesNotMatch(text, /委派工具已关闭/);
  assert.notEqual(surface.rows.find((row) => row.id === 'enablement:toggle').readonly, true);
});
