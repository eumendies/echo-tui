const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.cwd();
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
function capture(kind, options) {
  const surface = options.commandSurface || null;
  const interactionId = surface?.kind === 'select' ? options.footerInteractionId : null;
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
const app = createApp(
  () => new Promise(() => {}),
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

  process.stdout.write(JSON.stringify({
    destructiveFrames,
    disabledCprRequests,
    disabledInteractionId,
    effortInteractionId: frames.at(-1).interactionId,
    requestsAfterStaleCpr,
    requestsBeforeClosedMouse,
    requestsBeforeHover,
    requestsBeforeResize,
    trackingAfterClose: terminal.mouse.at(-1) === false
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
