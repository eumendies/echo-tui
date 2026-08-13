const path = require('node:path');

const root = process.cwd();
const terminalModule = require(path.join(root, 'dist/src/terminal/tty'));
terminalModule.setupTerminal = () => ({
  cleanup() {},
  getSize() { return {columns: 80, rows: 24}; }
});

let streamingCommits = 0;
let latestMainDraft = '';
const destructiveFrames = [];
const renderer = {
  renderRecords() {},
  render(options) {
    if (options.streamingOwner === 'main' && options.pending?.kind === 'streaming' && options.pending.text !== latestMainDraft) {
      streamingCommits += 1;
      latestMainDraft = options.pending.text;
    }
  },
  clearFooter() {},
  renderDestructive(options) {
    destructiveFrames.push({
      variant: options.bannerContext.variant || 'main',
      restoredAssistant: options.streamingOwner === 'main' && options.pending?.kind === 'streaming'
        ? options.pending.text
        : ''
    });
  },
  renderFinal() {},
  renderInitial() {}
};
require(path.join(root, 'dist/src/render/app-renderer')).createAppRenderer = () => renderer;

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));
const turns = [];

function runAgent(session, callbacks) {
  return new Promise((resolve) => turns.push({session, callbacks, resolve}));
}

const app = createApp(
  runAgent,
  {close: async () => {}, getDiagnostics: () => [], listTools: () => [], reload: async () => {}},
  {emit() {}, updateConfig() {}},
  disabledObservation,
  {appendEvent: () => null, listDailyUsage: () => []},
  new UserConfigContext()
);

function submit(text) {
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: text});
  return app.handleEvent({type: INPUT_EVENTS.SUBMIT});
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

(async () => {
  submit('main question');
  await waitFor(() => turns.length === 1, 'main turn did not start');
  turns[0].callbacks.onToken('x', 'alpha\n\nbeta');
  await waitFor(() => streamingCommits === 1, 'main stable prefix was not committed');

  await submit('/btw side question');
  await waitFor(() => turns.length === 2, 'BTW turn did not start');
  turns[0].callbacks.onToken('x', 'alpha\n\nbeta\n\ngamma');
  await new Promise((resolve) => setTimeout(resolve, 130));
  const commitsWhileBtw = streamingCommits;

  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  await waitFor(() => destructiveFrames.at(-1)?.variant === 'main', 'main projection was not restored');
  const restored = destructiveFrames.at(-1);

  process.stdout.write(JSON.stringify({
    commitsBeforeBtw: 1,
    commitsWhileBtw,
    restoredAssistant: restored.restoredAssistant
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
