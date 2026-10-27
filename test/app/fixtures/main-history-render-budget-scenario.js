const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.cwd();
const scenario = process.argv[2] || 'settings';
const compacted = scenario === 'compacted';
const configPath = path.join(os.homedir(), '.echo', 'config.json');
fs.mkdirSync(path.dirname(configPath), {recursive: true});
let config = {ui: {historyRenderLineLimit: 1000}, updates: {checkOnStartup: false}};
fs.writeFileSync(configPath, JSON.stringify(config));

const terminal = {
  size: {columns: 100, rows: 30},
  cleanup() {},
  getSize() { return this.size; },
  setMouseTracking() {},
  requestCursorPosition() { return false; }
};
require(path.join(root, 'dist/src/terminal/tty')).setupTerminal = () => terminal;

// 保留真实排版和 ANSI 输出，仅将终端字节写到内存，并在现有 renderer 边界观察结果。
const {stripAnsi} = require(path.join(root, 'dist/src/render/layout'));
const rendererModule = require(path.join(root, 'dist/src/render/app-renderer'));
const createRenderer = rendererModule.createAppRenderer;
const frames = [];
rendererModule.createAppRenderer = () => {
  let output = '';
  const renderer = createRenderer({write(chunk) { output += chunk; return true; }});
  const wrapped = {syncMainTranscript: (...args) => renderer.syncMainTranscript(...args), clearFooter: () => renderer.clearFooter()};
  for (const method of ['render', 'renderRecords', 'renderInitial', 'renderDestructive']) {
    wrapped[method] = (options, ...args) => {
      output = '';
      const pointer = renderer[method](options, ...args);
      frames.push({
        method, text: stripAnsi(output), output,
        owner: options.streamingOwner,
        budget: options.renderPreferences.historyRenderLineLimit,
        base: options.mainTranscript?.baseRecordIndex,
        main: !!options.mainTranscript,
        count: options.records?.length,
        composer: structuredClone(options.composer),
        surface: structuredClone(options.commandSurface),
        pointer
      });
      return pointer;
    };
  }
  return wrapped;
};

const storeModule = require(path.join(root, 'dist/src/persistence/transcript-store'));
const store = storeModule.createTranscriptStore();
let historyReads = 0;
for (const method of ['loadSession', 'loadSessionReadOnly']) {
  const original = store[method];
  store[method] = (...args) => { historyReads += 1; return original(...args); };
}
storeModule.createTranscriptStore = () => store;

function longMessage(marker, length = 90) {
  return `${marker}_BEGIN\n\n\`\`\`text\n${Array.from({length}, (_, index) => `${marker} row${index} ${'x'.repeat(48)}`).join('\n')}\n\`\`\`\n\n${marker}_END`;
}

const subagent = {role: 'subagent', runId: 'history-run', parentToolCallId: 'delegate-history', agentName: 'explorer'};
const records = [
  {role: 'user', text: 'ARCHIVED_PREFIX'},
  {role: 'assistant', text: 'ARCHIVED_ANSWER'},
  ...(compacted ? [{role: 'compaction_notice', text: '已将较早的 2 条历史压缩为摘要'}] : []),
  {...subagent, text: '', event: {kind: 'start', task: 'history budget view'}},
  // 每条 rail 正文低于既有单事件显示上限，整段独立视图则超过主会话的 500 行预算。
  ...Array.from({length: 60}, (_, index) => ({
    ...subagent, event: {kind: 'assistant'},
    text: `VIEW_${index}_BEGIN\n${Array.from({length: 8}, (_, row) => `view ${index} row ${row}`).join('\n')}\nVIEW_${index}_END`
  })),
  {...subagent, text: '', event: {kind: 'completed', durationMs: 25}},
  ...Array.from({length: 16}, (_, index) => ({role: 'assistant', text: longMessage(`ACTIVE_${String(index).padStart(2, '0')}`)})),
  {role: 'reasoning_summary', text: 'REASONING_MARKER'},
  {role: 'user', text: 'UNDO_REQUEST'},
  {role: 'assistant', text: 'UNDO_ANSWER'}
];
const compaction = compacted ? {activeStartIndex: 2, summaryText: 'archived summary only', createdAt: '2026-05-19T00:00:00.000Z'} : null;
const reference = store.createSession(root, {op: 'batch', operations: [
  {op: 'append_records', records},
  {op: 'set_compaction', compaction},
  {op: 'set_todo_state', todoState: {items: [{id: 'todo_1', text: 'retained task', status: 'open'}], updatedAt: '2026-05-19T00:00:00.000Z'}},
  {op: 'set_change_history', changeHistory: [{
    id: 'history-checkpoint', createdAt: '2026-05-19T00:00:00.000Z', cwd: root,
    transcriptStartIndex: records.length - 2, status: 'ready', files: [],
    ...(compaction ? {compactionBefore: compaction} : {})
  }]}
]});
const journalPath = store.getSessionFilePath(root, reference.sessionId);
const originalJournal = fs.readFileSync(journalPath, 'utf8');

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));
const {getGeneralConfigRowIds} = require(path.join(root, 'dist/src/commands/config/state'));
let notifyWatcher;
let configReads = 0;
const userConfigContext = new UserConfigContext({
  configPath,
  readFile(...args) { configReads += 1; return fs.readFileSync(...args); },
  watchConfig(onChange) { notifyWatcher = onChange; return {close() {}}; }
});
const turns = [];
const app = createApp(
  async (session, callbacks) => {
    turns.push(session);
    const answer = session.conversationKind === 'btw' ? longMessage(`BTW_${turns.length}`, 350) : 'PROVIDER_ANSWER';
    callbacks.onComplete(answer);
    return answer;
  },
  {bootstrap: async () => {}, close: async () => {}, getDiagnostics: () => [], listTools: () => [], listPrompts: () => [], reload: async () => {}},
  {emit() {}, updateConfig() {}},
  disabledObservation,
  {appendEvent: () => null, listDailyUsage: () => []},
  userConfigContext
);

async function event(type, value) { await app.handleEvent({type, ...(value === undefined ? {} : {value})}); }
async function submit(text) { await event(INPUT_EVENTS.TEXT, text); await event(INPUT_EVENTS.SUBMIT); }
function latest() { return frames.at(-1); }
function destructive() { return frames.filter((frame) => frame.method === 'renderDestructive'); }
function lastDestructive() { return destructive().at(-1); }
async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function summary(frame) {
  const activeBlocks = frame.text.match(/ACTIVE_\d\d_BEGIN/g) || [];
  return {
    owner: frame.owner, budget: frame.budget, main: frame.main, base: frame.base ?? null, count: frame.count,
    oldActive: frame.text.includes('ACTIVE_00_BEGIN'), latestActive: frame.text.includes('ACTIVE_15_END'),
    archived: frame.text.includes('ARCHIVED_PREFIX'), undo: frame.text.includes('UNDO_ANSWER'),
    reasoning: frame.text.includes('REASONING_MARKER'),
    viewFirst: frame.text.includes('VIEW_0_BEGIN'), viewLast: frame.text.includes('VIEW_59_END'),
    btwFirst: frame.text.includes('BTW_1_BEGIN'), btwLast: frame.text.includes('BTW_2_END'),
    activeBlocks,
    completeBlocks: activeBlocks.every((marker) => frame.text.includes(marker.replace('_BEGIN', '_END'))),
    budgetHints: frame.text.split('较早的部分历史未展开').length - 1,
    compactionHints: frame.text.split('完整记录保存在会话文件中').length - 1,
    clears: frame.output.split('\x1b[3J').length - 1,
    alternateScreen: /\x1b\[\?1049h/.test(frame.output)
  };
}

function externalBudget(limit, ui = {}) {
  config = {...config, ui: {...config.ui, ...ui, historyRenderLineLimit: limit}};
  fs.writeFileSync(configPath, JSON.stringify(config));
  notifyWatcher();
}

async function focusGeneral(rowId) {
  const state = latest().surface.state;
  const target = getGeneralConfigRowIds(state).indexOf(rowId);
  while (latest().surface.state.selectedIndex !== target) {
    await event(latest().surface.state.selectedIndex < target ? INPUT_EVENTS.MOVE_DOWN : INPUT_EVENTS.MOVE_UP);
  }
}

async function settingsScenario() {
  const initial = summary(lastDestructive());
  await submit('/config');
  await focusGeneral('historyRenderLineLimit');
  const beforeDraft = destructive().length;
  await event(INPUT_EVENTS.MOVE_LEFT);
  const draftOnly = destructive().length === beforeDraft
    && latest().budget === 1000 && latest().surface.state.draft.historyRenderLineLimit === 500
    && JSON.parse(fs.readFileSync(configPath, 'utf8')).ui.historyRenderLineLimit === 1000;
  await focusGeneral('save');
  const saveFocus = latest().surface.state.selectedIndex;
  const beforeSave = destructive().length;
  await event(INPUT_EVENTS.SUBMIT);
  const saved = summary(lastDestructive());
  const savedSurface = latest().surface;
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const save = {
    recoveries: destructive().length - beforeSave, focus: savedSurface.state.selectedIndex, expectedFocus: saveFocus,
    destructiveSurface: lastDestructive().surface.kind,
    destructiveFocus: lastDestructive().surface.state.selectedIndex,
    kind: savedSurface.kind, tab: savedSurface.activeTab, feedback: savedSurface.state.feedback,
    dirty: savedSurface.tabs.find((tab) => tab.id === 'general').status || null,
    persisted: JSON.parse(fs.readFileSync(configPath, 'utf8')).ui.historyRenderLineLimit
  };
  let before = frames.length;
  notifyWatcher();
  notifyWatcher();
  const duplicateFrames = frames.length - before;
  before = frames.length;
  config.unknownRevision = 'unrelated snapshot';
  fs.writeFileSync(configPath, JSON.stringify(config));
  notifyWatcher();
  const unrelatedFrames = frames.length - before;

  const surfaceBeforeExternal = JSON.stringify(latest().surface);
  before = destructive().length;
  externalBudget(0);
  const external = summary(lastDestructive());
  const externalRecoveries = destructive().length - before;
  const surfacePreserved = JSON.stringify(latest().surface) === surfaceBeforeExternal;
  before = destructive().length;
  externalBudget(500, {showReasoningSummary: false});
  const combined = summary(lastDestructive());
  const combinedRecoveries = destructive().length - before;
  before = frames.length;
  notifyWatcher();
  const combinedDuplicateFrames = frames.length - before;
  externalBudget('1000');
  const normalized = summary(lastDestructive());
  before = frames.length;
  externalBudget(750);
  const invalidSameFrames = frames.length - before;
  const readsBeforeHotPath = configReads;
  const historyBeforeHotPath = historyReads;
  for (let tick = 0; tick < 5; tick += 1) app.render();
  app.renderResizeRecovery();
  return {
    initial, draftOnly, save, saved, duplicateFrames, unrelatedFrames, external, externalRecoveries,
    surfacePreserved, combined, combinedRecoveries, combinedDuplicateFrames, normalized, invalidSameFrames,
    hotPathConfigReads: configReads - readsBeforeHotPath, hotPathHistoryReads: historyReads - historyBeforeHotPath,
    journalUnchanged: fs.readFileSync(journalPath, 'utf8') === originalJournal
  };
}

async function ownersScenario() {
  await submit('/btw side one');
  await waitFor(() => turns.length === 1 && !latest().surface, 'BTW first turn did not finish');
  await submit('side two');
  const beforeBtw = frames.length;
  externalBudget(500);
  const btwBudgetFrames = frames.length - beforeBtw;
  app.renderResizeRecovery();
  const btw = summary(lastDestructive());
  const beforeCombined = destructive().length;
  externalBudget(2000, {showReasoningSummary: false});
  const btwCombined = summary(lastDestructive());
  const combinedRecoveries = destructive().length - beforeCombined;
  await event(INPUT_EVENTS.ESCAPE);
  const returnedBtw = summary(lastDestructive());
  externalBudget(500);
  await event(INPUT_EVENTS.OPEN_SUBAGENT_VIEW);
  const view = summary(lastDestructive());
  const beforeView = frames.length;
  externalBudget(0);
  const viewBudgetFrames = frames.length - beforeView;
  app.renderResizeRecovery();
  const viewRecovery = summary(lastDestructive());
  await event(INPUT_EVENTS.ESCAPE);
  return {
    btwBudgetFrames, btw, btwCombined, combinedRecoveries, returnedBtw,
    view, viewBudgetFrames, viewRecovery, returnedView: summary(lastDestructive()),
    journalUnchanged: fs.readFileSync(journalPath, 'utf8') === originalJournal
  };
}

async function recoveryScenario() {
  const resumed = summary(lastDestructive());
  const readsBeforeDisplay = historyReads;
  await event(INPUT_EVENTS.TEXT, 'unsent resize draft');
  await event(INPUT_EVENTS.MOVE_LEFT);
  await event(INPUT_EVENTS.INSERT_NEWLINE);
  const composer = JSON.stringify(latest().composer);
  terminal.size = {columns: 60, rows: 24};
  process.stdout.emit('resize');
  const resized = summary(lastDestructive());
  const composerPreserved = JSON.stringify(lastDestructive().composer) === composer;
  // 清空草稿后经真实外观页保存主题，验证它与 resize 使用同一主历史预算入口。
  while (latest().composer.cursor < latest().composer.chars.length) await event(INPUT_EVENTS.MOVE_RIGHT);
  while (latest().composer.chars.length > 0) await event(INPUT_EVENTS.BACKSPACE);
  await submit('/config');
  while (latest().surface.activeTab !== 'appearance') await event(INPUT_EVENTS.TAB);
  const oldTheme = latest().surface.state.themes.findIndex((theme) => theme.selected);
  await event(oldTheme === 0 ? INPUT_EVENTS.MOVE_DOWN : INPUT_EVENTS.MOVE_UP);
  const themeFocus = latest().surface.state.selectedIndex;
  const beforeTheme = destructive().length;
  await event(INPUT_EVENTS.SUBMIT);
  const themed = summary(lastDestructive());
  const themeRecoveries = destructive().length - beforeTheme;
  const themeSurfacePreserved = latest().surface.activeTab === 'appearance' && latest().surface.state.selectedIndex === themeFocus;
  externalBudget(0);
  const unlimited = summary(lastDestructive());
  const displayHistoryReads = historyReads - readsBeforeDisplay;
  const displayJournalUnchanged = fs.readFileSync(journalPath, 'utf8') === originalJournal;
  await event(INPUT_EVENTS.ESCAPE);
  externalBudget(500);
  await submit('/undo');
  const undoConfirm = latest().surface.kind;
  await event(INPUT_EVENTS.SUBMIT);
  const undone = summary(lastDestructive());
  const undoJournal = fs.readFileSync(journalPath, 'utf8');
  const loaded = store.loadSessionReadOnly(root, reference.sessionId).session;
  await submit('/fork');
  const forkSummaries = store.listSessionSummaries(root);
  const forked = store.loadSessionReadOnly(root, forkSummaries.find((session) => session.sessionId !== reference.sessionId).sessionId).session;
  await event(INPUT_EVENTS.ESCAPE);
  await submit('provider input check');
  const provider = turns.at(-1);
  const expectedProviderRecords = forked.records.slice(compacted ? 2 : 0);
  const providerComplete = JSON.stringify(provider.records.slice(0, -1)) === JSON.stringify(expectedProviderRecords)
    && provider.records.at(-1).text === 'provider input check';
  await submit('/resume');
  await waitFor(() => latest().surface?.previewStatus === 'ready', 'resume preview did not load');
  const preview = JSON.stringify(latest().surface.previewRecords);
  const previewCount = latest().surface.previewRecords.length;
  externalBudget(0);
  const previewPreserved = JSON.stringify(latest().surface.previewRecords) === preview;
  return {
    resumed, resized, composerPreserved, themed, themeRecoveries, themeSurfacePreserved, unlimited,
    displayHistoryReads, displayJournalUnchanged, undoConfirm, undone,
    expectedResidentCount: records.length - (compacted ? 2 : 0),
    persistedCountAfterUndo: loaded.records.length,
    expectedCountAfterUndo: records.length - 2,
    undoPreservedPrefix: loaded.records[0].text === 'ARCHIVED_PREFIX',
    undoCompaction: loaded.compaction || null,
    forkComplete: JSON.stringify(forked.records) === JSON.stringify(loaded.records),
    forkTodo: forked.todoState.items[0].text,
    providerComplete, providerBase: provider.baseRecordIndex, providerCompaction: provider.compaction || null,
    providerContainsOmitted: provider.records.some((record) => record.text.includes('ACTIVE_00_BEGIN')),
    providerContainsBudgetHint: provider.records.some((record) => record.text.includes('较早的部分历史未展开')),
    previewCount, previewPreserved,
    sourceJournalUnchangedByFork: fs.readFileSync(journalPath, 'utf8') === undoJournal
  };
}

(async () => {
  app.start();
  await waitFor(() => frames.length > 2, 'startup did not finish');
  await submit('/resume');
  await waitFor(() => latest().surface?.kind === 'resume', 'resume browser did not open');
  await event(INPUT_EVENTS.SUBMIT);
  await waitFor(() => lastDestructive()?.main, 'session did not resume');
  const result = scenario === 'settings' ? await settingsScenario()
    : scenario === 'owners' ? await ownersScenario() : await recoveryScenario();
  userConfigContext.close();
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
