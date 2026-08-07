const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  HOOK_TEST_OUTPUT_LIMIT_BYTES,
  createLifecycleHookSyntheticPayload,
  executeLifecycleHookSyntheticTest
} = require('../../src/hooks/synthetic-test');
const {
  DEFAULT_HOOK_TIMEOUT_MS,
  createLifecycleHookRuntimeConfigFromDraft,
  parseLifecycleHookConfig
} = require('../../src/hooks/config');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {createLifecycleHookDispatcher} = require('../../src/hooks/dispatcher');
const {executeLifecycleHookSubprocess} = require('../../src/hooks/executor');
const {
  emitToolApprovalRequestHook,
  emitToolApprovalResponseHook,
  emitUserQuestionRequestHook,
  emitUserQuestionResponseHook
} = require('../../src/hooks/lifecycle-events');
const {LIFECYCLE_HOOK_EVENTS} = require('../../src/types/hooks');

function readLifecycleHookConfigDraft(options = {}) {
  const context = new UserConfigContext(options);
  try {
    return context.capture().getLifecycleHookConfigDraft();
  } finally {
    context.close();
  }
}

function saveLifecycleHookConfigDraft(draft, options = {}) {
  const context = new UserConfigContext({configPath: draft.configPath, ...options});
  try {
    return context.saveLifecycleHookConfigDraft(draft);
  } finally {
    context.close();
  }
}

function withTemporaryConfig(config, callback) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-hooks-'));
  const configPath = path.join(homeDir, '.echo', 'config.json');

  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  try {
    return callback({
      configPath,
      readConfig() {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    });
  } finally {
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
}

test('parseLifecycleHookConfig reads valid hook entries and string shorthand', () => {
  const config = parseLifecycleHookConfig({
    hooks: {
      assistant_turn_end: [
        'echo done',
        {command: 'node hook.js', timeoutMs: 1000},
        {command: 'echo disabled', timeoutMs: 1000, enabled: false}
      ],
      tool_call_start: [
        {command: 'echo tool'}
      ],
      tool_approval_response: [
        {command: 'echo approval'}
      ],
      user_question_response: [
        {command: 'echo question'}
      ]
    }
  });

  assert.deepEqual(config, {
    assistant_turn_end: [
      {command: 'echo done', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS},
      {command: 'node hook.js', timeoutMs: 1000}
    ],
    tool_call_start: [
      {command: 'echo tool', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS}
    ],
    tool_approval_response: [
      {command: 'echo approval', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS}
    ],
    user_question_response: [
      {command: 'echo question', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS}
    ]
  });
});

test('readLifecycleHookConfigDraft preserves manageable entries and reports diagnostics', () => {
  withTemporaryConfig({
    hooks: {
      unknown_event: [{command: 'echo unknown'}],
      assistant_turn_end: [
        'echo shorthand',
        {command: 'echo disabled', timeoutMs: 1000, enabled: false},
        {command: '', timeoutMs: 1000},
        {command: 'echo bad enabled', enabled: 'nope'}
      ],
      tool_call_start: 'echo not array'
    }
  }, ({configPath}) => {
    const draft = readLifecycleHookConfigDraft({configPath});
    const assistantTurnEnd = draft.events.find((eventDraft) => eventDraft.event === 'assistant_turn_end');

    assert.equal(draft.configPath, configPath);
    assert.deepEqual(assistantTurnEnd.entries, [
      {command: 'echo shorthand', enabled: true, timeoutMs: DEFAULT_HOOK_TIMEOUT_MS},
      {command: 'echo disabled', enabled: false, timeoutMs: 1000}
    ]);
    assert.deepEqual(draft.diagnostics.map((diagnostic) => diagnostic.message), [
      '未知 hook event，已忽略',
      'command 不能为空',
      'enabled 必须是 boolean',
      'hook entries 必须是数组，已忽略'
    ]);
  });
});

test('saveLifecycleHookConfigDraft only replaces hooks root and preserves disabled entries', () => {
  withTemporaryConfig({
    llm: {selectedModelId: 'gpt'},
    hooks: {
      assistant_turn_end: ['echo old']
    },
    theme: 'amber'
  }, ({configPath, readConfig}) => {
    saveLifecycleHookConfigDraft({
      configPath,
      diagnostics: [],
      events: LIFECYCLE_HOOK_EVENTS.map((event) => ({
        event,
        entries: event === 'assistant_turn_end'
          ? [
              {command: 'echo enabled', enabled: true, timeoutMs: 1000},
              {command: 'echo disabled', enabled: false, timeoutMs: 2000}
            ]
          : []
      }))
    });

    assert.deepEqual(readConfig(), {
      llm: {selectedModelId: 'gpt'},
      hooks: {
        assistant_turn_end: [
          {command: 'echo enabled', timeoutMs: 1000},
          {command: 'echo disabled', timeoutMs: 2000, enabled: false}
        ]
      },
      theme: 'amber'
    });
  });
});

test('createLifecycleHookRuntimeConfigFromDraft omits disabled entries', () => {
  const config = createLifecycleHookRuntimeConfigFromDraft({
    configPath: '/tmp/config.json',
    diagnostics: [],
    events: LIFECYCLE_HOOK_EVENTS.map((event) => ({
      event,
      entries: event === 'assistant_turn_end'
        ? [
            {command: 'echo enabled', enabled: true, timeoutMs: 1000},
            {command: 'echo disabled', enabled: false, timeoutMs: 1000}
          ]
        : []
    }))
  });

  assert.deepEqual(config, {
    assistant_turn_end: [{command: 'echo enabled', timeoutMs: 1000}]
  });
});

test('parseLifecycleHookConfig ignores missing hooks and invalid entries', () => {
  assert.deepEqual(parseLifecycleHookConfig({}), {});
  assert.deepEqual(parseLifecycleHookConfig({hooks: []}), {});

  const config = parseLifecycleHookConfig({
    hooks: {
      unknown_event: [{command: 'echo nope'}],
      assistant_turn_end: [
        {command: ''},
        {command: 'echo bad timeout', timeoutMs: 99},
        {command: 'echo valid', timeoutMs: 100, ignoredField: true}
      ],
      tool_call_end: 'echo not array'
    }
  });

  assert.deepEqual(config, {
    assistant_turn_end: [
      {command: 'echo valid', timeoutMs: 100}
    ]
  });
});

test('createLifecycleHookDispatcher enqueues hooks with payload and isolates executor failures', async () => {
  const calls = [];
  const dispatcher = createLifecycleHookDispatcher({
    cwd: () => '/tmp/project',
    now: () => new Date('2026-06-29T00:00:00.000Z'),
    config: {
      assistant_turn_end: [
        {command: 'first', timeoutMs: 1000},
        {command: 'second', timeoutMs: 1000}
      ]
    },
    async executor(input) {
      calls.push(input);

      if (input.entry.command === 'first') {
        throw new Error('ignored');
      }

      return {ok: true};
    }
  });

  dispatcher.emit('assistant_turn_end', {interactionMode: 'normal', status: 'completed'});
  await dispatcher.flush();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.entry.command), ['first', 'second']);
  assert.deepEqual(calls.map((call) => call.cwd), ['/tmp/project', '/tmp/project']);
  assert.deepEqual(calls[0].payload, {
    event: 'assistant_turn_end',
    timestamp: '2026-06-29T00:00:00.000Z',
    cwd: '/tmp/project',
    interactionMode: 'normal',
    status: 'completed'
  });
});

test('createLifecycleHookDispatcher reloads future emits without rewriting queued jobs', async () => {
  const calls = [];
  let releaseFirst;
  const firstStarted = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const dispatcher = createLifecycleHookDispatcher({
    cwd: '/tmp/project',
    now: () => new Date('2026-06-29T00:00:00.000Z'),
    config: {
      assistant_turn_end: [{command: 'old', timeoutMs: 1000}]
    },
    async executor(input) {
      calls.push(input.entry.command);

      if (input.entry.command === 'old') {
        await firstStarted;
      }

      return {ok: true};
    }
  });

  dispatcher.emit('assistant_turn_end');
  dispatcher.updateConfig({
    assistant_turn_end: [{command: 'new', timeoutMs: 1000}]
  });
  dispatcher.emit('assistant_turn_end');
  releaseFirst();
  await dispatcher.flush();

  assert.deepEqual(calls, ['old', 'new']);
});

test('createLifecycleHookSyntheticPayload covers lifecycle events with stable fields', () => {
  const payloads = LIFECYCLE_HOOK_EVENTS.map((event) => createLifecycleHookSyntheticPayload({
    cwd: '/tmp/project',
    event,
    interactionMode: 'plan',
    now: () => new Date('2026-06-29T00:00:00.000Z')
  }));

  assert.deepEqual(payloads.map((payload) => payload.event), LIFECYCLE_HOOK_EVENTS);
  assert.deepEqual(payloads.map((payload) => payload.cwd), LIFECYCLE_HOOK_EVENTS.map(() => '/tmp/project'));
  assert.equal(payloads.find((payload) => payload.event === 'assistant_turn_start').interactionMode, 'plan');
  assert.equal(payloads.find((payload) => payload.event === 'assistant_turn_error').errorName, 'HookTestError');
  assert.equal(payloads.find((payload) => payload.event === 'tool_call_start').argumentsText, '{}');
  assert.equal(payloads.find((payload) => payload.event === 'tool_call_end').ok, true);
  assert.equal(payloads.find((payload) => payload.event === 'tool_approval_request').preview, 'echo hook');
  assert.equal(payloads.find((payload) => payload.event === 'tool_approval_response').feedbackText, 'synthetic feedback');
  assert.equal(payloads.find((payload) => payload.event === 'user_question_request').questionCount, 1);
  assert.match(payloads.find((payload) => payload.event === 'user_question_response').resultText, /"selected":"yes"/);
  assert.equal(payloads.find((payload) => payload.event === 'compaction_end').activeStartIndex, 0);
});

test('interaction lifecycle helpers map domain values and emit stable payloads', () => {
  const events = [];
  const hooks = {
    emit(event, payload) {
      events.push({event, payload});
    }
  };
  const approvalCall = {
    callId: 'approval-call',
    toolName: 'run_bash_command',
    argumentsText: '{"command":"rm generated.txt"}'
  };
  const questionCall = {
    callId: 'question-call',
    toolName: 'ask_user_questions',
    argumentsText: '{"questions":[]}'
  };

  emitToolApprovalRequestHook(hooks, {
    interactionMode: 'plan',
    toolCall: approvalCall,
    approval: {previewTitle: 'command', preview: 'rm generated.txt'}
  });
  emitToolApprovalResponseHook(hooks, {
    interactionMode: 'plan',
    toolCall: approvalCall,
    decision: {kind: 'allow_command_for_session', toolName: 'run_bash_command', command: 'rm generated.txt'}
  });
  emitUserQuestionRequestHook(hooks, {
    interactionMode: 'normal',
    toolCall: questionCall,
    request: {questions: [{question: 'First?', options: [{label: 'yes'}]}, {question: 'Second?', options: [{label: 'no'}]}]}
  });
  emitUserQuestionResponseHook(hooks, {
    interactionMode: 'normal',
    toolCall: questionCall,
    result: {
      callId: questionCall.callId,
      toolName: questionCall.toolName,
      ok: true,
      details: {kind: 'generic'},
      text: '{"answers":[{"selected":"yes"},{"selected":"no"}]}'
    }
  });

  assert.deepEqual(events, [
    {
      event: 'tool_approval_request',
      payload: {
        interactionMode: 'plan',
        toolCallId: 'approval-call',
        toolName: 'run_bash_command',
        argumentsText: '{"command":"rm generated.txt"}',
        previewTitle: 'command',
        preview: 'rm generated.txt'
      }
    },
    {
      event: 'tool_approval_response',
      payload: {
        interactionMode: 'plan',
        toolCallId: 'approval-call',
        toolName: 'run_bash_command',
        argumentsText: '{"command":"rm generated.txt"}',
        decision: 'allow_command_for_session',
        approvedCommand: 'rm generated.txt'
      }
    },
    {
      event: 'user_question_request',
      payload: {
        interactionMode: 'normal',
        toolCallId: 'question-call',
        toolName: 'ask_user_questions',
        argumentsText: '{"questions":[]}',
        questionCount: 2,
        questionsText: 'First?\nSecond?'
      }
    },
    {
      event: 'user_question_response',
      payload: {
        interactionMode: 'normal',
        toolCallId: 'question-call',
        toolName: 'ask_user_questions',
        argumentsText: '{"questions":[]}',
        ok: true,
        resultText: '{"answers":[{"selected":"yes"},{"selected":"no"}]}',
        answerCount: 2
      }
    }
  ]);
});

test('executeLifecycleHookSyntheticTest captures success, failure, truncation, startup error, and timeout', async () => {
  const payload = {
    event: 'tool_call_start',
    timestamp: '2026-06-29T00:00:00.000Z',
    cwd: process.cwd(),
    toolName: 'grep'
  };
  const success = await executeLifecycleHookSyntheticTest({
    cwd: process.cwd(),
    entry: {
      command: 'node -e "let s = \'\'; process.stdin.on(\'data\', c => s += c); process.stdin.on(\'end\', () => { const p = JSON.parse(s); process.stdout.write(process.env.ECHO_HOOK_EVENT + \':\' + process.env.ECHO_HOOK_CWD + \':\' + p.toolName); });"',
      timeoutMs: 1000
    },
    payload
  });

  assert.equal(success.ok, true);
  assert.equal(success.exitCode, 0);
  assert.match(success.stdout, /tool_call_start/);
  assert.match(success.stdout, /grep/);

  const nonzero = await executeLifecycleHookSyntheticTest({
    cwd: process.cwd(),
    entry: {command: 'node -e "process.exit(7)"', timeoutMs: 1000},
    payload
  });

  assert.equal(nonzero.ok, false);
  assert.equal(nonzero.exitCode, 7);

  const truncated = await executeLifecycleHookSyntheticTest({
    cwd: process.cwd(),
    entry: {command: 'node -e "process.stdout.write(\'a\'.repeat(5000)); process.stderr.write(\'b\'.repeat(5000));"', timeoutMs: 1000},
    payload
  });

  assert.equal(truncated.ok, true);
  assert.equal(Buffer.byteLength(truncated.stdout), HOOK_TEST_OUTPUT_LIMIT_BYTES);
  assert.equal(Buffer.byteLength(truncated.stderr), HOOK_TEST_OUTPUT_LIMIT_BYTES);
  assert.equal(truncated.stdoutTruncated, true);
  assert.equal(truncated.stderrTruncated, true);

  const startupFailure = await executeLifecycleHookSyntheticTest({
    cwd: path.join(os.tmpdir(), 'echo-hooks-missing-cwd'),
    entry: {command: 'node -e "process.exit(0)"', timeoutMs: 1000},
    payload
  });

  assert.equal(startupFailure.ok, false);
  assert.match(startupFailure.error, /ENOENT|no such file/i);

  const timeout = await executeLifecycleHookSyntheticTest({
    cwd: process.cwd(),
    entry: {command: 'node -e "setTimeout(() => {}, 1000)"', timeoutMs: 20},
    payload
  });

  assert.equal(timeout.ok, false);
  assert.equal(timeout.timedOut, true);
});

test('executeLifecycleHookSubprocess passes payload through stdin and event environment', async () => {
  const result = await executeLifecycleHookSubprocess({
    cwd: process.cwd(),
    entry: {
      command: 'node -e "let s = \'\'; process.stdin.on(\'data\', c => s += c); process.stdin.on(\'end\', () => { const p = JSON.parse(s); if (process.env.ECHO_HOOK_EVENT !== \'tool_call_start\' || process.env.ECHO_HOOK_CWD !== process.cwd() || p.toolName !== \'grep\') process.exit(2); });"',
      timeoutMs: 1000
    },
    payload: {
      event: 'tool_call_start',
      timestamp: '2026-06-29T00:00:00.000Z',
      cwd: process.cwd(),
      toolCallId: 'call-1',
      toolName: 'grep'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
});

test('executeLifecycleHookSubprocess ignores output and isolates timeout', async () => {
  const outputResult = await executeLifecycleHookSubprocess({
    cwd: process.cwd(),
    entry: {
      command: 'node -e "process.stdout.write(\'abcdef\'); process.stderr.write(\'error\')"',
      timeoutMs: 1000
    },
    payload: {
      event: 'assistant_turn_end',
      timestamp: '2026-06-29T00:00:00.000Z',
      cwd: process.cwd()
    }
  });

  assert.equal(outputResult.ok, true);
  assert.equal('stdout' in outputResult, false);
  assert.equal('stderr' in outputResult, false);

  const timeoutResult = await executeLifecycleHookSubprocess({
    cwd: process.cwd(),
    entry: {
      command: 'node -e "setTimeout(() => {}, 1000)"',
      timeoutMs: 20
    },
    payload: {
      event: 'assistant_turn_end',
      timestamp: '2026-06-29T00:00:00.000Z',
      cwd: process.cwd()
    }
  });

  assert.equal(timeoutResult.ok, false);
  assert.equal(timeoutResult.timedOut, true);
});
