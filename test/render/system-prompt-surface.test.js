const test = require('node:test');
const assert = require('node:assert/strict');

const { displayWidth, stripAnsi } = require('../../src/render/layout');
const { createComposer } = require('../../src/input/composer');
const { createInitialSystemPromptConfigState } = require('../../src/commands/config/state');
const { projectSystemPromptRead } = require('../../src/render/footer/system-prompt-surface');
const { renderConfigSurface } = require('../../src/render/footer/config-surface');

const TABS = [
  {id: 'general', label: '常规'},
  {id: 'models', label: '模型与 Provider'},
  {id: 'appearance', label: '外观'}
];

function createFact(filePath, content) {
  if (content === undefined) {
    return {exists: false, filePath, lines: 0};
  }

  return {
    content,
    exists: true,
    filePath,
    lines: content.split('\n').length
  };
}

function createSnapshot(projectContent, globalContent) {
  const project = createFact('/work/repo/SYSTEM.md', projectContent);
  const global = createFact('/home/user/.echo/SYSTEM.md', globalContent);
  const sourceKind = project.exists ? 'project' : global.exists ? 'global' : 'builtin';
  const baseContent = sourceKind === 'project'
    ? project.content
    : sourceKind === 'global'
      ? global.content
      : 'builtin prompt';

  return {baseContent, global, project, sourceKind};
}

const DYNAMIC_SECTIONS = [
  {label: 'Runtime environment', detail: 'cwd', estimatedTokens: 12},
  {label: 'AGENTS.md instructions', detail: '2 个文件', estimatedTokens: 800},
  {label: 'Available Skills', detail: '3 个已启用', estimatedTokens: 120},
  {label: 'Memory', detail: 'user 1 条 · agent 0 项', estimatedTokens: 20}
];

function createState(options = {}) {
  const state = createInitialSystemPromptConfigState(
    createSnapshot(options.projectContent, options.globalContent),
    DYNAMIC_SECTIONS
  );
  return Object.assign(state, options.patch || {});
}

function render(state, width = 92, maxLines) {
  return renderConfigSurface({
    kind: 'config',
    view: 'systemPrompt',
    activeTab: 'general',
    tabs: TABS,
    state
  }, width, maxLines === undefined ? {} : {maxLines});
}

test('menu view shows source facts, six actions, and the dynamic section summary', () => {
  const layout = render(createState({globalContent: 'global prompt'}));
  const text = layout.lines.map(stripAnsi).join('\n');

  assert.match(text, /系统提示词/);
  assert.match(text, /当前生效\s+全局 SYSTEM\.md/);
  assert.match(text, /项目文件\s+不存在 · \/work\/repo\/SYSTEM\.md/);
  assert.match(text, /全局文件\s+\/home\/user\/\.echo\/SYSTEM\.md · 1 行/);
  assert.match(text, /查看当前生效的 system prompt/);
  assert.match(text, /编辑项目 SYSTEM\.md\s+新建/);
  assert.match(text, /编辑全局 SYSTEM\.md\s+修改现有文件/);
  assert.match(text, /删除项目 SYSTEM\.md（不可用）\s+文件不存在/);
  assert.match(text, /删除全局 SYSTEM\.md\s+已存在/);
  assert.match(text, /返回常规设置/);
  assert.match(text, /动态段（运行时拼装，不可编辑）/);
  assert.match(text, /Runtime environment\s+cwd · ~12 tokens/);
  assert.match(text, /Available Skills\s+3 个已启用 · ~120 tokens/);
  assert.equal(layout.showCursor, false);
  assert.equal(layout.hitRegions, undefined);
  // 视图不提供字母快捷键，避免用户误以为存在 e/g/r 之类的直接操作。
  assert.doesNotMatch(text, /e 编辑|g 切换|r 恢复/);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= 88));
});

test('menu view keeps the focused action visible at tiny heights', () => {
  const rows = ['view', 'editProject', 'editGlobal', 'deleteProject', 'deleteGlobal', 'back'];
  const labels = {
    view: '查看当前生效的 system prompt',
    editProject: '编辑项目 SYSTEM.md',
    editGlobal: '编辑全局 SYSTEM.md',
    deleteProject: '删除项目 SYSTEM.md',
    deleteGlobal: '删除全局 SYSTEM.md',
    back: '返回常规设置'
  };

  for (let selectedIndex = 0; selectedIndex < rows.length; selectedIndex += 1) {
    const state = createState({projectContent: 'project prompt', globalContent: 'global prompt'});
    state.selectedIndex = selectedIndex;

    for (const maxLines of [1, 2, 3, 5, 8, 12]) {
      const layout = render(state, 70, maxLines);
      const focusLines = layout.lines.map(stripAnsi).filter((line) => line.includes('▌'));
      assert.equal(
        focusLines.filter((line) => line.includes(labels[rows[selectedIndex]].slice(0, 4))).length,
        1,
        `${rows[selectedIndex]}, height=${maxLines}`
      );
      assert.ok(layout.lines.length <= maxLines);
    }
  }
});

test('read view numbers the base text and applies the scroll offset window', () => {
  const content = Array.from({length: 20}, (_value, index) => `line ${index + 1}`).join('\n');
  const state = createState({projectContent: content, patch: {mode: 'read', readScroll: 5}});
  const layout = render(state, 92, 10);
  const text = layout.lines.map(stripAnsi).join('\n');

  assert.match(text, /只读 · 项目 SYSTEM\.md/);
  assert.match(text, /6 │ line 6/);
  assert.doesNotMatch(text, /1 │ line 1\n/);
  assert.match(text, /↑\/↓ 逐行 · PgUp\/PgDn 翻页 · Esc 返回/);
  assert.ok(layout.lines.length <= 10);
  assert.equal(layout.showCursor, false);
});

test('read view clamps the scroll offset to the last visible window', () => {
  const content = Array.from({length: 6}, (_value, index) => `line ${index + 1}`).join('\n');
  const state = createState({projectContent: content, patch: {mode: 'read', readScroll: 99}});
  const text = render(state, 92, 10).lines.map(stripAnsi).join('\n');

  // 视窗为 5 行时，最大起点是最后一行能落在窗口底部，因此从第 2 行开始渲染。
  assert.match(text, /2 │ line 2/);
  assert.match(text, /6 │ line 6/);
  assert.doesNotMatch(text, /1 │ line 1\n/);
});

test('read view wraps long lines instead of truncating them', () => {
  const longLine = Array.from({length: 30}, (_value, index) => `segment-${index + 1}`).join(' ');
  const state = createState({projectContent: longLine, patch: {mode: 'read'}});
  const text = render(state, 60, 20).lines.map(stripAnsi).join('\n');

  assert.doesNotMatch(text, /…/);
  assert.match(text, /segment-1/);
  // 同一条逻辑行折出的续行不重复行号，但内容仍在同一屏内连续可见。
  assert.match(text, /segment-30/);
  assert.equal(text.match(/│ 1 │/gu)?.length ?? 0, 1);
});

test('edit view projects the composer and reports a visible cursor position', () => {
  const state = createState({patch: {draft: createComposer('first\nsecond'), mode: 'edit', target: 'project'}});
  const layout = render(state, 92, 14);
  const text = layout.lines.map(stripAnsi).join('\n');

  assert.match(text, /编辑 项目 SYSTEM\.md/);
  assert.match(text, /first/);
  assert.match(text, /second/);
  assert.match(text, /Enter 保存 · Ctrl\+J 换行 · Esc 取消/);
  assert.equal(layout.showCursor, true);
  assert.ok(layout.cursorRow >= 0 && layout.cursorRow < layout.lines.length);
  assert.ok(layout.cursorColumn >= 0);
});

test('edit view keeps the cursor row inside a small window', () => {
  const content = Array.from({length: 30}, (_value, index) => `row ${index + 1}`).join('\n');
  const composer = createComposer(content);
  const state = createState({patch: {draft: composer, mode: 'edit', target: 'global'}});
  const layout = render(state, 92, 8);
  const visible = layout.lines[layout.cursorRow];

  assert.match(stripAnsi(visible), /row 30/);
  assert.ok(layout.lines.length <= 8);
});

test('save confirmation shows only the overwrite fact', () => {
  const state = createState({
    projectContent: 'old prompt',
    patch: {confirmIndex: 0, mode: 'confirmSave', pendingOverwrites: true, target: 'project'}
  });
  const text = render(state).lines.map(stripAnsi).join('\n');

  assert.match(text, /确认写入/);
  assert.match(text, /写入目标\s+\/work\/repo\/SYSTEM\.md/);
  assert.match(text, /覆盖\s+是（替换现有文件）/);
  assert.doesNotMatch(text, /字节|B →/);
  assert.match(text, /确认写入\s+原子替换目标文件/);
  assert.match(text, /返回编辑\s+保留当前草稿/);
});

test('delete confirmation shows the fallback target', () => {
  const state = createState({
    globalContent: 'global prompt',
    projectContent: 'project prompt',
    patch: {confirmIndex: 1, mode: 'confirmReset', pendingFallback: '全局 /home/user/.echo/SYSTEM.md', target: 'project'}
  });
  const text = render(state).lines.map(stripAnsi).join('\n');

  assert.match(text, /确认删除/);
  assert.match(text, /将删除\s+\/work\/repo\/SYSTEM\.md/);
  assert.match(text, /回落\s+全局 \/home\/user\/\.echo\/SYSTEM\.md/);
  assert.match(text, /确认删除\s+只删除该文件/);
  assert.match(text, /取消\s+保留文件/);
});

test('renderer projects errors and feedback without mutating state', () => {
  const state = createState({patch: {error: '写入失败：磁盘只读'}});
  const original = structuredClone(state);
  const text = render(state).lines.map(stripAnsi).join('\n');

  assert.match(text, /写入失败：磁盘只读/);
  assert.deepEqual(state, original);
});
