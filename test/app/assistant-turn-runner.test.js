const test = require('node:test');
const assert = require('node:assert/strict');

const {runAssistantTurn} = require('../../src/app/assistant-turn-runner');
const {AppContext} = require('../../src/app/state/app-context');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');
const {UserQuestionContext} = require('../../src/app/state/user-question-context');

function createFakeTranscriptStore() {
  let currentSession = null;

  return {
    createSession(cwd, records = []) {
      return {
        schemaVersion: 1,
        sessionId: 'session-1',
        cwd,
        createdAt: '2026-06-29T00:00:00.000Z',
        updatedAt: '2026-06-29T00:00:00.000Z',
        records: records.map((record) => ({...record}))
      };
    },
    listSessions() {
      return [];
    },
    loadSession() {
      return currentSession ? structuredClone(currentSession) : null;
    },
    saveSession(cwd, session) {
      currentSession = {
        ...session,
        cwd,
        updatedAt: '2026-06-29T00:00:00.000Z',
        records: session.records.map((record) => ({...record}))
      };
      return structuredClone(currentSession);
    }
  };
}

function createHarness() {
  const appContext = new AppContext(
    {getSize() { return {columns: 80, rows: 24}; }},
    createFakeTranscriptStore(),
    '/tmp/echo_tui',
    'v20.0.0'
  );
  const appended = [];
  const hookEvents = [];
  const debugEvents = [];

  return {
    appContext,
    appended,
    debugEvents,
    hookEvents,
    input: {
      appContext,
      toolApproval: new ToolApprovalContext(() => {}),
      userQuestion: new UserQuestionContext(() => {}),
      userText: 'hello',
      appendRecord(record) {
        appended.push(record);
      },
      appendRecords(records) {
        appended.push(...records);
      },
      hooks: {
        emit(event, payload) {
          hookEvents.push({event, payload});
        },
        async flush() {}
      },
      debug: {
        enabled: true,
        logPath: '/tmp/debug.jsonl',
        emit(event, payload) {
          debugEvents.push({event, payload});
        },
        close() {}
      },
      renderFooter() {}
    }
  };
}

test('runAssistantTurn emits start and end hooks without adding hook records', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.deepEqual(harness.hookEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_end'
  ]);
  assert.deepEqual(harness.hookEvents.map((event) => event.payload.status), ['started', 'completed']);
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'assistant']);
  assert.deepEqual(harness.debugEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_end'
  ]);
  assert.equal(harness.debugEvents[0].payload.userText.length, 5);
  assert.equal(harness.appContext.responding, false);
});

test('runAssistantTurn stores submit interaction mode on user records', async () => {
  const harness = createHarness();
  harness.appContext.setInteractionMode('plan');

  await runAssistantTurn({
    ...harness.input,
    metadata: {
      skillInvocation: {
        skillName: 'example'
      }
    },
    async runAgent(_session, callbacks) {
      callbacks.onComplete('done');
      return 'done';
    }
  });

  const userRecord = harness.appended[0];
  assert.equal(userRecord.role, 'user');
  assert.equal(userRecord.interactionMode, 'plan');
  assert.deepEqual(userRecord.skillInvocation, {skillName: 'example'});
});

test('runAssistantTurn persists provider records without visible assistant text', async () => {
  const harness = createHarness();
  const reasoningContentRecord = {
    role: 'openai_chat_reasoning',
    text: '',
    reasoningContent: 'hidden'
  };

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onProviderRecords([reasoningContentRecord]);
      callbacks.onComplete('done');
      return 'done';
    }
  });

  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'openai_chat_reasoning', 'assistant']);
  assert.deepEqual(harness.appContext.transcriptRecords.map((record) => record.role), ['user', 'openai_chat_reasoning', 'assistant']);
});

test('runAssistantTurn persists shared tool records with result metadata', async () => {
  const harness = createHarness();
  const attachments = [{
    kind: 'image',
    mediaType: 'image/png',
    dataBase64: 'aGVsbG8=',
    path: '/tmp/screenshot.png',
    sizeBytes: 5
  }];

  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      callbacks.onToolCall({
        callId: 'call_search',
        toolName: 'web_search',
        argumentsText: '{"query":"Echo TUI"}'
      });
      callbacks.onToolResult({
        callId: 'call_search',
        toolName: 'web_search',
        ok: true,
        text: 'search result',
        timedOut: false,
        truncated: true,
        attachments
      });
      callbacks.onComplete('done');
      return 'done';
    }
  });

  const [toolCall, toolResult] = harness.appContext.transcriptRecords.slice(1, 3);
  assert.equal(toolCall.text, 'web_search({"query":"Echo TUI"})');
  assert.equal(toolResult.timedOut, false);
  assert.equal(toolResult.truncated, true);
  assert.deepEqual(toolResult.attachments, attachments);
});

test('runAssistantTurn emits error hook while preserving error transcript behavior', async () => {
  const harness = createHarness();

  await runAssistantTurn({
    ...harness.input,
    async runAgent() {
      throw new Error('upstream failed');
    }
  });

  assert.deepEqual(harness.hookEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_error'
  ]);
  assert.equal(harness.hookEvents[1].payload.status, 'error');
  assert.deepEqual(harness.appended.map((record) => record.role), ['user', 'error']);
  assert.deepEqual(harness.debugEvents.map((event) => event.event), [
    'assistant_turn_start',
    'assistant_turn_error'
  ]);
  assert.equal(harness.debugEvents[1].payload.errorMessage, 'upstream failed');
  assert.match(harness.appended.at(-1).text, /upstream failed/);
  assert.equal(harness.appContext.responding, false);
});
