const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {runOnce, stripAnsiControlSequences} = require('../../src/cli/one-shot');
const {AgentAbortError} = require('../../src/types/agent');
const {UserConfigContext} = require('../../src/config/user-config-context');

function createResources() {
  const events = [];
  const signalListeners = new Map();

  return {
    events,
    debug: {
      enabled: false,
      logPath: null,
      emit() {},
      close() {
        events.push('debug.close');
      }
    },
    hooks: {
      emit(event, payload) {
        events.push(`hook:${event}:${payload.status}`);
      },
      async flush() {
        events.push('hooks.flush');
      },
      updateConfig() {}
    },
    mcpManager: {
      async bootstrap() {
        events.push('mcp.bootstrap');
      },
      async close() {
        events.push('mcp.close');
      }
    },
    process: {
      once(event, listener) {
        signalListeners.set(event, listener);
        events.push(`signal.once:${event}`);
        return this;
      },
      removeListener(event, listener) {
        assert.equal(signalListeners.get(event), listener);
        signalListeners.delete(event);
        events.push(`signal.remove:${event}`);
        return this;
      }
    }
  };
}

test('runOnce executes without TTY and writes only final plain text', async () => {
  const resources = createResources();
  const output = [];
  let session;

  await runOnce({
    cwd: '/tmp/project',
    debug: resources.debug,
    fullAccess: true,
    hooks: resources.hooks,
    mcpManager: resources.mcpManager,
    process: resources.process,
    prompt: 'explain this',
    runAgent: async (nextSession) => {
      session = nextSession;
      return '\u001b[32mdone\u001b[0m';
    },
    stdout: {write: (text) => output.push(text)}
  });

  assert.equal(session.interactionMode, 'normal');
  assert.deepEqual(session.executionMode, {kind: 'headless', approvalPolicy: 'full-access'});
  assert.deepEqual(session.records, [{role: 'user', text: 'explain this'}]);
  assert.deepEqual(output, ['done\n']);
  assert.deepEqual(resources.events, [
    'signal.once:SIGINT',
    'signal.once:SIGTERM',
    'mcp.bootstrap',
    'hook:assistant_turn_start:started',
    'hook:assistant_turn_end:completed',
    'signal.remove:SIGINT',
    'signal.remove:SIGTERM',
    'mcp.close'
  ]);
});

test('runOnce defaults to headless denial without supplying an interactive question callback', async () => {
  const resources = createResources();
  const output = [];
  let callbacks;

  await runOnce({
    debug: resources.debug,
    hooks: resources.hooks,
    mcpManager: resources.mcpManager,
    process: resources.process,
    prompt: 'inspect',
    runAgent: async (session, nextCallbacks) => {
      callbacks = nextCallbacks;
      assert.deepEqual(session.executionMode, {kind: 'headless', approvalPolicy: 'deny'});
      return 'safe';
    },
    stdout: {write: (text) => output.push(text)}
  });

  assert.equal(callbacks, undefined);
  assert.deepEqual(output, ['safe\n']);
});

test('runOnce shares one non-watching config revision across MCP, hooks, and agent', async () => {
  const resources = createResources();
  let reads = 0;
  let watcherStarts = 0;
  const root = JSON.stringify({
    llm: {
      selectedModel: 'fake',
      providers: {fake: {preset: 'fake-agent'}},
      models: [{id: 'fake', provider: 'fake', model: 'echo-fake-agent'}]
    },
    mcp: {enabled: false},
    hooks: {assistant_turn_start: []}
  });
  const context = new UserConfigContext({
    configPath: '/tmp/echo-once-config.json',
    readFile() {
      reads += 1;
      return root;
    },
    watchConfig() {
      watcherStarts += 1;
      return {close() {}};
    }
  });
  const snapshot = context.capture();
  let sessionSnapshot;

  await runOnce({
    cwd: '/tmp/project',
    debug: resources.debug,
    process: resources.process,
    prompt: 'shared config',
    runAgent: async (session) => {
      sessionSnapshot = session.userConfigSnapshot;
      return 'done';
    },
    stdout: {write() {}},
    userConfigContext: context
  });

  assert.equal(sessionSnapshot, snapshot);
  assert.equal(reads, 1);
  assert.equal(watcherStarts, 0);
});

test('runOnce does not create or expose interactive session settings', async () => {
  const resources = createResources();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-once-session-settings-'));
  const originalHomedir = os.homedir;
  os.homedir = () => homeDir;

  try {
    await runOnce({
      cwd: homeDir,
      debug: resources.debug,
      hooks: resources.hooks,
      mcpManager: resources.mcpManager,
      process: resources.process,
      prompt: 'headless',
      async runAgent(session) {
        assert.equal(session.modelProfileId, undefined);
        assert.equal(session.reasoningEffortOverride, undefined);
        return 'done';
      },
      stdout: {write() {}}
    });

    assert.deepEqual(fs.readdirSync(homeDir), []);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
});

test('runOnce redacts provider errors and still cleans resources', async () => {
  const resources = createResources();
  const output = [];

  await assert.rejects(
    runOnce({
      debug: resources.debug,
      hooks: resources.hooks,
      mcpManager: resources.mcpManager,
      process: resources.process,
      prompt: 'fail',
      runAgent: async () => {
        throw new Error('authorization: Bearer sk-secret-value');
      },
      stdout: {write: (text) => output.push(text)}
    }),
    (error) => {
      assert.match(error.message, /authorization: Bearer <redacted>/);
      return true;
    }
  );

  assert.deepEqual(output, []);
  assert.ok(resources.events.includes('mcp.close'));
  assert.equal(resources.events.includes('debug.close'), false);
  assert.ok(resources.events.includes('hook:assistant_turn_start:started'));
  assert.ok(resources.events.includes('hook:assistant_turn_error:error'));
  assert.equal(resources.events.includes('hooks.flush'), false);
});

test('runOnce emits a cancelled lifecycle hook for aborted turns', async () => {
  const resources = createResources();

  await assert.rejects(runOnce({
    debug: resources.debug,
    hooks: resources.hooks,
    mcpManager: resources.mcpManager,
    process: resources.process,
    prompt: 'cancel',
    runAgent: async () => {
      throw new AgentAbortError();
    }
  }), {name: 'Error'});

  assert.ok(resources.events.includes('hook:assistant_turn_start:started'));
  assert.ok(resources.events.includes('hook:assistant_turn_cancelled:cancelled'));
  assert.equal(resources.events.includes('hook:assistant_turn_error:error'), false);
});

test('stripAnsiControlSequences removes CSI and OSC terminal controls', () => {
  assert.equal(stripAnsiControlSequences('\u001b[31mred\u001b[0m\u001b]0;title\u0007'), 'red');
});
