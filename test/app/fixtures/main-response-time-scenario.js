const path = require('node:path');

const root = process.cwd();
const terminalModule = require(path.join(root, 'dist/src/terminal/tty'));
terminalModule.setupTerminal = () => ({
  cleanup() {},
  getSize() {
    return {columns: 80, rows: 24};
  }
});

const snapshots = [];
const renderer = {
  renderRecords(options) {
    capture(options);
  },
  clearFooter() {},
  render: capture,
  renderDestructive: capture,
  renderFinal() {},
  renderInitial: capture
};

function capture(options) {
  snapshots.push({
    pendingMessage: options.pendingMessage?.preview || null,
    surfaceKind: options.commandSurface?.kind || null,
    surfaceTitle: options.commandSurface?.title || null
  });
}

const rendererModule = require(path.join(root, 'dist/src/render/app-renderer'));
rendererModule.createAppRenderer = () => renderer;

let configStarts = 0;
const {ConfigCommandHandler} = require(path.join(root, 'dist/src/commands/config/handler'));
const originalConfigStart = ConfigCommandHandler.prototype.start;
ConfigCommandHandler.prototype.start = function (...args) {
  configStarts += 1;
  return originalConfigStart.apply(this, args);
};

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));
const turns = [];

function runAgent(session, callbacks) {
  return new Promise((resolve) => {
    turns.push({
      abortSignal: session.abortSignal,
      records: session.records,
      finish(text) {
        callbacks.onComplete(text);
        resolve(text);
      }
    });
  });
}

const app = createApp(
  runAgent,
  {
    close: async () => {},
    getDiagnostics: () => [],
    listTools: () => [],
    reload: async () => {}
  },
  {
    emit() {},
    updateConfig() {}
  },
  disabledObservation,
  {
    appendEvent: () => null,
    listDailyUsage: () => []
  },
  new UserConfigContext()
);

function submit(text) {
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: text});
  return app.handleEvent({type: INPUT_EVENTS.SUBMIT});
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

(async () => {
  const firstSubmission = submit('first question');
  await waitFor(() => turns.length === 1, 'first assistant turn did not start');

  await submit('queued ordinary');
  const pendingBeforeHelp = snapshots.some((snapshot) => snapshot.pendingMessage === 'queued ordinary');
  await submit('/help');
  const immediateHelp = snapshots.at(-1)?.surfaceTitle === '/help';

  turns[0].finish('first answer');
  await waitFor(() => turns.length === 2, 'ordinary pending message did not start behind help');
  const secondTurnUserText = turns[1].records.filter((record) => record.role === 'user').at(-1)?.text;
  const helpStayedOpen = snapshots.at(-1)?.surfaceTitle === '/help';

  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  const escapeKeptSecondTurn = !turns[1].abortSignal.aborted;

  await submit('/config');
  await submit('/help');
  turns[1].finish('second answer');
  await firstSubmission;
  const configDeferred = configStarts === 0 && snapshots.at(-1)?.surfaceTitle === '/help';

  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  await waitFor(() => configStarts === 1, 'queued config command did not start after help closed');
  const configOpenedOnce = configStarts === 1 && snapshots.at(-1)?.surfaceKind === 'config';

  process.stdout.write(JSON.stringify({
    configDeferred,
    configOpenedOnce,
    escapeKeptSecondTurn,
    helpStayedOpen,
    immediateHelp,
    pendingBeforeHelp,
    secondTurnUserText,
    turnCount: turns.length
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
