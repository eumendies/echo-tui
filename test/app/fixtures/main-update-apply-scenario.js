const path = require('node:path');

const root = process.cwd();
let terminalCleanedUp = false;
const terminalModule = require(path.join(root, 'dist/src/terminal/tty'));
terminalModule.setupTerminal = () => ({
  cleanup() {
    terminalCleanedUp = true;
  },
  getSize() {
    return {columns: 80, rows: 24};
  }
});

const snapshots = [];
let footerCleared = false;
function capture(options) {
  snapshots.push({
    surfaceKind: options.commandSurface?.kind || null,
    surfaceTitle: options.commandSurface?.title || null
  });
}
const renderer = {
  clearFooter() {
    footerCleared = true;
  },
  render: capture,
  renderDestructive: capture,
  renderInitial: capture,
  renderRecords: capture
};
const rendererModule = require(path.join(root, 'dist/src/render/app-renderer'));
rendererModule.createAppRenderer = () => renderer;

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));

const appliedUpdates = [];
const exitCodes = [];
const stdoutWrites = [];
const originalExit = process.exit;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  stdoutWrites.push(String(chunk));
  return true;
};
process.exit = (code) => {
  exitCodes.push(code);
};

const app = createApp(
  () => new Promise(() => {}),
  {bootstrap: async () => {}, close: async () => {}, getDiagnostics: () => [], listTools: () => [], reload: async () => {}},
  {emit() {}, updateConfig() {}},
  disabledObservation,
  {appendEvent: () => null, listDailyUsage: () => []},
  new UserConfigContext(),
  {
    checkUpdate: async () => ({status: 'available', currentVersion: '1.2.5', latestVersion: '1.4.5'}),
    applyUpdate: async (latestVersion) => {
      appliedUpdates.push(latestVersion);
      return 0;
    }
  }
);

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) {
      return;
    }

    await wait(5);
  }

  throw new Error(message);
}

(async () => {
  const stdinDataListenersBefore = process.stdin.listenerCount('data');
  const resizeListenersBefore = process.stdout.listenerCount('resize');

  app.start();
  const stdinListenersAttachedAtStart = process.stdin.listenerCount('data') > stdinDataListenersBefore;
  const resizeListenerAttachedAtStart = process.stdout.listenerCount('resize') > resizeListenersBefore;

  await waitFor(() => snapshots.some((snapshot) => snapshot.surfaceTitle === '更新可用'), 'update request did not appear');

  // 默认焦点在「稍后提醒」，先上移到「立即更新」再确认。
  app.handleEvent({type: INPUT_EVENTS.MOVE_UP});
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => exitCodes.length > 0, 'update flow did not exit');

  const stdinDataListenersAfterUpdate = process.stdin.listenerCount('data');
  const stdinPausedAfterUpdate = process.stdin.isPaused();
  const resizeListenersAfterUpdate = process.stdout.listenerCount('resize');

  process.stdout.write = originalStdoutWrite;
  originalStdoutWrite(JSON.stringify({
    appliedUpdates,
    autoUpdateOutput: stdoutWrites.join(''),
    exitCodes,
    footerCleared,
    resizeListenerAttachedAtStart,
    resizeListenersAfterUpdate,
    resizeListenersBefore,
    stdinDataListenersAfterUpdate,
    stdinDataListenersBefore,
    stdinListenersAttachedAtStart,
    stdinPausedAfterUpdate,
    terminalCleanedUp
  }), () => originalExit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  originalExit(1);
});
