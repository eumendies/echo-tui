const test = require('node:test');
const assert = require('node:assert/strict');

const { INPUT_EVENTS } = require('../../src/input/event-types');
const { createCommandRuntime } = require('../../src/app/command/command-runtime');

function createConfirmSurface(title) {
  return {
    kind: 'confirm',
    title,
    bodyLines: [],
    confirmLabel: '确认',
    cancelLabel: '取消'
  };
}

function createInfoSurface(title) {
  return {kind: 'info', title, lines: [], dismissHint: 'Esc 关闭'};
}

function createHostAppHarness() {
  const calls = {
    exits: 0,
    leavesHistory: 0,
    renders: 0
  };

  const host = {
    composer: {
      reset() {},
      leaveHistoryBrowsing() {
        calls.leavesHistory += 1;
      }
    },
    transcript: {
      clear() {},
      loadSession() {
        return true;
      },
      append() {},
      listResumeSessions() {
        return [];
      }
    },
    model: {
      createModelCommandInfo() {
        return { error: 'missing config' };
      },
      createEffortCommandInfo() {
        return { error: 'missing config' };
      },
      selectModel() {
        return { ok: true };
      },
      selectEffort() {
        return { ok: true };
      }
    },
    config: {
      readDraft() {
        return { providers: [], rootConfig: {} };
      },
      listModels() {
        return Promise.resolve({ ok: true, models: [] });
      },
      saveDraft() {
        return { ok: true };
      }
    },
    skills: {
      createSkillInvocation() {
        return { ok: false, reason: 'missing', message: 'missing' };
      },
      listSkills() {
        return [];
      },
      listEnabledSkillDescriptors() {
        return [];
      },
      saveSkillStates() {}
    },
    mcp: {
      listServers() {
        return [];
      },
      saveServerStates() {
        return Promise.resolve({ok: true, diagnostics: []});
      }
    },
    assistant: {
      beginManualCompaction() {
        return true;
      },
      compactContext() {
        return Promise.resolve({ didCompact: false, reason: 'no_boundary' });
      },
      finishManualCompaction() {},
      fail() {}
    },
    mode: {
      getInteractionMode() {
        return 'normal';
      },
      setInteractionMode() {}
    },
    theme: {
      listThemes() {
        return [];
      },
      selectTheme() {
        return {ok: true};
      }
    },
    context: {
      getUsage() {
        return null;
      }
    },
    ui: {
      renderFooter() {
        calls.renders += 1;
      },
      renderResizeRecovery() {},
      exit() {
        calls.exits += 1;
      }
    }
  };

  return { calls, host };
}

function createRuntimeHarness(overrides = {}) {
  const hostHarness = createHostAppHarness();
  const runtime = createCommandRuntime({
    resolveSlashCommand: overrides.resolveSlashCommand || (() => null),
    host: hostHarness.host
  });

  return {
    calls: hostHarness.calls,
    host: hostHarness.host,
    runtime
  };
}

test('createCommandRuntime returns not_matched when no slash handler matches', () => {
  const harness = createRuntimeHarness();

  assert.deepEqual(harness.runtime.startFromText('/unknown'), { kind: 'not_matched' });
  assert.equal(harness.runtime.hasActiveSession(), false);
  assert.equal(harness.calls.renders, 0);
  assert.equal(harness.runtime.getSurface(), null);
});

test('createCommandRuntime starts matched command through CommandHost session', () => {
  const localHandler = {
    name: 'local',
    start(_text, host) {
      host.session.open({
        commandName: 'local',
        handler: localHandler,
        surface: createConfirmSurface('/local'),
        data: { step: 1 }
      });
    }
  };
  const harness = createRuntimeHarness({
    resolveSlashCommand(text) {
      return text === '/local' ? localHandler : null;
    }
  });

  assert.deepEqual(harness.runtime.startFromText('/local'), { kind: 'handled' });
  assert.equal(harness.runtime.hasActiveSession(), true);
  assert.equal(harness.calls.leavesHistory, 1);
  assert.equal(harness.calls.renders, 1);
  assert.equal(harness.runtime.getSurface().kind, 'confirm');
});

test('createCommandRuntime returns submit_user_message command result', () => {
  const localHandler = {
    name: 'skill',
    start() {
      return {
        kind: 'submit_user_message',
        text: 'loaded skill content',
        displayText: '/review src/foo.ts',
        metadata: { skillInvocation: { source: 'slash', skillName: 'review' } }
      };
    }
  };
  const harness = createRuntimeHarness({
    resolveSlashCommand() {
      return localHandler;
    }
  });

  assert.deepEqual(harness.runtime.startFromText('/review src/foo.ts'), {
    kind: 'submit_user_message',
    text: 'loaded skill content',
    displayText: '/review src/foo.ts',
    metadata: { skillInvocation: { source: 'slash', skillName: 'review' } }
  });
  assert.equal(harness.runtime.hasActiveSession(), false);
});

test('createCommandRuntime routes events to active session and can update or close it', () => {
  const localHandler = {
    name: 'local',
    start(_text, host) {
      host.session.open({
        commandName: 'local',
        handler: localHandler,
        surface: createConfirmSurface('/local'),
        data: { step: 1 }
      });
    },
    handleEvent(session, event, host) {
      if (event.type === INPUT_EVENTS.MOVE_RIGHT) {
        host.session.update({
          surface: {
            kind: 'select',
            title: '/local options',
            options: [{label: 'first'}, {label: 'second'}],
            selectedIndex: 1,
            dismissHint: 'Esc 关闭'
          },
          data: { step: session.data.step + 1 }
        });
        return;
      }

      if (event.type === INPUT_EVENTS.ESCAPE) {
        host.session.close();
      }
    }
  };
  const harness = createRuntimeHarness({
    resolveSlashCommand() {
      return localHandler;
    }
  });

  harness.runtime.startFromText('/local');
  harness.runtime.handleEvent({ type: INPUT_EVENTS.MOVE_RIGHT });

  assert.equal(harness.calls.renders, 2);
  assert.equal(harness.runtime.getSurface().kind, 'select');
  assert.equal(harness.runtime.getSurface().selectedIndex, 1);

  harness.runtime.handleEvent({ type: INPUT_EVENTS.ESCAPE });
  assert.equal(harness.runtime.hasActiveSession(), false);
  assert.equal(harness.calls.leavesHistory, 2);
});

test('createCommandRuntime rerenders after async command handlers settle', async () => {
  let resolveWork;
  const localHandler = {
    name: 'async-local',
    start(_text, host) {
      host.session.open({
        commandName: 'async-local',
        handler: localHandler,
        surface: createConfirmSurface('/async'),
        data: { step: 'ready' }
      });
    },
    async handleEvent(_session, _event, host) {
      host.session.update({
        surface: createConfirmSurface('/async loading'),
        data: { step: 'loading' }
      });
      await new Promise((resolve) => {
        resolveWork = resolve;
      });
      host.session.update({
        surface: createConfirmSurface('/async done'),
        data: { step: 'done' }
      });
    }
  };
  const harness = createRuntimeHarness({
    resolveSlashCommand() {
      return localHandler;
    }
  });

  harness.runtime.startFromText('/async');
  const pending = harness.runtime.handleEvent({ type: INPUT_EVENTS.SUBMIT });

  assert.equal(harness.calls.renders, 2);
  assert.equal(harness.runtime.getSurface().title, '/async loading');

  resolveWork();
  await pending;

  assert.equal(harness.calls.renders, 3);
  assert.equal(harness.runtime.getSurface().title, '/async done');
});

test('createCommandRuntime exits from an active command session', () => {
  const localHandler = {
    name: 'local',
    start(_text, host) {
      host.session.open({
        commandName: 'local',
        handler: localHandler,
        surface: createInfoSurface('/local'),
        data: null
      });
    }
  };
  const harness = createRuntimeHarness({
    resolveSlashCommand() {
      return localHandler;
    }
  });

  harness.runtime.startFromText('/local');
  harness.runtime.handleEvent({ type: INPUT_EVENTS.EXIT });

  assert.equal(harness.calls.exits, 1);
});

test('createCommandRuntime rejects session update without an active session', () => {
  const handler = {
    name: 'broken',
    start(_text, host) {
      host.session.update({ data: { step: 1 } });
    }
  };
  const harness = createRuntimeHarness({
    resolveSlashCommand() {
      return handler;
    }
  });

  assert.throws(
    () => harness.runtime.startFromText('/broken'),
    /command session update requires an active command session/
  );
});
