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
function capture(options) {
  snapshots.push({
    focusedIndex: options.commandSurface?.focusedIndex ?? null,
    surfaceKind: options.commandSurface?.kind || null,
    surfaceTitle: options.commandSurface?.title || null
  });
}
const renderer = {
  clearFooter() {},
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

let releaseCheck;
const checkResult = new Promise((resolve) => { releaseCheck = resolve; });

const app = createApp(
  () => new Promise(() => {}),
  {bootstrap: async () => {}, close: async () => {}, getDiagnostics: () => [], listTools: () => [], reload: async () => {}},
  {emit() {}, updateConfig() {}},
  disabledObservation,
  {appendEvent: () => null, listDailyUsage: () => []},
  new UserConfigContext(),
  {
    checkUpdate: () => checkResult,
    applyUpdate: async () => 0
  }
);

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function currentSurfaceTitle() {
  return snapshots.at(-1)?.surfaceTitle ?? null;
}

(async () => {
  app.start();
  await wait(250);

  // 输入与检查结果竞争：刚输入过时提示必须等待输入静默窗口。
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: 'draft'});
  releaseCheck({status: 'available', currentVersion: '1.2.5', latestVersion: '1.4.5'});

  await wait(400);
  const visibleWhileTyping = currentSurfaceTitle() === '更新可用';

  // composer 非空时，即使超过静默窗口也不弹。
  await wait(900);
  const visibleWhileComposerFilled = currentSurfaceTitle() === '更新可用';

  for (let index = 0; index < 5; index += 1) {
    app.handleEvent({type: INPUT_EVENTS.BACKSPACE});
  }

  await wait(1400);
  const visibleWhenIdle = currentSurfaceTitle() === '更新可用';
  const defaultFocus = snapshots.at(-1)?.focusedIndex ?? null;

  // 默认焦点是「稍后提醒」；Enter 只抑制本次会话。
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await wait(400);
  const visibleAfterLater = currentSurfaceTitle() === '更新可用';

  process.stdout.write(JSON.stringify({
    defaultFocus,
    visibleAfterLater,
    visibleWhenIdle,
    visibleWhileComposerFilled,
    visibleWhileTyping
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
