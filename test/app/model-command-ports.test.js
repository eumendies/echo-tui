const test = require('node:test');
const assert = require('node:assert/strict');

const {createModelCommandPorts} = require('../../src/app/command/model-command-ports');

function createPorts(overrides = {}) {
  const calls = {
    clears: 0,
    effortSelections: [],
    modelSelections: [],
    renders: 0
  };
  const appContext = {
    clearContextUsage() {
      calls.clears += 1;
    },
    modelContext: {
      selectModel(modelId) {
        calls.modelSelections.push(modelId);
        return overrides.selectModel ? overrides.selectModel(modelId) : {ok: true};
      },
      selectEffort(effort) {
        calls.effortSelections.push(effort);
        return overrides.selectEffort ? overrides.selectEffort(effort) : {ok: true};
      }
    }
  };

  return {
    calls,
    ports: createModelCommandPorts({
      appContext,
      userConfigContext: {},
      render() {
        calls.renders += 1;
      }
    })
  };
}

test('selectModel redraws the status line after a silent switch', () => {
  const {calls, ports} = createPorts();

  assert.deepEqual(ports.model.selectModel('deep'), {ok: true});
  assert.deepEqual(calls.modelSelections, ['deep']);
  assert.equal(calls.clears, 1);
  // 带参数的 /model 不打开 session，渲染必须由端口层触发。
  assert.equal(calls.renders, 1);
});

test('selectEffort redraws the status line after a silent switch', () => {
  const {calls, ports} = createPorts();

  assert.deepEqual(ports.model.selectEffort('high'), {ok: true});
  assert.deepEqual(calls.effortSelections, ['high']);
  assert.equal(calls.clears, 1);
  assert.equal(calls.renders, 1);
});

test('failed selections do not redraw or clear context usage', () => {
  const {calls, ports} = createPorts({
    selectModel() {
      return {ok: false, error: 'cannot write'};
    },
    selectEffort() {
      return {ok: false, error: 'cannot write'};
    }
  });

  assert.deepEqual(ports.model.selectModel('deep'), {ok: false, error: 'cannot write'});
  assert.deepEqual(ports.model.selectEffort('high'), {ok: false, error: 'cannot write'});
  assert.equal(calls.clears, 0);
  assert.equal(calls.renders, 0);
});
