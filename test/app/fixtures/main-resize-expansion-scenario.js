const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.cwd();
const terminal = {
  cprRequests: 0,
  size: {columns: 80, rows: 24},
  cleanup() {},
  getSize() { return this.size; },
  requestCursorPosition() {
    this.cprRequests += 1;
    return true;
  },
  setMouseTracking() {}
};
require(path.join(root, 'dist/src/terminal/tty')).setupTerminal = () => terminal;

let version = 0;
const frames = [];
function capture(kind, options) {
  const interactionId = options.commandSurface?.kind === 'choice' ? options.footerInteractionId : null;
  frames.push({kind, interactionId});
  return {
    version: ++version,
    cursorRow: 0,
    cursorColumn: 0,
    originStable: false,
    hitRegions: interactionId
      ? [{interactionId, owner: 'choice', target: {kind: 'choice_option', index: 0, inlineInput: false}, rowStart: 0, rowEnd: 0, columnStart: 1, columnEnd: 20}]
      : []
  };
}
require(path.join(root, 'dist/src/render/app-renderer')).createAppRenderer = () => ({
  clearFooter() {},
  render(options) { return capture('render', options); },
  renderDestructive(options) { return capture('destructive', options); },
  renderInitial(options) { return capture('initial', options); },
  renderRecords(options) { return capture('records', options); }
});

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));

const configPath = path.join(os.homedir(), '.echo', 'config.json');
fs.mkdirSync(path.dirname(configPath), {recursive: true});
fs.writeFileSync(configPath, JSON.stringify({ui: {mouseInteractionEnabled: true}}));
const turns = [];
function runAgent(_session, callbacks) {
  return new Promise(() => {
    turns.push({callbacks});
  });
}

const app = createApp(
  runAgent,
  {bootstrap: async () => {}, close: async () => {}, getDiagnostics: () => [], listTools: () => [], reload: async () => {}},
  {emit() {}, updateConfig() {}},
  disabledObservation,
  {appendEvent: () => null, listDailyUsage: () => []},
  new UserConfigContext()
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

(async () => {
  app.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: 'ask'});
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => turns.length === 1, 'assistant turn did not start');
  void turns[0].callbacks.onUserQuestionRequest(
    {callId: 'call-question-1', toolName: 'ask_user_questions', argumentsText: '{}'},
    {questions: [{question: '选择?', options: [{label: '确定'}]}]}
  );
  await waitFor(() => frames.at(-1)?.interactionId === 'user-question', 'question surface did not open');

  const destructiveBefore = frames.filter((frame) => frame.kind === 'destructive').length;
  const requestsBeforeResize = terminal.cprRequests;
  terminal.size = {columns: 80, rows: 36};
  process.stdout.emit('resize');

  const destructiveAfter = frames.filter((frame) => frame.kind === 'destructive').length;
  const requestsAfterResize = terminal.cprRequests;
  app.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  const requestsAfterStaleReply = terminal.cprRequests;
  app.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});

  process.stdout.write(JSON.stringify({
    destructiveAfter,
    destructiveBefore,
    requestsAfterResize,
    requestsAfterStaleReply,
    requestsBeforeResize
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
