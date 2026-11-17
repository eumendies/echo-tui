const assert = require('node:assert/strict');
const test = require('node:test');

const { INPUT_EVENTS } = require('../../src/input/event-types');
const { BUILT_IN_SYSTEM_PROMPT } = require('../../src/agent/context/system-prompt');
const { DEFAULT_APP_SETTINGS } = require('../../src/config/app-settings-config');
const { ConfigCommandHandler } = require('../../src/commands/config/handler');
const { createCommandRuntime } = require('../../src/app/command/command-runtime');
const { getGeneralConfigRowIds } = require('../../src/commands/config/state');

const PROJECT_PATH = '/work/repo/SYSTEM.md';
const GLOBAL_PATH = '/home/user/.echo/SYSTEM.md';

/**
 * 内存版系统提示词端口：快照与写删都作用于同一份可变内容，便于断言交互链路。
 */
function createSystemPromptDriver(options = {}) {
  const state = {
    projectContent: options.projectContent,
    globalContent: options.globalContent,
    saved: [],
    deleted: []
  };

  const createFact = (filePath, content) => {
    if (content === undefined) {
      return {exists: false, filePath, lines: 0};
    }

    return {
      content,
      exists: true,
      filePath,
      lines: content.split('\n').length
    };
  };

  const createSnapshot = () => {
    const project = createFact(PROJECT_PATH, state.projectContent);
    const global = createFact(GLOBAL_PATH, state.globalContent);
    const sourceKind = project.exists ? 'project' : global.exists ? 'global' : 'builtin';
    const baseContent = sourceKind === 'project'
      ? project.content
      : sourceKind === 'global'
        ? global.content
        : BUILT_IN_SYSTEM_PROMPT;

    return {baseContent, global, project, sourceKind};
  };

  const handler = new ConfigCommandHandler();
  const runtime = createCommandRuntime({
    resolveSlashCommand: () => handler,
    host: {
      ui: {render() {}, exit() {}},
      theme: {listThemes: () => []},
      config: {
        readSettings: () => structuredClone(DEFAULT_APP_SETTINGS),
        listApprovalModelProfiles: () => [],
        readDraft: () => ({providers: [], selectedModelId: undefined, rootConfig: {}}),
        readToolsDraft: () => ({disabledTools: []}),
        listToolCatalog: () => [],
        readSandboxDraft: () => ({mode: 'off', network: false, extraWritablePaths: []}),
        saveSettings: () => ({ok: true}),
        saveDraft: () => ({ok: true}),
        saveToolsDraft: () => ({ok: true}),
        saveSandboxDraft: () => ({ok: true}),
        readSystemPrompt: () => ({
          ok: true,
          snapshot: createSnapshot(),
          dynamicSections: [
            {label: 'Runtime environment', detail: 'cwd', estimatedTokens: 12},
            {label: 'AGENTS.md instructions', detail: '未发现'},
            {label: 'Available Skills', detail: '模型配置不可读'},
            {label: 'Memory', detail: 'user 0 条 · agent 0 项', estimatedTokens: 8}
          ]
        }),
        saveSystemPrompt(target, content) {
          const normalized = content.replace(/\r\n?/g, '\n').trim();

          if (normalized === '') {
            return {ok: false, error: '内容为空：空文件等价于不使用覆盖，请改用删除动作'};
          }

          const current = target === 'project' ? state.projectContent : state.globalContent;

          if (current === normalized) {
            return {ok: true, filePath: target === 'project' ? PROJECT_PATH : GLOBAL_PATH, overwritten: true, unchanged: true};
          }

          state.saved.push({content: normalized, target});

          if (target === 'project') {
            state.projectContent = normalized;
          } else {
            state.globalContent = normalized;
          }

          return {
            ok: true,
            filePath: target === 'project' ? PROJECT_PATH : GLOBAL_PATH,
            overwritten: current !== undefined,
            unchanged: false
          };
        },
        deleteSystemPrompt(target) {
          state.deleted.push(target);

          if (target === 'project') {
            state.projectContent = undefined;
          } else {
            state.globalContent = undefined;
          }

          return {ok: true, filePath: target === 'project' ? PROJECT_PATH : GLOBAL_PATH, removed: true};
        }
      },
      status: {
        getViewport: () => ({maxLines: 26, width: 92})
      }
    }
  });

  runtime.startFromText('/config');
  const surface = () => runtime.getSurface();
  const send = (type, value) => runtime.handleEvent(value === undefined ? {type} : {type, value});

  return {
    state,
    surface,
    send,
    async openSystemPromptView() {
      assert.equal(surface().view, 'general');
      const target = getGeneralConfigRowIds(surface().state).indexOf('systemPrompt');
      assert.ok(target >= 0);
      const distance = target - surface().state.selectedIndex;
      for (let index = 0; index < Math.abs(distance); index += 1) {
        await send(distance < 0 ? INPUT_EVENTS.MOVE_UP : INPUT_EVENTS.MOVE_DOWN);
      }
      await send(INPUT_EVENTS.SUBMIT);
      assert.equal(surface().view, 'systemPrompt');
    },
    async moveTo(rowId) {
      const rows = surface().state.menuRows.map((row) => row.id);
      const target = rows.indexOf(rowId);
      assert.ok(target >= 0, rowId);
      for (let index = 0; index < rows.length && surface().state.selectedIndex !== target; index += 1) {
        await send(surface().state.selectedIndex < target ? INPUT_EVENTS.MOVE_DOWN : INPUT_EVENTS.MOVE_UP);
      }
      assert.equal(surface().state.selectedIndex, target);
    }
  };
}

test('system prompt row opens the menu view and keeps the general draft untouched', async () => {
  const driver = createSystemPromptDriver();
  const summary = driver.surface().state.systemPromptSummary;
  assert.deepEqual(summary, {kind: 'builtin'});
  const draftFingerprint = driver.surface().state.initialDraftFingerprint;

  await driver.openSystemPromptView();
  assert.equal(driver.surface().state.mode, 'menu');
  assert.deepEqual(
    driver.surface().state.menuRows.map((row) => row.id),
    ['view', 'editProject', 'editGlobal', 'deleteProject', 'deleteGlobal', 'back']
  );
  assert.equal(driver.surface().state.dynamicSections.length, 4);

  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.equal(driver.surface().view, 'general');
  assert.equal(driver.surface().state.initialDraftFingerprint, draftFingerprint);
  assert.equal(driver.surface().tabs.find((tab) => tab.id === 'general').status, undefined);
});

test('system prompt menu focuses six rows, clamps at bounds, and returns to the general tab', async () => {
  const driver = createSystemPromptDriver();
  await driver.openSystemPromptView();

  for (let index = 0; index < 8; index += 1) {
    await driver.send(INPUT_EVENTS.MOVE_DOWN);
  }
  assert.equal(driver.surface().state.selectedIndex, 5);

  for (let index = 0; index < 8; index += 1) {
    await driver.send(INPUT_EVENTS.MOVE_UP);
  }
  assert.equal(driver.surface().state.selectedIndex, 0);

  await driver.moveTo('back');
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.surface().view, 'general');
});

test('system prompt read view scrolls with arrows and page keys, then returns to the menu', async () => {
  const content = Array.from({length: 30}, (_value, index) => `line ${index + 1}`).join('\n');
  const driver = createSystemPromptDriver({projectContent: content});
  await driver.openSystemPromptView();
  await driver.moveTo('view');
  await driver.send(INPUT_EVENTS.SUBMIT);

  assert.equal(driver.surface().state.mode, 'read');
  assert.equal(driver.surface().state.readScroll, 0);

  await driver.send(INPUT_EVENTS.MOVE_DOWN);
  await driver.send(INPUT_EVENTS.MOVE_DOWN);
  assert.equal(driver.surface().state.readScroll, 2);

  await driver.send(INPUT_EVENTS.PAGE_DOWN);
  // 30 行内容在 26 行预算下可滚动 9 行，翻页在边界处夹取。
  assert.equal(driver.surface().state.readScroll, 9);

  await driver.send(INPUT_EVENTS.PAGE_UP);
  assert.equal(driver.surface().state.readScroll, 0);

  for (let index = 0; index < 40; index += 1) {
    await driver.send(INPUT_EVENTS.MOVE_DOWN);
  }
  assert.equal(driver.surface().state.readScroll, 9);

  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.equal(driver.surface().state.mode, 'menu');
  assert.equal(driver.surface().state.readScroll, 0);
});

test('editing the project file prefills builtin text and writes through the explicit confirm step', async () => {
  const driver = createSystemPromptDriver();
  await driver.openSystemPromptView();
  await driver.moveTo('editProject');
  await driver.send(INPUT_EVENTS.SUBMIT);

  assert.equal(driver.surface().state.mode, 'edit');
  assert.equal(driver.surface().state.target, 'project');
  assert.equal(driver.surface().state.draft.chars.join(''), BUILT_IN_SYSTEM_PROMPT);

  // 在预填内容末尾追加 CRLF 与换行，验证归一化与确认前的写盘边界。
  await driver.send(INPUT_EVENTS.TEXT, '\r\n\r\nextra');
  await driver.send(INPUT_EVENTS.INSERT_NEWLINE);
  await driver.send(INPUT_EVENTS.TEXT, 'rules');
  await driver.send(INPUT_EVENTS.SUBMIT);

  assert.equal(driver.surface().state.mode, 'confirmSave');
  assert.equal(driver.surface().state.pendingOverwrites, false);
  const expected = `${BUILT_IN_SYSTEM_PROMPT}\n\nextra\nrules`;
  assert.deepEqual(driver.state.saved, []);

  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.deepEqual(driver.state.saved, [{content: expected, target: 'project'}]);
  assert.equal(driver.surface().state.mode, 'menu');
  assert.match(driver.surface().state.feedback, /下一轮 assistant run 生效/);
  assert.equal(driver.surface().state.sourceKind, 'project');
  assert.equal(driver.surface().state.project.lines, expected.split('\n').length);
});

test('saving unchanged content skips the write and keeps the feedback factual', async () => {
  const driver = createSystemPromptDriver({projectContent: 'same prompt'});
  await driver.openSystemPromptView();
  await driver.moveTo('editProject');
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.send(INPUT_EVENTS.SUBMIT);

  assert.equal(driver.surface().state.pendingOverwrites, true);
  await driver.send(INPUT_EVENTS.SUBMIT);

  assert.deepEqual(driver.state.saved, []);
  assert.equal(driver.surface().state.feedback, '内容未变化，未写入文件');
});

test('empty draft keeps the confirmation open with the port error', async () => {
  const driver = createSystemPromptDriver();
  await driver.openSystemPromptView();
  await driver.moveTo('editGlobal');
  await driver.send(INPUT_EVENTS.SUBMIT);
  // 清空预填内容：BACKSPACE 逐个删除 grapheme，直到草稿为空。
  for (let index = 0; index < BUILT_IN_SYSTEM_PROMPT.length + 8; index += 1) {
    await driver.send(INPUT_EVENTS.BACKSPACE);
  }
  assert.equal(driver.surface().state.draft.chars.length, 0);
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.send(INPUT_EVENTS.SUBMIT);

  assert.equal(driver.surface().state.mode, 'confirmSave');
  assert.match(driver.surface().state.error, /内容为空/);
  assert.deepEqual(driver.state.saved, []);
});

test('cancelling the save confirmation returns to editing with the draft intact', async () => {
  const driver = createSystemPromptDriver();
  await driver.openSystemPromptView();
  await driver.moveTo('editGlobal');
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.send(INPUT_EVENTS.SUBMIT);

  await driver.send(INPUT_EVENTS.MOVE_DOWN);
  assert.equal(driver.surface().state.confirmIndex, 1);
  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.equal(driver.surface().state.mode, 'edit');
  assert.equal(driver.surface().state.draft.chars.join(''), BUILT_IN_SYSTEM_PROMPT);

  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.equal(driver.surface().state.mode, 'menu');
  // target 是必填字段：取消后保留上次选择，只是 menu 渲染不使用它。
  assert.equal(driver.surface().state.target, 'global');
});

test('deleting a project override confirms the fallback and refreshes the general summary', async () => {
  const driver = createSystemPromptDriver({projectContent: 'project prompt', globalContent: 'global prompt'});
  await driver.openSystemPromptView();
  await driver.moveTo('deleteProject');
  await driver.send(INPUT_EVENTS.SUBMIT);

  assert.equal(driver.surface().state.mode, 'confirmReset');
  assert.equal(driver.surface().state.target, 'project');

  await driver.send(INPUT_EVENTS.SUBMIT);
  assert.deepEqual(driver.state.deleted, ['project']);
  assert.equal(driver.surface().state.sourceKind, 'global');
  assert.match(driver.surface().state.feedback, /回落到 全局 \/home\/user\/\.echo\/SYSTEM\.md/);

  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.equal(driver.surface().view, 'general');
  assert.deepEqual(driver.surface().state.systemPromptSummary, {kind: 'global'});
});

test('deleting a missing override stays on the menu with an explicit notice', async () => {
  const driver = createSystemPromptDriver({globalContent: 'global prompt'});
  await driver.openSystemPromptView();
  await driver.moveTo('deleteProject');
  await driver.send(INPUT_EVENTS.SUBMIT);

  assert.equal(driver.surface().state.mode, 'menu');
  assert.match(driver.surface().state.error, /目标文件不存在/);
  assert.deepEqual(driver.state.deleted, []);
});

test('tab exits from menu and read but is ignored while editing', async () => {
  const driver = createSystemPromptDriver();
  await driver.openSystemPromptView();
  await driver.send(INPUT_EVENTS.TAB);
  assert.equal(driver.surface().activeTab, 'models');
  assert.equal(driver.surface().view, 'models');

  await driver.send(INPUT_EVENTS.TAB);
  await driver.send(INPUT_EVENTS.TAB);
  await driver.send(INPUT_EVENTS.TAB);
  await driver.send(INPUT_EVENTS.TAB);
  await driver.openSystemPromptView();
  await driver.moveTo('view');
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.send(INPUT_EVENTS.TAB);
  assert.equal(driver.surface().activeTab, 'models');

  await driver.send(INPUT_EVENTS.TAB);
  await driver.send(INPUT_EVENTS.TAB);
  await driver.send(INPUT_EVENTS.TAB);
  await driver.send(INPUT_EVENTS.TAB);
  await driver.openSystemPromptView();
  await driver.moveTo('editProject');
  await driver.send(INPUT_EVENTS.SUBMIT);
  await driver.send(INPUT_EVENTS.TAB);
  assert.equal(driver.surface().state.mode, 'edit');
  assert.equal(driver.surface().activeTab, 'general');
});

test('escape from the menu returns to the general tab and keeps config center open', async () => {
  const driver = createSystemPromptDriver();
  await driver.openSystemPromptView();
  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.equal(driver.surface().view, 'general');
  // 常规草稿未修改，再按 Esc 直接关闭配置中心，而不是进入放弃确认。
  await driver.send(INPUT_EVENTS.ESCAPE);
  assert.equal(driver.surface(), null);
});
