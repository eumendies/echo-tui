const test = require('node:test');
const assert = require('node:assert/strict');

const {runAssistantTurn} = require('../../src/app/assistant-turn-runner');
const {AppContext} = require('../../src/app/state/app-context');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');
const {UserQuestionContext} = require('../../src/app/state/user-question-context');

function createFakeTranscriptStore() {
  let currentSession = null;
  let currentReference = null;

  return {
    createSession(cwd, operation) {
      currentSession = {
        schemaVersion: 1,
        sessionId: 'session-1',
        cwd,
        createdAt: '2026-06-29T00:00:00.000Z',
        updatedAt: '2026-06-29T00:00:00.000Z',
        records: []
      };
      applyOperation(currentSession, operation);
      currentReference = {
        sessionId: currentSession.sessionId,
        cwd,
        createdAt: currentSession.createdAt,
        updatedAt: currentSession.updatedAt,
        sequence: 1
      };
      return {...currentReference};
    },
    appendSession(cwd, reference, operation) {
      if (!currentSession || reference.sessionId !== currentSession.sessionId) {
        throw new Error('missing session');
      }

      applyOperation(currentSession, operation);
      currentReference = {
        ...currentReference,
        cwd,
        updatedAt: '2026-06-29T00:00:00.000Z',
        sequence: currentReference.sequence + 1
      };
      currentSession.updatedAt = currentReference.updatedAt;
      return {...currentReference};
    },
    listSessions() {
      return [];
    },
    loadSession() {
      return currentSession ? {session: structuredClone(currentSession), reference: {...currentReference}} : null;
    }
  };
}

function applyOperation(session, operation) {
  if (operation.op === 'batch') {
    for (const item of operation.operations) {
      applyOperation(session, item);
    }
    return;
  }

  if (operation.op === 'append_records') {
    session.records.push(...operation.records.map((record) => ({...record})));
  } else if (operation.op === 'truncate_records') {
    session.records.length = operation.recordCount;
  } else if (operation.op === 'set_change_history') {
    session.changeHistory = structuredClone(operation.changeHistory);
  } else if (operation.op === 'set_compaction') {
    if (operation.compaction) {
      session.compaction = {...operation.compaction};
    } else {
      delete session.compaction;
    }
  } else if (operation.op === 'set_todo_state') {
    session.todoState = structuredClone(operation.todoState);
  }
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

test('runAssistantTurn stores plan transition prompt while preserving display, history, metadata, and attachments', async () => {
  const harness = createHarness();
  harness.appContext.setInteractionMode('plan');
  const attachments = [{kind: 'image', mediaType: 'image/png', dataBase64: 'aGVsbG8=', sizeBytes: 5}];
  let capturedSession;

  await runAssistantTurn({
    ...harness.input,
    userText: 'expanded request',
    displayText: '@request.png',
    historyText: '@request.png',
    attachments,
    metadata: {
      skillInvocation: {
        skillName: 'example'
      }
    },
    async runAgent(session, callbacks) {
      capturedSession = session;
      callbacks.onComplete('done');
      return 'done';
    }
  });

  const userRecord = harness.appended[0];
  assert.equal(userRecord.role, 'user');
  assert.match(userRecord.text, /\[Interaction Mode Transition\]/);
  assert.match(userRecord.text, /from: normal/);
  assert.match(userRecord.text, /to: plan/);
  assert.match(userRecord.text, /\[User Request\]\nexpanded request$/);
  assert.equal(userRecord.displayText, '@request.png');
  assert.equal(userRecord.interactionMode, 'plan');
  assert.deepEqual(userRecord.modeTransition, {from: 'normal', to: 'plan'});
  assert.deepEqual(userRecord.skillInvocation, {skillName: 'example'});
  assert.deepEqual(userRecord.attachments, attachments);
  assert.equal(capturedSession.interactionMode, 'plan');
  assert.equal(capturedSession.records[0].text, userRecord.text);
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), ['@request.png']);
});

test('runAssistantTurn injects only effective mode transitions across turns', async () => {
  const harness = createHarness();

  harness.appContext.setInteractionMode('plan');
  await runAssistantTurn({
    ...harness.input,
    userText: 'plan first',
    async runAgent(_session, callbacks) {
      callbacks.onComplete('planned');
      return 'planned';
    }
  });

  await runAssistantTurn({
    ...harness.input,
    userText: 'plan second',
    async runAgent(_session, callbacks) {
      callbacks.onComplete('still planned');
      return 'still planned';
    }
  });

  harness.appContext.setInteractionMode('normal');
  await runAssistantTurn({
    ...harness.input,
    userText: 'implement now',
    async runAgent(_session, callbacks) {
      callbacks.onComplete('implemented');
      return 'implemented';
    }
  });

  const userRecords = harness.appContext.transcriptRecords.filter((record) => record.role === 'user');
  assert.deepEqual(userRecords.map((record) => record.modeTransition), [
    {from: 'normal', to: 'plan'},
    undefined,
    {from: 'plan', to: 'normal'}
  ]);
  assert.equal(userRecords[1].text, 'plan second');
  assert.match(userRecords[2].text, /Previous Plan Mode restrictions no longer apply/);
  assert.equal(userRecords[2].displayText, 'implement now');
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
  assert.deepEqual(harness.appContext.transcriptRecords.map((record) => record.role), [
    'user',
    'tool_call',
    'tool_result',
    'assistant'
  ]);
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
