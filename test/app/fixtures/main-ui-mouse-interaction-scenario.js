const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.cwd();
const terminal = {
  cprRequests: 0,
  cleanup() {},
  getSize() { return {columns: 80, rows: 24}; },
  mouse: [],
  requestCursorPosition() {
    this.cprRequests += 1;
    return false;
  },
  setMouseTracking(enabled) {
    this.mouse.push(enabled);
  }
};
require(path.join(root, 'dist/src/terminal/tty')).setupTerminal = () => terminal;

let version = 0;
const snapshots = [];
function capture(options) {
  snapshots.push({
    footerInteractionId: options.footerInteractionId || null,
    surfaceKind: options.commandSurface?.kind || null
  });
  const interactionId = options.commandSurface?.kind === 'choice' ? options.footerInteractionId : null;
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
  render: capture,
  renderDestructive: capture,
  renderInitial: capture,
  renderRecords: capture
});

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));

const configPath = path.join(os.homedir(), '.echo', 'config.json');
fs.mkdirSync(path.dirname(configPath), {recursive: true});
fs.writeFileSync(configPath, '{}');
const userConfigContext = new UserConfigContext();
const turns = [];
function runAgent(_session, callbacks) {
  return new Promise((resolve) => {
    turns.push({
      callbacks,
      finish(text) {
        callbacks.onComplete(text);
        resolve(text);
      }
    });
  });
}

const app = createApp(
  runAgent,
  {bootstrap: async () => {}, close: async () => {}, getDiagnostics: () => [], listTools: () => [], reload: async () => {}},
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

(async () => {
  app.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: 'ask'});
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => turns.length === 1, 'assistant turn did not start');

  const question = turns[0].callbacks.onUserQuestionRequest(
    {callId: 'call-question-1', toolName: 'ask_user_questions', argumentsText: '{}'},
    {questions: [{question: '选择?', options: [{label: '确定'}]}]}
  );
  await waitFor(() => snapshots.at(-1)?.surfaceKind === 'choice', 'question surface did not open');
  const disabledRequests = terminal.cprRequests;
  const disabledEnabled = terminal.mouse.includes(true);

  const enabledSettings = {...userConfigContext.capture().getAppSettings(), mouseInteractionEnabled: true};
  userConfigContext.saveAppSettingsDraft(enabledSettings);
  await waitFor(() => terminal.mouse.includes(true), 'mouse tracking did not enable after settings save');
  const enabledInteractionId = snapshots.at(-1)?.footerInteractionId || null;

  const disabledSettings = {...userConfigContext.capture().getAppSettings(), mouseInteractionEnabled: false};
  userConfigContext.saveAppSettingsDraft(disabledSettings);
  await waitFor(() => snapshots.at(-1)?.footerInteractionId === null && terminal.mouse.at(-1) === false, 'mouse tracking did not disable after settings save');

  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  await question;
  turns[0].finish('done');
  process.stdout.write(JSON.stringify({
    disabledEnabled,
    disabledRequests,
    enabledInteractionId,
    enabledRequests: terminal.cprRequests,
    disabledAfterEnable: terminal.mouse.at(-1) === false
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
