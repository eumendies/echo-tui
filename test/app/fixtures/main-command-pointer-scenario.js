const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.cwd();
const {renderFooterLayout} = require(path.join(root, 'dist/src/render/footer'));
const terminal = {
  cprRequests: 0,
  mouse: [],
  size: {columns: 80, rows: 24},
  cleanup() {},
  getSize() { return this.size; },
  requestCursorPosition() {
    this.cprRequests += 1;
    return true;
  },
  setMouseTracking(enabled) {
    this.mouse.push(enabled);
  }
};
require(path.join(root, 'dist/src/terminal/tty')).setupTerminal = () => terminal;

let version = 0;
const frames = [];
let lastCopyWheelRegions = [];
function capture(kind, options) {
  const surface = options.commandSurface || null;
  const interactionId = surface?.kind === 'select' ? options.footerInteractionId : null;
  if (surface?.kind === 'copy') {
    const previousCopy = frames.at(-1)?.surfaceKind === 'copy';
    const layout = renderFooterLayout(options);
    const frame = {
      kind, interactionId: options.footerInteractionId || null, surfaceKind: 'copy',
      selectedIndex: surface.selectedIndex, focus: surface.focus, previewScroll: surface.previewScroll,
      selectedIds: surface.selectedIds, hitRegions: layout.hitRegions || [], wheelRegions: layout.wheelRegions || [], cursorRow: layout.cursorRow,
      cursorColumn: layout.cursorColumn
    };
    if (frame.wheelRegions.length > 0) lastCopyWheelRegions = frame.wheelRegions;
    frames.push(frame);
    return {
      version: ++version, cursorRow: layout.cursorRow, cursorColumn: layout.cursorColumn,
      originStable: kind === 'render' && previousCopy, hitRegions: layout.hitRegions || [], wheelRegions: layout.wheelRegions || []
    };
  }
  frames.push({kind, interactionId, selectedIndex: surface?.kind === 'select' ? surface.selectedIndex : null, surfaceKind: surface?.kind || null});
  return {
    version: ++version,
    cursorRow: 0,
    cursorColumn: 0,
    originStable: false,
    hitRegions: interactionId
      ? [{interactionId, owner: 'command-session', target: {kind: 'command_select_option', index: 2}, rowStart: 0, rowEnd: 0, columnStart: 1, columnEnd: 20}]
      : []
  };
}
require(path.join(root, 'dist/src/render/app-renderer')).createAppRenderer = () => ({
  clearFooter() {},
  render: (options) => capture('render', options),
  renderDestructive: (options) => capture('destructive', options),
  renderInitial: (options) => capture('initial', options),
  renderRecords: (options) => capture('records', options)
});

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));

const configPath = path.join(os.homedir(), '.echo', 'config.json');
fs.mkdirSync(path.dirname(configPath), {recursive: true});
fs.writeFileSync(configPath, JSON.stringify({ui: {mouseInteractionEnabled: false}}));
const userConfigContext = new UserConfigContext();
const turns = [];
const app = createApp(
  (_session, callbacks) => new Promise(() => { turns.push(callbacks); }),
  {bootstrap: async () => {}, close: async () => {}, getDiagnostics: () => [], listPrompts: () => [], listTools: () => [], reload: async () => {}},
  {emit() {}, updateConfig() {}},
  disabledObservation,
  {appendEvent: () => null, listDailyUsage: () => []},
  userConfigContext
);

function waitFor(predicate, message) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (attempts++ >= 200) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 5);
  });
}

function mouse(phase, row, column, button = 'left') {
  return {type: INPUT_EVENTS.MOUSE, phase, row, column, button, shift: false, alt: false, ctrl: false};
}

async function wheel(pane, direction) {
  const region = (frames.at(-1).wheelRegions.length ? frames.at(-1).wheelRegions : lastCopyWheelRegions)
    .find((candidate) => candidate.pane === pane);
  if (!region) throw new Error(`missing ${pane} wheel region`);
  await app.handleChunk(`\x1b[<${direction === 'down' ? 65 : 64};${region.columnStart};${region.rowStart + 1}M`);
}

async function calibrate() {
  const frame = frames.at(-1);
  await app.handleChunk(`\x1b[${frame.cursorRow + 1};${frame.cursorColumn + 1}R`);
}

(async () => {
  app.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: '/mode'});
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => frames.at(-1)?.surfaceKind === 'select', 'mode selector did not open');
  const disabledInteractionId = frames.at(-1).interactionId;
  const disabledCprRequests = terminal.cprRequests;

  userConfigContext.saveAppSettingsDraft({...userConfigContext.capture().getAppSettings(), mouseInteractionEnabled: true});
  await waitFor(() => frames.at(-1)?.interactionId === 'command-session' && terminal.mouse.at(-1) === true, 'command pointer consumer did not activate');
  const requestsBeforeHover = terminal.cprRequests;
  app.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  app.handleEvent(mouse('move', 12, 4, 'other'));
  await waitFor(() => frames.at(-1)?.selectedIndex === 2, 'command pointer hover did not select the semantic target');
  const requestsBeforeResize = terminal.cprRequests;

  terminal.size = {columns: 80, rows: 30};
  process.stdout.emit('resize');
  const destructiveFrames = frames.filter((frame) => frame.kind === 'destructive').length;
  app.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  const requestsAfterStaleCpr = terminal.cprRequests;
  app.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});

  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  await waitFor(() => terminal.mouse.at(-1) === false && frames.at(-1)?.interactionId === null, 'command close did not disable pointer tracking');
  const requestsBeforeClosedMouse = terminal.cprRequests;
  app.handleEvent(mouse('down', 12, 4));

  app.handleEvent({type: INPUT_EVENTS.TEXT, value: '/effort'});
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => frames.at(-1)?.surfaceKind !== null, 'effort surface did not open');
  const effortInteractionId = frames.at(-1).interactionId;
  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: Array.from({length: 40}, (_, index) => `preview line ${index}`).join('\n')});
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => turns.length === 1, 'copy fixture user message did not start a turn');
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: '/copy'});
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => frames.at(-1)?.surfaceKind === 'copy', 'copy surface did not open');
  const initialCopy = frames.at(-1);
  const requestsBeforeCopyCpr = terminal.cprRequests;
  await wheel('secondary', 'down');
  const beforeCprScroll = frames.at(-1).previewScroll;
  await calibrate();
  const requestsAfterCopyCpr = terminal.cprRequests;
  await wheel('secondary', 'down');
  const afterStaleCopyCprScroll = frames.at(-1).previewScroll;
  await calibrate();
  await wheel('secondary', 'down');
  const rightScroll = frames.at(-1).previewScroll;
  const rightFocus = frames.at(-1).focus;
  const listRegion = frames.at(-1).hitRegions[0];
  await app.handleChunk(`\x1b[<65;${listRegion.columnStart};${listRegion.rowStart + 1}M`);
  const selectedAfterListWheel = frames.at(-1).selectedIndex;
  const focusAfterListWheel = frames.at(-1).focus;
  const scrollAfterListWheel = frames.at(-1).previewScroll;
  const selectedIdsAfterWheel = frames.at(-1).selectedIds;

  const question = turns[0].onUserQuestionRequest(
    {callId: 'copy-question', toolName: 'ask_user_questions', argumentsText: '{}'},
    {questions: [{question: '选择?', options: [{label: '确定'}]}]}
  );
  await waitFor(() => frames.at(-1)?.surfaceKind === 'choice', 'higher-priority owner did not open');
  const framesBeforeOwnerWheel = frames.length;
  const ownerRegion = lastCopyWheelRegions.find((region) => region.pane === 'secondary');
  await app.handleChunk(`\x1b[<65;${ownerRegion.columnStart};${ownerRegion.rowStart + 1}M`);
  const ownerIgnored = frames.length === framesBeforeOwnerWheel;
  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  await question;
  await waitFor(() => frames.at(-1)?.surfaceKind === 'copy', 'copy surface did not return');
  await calibrate();
  userConfigContext.saveAppSettingsDraft({...userConfigContext.capture().getAppSettings(), mouseInteractionEnabled: false});
  await waitFor(() => frames.at(-1)?.interactionId === null, 'copy pointer did not disable');
  const disabledScrollBefore = frames.at(-1).previewScroll;
  await wheel('secondary', 'down');
  const disabledScrollAfter = frames.at(-1).previewScroll;
  userConfigContext.saveAppSettingsDraft({...userConfigContext.capture().getAppSettings(), mouseInteractionEnabled: true});
  await waitFor(() => frames.at(-1)?.interactionId === 'command-session', 'copy pointer did not re-enable');
  await calibrate();
  await wheel('secondary', 'down');
  const reenabledScroll = frames.at(-1).previewScroll;

  // 强制重绘和 resize 期间各保留一个未回复 CPR，先收到的旧回复不能校准新 footer。
  app.renderResizeRecovery();
  const requestsBeforeCopyResize = terminal.cprRequests;
  terminal.size = {columns: 80, rows: 36};
  process.stdout.emit('resize');
  await calibrate();
  const requestsAfterCopyStaleCpr = terminal.cprRequests;
  const beforeFreshCprScroll = frames.at(-1).previewScroll;
  await wheel('secondary', 'down');
  const afterStaleWheel = frames.at(-1).previewScroll;
  await calibrate();
  await wheel('secondary', 'down');
  const afterFreshWheel = frames.at(-1).previewScroll;

  process.stdout.write(JSON.stringify({
    destructiveFrames,
    disabledCprRequests,
    disabledInteractionId,
    effortInteractionId,
    requestsAfterStaleCpr,
    requestsBeforeClosedMouse,
    requestsBeforeHover,
    requestsBeforeResize,
    trackingAfterClose: terminal.mouse.includes(false),
    copyWheel: {
      initialCopy: {focus: initialCopy.focus, selectedIndex: initialCopy.selectedIndex, previewScroll: initialCopy.previewScroll},
      requestsBeforeCopyCpr, requestsAfterCopyCpr, beforeCprScroll, afterStaleCopyCprScroll, rightScroll, rightFocus, selectedAfterListWheel, focusAfterListWheel, scrollAfterListWheel,
      selectedIdsAfterWheel, ownerIgnored, disabledScrollBefore, disabledScrollAfter, reenabledScroll,
      requestsBeforeCopyResize, requestsAfterCopyStaleCpr, beforeFreshCprScroll, afterStaleWheel, afterFreshWheel
    }
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
