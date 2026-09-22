const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.cwd();
const terminalModule = require(path.join(root, 'dist/src/terminal/tty'));
terminalModule.setupTerminal = () => ({
  cleanup() {},
  getSize() {
    return {columns: 80, rows: 24};
  },
  setMouseTracking() {},
  requestCursorPosition() { return false; }
});

// 只记录 renderRecords 的批次边界：一次调用里的 records 代表一个稳定投影批次。
const batches = [];
let lastPendingKind = null;
function capturePending(options) {
  lastPendingKind = options.pending?.kind || null;
}
const renderer = {
  clearFooter() {},
  render(options) {
    capturePending(options);
  },
  renderRecords(options) {
    capturePending(options);
    batches.push(options.records);
  },
  renderDestructive(options) {
    capturePending(options);
  },
  renderInitial(options) {
    capturePending(options);
  }
};
const rendererModule = require(path.join(root, 'dist/src/render/app-renderer'));
rendererModule.createAppRenderer = () => renderer;

const {createApp} = require(path.join(root, 'dist/src/app/main'));
const {disabledObservation} = require(path.join(root, 'dist/src/observation/observation'));
const {UserConfigContext} = require(path.join(root, 'dist/src/config/user-config-context'));
const {INPUT_EVENTS} = require(path.join(root, 'dist/src/input/event-types'));
const {AgentAbortError} = require(path.join(root, 'dist/src/types/agent'));

// 假 agent 先播报一个 bash 工具调用，随后一直等待 turn 级取消信号。
const toolCall = {callId: 'call-interrupt', toolName: 'run_bash_command', argumentsText: JSON.stringify({command: 'sleep 30'})};
const turns = [];
function runAgent(session, callbacks) {
  return new Promise((resolve, reject) => {
    turns.push({session});
    callbacks.onToolCall(toolCall);
    session.abortSignal.addEventListener('abort', () => {
      reject(new AgentAbortError());
    }, {once: true});
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

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(message);
}

/** 读取当前 HOME 下真实 journal 的操作序列，验证补齐记录确实成组落盘。 */
function readJournalOperations() {
  const projectKey = crypto.createHash('sha1').update(String(process.cwd())).digest('hex');
  const sessionDir = path.join(os.homedir(), '.echo', 'echo_tui', 'projects', projectKey, 'sessions');
  const journalFile = fs.readdirSync(sessionDir).find((name) => name.endsWith('.jsonl'));

  return fs.readFileSync(path.join(sessionDir, journalFile), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

(async () => {
  app.handleEvent({type: INPUT_EVENTS.TEXT, value: 'run the tool'});
  const submission = app.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await waitFor(() => turns.length === 1, 'assistant turn did not start');

  app.handleEvent({type: INPUT_EVENTS.ESCAPE});
  await submission;

  const pairBatchIndex = batches.findIndex((records) => records.some((record) => record.role === 'tool_call'));
  const noticeBatchIndex = batches.findIndex((records) => records.some((record) => record.role === 'local_notice'));
  const pairBatch = pairBatchIndex >= 0 ? batches[pairBatchIndex] : [];
  const interruptedResult = pairBatch.find((record) => record.role === 'tool_result');
  const appendedRecords = readJournalOperations()
    .flatMap((entry) => (entry.op === 'batch' ? entry.operations : [entry]))
    .filter((operation) => operation.op === 'append_records');

  process.stdout.write(JSON.stringify({
    journalBatchRoles: appendedRecords.map((operation) => operation.records.map((record) => record.role).join(',')),
    journalInterruptedResultText: (appendedRecords
      .flatMap((operation) => operation.records)
      .find((record) => record.role === 'tool_result') || {}).text || null,
    noticeRenderedAfterPair: noticeBatchIndex > pairBatchIndex,
    pendingAfterInterrupt: lastPendingKind,
    pairBatchRoles: pairBatch.map((record) => record.role),
    renderedInterruptedResultOk: interruptedResult ? interruptedResult.ok : null
  }), () => process.exit(0));
})().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
