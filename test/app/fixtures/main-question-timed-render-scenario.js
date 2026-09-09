const path = require('node:path');

const root = process.cwd();
const terminalModule = require(path.join(root, 'dist/src/terminal/tty'));
terminalModule.setupTerminal = () => ({
  cleanup() {},
  getSize() {
    return {columns: 80, rows: 24};
  }
});

const renders = [];
function capture(options) {
  return {
    at: Date.now(),
    surfaceKind: options.commandSurface?.kind || null,
    surfaceTitle: options.commandSurface?.title || null
  };
}
const renderer = {
  renderRecords(options) {
    renders.push(capture(options));
  },
  clearFooter() {},
  render: (options) => renders.push(capture(options)),
  renderDestructive: (options) => renders.push(capture(options)),
  renderFinal() {},
  renderInitial: (options) => renders.push(capture(options))
};
const rendererModule = require(path.join(root, 'dist/src/render/app-renderer'));
rendererModule.createAppRenderer = () => renderer;

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));

const turns = [];
function runAgent(session, callbacks) {
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
  new UserConfigContext()
);

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  app.start();
  // start() 触发 MCP bootstrap;其异步收尾会 stopSpinner + render,先等它落定再开计时窗口。
  await wait(300);

  app.handleEvent({type: INPUT_EVENTS.TEXT, value: 'ask me'});
  app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => turns.length === 1, 'assistant turn did not start');

  // 阶段一:无表面,thinking spinner 活跃,计时重绘应正常驱动 composer。
  const composerBaseline = renders.length;
  await wait(400);
  const composerTimedRenders = renders.slice(composerBaseline).filter((item) => item.surfaceKind === null).length;

  // 阶段二:假 agent 直接发起用户问题;打开 surface 的那次 render 属于按键路径之外的一次性投影。
  const questionPromise = turns[0].callbacks.onUserQuestionRequest(
    {callId: 'call-question-1', toolName: 'ask_user_questions', argumentsText: '{}'},
    {questions: [{question: '选择执行方式?', options: [{label: '立即执行'}, {label: '稍后再说'}]}]}
  );
  await waitFor(() => renders.at(-1)?.surfaceKind === 'choice', 'question surface did not open');
  const openBaseline = renders.length;
  await wait(400);
  const rendersDuringQuestion = renders.slice(openBaseline).length;

  // 阶段三:Esc 取消问题但不结束 turn,spinner 仍在计时,周期重绘应恢复。
  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  await questionPromise;
  const cancelBaseline = renders.length;
  await wait(400);
  const rendersAfterCancel = renders.slice(cancelBaseline).filter((item) => item.surfaceKind === null).length;

  turns[0].finish('done');
  process.stdout.write(JSON.stringify({
    composerTimedRenders,
    rendersDuringQuestion,
    rendersAfterCancel
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
