const test = require('node:test');
const assert = require('node:assert/strict');

const {AutoUpdateController} = require('../../src/app/auto-update-controller');
const {INPUT_EVENTS} = require('../../src/input/event-types');

const AVAILABLE_RESULT = {status: 'available', currentVersion: '1.2.5', latestVersion: '1.4.5'};

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createHarness(overrides = {}) {
  const calls = [];
  let canPresent = overrides.canPresent ?? true;
  const checkResult = overrides.checkResult || AVAILABLE_RESULT;
  const controller = new AutoUpdateController({
    applyUpdate: overrides.applyUpdate || (async (latestVersion) => {
      calls.push(`apply:${latestVersion}`);
      return 0;
    }),
    canPresent: () => canPresent,
    checkUpdate: overrides.checkUpdate || (async () => checkResult),
    exit: (code) => calls.push(`exit:${code}`),
    persistIgnoredVersion: (version) => calls.push(`ignore:${version}`),
    render: () => calls.push('render'),
    shutdown: () => calls.push('shutdown')
  });

  return {
    calls,
    controller,
    setCanPresent(value) {
      canPresent = value;
    }
  };
}

test('AutoUpdateController waits for the gate before presenting the choice surface', async () => {
  const harness = createHarness({canPresent: false});
  harness.controller.start();
  await settle();

  harness.controller.tick();
  assert.equal(harness.controller.getSurface(), null);
  assert.equal(harness.calls.filter((call) => call === 'render').length, 0);

  harness.setCanPresent(true);
  harness.controller.tick();
  const surface = harness.controller.getSurface();

  assert.equal(harness.controller.hasActiveRequest(), true);
  assert.equal(surface.kind, 'choice');
  assert.equal(surface.title, '更新可用');
  assert.match(surface.message, /发现新版本 v1\.4\.5（当前 v1\.2\.5）/);
  assert.deepEqual(surface.options.map((option) => option.label), ['立即更新', '稍后提醒', '忽略此版本']);
  assert.equal(surface.focusedIndex, 1);
  assert.match(surface.dismissHint, /Esc 稍后提醒/);
  assert.equal(harness.calls.filter((call) => call === 'render').length, 1);
});

test('AutoUpdateController maps navigation and Enter to the focused decision', async () => {
  const harness = createHarness();
  harness.controller.start();
  await settle();
  harness.controller.tick();

  harness.controller.handleEvent({type: INPUT_EVENTS.MOVE_UP});
  assert.equal(harness.controller.getSurface().focusedIndex, 0);
  harness.controller.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  harness.controller.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  assert.equal(harness.controller.getSurface().focusedIndex, 2);

  harness.controller.handleEvent({type: INPUT_EVENTS.SUBMIT});

  assert.equal(harness.controller.hasActiveRequest(), false);
  assert.equal(harness.controller.getSurface(), null);
  assert.ok(harness.calls.includes('ignore:1.4.5'));
});

test('AutoUpdateController treats Esc as later and snoozes further presentations', async () => {
  const harness = createHarness();
  harness.controller.start();
  await settle();
  harness.controller.tick();

  harness.controller.handleEvent({type: INPUT_EVENTS.TEXT, value: 'x'});
  harness.controller.handleEvent({type: INPUT_EVENTS.ESCAPE});

  assert.equal(harness.controller.hasActiveRequest(), false);
  assert.equal(harness.calls.filter((call) => call.startsWith('ignore:')).length, 0);

  // 已进入会话级抑制：再次发现新版本也不再呈现。
  harness.controller.start();
  await settle();
  harness.controller.tick();
  assert.equal(harness.controller.getSurface(), null);
});

test('AutoUpdateController tears down before applying an update and exits with its code', async () => {
  const harness = createHarness();
  harness.controller.start();
  await settle();
  harness.controller.tick();

  harness.controller.handleEvent({type: INPUT_EVENTS.MOVE_UP});
  harness.controller.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await settle();

  assert.deepEqual(harness.calls, ['render', 'render', 'shutdown', 'apply:1.4.5', 'exit:0']);
});

test('AutoUpdateController exits with code 1 when applying the update fails', async () => {
  const harness = createHarness({
    applyUpdate: async () => {
      throw new Error('spawn failed');
    }
  });
  harness.controller.start();
  await settle();
  harness.controller.tick();

  harness.controller.handleEvent({type: INPUT_EVENTS.MOVE_UP});
  harness.controller.handleEvent({type: INPUT_EVENTS.SUBMIT});
  await settle();

  assert.deepEqual(harness.calls, ['render', 'render', 'shutdown', 'exit:1']);
});

test('AutoUpdateController ignores failed or idle update checks', async () => {
  const failing = createHarness({
    checkUpdate: async () => {
      throw new Error('offline');
    }
  });
  failing.controller.start();
  await settle();
  failing.controller.tick();
  assert.equal(failing.controller.getSurface(), null);

  const idle = createHarness({checkResult: {status: 'none', reason: 'up-to-date'}});
  idle.controller.start();
  await settle();
  idle.controller.tick();
  assert.equal(idle.controller.getSurface(), null);
});
