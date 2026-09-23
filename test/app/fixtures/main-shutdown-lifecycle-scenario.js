const path = require('node:path');

const root = process.cwd();
const outcome = process.argv[2];
let terminalCleanups = 0;
const terminalModule = require(path.join(root, 'dist/src/terminal/tty'));
terminalModule.setupTerminal = () => ({
  cleanup() { terminalCleanups += 1; },
  getSize() { return {columns: 80, rows: 24}; },
  setMouseTracking() {},
  requestCursorPosition() { return false; }
});

let renders = 0;
const rendererModule = require(path.join(root, 'dist/src/render/app-renderer'));
rendererModule.createAppRenderer = () => ({
  clearFooter() {},
  render() { renders += 1; },
  renderRecords() { renders += 1; },
  renderDestructive() { renders += 1; },
  renderInitial() { renders += 1; }
});

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const config = new UserConfigContext();
let onConfigChange;
let onWatchError;
let unsubscribes = 0;
let configCloses = 0;
config.subscribe = (listener) => {
  onConfigChange = listener;
  return () => { unsubscribes += 1; };
};
config.startWatching = (onError) => { onWatchError = onError; };
config.close = () => { configCloses += 1; };

let resolveBootstrap;
let rejectBootstrap;
const bootstrap = new Promise((resolve, reject) => {
  resolveBootstrap = resolve;
  rejectBootstrap = reject;
});
let mcpCloses = 0;
let appExits = 0;
let watchErrors = 0;
let observationCloses = 0;
const observation = {
  ...disabledObservation,
  appExiting() { appExits += 1; },
  configurationWatchFailed() { watchErrors += 1; },
  close() { observationCloses += 1; }
};
const mcp = {
  bootstrap: () => bootstrap,
  close: async () => { mcpCloses += 1; },
  getDiagnostics: () => [{serverName: 'late', message: 'finished'}],
  listTools: () => [],
  reload: async () => {}
};

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);
process.exit = () => {};
process.stdout.write = () => true;

const app = createApp(
  async () => {},
  mcp,
  {emit() {}, updateConfig() {}},
  observation,
  {appendEvent: () => null, listDailyUsage: () => []},
  config
);

(async () => {
  app.start();
  app.exit();
  const rendersAfterExit = renders;
  app.start();
  app.exit();
  app.render();
  app.renderResizeRecovery();
  onConfigChange({domains: {llm: true}, snapshot: config.capture()});
  onWatchError(new Error('late watcher error'));

  if (outcome === 'reject') rejectBootstrap(new Error('late MCP error'));
  else resolveBootstrap();
  await bootstrap.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));

  process.stdout.write = originalWrite;
  originalWrite(JSON.stringify({
    appExits,
    configCloses,
    mcpCloses,
    observationCloses,
    rendersAfterExit,
    rendersAfterLateCallbacks: renders,
    terminalCleanups,
    unsubscribes,
    watchErrors
  }), () => originalExit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  originalExit(1);
});
