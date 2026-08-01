const test = require('node:test');
const assert = require('node:assert/strict');

const {InputEventController} = require('../../src/app/input-event-controller');
const composerOps = require('../../src/input/composer');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {createAppContext} = require('./controller-test-helpers');

function createHarness(overrides = {}) {
  const appContext = createAppContext();
  appContext.setMcpBootstrapStatus('ready');
  const calls = [];
  let localSurfaceActive = Boolean(overrides.localSurfaceActive);
  const controller = new InputEventController({
    appContext,
    userQuestion: overrides.userQuestion || {
      hasActiveRequest: () => false,
      handleEvent: () => calls.push('question')
    },
    toolApproval: overrides.toolApproval || {
      hasActiveRequest: () => false,
      handleEvent: () => calls.push('approval'),
      toggleAllowAllForSession: () => calls.push('toggle-approval')
    },
    filePicker: overrides.filePicker || {
      hasActiveRequest: () => false,
      handleEvent: () => calls.push('picker-event'),
      open: (index) => calls.push(`picker-open:${index}`)
    },
    command: overrides.command || {
      hasActiveSession: () => false,
      handleEvent: () => undefined
    },
    localSurface: {
      hasActive: () => localSurfaceActive,
      dismiss() {
        calls.push('dismiss-local');
        localSurfaceActive = false;
      }
    },
    cancelReferencePreparation: () => calls.push('cancel-reference-preparation'),
    submitComposer: overrides.submitComposer || (async () => { calls.push('submit'); }),
    interruptActiveShellCommand: overrides.interruptActiveShellCommand || (() => {
      calls.push('interrupt-shell');
      return false;
    }),
    interruptActiveTurn: overrides.interruptActiveTurn || (() => {
      calls.push('interrupt-turn');
      return false;
    }),
    exit: () => calls.push('exit'),
    renderFooter: () => calls.push('render')
  });

  return {appContext, calls, controller};
}

test('InputEventController gives active modals and command sessions priority', async () => {
  const question = createHarness({
    userQuestion: {
      hasActiveRequest: () => true,
      handleEvent: () => question.calls.push('question')
    }
  });
  await question.controller.handleEvent({type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(question.calls, ['question']);

  const command = createHarness({
    command: {
      hasActiveSession: () => true,
      async handleEvent() {
        command.calls.push('command-start');
        await Promise.resolve();
        command.calls.push('command-end');
      }
    }
  });
  await command.controller.handleChunk('\r');
  assert.deepEqual(command.calls, ['command-start', 'command-end']);
});

test('InputEventController consumes reference preparation and local surfaces before composer actions', () => {
  const preparing = createHarness();
  preparing.appContext.conversationReferenceContext.beginPreparation();
  preparing.controller.handleEvent({type: INPUT_EVENTS.ESCAPE});
  assert.deepEqual(preparing.calls, ['cancel-reference-preparation']);

  const local = createHarness({localSurfaceActive: true});
  local.controller.handleEvent({type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(local.calls, ['dismiss-local', 'render']);
});

test('InputEventController preserves pending, reference, shell, and assistant Esc order', () => {
  const harness = createHarness({
    interruptActiveShellCommand: () => {
      harness.calls.push('interrupt-shell');
      return true;
    },
    interruptActiveTurn: () => {
      harness.calls.push('interrupt-turn');
      return true;
    }
  });
  harness.appContext.pendingMessageContext.enqueue('queued');
  harness.appContext.conversationReferenceContext.setPending({
    projectionMode: 'full', sourcePath: '/tmp/a', sourceSessionId: 's', title: 'ref', records: []
  });

  harness.controller.handleEvent({type: INPUT_EVENTS.ESCAPE});
  assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
  assert.ok(harness.appContext.conversationReferenceContext.getPending());
  harness.controller.handleEvent({type: INPUT_EVENTS.ESCAPE});
  assert.equal(harness.appContext.conversationReferenceContext.getPending(), null);
  harness.controller.handleEvent({type: INPUT_EVENTS.ESCAPE});

  assert.deepEqual(harness.calls, ['render', 'render', 'interrupt-shell']);
});

test('InputEventController routes picker, composer editing, mode, submit, and exit', async () => {
  const harness = createHarness();

  harness.controller.handleEvent({type: INPUT_EVENTS.TEXT, value: '@'});
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), '@');
  assert.deepEqual(harness.calls, ['picker-open:0']);

  harness.controller.handleEvent({type: INPUT_EVENTS.TEXT, value: 'a'});
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), '@a');
  harness.controller.handleEvent({type: INPUT_EVENTS.INSERT_NEWLINE});
  harness.controller.handleEvent({type: INPUT_EVENTS.TAB});
  await harness.controller.handleEvent({type: INPUT_EVENTS.SUBMIT});
  harness.controller.handleEvent({type: INPUT_EVENTS.EXIT});

  assert.equal(harness.appContext.getInteractionMode(), 'plan');
  assert.deepEqual(harness.calls, ['picker-open:0', 'render', 'render', 'render', 'submit', 'exit']);
});

test('InputEventController keeps parser state across split bracketed paste chunks', async () => {
  const harness = createHarness();
  await harness.controller.handleChunk('\x1b[200~hello');
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), '');
  await harness.controller.handleChunk(' world\x1b[201~');
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), 'hello world');
});

test('InputEventController handles tuning, approval shortcut, slash completion, and history browsing', () => {
  const harness = createHarness();
  harness.controller.handleEvent({type: INPUT_EVENTS.TOGGLE_MODEL_TUNING});
  harness.controller.handleEvent({type: INPUT_EVENTS.ESCAPE});
  harness.controller.handleEvent({type: INPUT_EVENTS.SHIFT_TAB});
  assert.deepEqual(harness.calls, ['render', 'render', 'toggle-approval']);

  harness.appContext.configureSlashSuggestions([
    {name: 'help', description: 'Show help'}
  ], () => false);
  harness.appContext.composerContext.setText('/he');
  harness.controller.handleEvent({type: INPUT_EVENTS.TAB});
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), '/help ');

  harness.appContext.composerContext.reset();
  harness.appContext.composerContext.recordInput('previous input');
  harness.controller.handleEvent({type: INPUT_EVENTS.MOVE_UP});
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), 'previous input');
});
