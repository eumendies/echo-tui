const test = require('node:test');
const assert = require('node:assert/strict');

const { createTuiTheme } = require('../../src/config/theme-config');
const { createComposer } = require('../../src/input/composer');
const { displayWidth, safeRenderWidth, stripAnsi } = require('../../src/render/layout');

const DEFAULT_STATUS_LINE = {
  projectName: 'echo_tui',
  model: {kind: 'default', label: 'GPT-4o'},
  mode: 'idle'
};
const ASK_USER_QUESTIONS_TOOL_NAME = 'ask_user_questions';
const appRenderer = require('../../src/render/app-renderer');
const { renderToolCallPreviewLines } = require('../../src/render/tool-message-renderer');
const ansi = require('../../src/terminal/ansi');

function normalizeTranscriptRecord(record, index = 0) {
  if (record.role === 'user') {
    const {interactionMode, modeTransition, skillInvocation, agentWorkflow, ...rest} = record;
    const metadata = {
      ...(rest.metadata || {}),
      ...(interactionMode ? {interactionMode} : {}),
      ...(modeTransition ? {modeTransition} : {}),
      ...(skillInvocation ? {skillInvocation} : {}),
      ...(agentWorkflow ? {agentWorkflow} : {})
    };
    return {...rest, ...(Object.keys(metadata).length > 0 ? {metadata} : {})};
  }

  if (record.role === 'tool_call') {
    return {
      ...record,
      toolCallId: record.toolCallId || `fixture-call-${index}`,
      toolName: record.toolName || 'unknown_tool',
      argumentsText: record.argumentsText ?? '{}'
    };
  }

  if (record.role === 'tool_result') {
    const {exitCode, timedOut, truncated, durationMs, display, ...rest} = record;
    let details = record.details;

    if (!details && record.toolName === 'run_bash_command') {
      details = {kind: 'bash', exitCode, timedOut, truncated, durationMs};
    } else if (!details && (record.toolName === 'apply_patch' || record.toolName === 'edit_file')) {
      details = {kind: record.toolName, ...(display ? {display} : {})};
    }

    return {
      ...rest,
      toolCallId: record.toolCallId || `fixture-result-${index}`,
      toolName: record.toolName || 'unknown_tool',
      ok: record.ok ?? false,
      details: details || {kind: 'generic'}
    };
  }

  return record;
}

function normalizeTranscriptRecords(records) {
  return records.map(normalizeTranscriptRecord);
}

function renderTranscriptLines(records, ...args) {
  return appRenderer.renderTranscriptLines(normalizeTranscriptRecords(records), ...args);
}

function createAppRenderer(output) {
  const renderer = appRenderer.createAppRenderer(output);
  return {
    ...renderer,
    renderRecords(options) {
      return renderer.renderRecords({...options, records: normalizeTranscriptRecords(options.records)});
    },
    render(options, finalizeRecord) {
      return renderer.render(options, finalizeRecord ? normalizeTranscriptRecord(finalizeRecord) : undefined);
    },
    renderDestructive(options) {
      return renderer.renderDestructive({...options, records: normalizeTranscriptRecords(options.records)});
    },
    renderFinal(options) {
      return renderer.renderFinal({...options, records: normalizeTranscriptRecords(options.records)});
    }
  };
}

function assertSafeRenderLines(lines, width) {
  for (const line of lines) {
    const plainLine = stripAnsi(line);

    assert.equal(plainLine.includes('\n'), false, `line contains raw newline: ${JSON.stringify(plainLine)}`);
    assert.equal(plainLine.includes('\r'), false, `line contains raw carriage return: ${JSON.stringify(plainLine)}`);
    assert.ok(displayWidth(line) <= safeRenderWidth(width), `line exceeds safe width: ${JSON.stringify(plainLine)}`);
  }
}

function createAskUserQuestionsCall(callId, questions) {
  return {
    role: 'tool_call',
    text: '',
    toolCallId: callId,
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    argumentsText: JSON.stringify({questions})
  };
}

function createAskUserQuestionsResult(callId, payload, ok = true) {
  return {
    role: 'tool_result',
    text: typeof payload === 'string' ? payload : JSON.stringify(payload),
    toolCallId: callId,
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    ok,
    details: {kind: 'generic'}
  };
}

test('createAppRenderer includes the pending message card in destructive recovery without creating transcript content', () => {
  const output = {
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
    }
  };
  const renderer = createAppRenderer(output);

  renderer.renderDestructive({
    bannerContext: {cwd: '/tmp/echo_tui', nodeVersion: 'v20.0.0', terminalSize: {columns: 50, rows: 10}, mode: 'current terminal'},
    records: [{role: 'assistant', text: 'current answer'}],
    composer: createComposer('later draft'),
    pendingMessage: {preview: 'queued request'},
    commandSurface: null,
    pending: null,
    working: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 10,
    width: 50
  });

  const plain = stripAnsi(output.writes[0]);
  assert.ok(plain.includes('current answer'));
  assert.ok(plain.includes('待发送消息'));
  assert.ok(plain.includes('queued request'));
  assert.ok(plain.includes('later draft'));
  assert.equal((plain.match(/queued request/g) || []).length, 1);
});

test('createAppRenderer computes streaming history and final record suffix internally', () => {
  const output = {writes: [], write(chunk) { this.writes.push(String(chunk)); }};
  const renderer = createAppRenderer(output);
  const state = {
    streamingOwner: 'main',
    composer: createComposer(),
    commandSurface: null,
    slashSuggestions: null,
    pending: {kind: 'streaming', text: 'alpha\n\nbeta'},
    working: {elapsedMs: 10},
    renderPreferences: {showReasoningSummary: true, slashSuggestionMaxVisible: 8},
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'streaming'},
    rows: 24,
    width: 80
  };

  renderer.render(state);
  renderer.render({...state, pending: null, working: null}, {role: 'assistant', text: 'alpha\n\nbeta'});

  const plain = stripAnsi(output.writes.join(''));
  assert.equal((plain.match(/◆ alpha/g) || []).length, 1);
  assert.equal(plain.includes('beta'), true);
  assert.equal(plain.includes('◆ beta'), false);
});

test('createAppRenderer flushes the reasoning tail before assistant history and filters hidden reasoning', () => {
  const shownChunks = [];
  const shown = createAppRenderer({write(chunk) { shownChunks.push(String(chunk)); }});
  const state = {
    streamingOwner: 'main',
    composer: createComposer(),
    commandSurface: null,
    pending: {kind: 'streaming', text: 'stable assistant\n\ntail', reasoningText: 'stable reasoning'},
    working: {elapsedMs: 10},
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'streaming'},
    rows: 24,
    width: 30,
    renderPreferences: {showReasoningSummary: true, slashSuggestionMaxVisible: 8}
  };
  shown.render(state);
  const shownPlain = stripAnsi(shownChunks.at(-1));
  assert.ok(shownPlain.indexOf('stable reasoning') < shownPlain.indexOf('stable assistant'));

  const hiddenChunks = [];
  const hidden = createAppRenderer({write(chunk) { hiddenChunks.push(String(chunk)); }});
  hidden.render({...state, renderPreferences: {showReasoningSummary: false, slashSuggestionMaxVisible: 8}});
  const hiddenPlain = stripAnsi(hiddenChunks.at(-1));
  assert.doesNotMatch(hiddenPlain, /stable reasoning/);
  assert.match(hiddenPlain, /stable assistant/);
});

test('createAppRenderer keeps late reasoning out of assistant output for main and BTW owners', () => {
  for (const streamingOwner of ['main', 'btw']) {
    const chunks = [];
    const renderer = createAppRenderer({write(chunk) { chunks.push(String(chunk)); }});
    const state = {
      streamingOwner,
      composer: createComposer(),
      commandSurface: null,
      slashSuggestions: null,
      working: {elapsedMs: 10},
      renderPreferences: {showReasoningSummary: true, slashSuggestionMaxVisible: 8},
      statusLine: {...DEFAULT_STATUS_LINE, mode: 'streaming'},
      rows: 24,
      width: 40
    };
    const assistantText = 'stable assistant\n\ntail';
    const completeReasoning = 'early reasoning\nlate reasoning';

    renderer.render({
      ...state,
      pending: {kind: 'streaming', text: assistantText, reasoningText: 'early reasoning'}
    });
    renderer.render({
      ...state,
      pending: {kind: 'streaming', text: assistantText, reasoningText: completeReasoning}
    });
    renderer.render({
      ...state,
      pending: {kind: 'streaming', text: assistantText, reasoningText: completeReasoning}
    }, {role: 'reasoning_summary', text: completeReasoning});
    renderer.render({...state, pending: null, working: null}, {role: 'assistant', text: assistantText});

    const realtime = stripAnsi(chunks.join(''));
    assert.match(realtime, /early reasoning/);
    assert.match(realtime, /stable assistant/);
    assert.match(realtime, /tail/);
    assert.doesNotMatch(realtime, /late reasoning/);

    renderer.renderDestructive({
      ...state,
      bannerContext: {cwd: '/tmp/project', nodeVersion: 'v20', terminalSize: {columns: 40, rows: 24}, mode: 'current terminal'},
      records: [
        {role: 'reasoning_summary', text: completeReasoning},
        {role: 'assistant', text: assistantText}
      ],
      pending: null,
      working: null
    });
    const replay = stripAnsi(chunks.at(-1));
    assert.ok(replay.indexOf('late reasoning') < replay.indexOf('stable assistant'));
  }
});

test('createAppRenderer closes reasoning display even when assistant starts without a reasoning draft', () => {
  const chunks = [];
  const renderer = createAppRenderer({write(chunk) { chunks.push(String(chunk)); }});
  const state = {
    streamingOwner: 'main',
    composer: createComposer(),
    commandSurface: null,
    slashSuggestions: null,
    working: {elapsedMs: 10},
    renderPreferences: {showReasoningSummary: true, slashSuggestionMaxVisible: 8},
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'streaming'},
    rows: 24,
    width: 40
  };

  renderer.render({...state, pending: {kind: 'streaming', text: 'answer'}});
  renderer.render({...state, pending: {kind: 'streaming', text: 'answer', reasoningText: 'late reasoning'}});
  renderer.render({
    ...state,
    pending: {kind: 'streaming', text: 'answer', reasoningText: 'late reasoning'}
  }, {role: 'reasoning_summary', text: 'late reasoning'});
  renderer.render({...state, pending: null, working: null}, {role: 'assistant', text: 'answer'});

  assert.doesNotMatch(stripAnsi(chunks.join('')), /late reasoning/);
});

test('createAppRenderer destructively switches between BTW side records and latest main records', () => {
  const chunks = [];
  const renderer = createAppRenderer({write(chunk) { chunks.push(String(chunk)); }});
  const base = {
    composer: createComposer(),
    commandSurface: null,
    slashSuggestions: null,
    pending: null,
    working: null,
    width: 80,
    rows: 24,
    statusLine: DEFAULT_STATUS_LINE
  };

  renderer.renderDestructive({
    ...base,
    bannerContext: {cwd: '/tmp/project', nodeVersion: 'v20', terminalSize: {columns: 80, rows: 24}, mode: 'current terminal', variant: 'btw', parentActivity: 'MAIN streaming'},
    records: [{role: 'assistant', text: 'side-only answer'}]
  });
  renderer.renderDestructive({
    ...base,
    bannerContext: {cwd: '/tmp/project', nodeVersion: 'v20', terminalSize: {columns: 80, rows: 24}, mode: 'current terminal'},
    records: [{role: 'assistant', text: 'latest main answer'}]
  });

  const sideFrame = stripAnsi(chunks.at(-2));
  const mainFrame = stripAnsi(chunks.at(-1));
  assert.match(sideFrame, /BTW · 临时只读会话/);
  assert.match(sideFrame, /side-only answer/);
  assert.doesNotMatch(sideFrame, /latest main answer/);
  assert.match(mainFrame, /latest main answer/);
  assert.doesNotMatch(mainFrame, /side-only answer/);
});

test('createAppRenderer replays a response-time command surface while appending stable transcript', () => {
  const output = {
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
    }
  };
  const renderer = createAppRenderer(output);
  const state = {
    composer: createComposer(''),
    commandSurface: {
      kind: 'info',
      title: '/status',
      lines: ['当前状态'],
      dismissHint: 'Esc 关闭'
    },
    pending: {kind: 'streaming', text: 'background draft'},
    working: {elapsedMs: 900},
    statusLine: undefined,
    rows: 12,
    width: 60
  };

  renderer.renderDestructive({
    bannerContext: {cwd: '/tmp/echo_tui', nodeVersion: 'v20.0.0', terminalSize: {columns: 60, rows: 12}, mode: 'current terminal'},
    records: [{role: 'assistant', text: 'stable answer'}],
    ...state
  });

  const replay = stripAnsi(output.writes[0]);
  assert.ok(output.writes[0].includes(ansi.clearVisibleScreen()));
  assert.ok(output.writes[0].includes(ansi.clearScrollback()));
  assert.equal((replay.match(/stable answer/g) || []).length, 1);
  assert.equal((replay.match(/\/status/g) || []).length, 1);

  renderer.renderRecords({
    records: [{role: 'local_notice', text: 'stable notice'}],
    ...state
  });

  const appendFrame = stripAnsi(output.writes.slice(1).join(''));
  assert.equal((appendFrame.match(/stable notice/g) || []).length, 1);
  assert.equal((appendFrame.match(/\/status/g) || []).length, 1);
  assert.equal(appendFrame.includes('stable answer'), false);
});

function createMemoryToolCall(callId, toolName, args) {
  return {
    role: 'tool_call',
    text: '',
    toolCallId: callId,
    toolName,
    argumentsText: typeof args === 'string' ? args : JSON.stringify(args)
  };
}

function createMemoryToolResult(callId, toolName, payload, ok = true) {
  return {
    role: 'tool_result',
    text: typeof payload === 'string' ? payload : JSON.stringify(payload),
    toolCallId: callId,
    toolName,
    ok,
    details: {kind: 'generic'}
  };
}

test('renderTranscriptLines projects user, assistant, error, local notice, and reasoning summary records', () => {
  const lines = renderTranscriptLines(
    [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'world' },
      { role: 'error', text: '模型响应失败：timeout' },
      { role: 'local_notice', text: '已中断模型回答' },
      { role: 'reasoning_summary', text: '我会先检查上下文。' }
    ],
    80
  ).map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.startsWith('▌ hello')));
  assert.ok(lines.some((line) => line.startsWith('◆ world')));
  assert.ok(lines.some((line) => line.startsWith('✕ 模型响应失败：timeout')));
  assert.ok(lines.some((line) => line.startsWith('◇ 已中断模型回答')));
  assert.ok(lines.some((line) => line.startsWith('◇ 我会先检查上下文。')));
});

test('renderTranscriptLines filters reasoning summaries only at the render boundary', () => {
  const records = [
    {role: 'user', text: 'question'},
    {role: 'reasoning_summary', text: 'private visible summary'},
    {role: 'assistant', text: 'answer'}
  ];
  const lines = renderTranscriptLines(records, 80, undefined, {
    showReasoningSummary: false,
    slashSuggestionMaxVisible: 8
  }).map((line) => stripAnsi(line));

  assert.equal(lines.some((line) => line.includes('private visible summary')), false);
  assert.equal(lines.some((line) => line.includes('question')), true);
  assert.equal(lines.some((line) => line.includes('answer')), true);
  assert.equal(records[1].role, 'reasoning_summary');
});

test('renderTranscriptLines uses displayText for user records when present', () => {
  const lines = renderTranscriptLines(
    [
      {
        role: 'user',
        text: '[Skill Invocation]\n[Skill Instructions]\n# Review\n[User Request]\ninspect src/app/main.ts',
        displayText: '/review inspect src/app/main.ts'
      }
    ],
    80
  ).map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.startsWith('▌ /review inspect src/app/main.ts')));
  assert.equal(lines.some((line) => line.includes('Skill Instructions')), false);
});

test('renderTranscriptLines replays conversation reference card without expanded history or internal metadata', () => {
  const lines = renderTranscriptLines([{
    role: 'user',
    text: '<referenced_conversation>\nprivate long history\n</referenced_conversation>\n<current_request>\ncontinue\n</current_request>',
    displayText: 'continue',
    metadata: {
      conversationReference: {
        projectionMode: 'summary',
        sourcePath: '/tmp/session-internal.jsonl',
        sourceSessionId: 'session-internal',
        title: 'MCP 权限分级设计'
      }
    }
  }], 80).map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.includes('引用对话 · 总结')));
  assert.ok(lines.some((line) => line.includes('MCP 权限分级设计')));
  assert.ok(lines.some((line) => line.startsWith('▌ continue')));
  assert.equal(lines.some((line) => line.includes('private long history')), false);
  assert.equal(lines.some((line) => line.includes('session-internal')), false);
});

test('renderTranscriptLines hides mode transition prompt behind user display text', () => {
  const lines = renderTranscriptLines(
    [{
      role: 'user',
      text: '[Interaction Mode Transition]\nfrom: plan\nto: normal\n\n[Mode Instructions]\nPrevious Plan Mode restrictions no longer apply.\n\n[User Request]\nimplement now',
      displayText: 'implement now',
      interactionMode: 'normal',
      modeTransition: {from: 'plan', to: 'normal'}
    }],
    80
  ).map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.startsWith('▌ implement now')));
  assert.equal(lines.some((line) => line.includes('Interaction Mode Transition')), false);
  assert.equal(lines.some((line) => line.includes('Mode Instructions')), false);
});

test('renderTranscriptLines colors plan mode user prefix with footer plan color', () => {
  const theme = createTuiTheme({
    blocks: {
      colors: {
        userBackground: {ansi256: 99},
        userPrefix: [4, 5, 6],
        userText: [7, 8, 9]
      }
    },
    footer: {
      colors: {
        plan: [170, 150, 245]
      }
    }
  });
  const lines = renderTranscriptLines(
    [
      { role: 'user', text: 'normal' },
      { role: 'user', text: 'plan', interactionMode: 'plan' }
    ],
    80,
    theme
  );
  const normalLine = lines.find((line) => stripAnsi(line).startsWith('▌ normal'));
  const planLine = lines.find((line) => stripAnsi(line).startsWith('▌ plan'));

  assert.ok(normalLine.includes('\x1b[38;2;4;5;6m▌ '));
  assert.ok(planLine.includes('\x1b[38;2;170;150;245m▌ '));
  assert.equal(planLine.includes('\x1b[38;2;4;5;6m▌ '), false);
});

test('renderTranscriptLines keeps a blank line between adjacent transcript records', () => {
  const lines = renderTranscriptLines(
    [
      { role: 'assistant', text: 'first' },
      { role: 'assistant', text: 'second' }
    ],
    80
  ).map((line) => stripAnsi(line));

  assert.deepEqual(lines, [
    '◆ first',
    '',
    '◆ second',
    ''
  ]);
});

test('renderTranscriptLines projects bash tool call and result with dedicated styling', () => {
  const renderedLines = renderTranscriptLines(
    [
      {
        role: 'tool_call',
        text: '$ pwd',
        toolCallId: 'call_1',
        toolName: 'run_bash_command',
        argumentsText: '{"command":"pwd"}'
      },
      {
        role: 'tool_result',
        text: '$ pwd\nexit_code: 0\nduration_ms: 10\ntimed_out: false\ntruncated: false\n\nstdout:\n/tmp/echo_tui\n\nstderr:\n',
        toolCallId: 'call_1',
        toolName: 'run_bash_command',
        ok: true,
        exitCode: 0,
        durationMs: 10
      }
    ],
    80
  );
  const lines = renderedLines.map((line) => stripAnsi(line));

  assert.deepEqual(lines, [
    '◆ ▌ Bash · complete · exit 0 · 10ms',
    '  ▌ pwd',
    '  ▌ ',
    '  ▌ /tmp/echo_tui',
    ''
  ]);
  assert.match(renderedLines[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m/);
  assert.match(renderedLines[2], /\x1b\[38;2;85;85;85m▌\x1b\[39m/);
});

test('renderTranscriptLines keeps bash status literals in stdout from changing structured status', () => {
  const lines = renderTranscriptLines(
    [
      {
        role: 'tool_call',
        text: '',
        toolCallId: 'status_literal',
        toolName: 'run_bash_command',
        argumentsText: JSON.stringify({command: 'printf status'})
      },
      {
        role: 'tool_result',
        text: 'stdout:\ntimed_out: true\ntruncated: true\n\nstderr:\n',
        toolCallId: 'status_literal',
        toolName: 'run_bash_command',
        ok: true,
        exitCode: 0,
        durationMs: 5
      }
    ],
    80
  ).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ ▌ Bash · complete · exit 0 · 5ms'));
  assert.equal(lines.some((line) => line.includes('Bash · timed out')), false);
  assert.equal(lines.some((line) => line.includes('Bash · complete · exit 0 · 5ms · truncated')), false);
  assert.ok(lines.includes('  ▌ timed_out: true'));
  assert.ok(lines.includes('  ▌ truncated: true'));
  assert.equal(lines.some((line) => line.includes('Output was truncated.')), false);
});

test('renderTranscriptLines renders bash heredocs as a bounded rail while preserving shell context', () => {
  const script = Array.from({length: 14}, (_value, index) => `print(${index})`).join('\n');
  const command = `cd workspace &&\nexport MODE=check\npython3 - <<'PY'\n${script}\nPY\necho done`;
  const records = [
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'heredoc',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({command})
    },
    {
      role: 'tool_result',
      text: 'done',
      toolCallId: 'heredoc',
      toolName: 'run_bash_command',
      ok: true,
      exitCode: 0,
      durationMs: 1200
    }
  ];
  const snapshot = JSON.parse(JSON.stringify(records));
  const lines = renderTranscriptLines(records, 80).map((line) => stripAnsi(line));

  assert.ok(lines.includes('  ▌ cd workspace &&'));
  assert.ok(lines.includes('  ▌ export MODE=check'));
  assert.ok(lines.includes("  ▌ python3 - <<'PY'"));
  assert.ok(lines.includes('  ▌ … 3 more lines'));
  assert.ok(lines.includes('  ▌ PY'));
  assert.ok(lines.includes('  ▌ echo done'));
  assert.ok(lines.includes('  ▌ done'));
  assert.equal(lines.some((line) => line.includes("Bash('")), false);
  assert.deepEqual(records, snapshot);
});

test('renderTranscriptLines closes bash heredocs using shell delimiter rules', () => {
  const exactCommand = [
    'cat <<EOF',
    'body',
    ' EOF',
    ...Array.from({length: 13}, (_value, index) => `space body ${index + 1}`),
    'EOF',
    'echo exact done'
  ].join('\n');
  const tabCommand = [
    'cat <<-TAB',
    'tab body',
    ' TAB',
    ...Array.from({length: 13}, (_value, index) => `tab body ${index + 1}`),
    '\tTAB',
    'echo tab done'
  ].join('\n');
  const lines = renderTranscriptLines(
    [
      {
        role: 'tool_call',
        text: '',
        toolCallId: 'heredoc_exact',
        toolName: 'run_bash_command',
        argumentsText: JSON.stringify({command: exactCommand})
      },
      {
        role: 'tool_result',
        text: 'exact done',
        toolCallId: 'heredoc_exact',
        toolName: 'run_bash_command',
        ok: true,
        exitCode: 0
      },
      {
        role: 'tool_call',
        text: '',
        toolCallId: 'heredoc_tab',
        toolName: 'run_bash_command',
        argumentsText: JSON.stringify({command: tabCommand})
      },
      {
        role: 'tool_result',
        text: 'tab done',
        toolCallId: 'heredoc_tab',
        toolName: 'run_bash_command',
        ok: true,
        exitCode: 0
      }
    ],
    80
  ).map((line) => stripAnsi(line));

  assert.ok(lines.includes('  ▌  EOF'));
  assert.ok(lines.includes('  ▌ … 4 more lines'));
  assert.ok(lines.includes('  ▌ EOF'));
  assert.ok(lines.includes('  ▌ echo exact done'));
  assert.ok(lines.includes('  ▌ cat <<-TAB'));
  assert.ok(lines.includes('  ▌  TAB'));
  assert.equal(lines.filter((line) => line === '  ▌ … 4 more lines').length, 2);
  assert.ok(lines.includes('  ▌     TAB'));
  assert.ok(lines.includes('  ▌ echo tab done'));
});

test('renderTranscriptLines keeps multiline bash commands with inline scripts as independent rail rows', () => {
  const width = 140;
  const command = [
    'echo before',
    'node -e "console.log(\'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz\');"',
    'echo after'
  ].join('\n');
  const records = [
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'multiline_inline',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({command})
    },
    {
      role: 'tool_result',
      text: 'stdout:\ndone\n\nstderr:\n',
      toolCallId: 'multiline_inline',
      toolName: 'run_bash_command',
      ok: true,
      exitCode: 0
    }
  ];
  const rendered = renderTranscriptLines(records, width);
  const lines = rendered.map((line) => stripAnsi(line));

  assertSafeRenderLines(rendered, width);
  assert.ok(lines.includes('  ▌ echo before'));
  assert.ok(lines.includes('  ▌ node -e "console.log(\'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz\');"'));
  assert.ok(lines.includes('  ▌ echo after'));
  assert.equal(lines.includes('node -e "…"'), false);
  assert.equal(lines.includes('echo after'), false);
});

test('renderTranscriptLines expands tabs in bash rails and generic tool fallback without mutating records', () => {
  const records = [
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'bash_tabs',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({command: 'printf\tone\n\techo tabbed'})
    },
    {
      role: 'tool_result',
      text: 'stdout:\nout\tone\n\nstderr:\nerr\tone\n',
      toolCallId: 'bash_tabs',
      toolName: 'run_bash_command',
      ok: false,
      exitCode: 1
    },
    {
      role: 'tool_call',
      text: 'legacy',
      toolCallId: 'generic_tabs',
      toolName: 'tab_tool',
      argumentsText: 'raw\targument'
    },
    {
      role: 'tool_result',
      text: 'generic\tresult',
      toolCallId: 'generic_tabs',
      toolName: 'tab_tool',
      ok: true
    }
  ];
  const snapshot = JSON.parse(JSON.stringify(records));
  const rendered = renderTranscriptLines(records, 80);
  const lines = rendered.map((line) => stripAnsi(line));

  assertSafeRenderLines(rendered, 80);
  assert.equal(lines.some((line) => line.includes('\t')), false);
  assert.ok(lines.includes('  ▌ printf      one'));
  assert.ok(lines.includes('  ▌     echo tabbed'));
  assert.ok(lines.includes('  ▌ out one'));
  assert.ok(lines.includes('  ▌ err one'));
  assert.ok(lines.includes('◆ Tab tool'));
  assert.ok(lines.some((line) => line.startsWith('  raw') && line.endsWith('argument')));
  assert.ok(lines.includes('  ⎿ generic     result'));
  assert.deepEqual(records, snapshot);
});

test('renderTranscriptLines handles inline scripts, stderr channels, fallback, narrow widths, and custom rail colors', () => {
  const inlineCommand = `python3 -c "${Array.from({length: 13}, (_value, index) => `print(${index})`).join('\n')}"`;
  const theme = createTuiTheme({
    blocks: {
      colors: {
        tool: [1, 2, 3],
        toolOutput: [4, 5, 6],
        toolError: [7, 8, 9],
        toolSuccess: [10, 11, 12]
      }
    }
  });
  const rendered = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'inline',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({command: inlineCommand})
    },
    {
      role: 'tool_result',
      text: 'stdout:\nfirst\n\nstderr:\nfailed\n',
      toolCallId: 'inline',
      toolName: 'run_bash_command',
      ok: false,
      exitCode: 1,
      truncated: true
    },
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'success',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({command: 'echo ok'})
    },
    {
      role: 'tool_result',
      text: 'stdout:\nsuccess\n\nstderr:\n',
      toolCallId: 'success',
      toolName: 'run_bash_command',
      ok: true,
      exitCode: 0
    },
    {
      role: 'tool_call',
      text: 'fallback',
      toolName: 'run_bash_command',
      argumentsText: '{}'
    },
    {
      role: 'tool_call',
      text: '',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({command: 'python3 -c "print($(date))"'})
    }
  ], 24, theme);
  const lines = rendered.map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.includes('python3 -c "…"')));
  assert.ok(lines.some((line) => line.includes('… 2 more lines')));
  assert.equal(lines.some((line) => line.includes('stdout') || line.includes('stderr')), false);
  assert.ok(lines.includes('  ▌ first'));
  assert.ok(lines.includes('  ▌ failed'));
  assert.ok(lines.includes('  ▌ success'));
  assert.ok(lines.includes('  ▌ Output was truncate'));
  assert.ok(lines.includes('◆ Bash'));
  assert.ok(lines.includes('  {}'));
  assert.ok(lines.some((line) => line.includes('python3 -c "print($')));
  assert.ok(rendered.some((line) => line.includes('\x1b[38;2;1;2;3m▌\x1b[39m')));
  assert.ok(rendered.some((line) => line.includes('\x1b[38;2;4;5;6m▌\x1b[39m')));
  assert.ok(rendered.some((line) => line.includes('\x1b[38;2;7;8;9m◆\x1b[39m')));
  assert.match(rendered[0], /\x1b\[38;2;7;8;9m◆\x1b\[39m \x1b\[38;2;7;8;9m▌\x1b\[39m \x1b\[38;2;7;8;9mBash · failed/);
  assert.match(rendered.find((line) => stripAnsi(line).includes('Bash · complete')), /\x1b\[38;2;10;11;12m◆\x1b\[39m \x1b\[38;2;10;11;12m▌\x1b\[39m \x1b\[38;2;10;11;12mBash · complete/);
  assert.match(rendered.find((line) => stripAnsi(line).includes('python3 -c "…"')), /\x1b\[38;2;7;8;9m▌\x1b\[39m/);
  assert.match(rendered.find((line) => stripAnsi(line).includes('first')), /\x1b\[38;2;4;5;6m▌\x1b\[39m/);
  assert.match(rendered.find((line) => stripAnsi(line).includes('python3 -c "print($')), /\x1b\[38;2;1;2;3m▌\x1b\[39m/);
  assert.ok(rendered.every((line) => displayWidth(line) <= safeRenderWidth(24)));
});

test('renderTranscriptLines applies one combined display budget to bash stdout and stderr rows', () => {
  const stdout = Array.from({length: 8}, (_value, index) => `out ${index + 1}`).join('\n');
  const stderr = Array.from({length: 8}, (_value, index) => `err ${index + 1}`).join('\n');
  const rendered = renderTranscriptLines(
    [
      {
        role: 'tool_call',
        text: '',
        toolCallId: 'combined_budget',
        toolName: 'run_bash_command',
        argumentsText: JSON.stringify({command: 'run noisy'})
      },
      {
        role: 'tool_result',
        text: `stdout:\n${stdout}\n\nstderr:\n${stderr}\n`,
        toolCallId: 'combined_budget',
        toolName: 'run_bash_command',
        ok: false,
        exitCode: 1
      }
    ],
    80
  );
  const lines = rendered.map((line) => stripAnsi(line));

  assert.ok(lines.includes('  ▌ out 8'));
  assert.ok(lines.includes('  ▌ err 1'));
  assert.ok(lines.includes('  ▌ err 3'));
  assert.equal(lines.some((line) => line.includes('err 4')), false);
  assert.ok(lines.includes('  ▌ … 5 more lines'));
  assert.match(rendered.find((line) => stripAnsi(line).includes('err 1')), /\x1b\[38;2;170;0;0merr 1\x1b\[39m/);
});

test('renderTranscriptLines colors tool call prefix by adjacent result state with neutral fallback', () => {
  const renderedLines = renderTranscriptLines(
    [
      { role: 'tool_call', text: 'ok call', toolCallId: 'ok', toolName: 'ok_tool', argumentsText: '{}' },
      { role: 'tool_result', text: 'ok', toolCallId: 'ok', ok: true },
      { role: 'tool_call', text: 'failed call', toolCallId: 'failed', toolName: 'failed_tool', argumentsText: '{}' },
      { role: 'tool_result', text: 'failed', toolCallId: 'failed', ok: false },
      { role: 'tool_call', text: 'legacy call', toolCallId: 'legacy', toolName: 'legacy_tool', argumentsText: '{}' },
      { role: 'tool_result', text: 'legacy', toolCallId: 'legacy' }
    ],
    80
  );

  assert.match(renderedLines.find((line) => stripAnsi(line).includes('Ok tool')), /\x1b\[38;2;0;170;0m◆\x1b\[39m/);
    assert.match(renderedLines.find((line) => stripAnsi(line).includes('Failed tool')), /\x1b\[38;2;170;0;0m◆\x1b\[39m/);
  assert.doesNotMatch(renderedLines.find((line) => stripAnsi(line).includes('Legacy tool')), /\x1b\[(31|32)m◆/);
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('⎿ ok')), /\x1b\[38;2;85;85;85m/);
});

test('renderTranscriptLines only groups adjacent matching tool records', () => {
  const renderedLines = renderTranscriptLines(
    [
      { role: 'tool_call', text: 'first call', toolCallId: 'first', toolName: 'first_tool', argumentsText: '{}' },
      { role: 'assistant', text: 'between' },
      { role: 'tool_result', text: 'late result', toolCallId: 'first', ok: true },
      { role: 'tool_call', text: 'mismatch call', toolCallId: 'second', toolName: 'second_tool', argumentsText: '{}' },
      { role: 'tool_result', text: 'mismatch result', toolCallId: 'third', ok: false },
      { role: 'tool_call', text: 'paired call', toolCallId: 'paired', toolName: 'paired_tool', argumentsText: '{}' },
      { role: 'tool_result', text: 'paired result', toolCallId: 'paired', ok: false }
    ],
    80
  );

  assert.doesNotMatch(renderedLines.find((line) => stripAnsi(line).includes('First tool')), /\x1b\[(31|32)m◆/);
  assert.doesNotMatch(renderedLines.find((line) => stripAnsi(line).includes('Second tool')), /\x1b\[(31|32)m◆/);
    assert.match(renderedLines.find((line) => stripAnsi(line).includes('Paired tool')), /\x1b\[38;2;170;0;0m◆\x1b\[39m/);
});

test('renderTranscriptLines wraps bash tool result and hides execution summary', () => {
  const lines = renderTranscriptLines(
    [
      {
        role: 'tool_result',
        text: '$ echo abcdefghijkl\nexit_code: 0\nduration_ms: 10\ntimed_out: false\ntruncated: false\n\nstdout:\nabcdefghijkl\n\nstderr:\n',
        toolName: 'run_bash_command',
        ok: true
      }
    ],
    10
  ).map((line) => stripAnsi(line));

  assert.deepEqual(lines, [
    '  ⎿ abcde',
    '    fghij',
    '    kl',
    ''
  ]);
  assert.ok(lines.every((line) => !line.includes('exit_code')));
  assert.ok(lines.every((line) => !line.includes('duration_ms')));
});

test('renderTranscriptLines displays stderr, no output, timeout, truncation, and fallback tool records', () => {
  const longOutput = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join('\n');
  const lines = renderTranscriptLines(
    [
      {
        role: 'tool_result',
        text: '$ missing\nexit_code: 1\nduration_ms: 10\ntimed_out: false\ntruncated: false\n\nstdout:\n\nstderr:\nmissing file\n',
        toolName: 'run_bash_command',
        ok: false
      },
      {
        role: 'tool_result',
        text: '$ noisy\nexit_code: 1\nduration_ms: 10\ntimed_out: false\ntruncated: true\n\nstdout:\n\nstderr:\nimportant stderr\n\nOutput was truncated.',
        toolName: 'run_bash_command',
        ok: false,
        truncated: true
      },
      {
        role: 'tool_result',
        text: '$ touch ok\nexit_code: 0\nduration_ms: 10\ntimed_out: false\ntruncated: false\n\nstdout:\n\nstderr:\n',
        toolName: 'run_bash_command',
        ok: true
      },
      {
        role: 'tool_result',
        text: '$ sleep 60\nexit_code: null\nduration_ms: 30000\ntimed_out: true\ntruncated: false\n\nstdout:\n\nstderr:\n',
        toolName: 'run_bash_command',
        ok: false,
        timedOut: true
      },
      {
        role: 'tool_result',
        text: `$ seq\nexit_code: 0\nduration_ms: 10\ntimed_out: false\ntruncated: true\n\nstdout:\n${longOutput}\n\nstderr:\n`,
        toolName: 'run_bash_command',
        ok: true,
        truncated: true
      },
      { role: 'tool_call', text: '', toolCallId: 'generic', toolName: 'generic_tool', argumentsText: 'legacy call' },
      { role: 'tool_result', text: 'legacy result', toolCallId: 'generic', toolName: 'generic_tool', ok: true, details: {kind: 'generic'} }
    ],
    80
  ).map((line) => stripAnsi(line));

  assert.ok(lines.includes('  ⎿ missing file'));
  assert.ok(lines.includes('  ⎿ important stderr'));
  assert.ok(!lines.some((line) => line.includes('Output was truncated.')));
  assert.ok(lines.includes('  ⎿ (no output)'));
  assert.ok(lines.includes('  ⎿ Command timed out.'));
  assert.ok(lines.includes('    [tool output truncated for display]'));
  assert.ok(lines.includes('◆ Generic tool'));
  assert.ok(lines.includes('  legacy call'));
  assert.ok(lines.includes('  ⎿ legacy result'));
});

test('renderTranscriptLines renders generic MCP calls with source identity and layered arguments', () => {
  const record = {
    role: 'tool_call',
    text: '',
    toolCallId: 'mcp-call',
    toolName: 'mcp__github_server__createIssue',
    argumentsText: '{"title":"Fix rendering"}'
  };
  const snapshot = structuredClone(record);
  const lines = renderTranscriptLines([record], 80).map(stripAnsi);

  assert.ok(lines.includes('◆ MCP · github server · create issue'));
  assert.ok(lines.includes('  {"title":"Fix rendering"}'));
  assert.deepEqual(record, snapshot);
});

test('renderTranscriptLines projects todo tool results with dedicated state display', () => {
  const renderedLines = renderTranscriptLines(
    [
      {
        role: 'tool_call',
        text: '',
        toolCallId: 'todo-call',
        toolName: 'create_todos',
        argumentsText: '{"items":["first","second"]}'
      },
      {
        role: 'tool_result',
        text: JSON.stringify({
          action: 'create_todos',
          items: [
            {id: 'todo_1', text: 'first open', status: 'open'},
            {id: 'todo_2', text: 'second open', status: 'open'}
          ],
          openTodos: [
            {id: 'todo_1', text: 'first open', status: 'open'},
            {id: 'todo_2', text: 'second open', status: 'open'}
          ]
        }),
        toolCallId: 'todo-call',
        toolName: 'create_todos',
        ok: true
      }
    ],
    80
  );
  const plainLines = renderedLines.map((line) => stripAnsi(line));

  assert.deepEqual(plainLines, [
    '◆ Create todos',
    '  ⎿ ○ first open',
    '    ○ second open',
    ''
  ]);
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('○ first open')), /\x1b\[38;2;0;170;170m/);
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('○ second open')), /\x1b\[38;2;85;85;85m/);
});

test('renderTranscriptLines renders completed todos with check and strikethrough', () => {
  const renderedLines = renderTranscriptLines(
    [
      {
        role: 'tool_result',
        text: JSON.stringify({
          action: 'complete_todo',
          completedIds: ['todo_1'],
          notFoundIds: [],
          items: [
            {id: 'todo_1', text: 'done item', status: 'completed'},
            {id: 'todo_2', text: 'remaining item', status: 'open'}
          ],
          openTodos: [
            {id: 'todo_2', text: 'remaining item', status: 'open'}
          ]
        }),
        toolCallId: 'todo-call',
        toolName: 'complete_todo',
        ok: true
      }
    ],
    80
  );
  const plainLines = renderedLines.map((line) => stripAnsi(line));

  assert.ok(plainLines.includes('  ⎿ ✓ done item'));
  assert.ok(plainLines.includes('    ○ remaining item'));
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('✓ done item')), /\x1b\[9m done item\x1b\[29m/);
});

test('renderTranscriptLines falls back for malformed todo tool output', () => {
  const lines = renderTranscriptLines(
    [
      {
        role: 'tool_result',
        text: 'not-json',
        toolName: 'complete_todo',
        ok: false
      }
    ],
    80
  ).map((line) => stripAnsi(line));

  assert.ok(lines.includes('  ⎿ not-json'));
});

test('renderTranscriptLines projects ask_user_questions single and multi answers without raw JSON field names', () => {
  const renderedLines = renderTranscriptLines([
    createAskUserQuestionsCall('questions-call', [
      {
        question: 'Pick one?',
        options: [{label: 'Yes'}, {label: 'No'}]
      },
      {
        question: 'Pick many?',
        multiSelect: true,
        options: [{label: 'A'}, {label: 'B'}, {label: 'C'}]
      }
    ]),
    createAskUserQuestionsResult('questions-call', {
      answers: [
        {index: 0, selected: 'No'},
        {index: 1, multiSelect: true, selectedOptions: ['A', 'C']}
      ]
    })
  ], 80);
  const lines = renderedLines.map((line) => stripAnsi(line));

  assert.deepEqual(lines, [
    '◆ Ask user questions · 2 questions',
    '  ⎿ 1. Pick one?（单选）',
    '       ● No',
    '    2. Pick many?（多选）',
    '       ● A',
    '       ● C',
    ''
  ]);
  assert.equal(lines.some((line) => /answers|index|selected|selectedOptions|multiSelect/.test(line)), false);
  assert.match(renderedLines[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m Ask user questions/);
  assert.match(renderedLines[1], /\x1b\[38;2;85;85;85m/);
});

test('renderTranscriptLines and pending preview summarize valid unpaired ask_user_questions calls', () => {
  const call = createAskUserQuestionsCall('pending-questions-call', [
    {question: 'Pick one?', options: [{label: 'Yes'}, {label: 'No'}]},
    {question: 'Pick many?', multiSelect: true, options: [{label: 'A'}, {label: 'B'}]}
  ]);
  const callLines = renderTranscriptLines([call], 80).map((line) => stripAnsi(line));
  const previewLines = renderToolCallPreviewLines(ASK_USER_QUESTIONS_TOOL_NAME, call.argumentsText, 80).map((line) => stripAnsi(line));

  assert.ok(callLines.includes('◆ Ask user questions · 2 questions'));
  assert.ok(previewLines.includes('◆ Ask user questions · 2 questions'));
  assert.equal(callLines.some((line) => line.includes('"questions"')), false);
  assert.equal(previewLines.some((line) => line.includes('"questions"')), false);
});

test('renderTranscriptLines keeps malformed unpaired ask_user_questions calls concise', () => {
  const lines = renderTranscriptLines([{
    ...createAskUserQuestionsCall('invalid-pending-questions-call', [{question: 'Pick?', options: [{label: 'A'}]}]),
    argumentsText: '{not-json'
  }], 80).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Ask user questions'));
  assert.equal(lines.some((line) => line.includes('{not-json')), true);
});

test('renderTranscriptLines projects ask_user_questions Other and cancelled receipts', () => {
  const otherLines = renderTranscriptLines([
    createAskUserQuestionsCall('other-call', [
      {
        question: 'Pick extras?',
        multiSelect: true,
        options: [{label: 'A'}, {label: 'B'}]
      }
    ]),
    createAskUserQuestionsResult('other-call', {
      answers: [
        {index: 0, multiSelect: true, selectedOptions: ['B', 'Other'], customText: 'custom answer'}
      ]
    })
  ], 80).map((line) => stripAnsi(line));

  assert.ok(otherLines.includes('       ● B'));
  assert.ok(otherLines.includes('       ● Other：custom answer'));
  assert.equal(otherLines.some((line) => line.includes('customText')), false);

  const cancelledRenderedLines = renderTranscriptLines([
    createAskUserQuestionsCall('cancel-call', [
      {
        question: 'Proceed?',
        options: [{label: 'Yes'}, {label: 'No'}]
      }
    ]),
    createAskUserQuestionsResult('cancel-call', {cancelled: true, reason: 'User dismissed dialog'}, false)
  ], 80);
  const cancelledLines = cancelledRenderedLines.map((line) => stripAnsi(line));

  assert.deepEqual(cancelledLines, [
    '◆ Ask user questions · 1 question',
    '  ⎿ 已取消：User dismissed dialog',
    ''
  ]);
  assert.equal(cancelledLines.some((line) => /cancelled|reason/.test(line)), false);
  assert.match(cancelledRenderedLines[0], /\x1b\[38;2;170;0;0m◆\x1b\[39m Ask user questions/);
});

test('renderTranscriptLines falls back for invalid ask_user_questions pair shapes', () => {
  const validQuestions = [
    {
      question: 'Pick one?',
      options: [{label: 'A'}, {label: 'B'}]
    }
  ];
  const cases = [
    {
      call: {
        ...createAskUserQuestionsCall('invalid-args', validQuestions),
        argumentsText: '{not-json'
      },
      result: createAskUserQuestionsResult('invalid-args', {answers: [{index: 0, selected: 'A'}]}),
      expected: '"selected":"A"'
    },
    {
      call: createAskUserQuestionsCall('invalid-result', validQuestions),
      result: createAskUserQuestionsResult('invalid-result', 'not-json'),
      expected: 'not-json'
    },
    {
      call: createAskUserQuestionsCall('invalid-index', validQuestions),
      result: createAskUserQuestionsResult('invalid-index', {answers: [{index: 9, selected: 'A'}]}),
      expected: '"index":9'
    },
    {
      call: createAskUserQuestionsCall('invalid-shape', validQuestions),
      result: createAskUserQuestionsResult('invalid-shape', {answers: [{index: 0, selectedOptions: ['A']}]}),
      expected: 'selectedOptions'
    }
  ];

  for (const {call, result, expected} of cases) {
    const renderedLines = renderTranscriptLines([call, result], 80);
    const lines = renderedLines.map((line) => stripAnsi(line));

    assert.ok(lines.some((line) => line.startsWith('◆ Ask user questions')));
    assert.ok(lines.some((line) => line.includes(expected)));
    assert.equal(lines.some((line) => line.includes('ask_user_questions(')), false);
    assert.match(renderedLines[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m Ask user questions/);
  }
});

test('renderTranscriptLines wraps and truncates ask_user_questions receipts within tool layout', () => {
  const narrowLines = renderTranscriptLines([
    createAskUserQuestionsCall('wrapped-question', [
      {
        question: 'Choose the very long answer label?',
        options: [{label: 'abcdefghijklmnopqrstuvwxyz'}]
      }
    ]),
    createAskUserQuestionsResult('wrapped-question', {
      answers: [{index: 0, selected: 'abcdefghijklmnopqrstuvwxyz'}]
    })
  ], 20).map((line) => stripAnsi(line));

  assert.ok(narrowLines.some((line) => line.includes('klmnopqrst')));
  assert.equal(narrowLines.every((line) => displayWidth(line) <= 19), true);

  const questions = Array.from({length: 5}, (_unused, index) => ({
    question: `Question ${index + 1}?`,
    multiSelect: true,
    options: [{label: `A${index + 1}`}, {label: `B${index + 1}`}]
  }));
  const answers = questions.map((_question, index) => ({
    index,
    multiSelect: true,
    selectedOptions: [`A${index + 1}`, `B${index + 1}`]
  }));
  const truncatedLines = renderTranscriptLines([
    createAskUserQuestionsCall('truncated-question', questions),
    createAskUserQuestionsResult('truncated-question', {answers})
  ], 80).map((line) => stripAnsi(line));

  assert.ok(truncatedLines.includes('    [tool output truncated for display]'));
  assert.equal(truncatedLines.some((line) => line.includes('Question 5?')), false);
});

test('renderTranscriptLines keeps read_files directory entries visible before generic truncation', () => {
  const argumentsText = '{"files":[{"path":"src/tools/read-files","limit":2}]}';
  const resultText = [
    '--- directory: src/tools/read-files',
    'entries:',
    '- src/tools/read-files/index.ts; file; size_bytes: 331',
    '- src/tools/read-files/readers.ts; file; size_bytes: 18000',
    '- src/tools/read-files/a.ts; file; size_bytes: 1',
    '- src/tools/read-files/b.ts; file; size_bytes: 1',
    '- src/tools/read-files/c.ts; file; size_bytes: 1',
    '- src/tools/read-files/d.ts; file; size_bytes: 1',
    '- src/tools/read-files/e.ts; file; size_bytes: 1',
    '- src/tools/read-files/f.ts; file; size_bytes: 1',
    '- src/tools/read-files/g.ts; file; size_bytes: 1',
    '- src/tools/read-files/h.ts; file; size_bytes: 1',
    '- src/tools/read-files/i.ts; file; size_bytes: 1',
    '- src/tools/read-files/j.ts; file; size_bytes: 1',
    '- src/tools/read-files/k.ts; file; size_bytes: 1',
    '',
    'has_more: true'
  ].join('\n');
  const lines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'call_read',
      toolName: 'read_files',
      argumentsText
    },
    {
      role: 'tool_result',
      text: resultText,
      toolCallId: 'call_read',
      toolName: 'read_files',
      ok: true,
      truncated: true
    }
  ], 80).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Read files · src/tools/read-files@0+2'));
  assert.ok(lines.includes('  └─ directory: src/tools/read-files  entries: 13'));
  assert.ok(lines.some((line) => line.includes('• src/tools/read-files/index.ts  file, size_bytes: 331')));
  assert.ok(lines.some((line) => line.includes('• src/tools/read-files/readers.ts  file, size_bytes: 18000')));
  assert.equal(lines.some((line) => line.includes('has_more')), false);
  // 单目录 13 条 entries 在专属预算内全部展示，不再出现通用截断提示。
  assert.ok(lines.some((line) => line.includes('• src/tools/read-files/k.ts  file, size_bytes: 1')));
  assert.equal(lines.some((line) => line.includes('[tool output truncated for display]')), false);
});

test('renderTranscriptLines projects read_files calls without raw arguments JSON', () => {
  const longPath = 'src/very/long/path/that/should/be/ellipsized/because/it/is/noisy.ts';
  const lines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'read-single',
      toolName: 'read_files',
      argumentsText: JSON.stringify({files: [{path: 'src/foo.ts', offset: 5, limit: 20}]})
    },
    {
      role: 'tool_result',
      text: ['--- text: src/foo.ts', '', 'content:', '```', '6 │ hello', '```'].join('\n'),
      toolCallId: 'read-single',
      toolName: 'read_files',
      ok: true,
      truncated: false
    },
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'read-many',
      toolName: 'read_files',
      argumentsText: JSON.stringify({files: [
        {path: longPath},
        {path: 'b.ts'},
        {path: 'c.ts'},
        {path: 'd.ts'}
      ]})
    }
  ], 120).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Read files · src/foo.ts@5+20'));
  assert.ok(lines.some((line) => line.startsWith('◆ Read files · src/very/long/path/that/should/be/ellipsized/')));
  assert.ok(lines.some((line) => line.includes('…')));
  assert.ok(lines.some((line) => line.includes('… +1 more')));
  assert.equal(lines.some((line) => line.includes('"files"')), false);
});

test('renderTranscriptLines projects read_files text output as compact summaries', () => {
  const lines = renderTranscriptLines([
    {
      role: 'tool_result',
      text: [
        '--- text: src/foo.ts',
        'has_more: true',
        'content_truncated: true',
        '',
        'content:',
        '```',
        '9 │ before width changes',
        '10 │ const value = 1;',
        '11 │ // --- text: not an envelope inside content',
        '```'
      ].join('\n'),
      toolName: 'read_files',
      ok: true,
      truncated: true
    },
    {
      role: 'tool_result',
      text: [
        '--- text: src/bar.ts',
        '',
        'content:',
        '```',
        '1 │ export const bar = true;',
        '```'
      ].join('\n'),
      toolName: 'read_files',
      ok: true,
      truncated: false
    }
  ], 100).map((line) => stripAnsi(line));

  // 两个 tool_result 是独立记录，各自只含一个 envelope，因此都闭合为 └─。
  assert.ok(lines.includes('  └─ text: src/foo.ts  lines: 9-11 (3), content_truncated: true'));
  assert.ok(lines.includes('  └─ text: src/bar.ts  lines: 1 (1)'));
  // 正文进入有界预览：行号 9-11 宽度 2，闭合 rail 后行号右对齐。
  assert.ok(lines.includes('     9 │ before width changes'));
  assert.ok(lines.includes('    10 │ const value = 1;'));
  // content block 内的伪 header 不会打断 envelope 解析，作为普通预览行展示。
  assert.ok(lines.includes('    11 │ // --- text: not an envelope inside content'));
  // 单行内容行号宽度为 1，闭合 rail 后直接跟行号。
  assert.ok(lines.includes('    1 │ export const bar = true;'));
  assert.equal(lines.some((line) => line.includes('has_more')), false);
  assert.equal(lines.some((line) => line.startsWith('  ├─ --- text:') || line.startsWith('    --- text:')), false);
  assert.equal(lines.some((line) => line === '    content:' || line === '    ```'), false);
});

test('renderTranscriptLines preserves semicolons in read_files directory entry paths', () => {
  const lines = renderTranscriptLines([
    {
      role: 'tool_result',
      text: [
        '--- directory: src/tools/read-files',
        'entries:',
        '- src/tools/read-files/name;with;semi.ts; file; size_bytes: 42',
        '- src/tools/read-files/sub;dir; directory'
      ].join('\n'),
      toolName: 'read_files',
      ok: true,
      truncated: false
    }
  ], 120).map((line) => stripAnsi(line));

  assert.ok(lines.includes('  └─ directory: src/tools/read-files  entries: 2'));
  assert.ok(lines.some((line) => line.includes('• src/tools/read-files/name;with;semi.ts  file, size_bytes: 42')));
  assert.ok(lines.some((line) => line.includes('• src/tools/read-files/sub;dir  directory')));
});

test('renderTranscriptLines projects read_files image, pdf summaries, and error envelopes', () => {
  const lines = renderTranscriptLines([
    {
      role: 'tool_result',
      text: [
        '--- image: assets/logo.png',
        'size_bytes: 2048',
        'image_attached: true',
        '',
        '--- pdf: docs/spec.pdf',
        'pages: 3',
        'pages_with_text: 2',
        'content_truncated: true',
        '',
        'extracted_text:',
        '```',
        'first page text',
        '```',
        '',
        '--- binary: build/app.bin',
        'size_bytes: 4096',
        'error: unsupported media type',
        'reason: binary reading is not supported by this version'
      ].join('\n'),
      toolName: 'read_files',
      ok: false,
      truncated: true,
      attachments: [{kind: 'image', mediaType: 'image/png', data: 'base64-data'}]
    }
  ], 120).map((line) => stripAnsi(line));

  assert.ok(lines.includes('  ├─ image: assets/logo.png  size_bytes: 2048, image_attached: true'));
  assert.ok(lines.includes('  ├─ pdf: docs/spec.pdf  pages: 3, pages_with_text: 2, content_truncated: true'));
  assert.equal(lines.some((line) => line.includes('first page text')), false);
  assert.equal(lines.some((line) => line.includes('extracted_text')), false);
  assert.ok(lines.some((line) => line.includes('binary: build/app.bin  size_bytes: 4096, error: unsupported media type, reason: binary reading is not supported')));
  // 超长 error header 按可用宽度尾部省略，保留省略号。
  assert.ok(lines.some((line) => line.includes('not supported') && line.endsWith('…')));
  assert.equal(lines.some((line) => line.includes('base64-data')), false);
});

test('renderTranscriptLines falls back for malformed read_files calls and results', () => {
  const lines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'bad-read-call',
      toolName: 'read_files',
      argumentsText: '{not-json'
    },
    {
      role: 'tool_result',
      text: '--- text: src/foo.ts\ncontent:\n```\nmissing closing fence',
      toolCallId: 'bad-read-call',
      toolName: 'read_files',
      ok: false,
      truncated: false
    },
    {
      role: 'tool_result',
      text: 'read_files failed.\nReason: files must be an array',
      toolName: 'read_files',
      ok: false,
      truncated: false
    }
  ], 100).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Read files'));
  assert.ok(lines.includes('  {not-json'));
  assert.ok(lines.some((line) => line.includes('--- text: src/foo.ts')));
  assert.ok(lines.some((line) => line.includes('missing closing fence')));
  assert.ok(lines.includes('  ⎿ read_files failed.'));
  assert.ok(lines.includes('    Reason: files must be an array'));
});

test('renderTranscriptLines keeps read_files transcript records unchanged', () => {
  const resultRecord = {
    role: 'tool_result',
    text: ['--- image: assets/logo.png', 'size_bytes: 2048', 'image_attached: true'].join('\n'),
    toolName: 'read_files',
    ok: true,
    truncated: false,
    attachments: [{kind: 'image', mediaType: 'image/png', data: 'base64-data'}]
  };
  const before = JSON.parse(JSON.stringify(resultRecord));

  renderTranscriptLines([resultRecord], 80);

  assert.deepEqual(resultRecord, before);
});

test('renderTranscriptLines projects successful use_skill pairs as a concise summary', () => {
  const records = [
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'skill-success',
      toolName: 'use_skill',
      argumentsText: JSON.stringify({name: 'openspec-explore'})
    },
    {
      role: 'tool_result',
      text: [
        'skill: openspec-explore',
        'source: /repo/.echo/skills/openspec-explore/SKILL.md',
        '',
        '# Explore Skill Body',
        'Full skill instructions that should stay provider-visible only.',
        '',
        '[Skill Resources]',
        '- docs/private-notes.md'
      ].join('\n'),
      toolCallId: 'skill-success',
      toolName: 'use_skill',
      ok: true
    }
  ];
  const lines = renderTranscriptLines(records, 100).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Using skill · openspec-explore'));
  assert.equal(lines.some((line) => line.includes('source:')), false);
  assert.equal(lines.some((line) => line.includes('Explore Skill Body')), false);
  assert.equal(lines.some((line) => line.includes('provider-visible only')), false);
  assert.equal(lines.some((line) => line.includes('[Skill Resources]')), false);
  assert.equal(lines.some((line) => line.includes('private-notes.md')), false);
});

test('renderTranscriptLines hides use_skill arguments in successful pairs', () => {
  const lines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'skill-args',
      toolName: 'use_skill',
      argumentsText: JSON.stringify({name: 'review', arguments: 'inspect src/secrets.ts'})
    },
    {
      role: 'tool_result',
      text: [
        'skill: review',
        'source: /repo/.echo/skills/review/SKILL.md',
        'arguments: inspect src/secrets.ts',
        '',
        '# Review Skill'
      ].join('\n'),
      toolCallId: 'skill-args',
      toolName: 'use_skill',
      ok: true
    }
  ], 100).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Using skill · review'));
  assert.equal(lines.some((line) => line.includes('"arguments"')), false);
  assert.equal(lines.some((line) => line.includes('arguments:')), false);
  assert.equal(lines.some((line) => line.includes('inspect src/secrets.ts')), false);
});

test('renderTranscriptLines and tool call preview summarize pending use_skill calls', () => {
  const argumentsText = JSON.stringify({name: 'echo-tui-setup', arguments: 'configure providers'});
  const transcriptLines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'skill-pending',
      toolName: 'use_skill',
      argumentsText
    }
  ], 100).map((line) => stripAnsi(line));
  const previewLines = renderToolCallPreviewLines('use_skill', argumentsText, 100).map((line) => stripAnsi(line));

  assert.ok(transcriptLines.includes('◆ Using skill · echo-tui-setup'));
  assert.ok(previewLines.includes('◆ Using skill · echo-tui-setup'));
  assert.equal([...transcriptLines, ...previewLines].some((line) => line.includes('"name"')), false);
  assert.equal([...transcriptLines, ...previewLines].some((line) => line.includes('configure providers')), false);
});

test('renderTranscriptLines shows bounded diagnostics for failed use_skill pairs', () => {
  const failureText = [
    'Unknown skill: missing',
    'available_skills:',
    ...Array.from({length: 14}, (_unused, index) => `- skill-${index + 1}`)
  ].join('\n');
  const lines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'skill-failed',
      toolName: 'use_skill',
      argumentsText: JSON.stringify({name: 'missing'})
    },
    {
      role: 'tool_result',
      text: failureText,
      toolCallId: 'skill-failed',
      toolName: 'use_skill',
      ok: false
    }
  ], 32).map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.includes('Using skill · missing')));
  assert.ok(lines.includes('  ⎿ Unknown skill: missing'));
  assert.ok(lines.includes('    available_skills:'));
  assert.ok(lines.some((line) => line.includes('[tool output truncated')));
  assert.equal(lines.some((line) => line.includes('skill-12')), false);
  assert.equal(lines.every((line) => displayWidth(line) <= safeRenderWidth(32)), true);
});

test('renderTranscriptLines keeps use_skill records unchanged and degrades malformed calls safely', () => {
  const records = [
    {
      role: 'tool_call',
      text: 'use_skill({not-json)',
      toolCallId: 'skill-malformed',
      toolName: 'use_skill',
      argumentsText: '{not-json'
    },
    {
      role: 'tool_result',
      text: [
        'skill: malformed',
        'source: /repo/.echo/skills/malformed/SKILL.md',
        '',
        '# Hidden Skill Body'
      ].join('\n'),
      toolCallId: 'skill-malformed',
      toolName: 'use_skill',
      ok: true
    }
  ];
  const before = JSON.parse(JSON.stringify(records));
  const lines = renderTranscriptLines(records, 100).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Using skill'));
  assert.equal(lines.some((line) => line.includes('Hidden Skill Body')), false);
  assert.deepEqual(records, before);
});

test('legacy memory tool records use the generic renderer', () => {
  const lines = renderTranscriptLines([{
    role: 'tool_call',
    text: 'read_memory({"catalog":"rendering"})',
    toolCallId: 'legacy-memory',
    toolName: 'read_memory',
    argumentsText: '{"catalog":"rendering"}'
  }, {
    role: 'tool_result',
    text: '{"memories":[{"content":"Use real cursors"}]}',
    toolCallId: 'legacy-memory',
    toolName: 'read_memory',
    ok: true
  }], 100).map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Read memory'));
  assert.ok(lines.includes('  {"catalog":"rendering"}'));
  assert.ok(lines.includes('  ⎿ {"memories":[{"content":"Use real cursors"}]}'));
  assert.equal(lines.some((line) => /Recalling|Remembering/.test(line)), false);
});

test('renderTranscriptLines renders current apply_patch metadata with file grouping, gutter, and full-row backgrounds', () => {
  const renderedLines = renderTranscriptLines(
    [
      {
        role: 'tool_call',
        text: 'apply_patch({"patch":"raw"})',
        toolCallId: 'call_patch',
        toolName: 'apply_patch',
        argumentsText: '{"patch":"--- a/src.txt\\n+++ b/src.txt\\n@@ -1 +1 @@\\n-alpha\\n+BETA\\n"}'
      },
      {
        role: 'tool_result',
        text: 'Applied patch.\nChanged files:\n- src.txt (updated)',
        toolCallId: 'call_patch',
        toolName: 'apply_patch',
        ok: true,
        display: {
          kind: 'apply_patch',
          files: [{
            path: 'src.txt',
            kind: 'updated',
            lines: [
              {kind: 'context', text: 'alpha', postLine: 1},
              {kind: 'removed', text: 'beta', postLine: null},
              {kind: 'added', text: 'BETA', postLine: 2},
              {kind: 'context', text: 'gamma', postLine: 3}
            ]
          }]
        }
      }
    ],
    80
  );
  const lines = renderedLines.map((line) => stripAnsi(line));

  assert.deepEqual(lines.map((line) => line.trimEnd()), [
    '◆ Apply patch · src.txt',
    '  ⎿ src.txt  +1 -1',
    '    1 │ alpha',
    '    - │ beta',
    '    + │ BETA',
    '    3 │ gamma',
    ''
  ]);
  assert.ok(!lines.some((line) => line.includes('diff --git')));
  assert.ok(!lines.some((line) => line.includes('Applied patch')));
  assert.match(renderedLines[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m Apply patch/);
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('- │ beta')), /\x1b\[97m\x1b\[48;5;52m- │ beta/);
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('+ │ BETA')), /\x1b\[97m\x1b\[48;5;22m\+ │ BETA/);
  assert.doesNotMatch(renderedLines.find((line) => stripAnsi(line).includes('alpha')), /\x1b\[48;5;(52|22)m/);
  assert.equal(stripAnsi(renderedLines.find((line) => stripAnsi(line).includes('- │ beta'))).length, 79);
  assert.equal(stripAnsi(renderedLines.find((line) => stripAnsi(line).includes('+ │ BETA'))).length, 79);
});

test('renderTranscriptLines renders edit_file with the shared diff projection and hides raw strings', () => {
  const rendered = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'call_edit',
      toolName: 'edit_file',
      argumentsText: JSON.stringify({path: 'src/edit.ts', old_string: 'PRIVATE_OLD', new_string: 'PRIVATE_NEW', replace_all: true})
    },
    {
      role: 'tool_result',
      text: 'Replaced 2 occurrences in src/edit.ts.',
      toolCallId: 'call_edit',
      toolName: 'edit_file',
      ok: true,
      display: {
        kind: 'edit_file',
        files: [{
          path: 'src/edit.ts',
          kind: 'updated',
          lines: [
            {kind: 'context', text: 'before', postLine: 1},
            {kind: 'removed', text: 'const first = false;', postLine: null},
            {kind: 'added', text: 'const first = true;', postLine: 2},
            ...Array.from({length: 8}, (_, index) => ({kind: 'context', text: `middle ${index + 1}`, postLine: index + 3})),
            {kind: 'removed', text: 'const second = false;', postLine: null},
            {kind: 'added', text: 'const second = true;', postLine: 11}
          ]
        }]
      }
    }
  ], 48);
  const text = rendered.map(stripAnsi).join('\n');

  assert.match(text, /◆ Edit file · src\/edit\.ts · replace all/);
  assert.match(text, /src\/edit\.ts  \+2 -2/);
  assert.match(text, /- │ const first = false;/);
  assert.match(text, /\+ │ const second = true;/);
  assert.match(text, /unchanged lines/);
  assert.doesNotMatch(text, /PRIVATE_OLD|PRIVATE_NEW|Replaced 2 occurrences/);
  assert.match(rendered.find((line) => stripAnsi(line).includes('- │ const first')), /\x1b\[48;5;52m/);
  assert.match(rendered.find((line) => stripAnsi(line).includes('+ │ const second')), /\x1b\[48;5;22m/);
  assert.ok(rendered.every((line) => displayWidth(line) <= 47));
});

test('renderTranscriptLines labels truncated edit_file results without patch terminology', () => {
  const text = renderTranscriptLines([
    {role: 'tool_call', text: '', toolCallId: 'large-edit', toolName: 'edit_file', argumentsText: JSON.stringify({path: 'large.txt', old_string: 'x', new_string: 'y', replace_all: true})},
    {
      role: 'tool_result', text: 'Replaced many occurrences.', toolCallId: 'large-edit', toolName: 'edit_file', ok: true,
      display: {
        kind: 'edit_file',
        files: [{
          path: 'large.txt',
          kind: 'updated',
          lines: Array.from({length: 160}, (_unused, index) => ({kind: 'added', text: `changed ${index + 1}`, postLine: index + 1}))
        }]
      }
    }
  ], 80).map(stripAnsi).join('\n');

  assert.match(text, /\[edit_file display truncated\]/);
  assert.doesNotMatch(text, /\[patch display truncated\]/);
});

test('renderTranscriptLines safely falls back for failed or mismatched edit_file metadata', () => {
  const lines = renderTranscriptLines([
    {role: 'tool_call', text: '', toolCallId: 'bad-edit', toolName: 'edit_file', argumentsText: JSON.stringify({path: 'a.txt', old_string: 'x', new_string: 'y'})},
    {role: 'tool_result', text: 'Edit failed.\nReason: no match', toolCallId: 'bad-edit', toolName: 'edit_file', ok: false, display: {kind: 'edit_file', files: []}},
    {role: 'tool_call', text: '', toolCallId: 'mismatch-edit', toolName: 'edit_file', argumentsText: JSON.stringify({path: 'b.txt', old_string: 'x', new_string: 'y'})},
    {role: 'tool_result', text: 'fallback text', toolCallId: 'mismatch-edit', toolName: 'edit_file', ok: true, display: {kind: 'apply_patch', files: []}}
  ], 60).map(stripAnsi).join('\n');

  assert.match(lines, /Edit failed/);
  assert.match(lines, /fallback text/);
});

test('renderTranscriptLines renders deleted apply_patch metadata as removed file content', () => {
  const renderedLines = renderTranscriptLines(
    [
      {
        role: 'tool_call',
        text: 'apply_patch({"patch":"raw"})',
        toolCallId: 'delete_patch',
        toolName: 'apply_patch',
        argumentsText: '{"patch":"*** Begin Patch\\n*** Delete File: old.txt\\n*** End Patch"}'
      },
      {
        role: 'tool_result',
        text: 'Applied patch.\nChanged files:\n- old.txt (deleted)',
        toolCallId: 'delete_patch',
        toolName: 'apply_patch',
        ok: true,
        display: {
          kind: 'apply_patch',
          files: [{
            path: 'old.txt',
            kind: 'deleted',
            lines: [
              {kind: 'removed', text: 'alpha', postLine: null},
              {kind: 'removed', text: 'beta', postLine: null}
            ]
          }]
        }
      }
    ],
    80
  );
  const lines = renderedLines.map((line) => stripAnsi(line));

  assert.deepEqual(lines.map((line) => line.trimEnd()), [
    '◆ Apply patch · delete old.txt',
    '  ⎿ deleted old.txt  +0 -2',
    '    - │ alpha',
    '    - │ beta',
    ''
  ]);
  assert.ok(!lines.some((line) => line.includes('*** Delete File')));
  assert.ok(!lines.some((line) => line.includes('Applied patch')));
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('- │ alpha')), /\x1b\[97m\x1b\[48;5;52m- │ alpha/);
});

test('renderTranscriptLines renders apply_patch failures without previews and rejects invalid metadata', () => {
  const manyLines = Array.from({ length: 70 }, (_, index) => ({kind: 'added', text: `line ${index + 1}`, postLine: index + 1}));
  const renderedLines = renderTranscriptLines(
    [
      {
        role: 'tool_call',
        text: 'apply_patch({})',
        toolCallId: 'failed_patch',
        toolName: 'apply_patch',
        argumentsText: '{"patch":"--- a/src.txt\\n+++ b/src.txt\\n@@ -1 +1 @@\\n-old\\n+new\\n"}'
      },
      {
        role: 'tool_result',
        text: 'Patch failed.\nReason: hunk matched 0 locations',
        toolCallId: 'failed_patch',
        toolName: 'apply_patch',
        ok: false,
        display: {
          kind: 'apply_patch',
          files: [
            {
              path: 'src.txt',
              kind: 'updated',
              lines: manyLines
            },
            {
              path: 'later.txt',
              kind: 'added',
              lines: manyLines.map((line) => ({...line, text: `later ${line.postLine}`}))
            }
          ]
        }
      },
      {
        role: 'tool_call',
        text: 'apply_patch({})',
        toolCallId: 'fallback_patch',
        toolName: 'apply_patch',
        argumentsText: '{"patch":"*** Begin Patch\\n*** Update File: fallback.txt\\n@@\\n-old\\n+new\\n*** End Patch"}'
      },
      {
        role: 'tool_result',
        text: 'Applied patch.\nChanged files:',
        toolCallId: 'fallback_patch',
        toolName: 'apply_patch',
        ok: true,
        display: {
          kind: 'apply_patch',
          files: [{path: 'old.txt', kind: 'updated', hunks: [{lines: [{kind: 'added', text: 'legacy'}]}]}]
        }
      }
    ],
    80
  );
  const lines = renderedLines.map((line) => stripAnsi(line));

  assert.ok(lines.includes('◆ Apply patch · src.txt'));
  assert.ok(lines.includes('  ⎿ Patch failed.'));
  assert.ok(lines.some((line) => line.includes('Reason: hunk matched 0 locations')));
  assert.ok(!lines.some((line) => line.includes('src.txt  +70 -0')));
  assert.ok(!lines.some((line) => line.includes('later.txt  +70 -0')));
  assert.ok(!lines.some((line) => line.includes('+ │ line 1')));
  assert.ok(!lines.some((line) => line.includes('+ │ later 70')));
  assert.ok(!lines.some((line) => line.includes('[patch display truncated]')));
  assert.ok(lines.some((line) => line.includes('◆ Apply patch · fallback.txt')));
  assert.ok(lines.some((line) => line.includes('Applied patch.')));
  assert.ok(!lines.some((line) => line.includes('legacy')));
    assert.match(renderedLines.find((line) => stripAnsi(line).includes('Apply patch · src.txt')), /\x1b\[38;2;170;0;0m◆\x1b\[39m/);
});

test('renderTranscriptLines keeps apply_patch added and removed backgrounds fixed under custom theme', () => {
  const theme = createTuiTheme({
    blocks: {
      colors: {
        toolOutput: [1, 2, 3],
        toolSuccess: [4, 5, 6]
      }
    }
  });
  const renderedLines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: 'apply_patch({})',
      toolCallId: 'fixed_patch',
      toolName: 'apply_patch',
      argumentsText: '{"patch":"*** Begin Patch\\n*** Update File: src.txt\\n@@\\n-old\\n+new\\n*** End Patch"}'
    },
    {
      role: 'tool_result',
      text: 'Applied patch.',
      toolCallId: 'fixed_patch',
      toolName: 'apply_patch',
      ok: true,
      display: {
        kind: 'apply_patch',
        files: [{
          path: 'src.txt',
          kind: 'updated',
          lines: [
            {kind: 'removed', text: 'old', postLine: 1},
            {kind: 'added', text: 'new', postLine: 1}
          ]
        }]
      }
    }
  ], 80, theme);

  assert.match(renderedLines[0], /\x1b\[38;2;4;5;6m◆\x1b\[39m Apply patch/);
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('- │ old')), /\x1b\[97m\x1b\[48;5;52m- │ old/);
  assert.match(renderedLines.find((line) => stripAnsi(line).includes('+ │ new')), /\x1b\[97m\x1b\[48;5;22m\+ │ new/);
});

test('renderTranscriptLines lets minimum apply_patch structure exceed soft budget without dropping later changes', () => {
  const files = Array.from({length: 20}, (_, fileIndex) => ({
    path: `file-${fileIndex + 1}.txt`,
    kind: 'updated',
    lines: Array.from({length: 5}, (_, changeIndex) => [
      {
        kind: 'added',
        text: `change-${fileIndex + 1}-${changeIndex + 1}`,
        postLine: changeIndex * 2 + 1
      },
      {
        kind: 'context',
        text: `separator-${fileIndex + 1}-${changeIndex + 1}`,
        postLine: changeIndex * 2 + 2
      }
    ]).flat()
  }));
  const lines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'oversized_patch',
      toolName: 'apply_patch',
      argumentsText: '{"patch":"raw"}'
    },
    {
      role: 'tool_result',
      text: 'Applied patch.',
      toolCallId: 'oversized_patch',
      toolName: 'apply_patch',
      ok: true,
      display: {
        kind: 'apply_patch',
        files
      }
    }
  ], 80).map((line) => stripAnsi(line));

  assert.ok(lines.length > 120);
  assert.ok(lines.some((line) => line.includes('file-20.txt  +5 -0')));
  assert.ok(lines.some((line) => line.includes('+ │ change-20-5')));
});

test('renderTranscriptLines keeps wrapped apply_patch additions highlighted across physical rows', () => {
  const renderedLines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'wrapped_patch',
      toolName: 'apply_patch',
      argumentsText: '{"patch":"*** Begin Patch\\n*** Add File: long.txt\\n+abcdefghijklmnopqrstuvwxyz\\n*** End Patch"}'
    },
    {
      role: 'tool_result',
      text: 'Applied patch.',
      toolCallId: 'wrapped_patch',
      toolName: 'apply_patch',
      ok: true,
      display: {
        kind: 'apply_patch',
        files: [{
          path: 'long.txt',
          kind: 'added',
          lines: [{kind: 'added', text: 'abcdefghijklmnopqrstuvwxyz', postLine: 1}]
        }]
      }
    }
  ], 24);
  const highlighted = renderedLines.filter((line) => /\x1b\[48;5;22m/.test(line));

  assert.equal(highlighted.length, 2);
  assert.equal(highlighted.every((line) => stripAnsi(line).length === 23), true);
  assert.ok(stripAnsi(highlighted[0]).includes('+ │ '));
  assert.ok(stripAnsi(highlighted[1]).includes('  │ '));
});

test('renderTranscriptLines folds long unchanged apply_patch context around edits', () => {
  const contextBefore = Array.from({length: 8}, (_, index) => ({
    kind: 'context',
    text: `before ${index + 1}`,
    postLine: index + 1
  }));
  const contextAfter = Array.from({length: 8}, (_, index) => ({
    kind: 'context',
    text: `after ${index + 1}`,
    postLine: index + 10
  }));
  const lines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'context_patch',
      toolName: 'apply_patch',
      argumentsText: '{"patch":"*** Begin Patch\\n*** Update File: context.txt\\n@@\\n-old\\n+new\\n*** End Patch"}'
    },
    {
      role: 'tool_result',
      text: 'Applied patch.',
      toolCallId: 'context_patch',
      toolName: 'apply_patch',
      ok: true,
      display: {
        kind: 'apply_patch',
        files: [{
          path: 'context.txt',
          kind: 'updated',
          lines: [
            ...contextBefore,
            {kind: 'removed', text: 'old', postLine: null},
            {kind: 'added', text: 'new', postLine: 9},
            ...contextAfter
          ]
        }]
      }
    }
  ], 80).map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.includes('… 5 unchanged lines …')));
  assert.equal(lines.filter((line) => line.includes('… 5 unchanged lines …')).length, 2);
  assert.ok(lines.some((line) => line.includes('6 │ before 6')));
  assert.ok(lines.some((line) => line.includes('10 │ after 1')));
  assert.ok(!lines.some((line) => line.includes('before 1')));
  assert.ok(!lines.some((line) => line.includes('after 8')));
  assert.equal(lines.some((line, index) => line.includes('unchanged lines') && lines[index + 1]?.includes('unchanged lines')), false);
});

test('renderTranscriptLines never emits consecutive unchanged markers between distant edits', () => {
  const lines = renderTranscriptLines([
    {
      role: 'tool_call',
      text: '',
      toolCallId: 'distant_patch',
      toolName: 'apply_patch',
      argumentsText: '{"patch":"raw"}'
    },
    {
      role: 'tool_result',
      text: 'Applied patch.',
      toolCallId: 'distant_patch',
      toolName: 'apply_patch',
      ok: true,
      display: {
        kind: 'apply_patch',
        files: [{
          path: 'distant.txt',
          kind: 'updated',
          lines: [
            {kind: 'context', text: 'before 1', postLine: 1},
            {kind: 'context', text: 'before 2', postLine: 2},
            {kind: 'removed', text: 'old first', postLine: null},
            {kind: 'added', text: 'new first', postLine: 3},
            ...Array.from({length: 110}, (_, index) => ({
              kind: 'context',
              text: `middle ${index + 1}`,
              postLine: index + 4
            })),
            {kind: 'removed', text: 'old second', postLine: null},
            {kind: 'added', text: 'new second', postLine: 114},
            {kind: 'context', text: 'after 1', postLine: 115},
            {kind: 'context', text: 'after 2', postLine: 116},
            {kind: 'context', text: 'after 3', postLine: 117}
          ]
        }]
      }
    }
  ], 80).map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.includes('… 104 unchanged lines …')));
  assert.equal(lines.some((line, index) => line.includes('unchanged lines') && lines[index + 1]?.includes('unchanged lines')), false);
});

test('renderTranscriptLines ignores unknown record roles', () => {
  assert.deepEqual(renderTranscriptLines([{ role: 'system', text: 'noop' }], 80), []);
});

test('createAppRenderer renderRecords preserves block spacing for realtime transcript output', () => {
  const output = {
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
    }
  };
  const renderer = createAppRenderer(output);

  renderer.renderRecords({
    records: [
      { role: 'user', text: 'move the file' },
      {
        role: 'tool_call',
        text: '$ mv file',
        toolCallId: 'call_1',
        toolName: 'run_bash_command',
        argumentsText: '{"command":"mv file"}'
      },
      {
        role: 'tool_result',
        text: 'done',
        toolCallId: 'call_1',
        toolName: 'run_bash_command',
        ok: true
      }
    ],
    composer: createComposer(''),
    pending: null,
    working: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const written = stripAnsi(output.writes[0]);

  assert.match(written, /▌ move the file[\s\S]*\n\n◆ ▌ Bash/);
  assert.match(output.writes[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m/);
});

test('createAppRenderer keeps one incremental subagent rail and compacts the later outer result', () => {
  const output = {
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
    }
  };
  const renderer = createAppRenderer(output);
  const state = {
    composer: createComposer(''),
    pending: null,
    working: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  };
  const base = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer-subagent', runId: 'subagent-run'};

  renderer.renderRecords({records: [{...base, text: 'inspect incrementally', event: {kind: 'start', task: 'inspect incrementally'}}], ...state});
  renderer.renderRecords({records: [{...base, text: 'Final incremental report.', event: {kind: 'assistant'}}], ...state});
  renderer.renderRecords({records: [{...base, text: '', event: {kind: 'completed', durationMs: 25}}], ...state});
  renderer.renderRecords({records: [
    {role: 'tool_call', text: '', toolCallId: 'outer-subagent', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"inspect incrementally"}'},
    {role: 'tool_result', text: 'Final incremental report.', toolCallId: 'outer-subagent', toolName: 'run_subagent', ok: true, details: {kind: 'generic'}}
  ], ...state});

  const written = stripAnsi(output.writes.join(''));
  assert.equal((written.match(/explorer · inspect incrementally/gu) || []).length, 1);
  assert.equal((written.match(/Final incremental report\./gu) || []).length, 1);
  assert.match(written, /Explorer · returned report/u);
});

test('createAppRenderer keeps a persisted subagent call transient until its result can render the pair', () => {
  const output = {writes: [], write(chunk) { this.writes.push(String(chunk)); }};
  const renderer = createAppRenderer(output);
  const state = {
    composer: createComposer(''), pending: null, working: null,
    statusLine: DEFAULT_STATUS_LINE, width: 80
  };
  const base = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer', runId: 'run-pair'};

  renderer.renderRecords({records: [{...base, text: 'inspect', event: {kind: 'start', task: 'inspect'}}], ...state});
  const writesBeforeCall = output.writes.length;
  renderer.renderRecords({records: [{
    ...base, text: 'bash', event: {
      kind: 'tool_call', toolCallId: 'inner', toolName: 'run_bash_command',
      argumentsText: '{"command":"git status --short"}'
    }
  }], ...state});
  assert.equal(stripAnsi(output.writes.at(-1)).includes('Bash'), false);
  assert.equal(output.writes.length, writesBeforeCall + 1);

  renderer.renderRecords({records: [{
    ...base, text: 'clean', event: {
      kind: 'tool_result', toolCallId: 'inner', toolName: 'run_bash_command', ok: true,
      details: {kind: 'bash', exitCode: 0, durationMs: 3, timedOut: false, truncated: false}
    }
  }], ...state});
  const completed = stripAnsi(output.writes.at(-1));
  assert.equal((completed.match(/Bash · complete/gu) || []).length, 1);
  assert.match(completed, /  ▌ ◆ ▌ Bash · complete/u);
});

test('createAppRenderer preserves the transient subagent tool boundary across destructive recovery', () => {
  const output = {writes: [], write(chunk) { this.writes.push(String(chunk)); }};
  const renderer = createAppRenderer(output);
  const base = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer', runId: 'run-resize'};
  const start = {...base, text: 'inspect', event: {kind: 'start', task: 'inspect'}};
  const call = {...base, text: 'bash', event: {
    kind: 'tool_call', toolCallId: 'inner', toolName: 'run_bash_command', argumentsText: '{"command":"git status --short"}'
  }};
  const pending = {
    kind: 'subagent', agentName: 'explorer', elapsedMs: 10, phase: 'tool', runId: 'run-resize', task: 'inspect',
    toolName: 'run_bash_command', argumentsText: '{"command":"git status --short"}'
  };
  const state = {
    composer: createComposer(''), pending, working: null,
    statusLine: DEFAULT_STATUS_LINE, rows: 24, width: 80
  };

  renderer.renderDestructive({
    ...state,
    bannerContext: {cwd: '/tmp/project', nodeVersion: 'v20', terminalSize: {columns: 80, rows: 24}, mode: 'current terminal'},
    records: [start, call]
  });
  assert.equal((stripAnsi(output.writes.at(-1)).match(/Bash · running/gu) || []).length, 1);

  renderer.renderRecords({
    ...state,
    pending: {...pending, phase: 'thinking', toolName: undefined, argumentsText: undefined},
    records: [{...base, text: 'clean', event: {
      kind: 'tool_result', toolCallId: 'inner', toolName: 'run_bash_command', ok: true,
      details: {kind: 'bash', exitCode: 0, durationMs: 3, timedOut: false, truncated: false}
    }}]
  });
  assert.equal((stripAnsi(output.writes.at(-1)).match(/Bash · complete/gu) || []).length, 1);
});

test('glob pending preview and successful pair render query, scope, and ordered flat paths', () => {
  const args = {pattern: '**/*.ts', paths: ['src', 'test']};
  const preview = renderToolCallPreviewLines('glob', JSON.stringify(args), 100).map(stripAnsi);
  assert.deepEqual(preview, [
    '◆ Glob · “**/*.ts” · searching',
    '  in src, test'
  ]);

  const records = createGlobPair('glob-success', args, [
    'src/app/runtime.ts',
    'src/tools/glob-tool-handler.ts',
    'test/render/app-renderer.test.js',
    'test/tools/tool-execution.test.js'
  ]);
  const rendered = renderTranscriptLines(records, 100);
  const lines = rendered.map(stripAnsi);

  assert.deepEqual(lines, [
    '◆ Glob · “**/*.ts” · 4 files',
    '  in src, test',
    '  ├─ src/app/runtime.ts',
    '  ├─ src/tools/glob-tool-handler.ts',
    '  ├─ test/render/app-renderer.test.js',
    '  └─ test/tools/tool-execution.test.js',
    ''
  ]);
  assert.match(rendered[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m Glob/);
  assert.match(rendered[2], /\x1b\[38;2;85;85;85m  ├─ src\/app\/runtime\.ts\x1b\[39m/);
  assert.equal(lines.some((line) => line === '  ├─ src/' || line.includes('"pattern"')), false);

  const isolated = renderTranscriptLines(records.slice(0, 1), 100).map(stripAnsi);
  assert.deepEqual(isolated, ['◆ Glob · “**/*.ts” · searching', '  in src, test']);
});

test('glob renderer distinguishes empty, failure, handler truncation, and display omission', () => {
  const empty = renderTranscriptLines(createGlobPair('glob-empty', {pattern: '*.missing'}, []), 80);
  assert.deepEqual(empty.map(stripAnsi), [
    '◆ Glob · “*.missing” · no files',
    '  in .',
    ''
  ]);
  assert.match(empty[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m/);

  const failure = renderTranscriptLines(createGlobPair(
    'glob-failure',
    {pattern: '**/*'},
    [],
    {ok: false, text: 'glob failed.\nReason: ripgrep executable not found'}
  ), 80);
  assert.deepEqual(failure.map(stripAnsi), [
    '◆ Glob · “**/*” · failed',
    '  in .',
    '  ⎿ ripgrep executable not found',
    ''
  ]);
  assert.match(failure[0], /\x1b\[38;2;170;0;0m◆\x1b\[39m/);

  const fittingPaths = Array.from({length: 12}, (_value, index) => `src/file-${index + 1}.ts`);
  const fitting = renderTranscriptLines(createGlobPair('glob-fitting', {pattern: '*.ts'}, fittingPaths), 80).map(stripAnsi);
  assert.equal(fitting.some((line) => line.includes('more files')), false);
  assert.equal(fitting.some((line) => line.includes('file-12.ts')), true);

  const manyPaths = Array.from({length: 14}, (_value, index) => `src/file-${index + 1}.ts`);
  const truncated = renderTranscriptLines(createGlobPair(
    'glob-truncated',
    {pattern: '*.ts'},
    manyPaths,
    {truncated: true}
  ), 80).map(stripAnsi);
  assert.equal(truncated[0], '◆ Glob · “*.ts” · 14 files shown · more available');
  assert.ok(truncated.includes('  └─ … 3 more files'));
  assert.equal(truncated.some((line) => line.includes('file-12.ts')), false);
  assert.equal(truncated.some((line) => line.includes('has_more: true')), false);
});

test('glob malformed and legacy records safely fall back without inventing path trees', () => {
  const malformedPreview = renderToolCallPreviewLines('glob', '{bad-json', 80).map(stripAnsi);
  assert.deepEqual(malformedPreview, ['◆ Glob', '  {bad-json']);

  const legacy = createGlobPair('glob-legacy', {pattern: '*.ts'}, [], {
    omitDisplay: true,
    text: 'src/a.ts\ntest/a.test.ts'
  });
  const legacyLines = renderTranscriptLines(legacy, 80).map(stripAnsi);
  assert.equal(legacyLines.includes('◆ Glob · “*.ts” · complete'), true);
  assert.equal(legacyLines.includes('  ⎿ src/a.ts'), true);
  assert.equal(legacyLines.some((line) => line.includes('├─ src/a.ts')), false);

  const malformed = createGlobPair('glob-malformed', {pattern: '*.ts'}, [], {
    display: {kind: 'glob', paths: ['']},
    text: 'raw malformed result'
  });
  const malformedLines = renderTranscriptLines(malformed, 80).map(stripAnsi);
  assert.equal(malformedLines.includes('  ⎿ raw malformed result'), true);
  assert.equal(malformedLines.some((line) => /[├└]─/u.test(line)), false);
});

test('glob renderer preserves records and safely applies subdued theme, control normalization, and width budgets', () => {
  const theme = createTuiTheme({
    blocks: {
      colors: {
        toolOutput: [4, 5, 6]
      }
    },
    syntax: {
      keyword: {foreground: [10, 11, 12], bold: true}
    }
  });
  const records = createGlobPair('glob-width', {
    pattern: `很长的\n模式/${'目录'.repeat(30)}/**/*.ts`,
    paths: [`src/${'深层目录/'.repeat(12)}`, 'test']
  }, [
    `src/${'深层目录/'.repeat(12)}\tconst-file.ts`,
    'test/控制\r\n换行.test.ts',
    `test/${'宽字符'.repeat(30)}.test.ts`
  ]);
  const before = structuredClone(records);
  const width = 28;
  const rendered = renderTranscriptLines(records, width, theme);
  const plain = rendered.map(stripAnsi);

  assert.deepEqual(records, before);
  assertSafeRenderLines(rendered, width);
  assert.equal(plain.some((line) => line.includes('\t') || line.includes('\r') || line.includes('\n')), false);
  assert.ok(rendered.some((line) => /\x1b\[38;2;4;5;6m/.test(line) && /[├└│]/u.test(stripAnsi(line))));
  assert.equal(rendered.some((line) => /\x1b\[38;2;10;11;12m/.test(line)), false);
  const firstTreeLine = plain.findIndex((line) => /^  [├└]/u.test(line));
  assert.ok(firstTreeLine >= 0);
  assert.ok(plain.slice(firstTreeLine).filter((line) => line !== '').length <= 12);

  const narrow = renderTranscriptLines(createGlobPair('glob-narrow', {pattern: '*.ts'}, [
    `src/${'long/'.repeat(20)}file.ts`
  ]), 12);
  assertSafeRenderLines(narrow, 12);
});

function createGlobPair(callId, args, paths, options = {}) {
  const text = options.text ?? (paths.length === 0
    ? 'no files matched'
    : paths.join('\n'));
  const display = options.display ?? {kind: 'glob', paths};
  return [
    {
      role: 'tool_call',
      text: '',
      toolCallId: callId,
      toolName: 'glob',
      argumentsText: JSON.stringify({
        pattern: args.pattern,
        paths: args.paths ?? null
      })
    },
    {
      role: 'tool_result',
      text,
      toolCallId: callId,
      toolName: 'glob',
      ok: options.ok ?? true,
      details: {
        kind: 'glob',
        exitCode: options.ok === false ? 2 : paths.length === 0 ? 1 : 0,
        truncated: options.truncated ?? false,
        ...(options.omitDisplay ? {} : {display})
      }
    }
  ];
}

test('grep pending preview and successful pair render query semantics, scope, and grouped matches', () => {
  const args = {
    pattern: 'needle',
    paths: ['src', 'test'],
    glob: '*.ts',
    literal: true,
    case_sensitive: false
  };
  const preview = renderToolCallPreviewLines('grep', JSON.stringify(args), 100).map(stripAnsi);
  assert.deepEqual(preview, [
    '◆ Grep · “needle” · ignore case · searching',
    '  in src, test · glob *.ts'
  ]);

  const rendered = renderTranscriptLines(createGrepPair('grep-success', args, [
    {path: 'src/tool.ts', line: 7, column: 7, text: 'const needle = true;'},
    {path: 'src/tool.ts', line: 18, column: 3, text: 'return needle;'},
    {path: 'test/tool.test.js', line: 42, column: 5, text: 'assert.match(value, /needle/);'}
  ]), 100);
  const lines = rendered.map(stripAnsi);

  assert.deepEqual(lines, [
    '◆ Grep · “needle” · ignore case · 3 matches',
    '  in src, test · glob *.ts',
    '  ├─ src/tool.ts',
    '  │  7:7 │ const needle = true;',
    '  │ 18:3 │ return needle;',
    '  └─ test/tool.test.js',
    '    42:5 │ assert.match(value, /needle/);',
    ''
  ]);
  assert.match(rendered[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m Grep/);
  assert.doesNotMatch(rendered[0], /\x1b\[[^m]*mGrep/);
  assert.match(rendered[2], /\x1b\[38;2;85;85;85m  ├─ src\/tool\.ts\x1b\[39m/);
  assert.doesNotMatch(rendered[2], /\x1b\[38;2;255;255;255m/);
  assert.match(rendered[3], /\x1b\[38;2;85;85;85mconst needle = true;\x1b\[39m/);
  assert.doesNotMatch(rendered[3], /\x1b\[(?:1m|38;2;(?:0;170;170|170;0;170)m)/);
  assert.equal(lines.some((line) => line.includes('case_sensitive') || line.includes('src/tool.ts:7:7:')), false);
});

test('grep renderer distinguishes empty, failure, handler truncation, and display omission', () => {
  const empty = renderTranscriptLines(createGrepPair('grep-empty', {pattern: 'missing'}, []), 80).map(stripAnsi);
  assert.deepEqual(empty, [
    '◆ Grep · “missing” · no matches',
    '  in .',
    ''
  ]);

  const failure = renderTranscriptLines(createGrepPair(
    'grep-failure',
    {pattern: '[', literal: false, case_sensitive: true},
    [],
    {ok: false, text: 'grep failed.\nReason: regex parse error'}
  ), 80);
  assert.deepEqual(failure.map(stripAnsi), [
    '◆ Grep · “[” · regex · case sensitive · failed',
    '  in .',
    '  ⎿ regex parse error',
    ''
  ]);
  assert.match(failure[0], /\x1b\[38;2;170;0;0m◆\x1b\[39m/);

  const fittingMatches = Array.from({length: 10}, (_value, index) => ({
    path: 'src/fitting.ts',
    line: index + 1,
    column: 1,
    text: `const fit${index + 1} = true;`
  }));
  const fitting = renderTranscriptLines(createGrepPair(
    'grep-fitting',
    {pattern: 'fit', paths: ['src']},
    fittingMatches
  ), 80).map(stripAnsi);
  assert.equal(fitting.some((line) => line.includes('more matches')), false);
  assert.equal(fitting.some((line) => line.includes('fit10')), true);

  const manyMatches = Array.from({length: 14}, (_value, index) => ({
    path: index < 7 ? 'src/many.ts' : 'test/many.test.ts',
    line: index + 1,
    column: 1,
    text: `const hit${index + 1} = true;`
  }));
  const truncated = renderTranscriptLines(createGrepPair(
    'grep-truncated',
    {pattern: 'hit', paths: ['src']},
    manyMatches,
    {truncated: true}
  ), 80).map(stripAnsi);

  assert.equal(truncated[0], '◆ Grep · “hit” · 14 matches shown · more available');
  assert.ok(truncated.includes('  └─ … 5 more matches'));
  assert.equal(truncated.some((line) => line.includes('hit10')), false);
  assert.equal(truncated.some((line) => line.includes('has_more: true')), false);
});

test('grep malformed and legacy records safely fall back without inventing match trees', () => {
  const malformedPreview = renderToolCallPreviewLines('grep', '{bad-json', 80).map(stripAnsi);
  assert.deepEqual(malformedPreview, ['◆ Grep', '  {bad-json']);

  const legacy = createGrepPair('grep-legacy', {pattern: 'needle'}, [], {
    omitDisplay: true,
    text: 'src/a.ts:1:1: needle'
  });
  const legacyLines = renderTranscriptLines(legacy, 80).map(stripAnsi);
  assert.equal(legacyLines.includes('◆ Grep · “needle” · complete'), true);
  assert.equal(legacyLines.includes('  ⎿ src/a.ts:1:1: needle'), true);
  assert.equal(legacyLines.some((line) => line.includes('├─ src/a.ts')), false);

  const malformed = createGrepPair('grep-malformed', {pattern: 'needle'}, [], {
    display: {kind: 'grep', matches: [{path: '', line: 0, column: 1, text: 'needle'}]},
    text: 'raw malformed result'
  });
  const malformedLines = renderTranscriptLines(malformed, 80).map(stripAnsi);
  assert.equal(malformedLines.includes('  ⎿ raw malformed result'), true);
  assert.equal(malformedLines.some((line) => line.includes('0:1 │')), false);
});

test('grep renderer preserves records and safely applies subdued theme, tabs, and width budgets', () => {
  const theme = createTuiTheme({
    blocks: {
      colors: {
        tool: [1, 2, 3],
        toolOutput: [4, 5, 6],
        text: [7, 8, 9]
      }
    },
    syntax: {
      keyword: {foreground: [10, 11, 12], bold: true},
      string: {foreground: [13, 14, 15]}
    }
  });
  const records = createGrepPair('grep-width', {
    pattern: `很长的\n查询 ${'模式'.repeat(30)}`,
    paths: [`src/${'深层目录/'.repeat(12)}文件.ts`],
    glob: '**/*.ts',
    literal: false,
    case_sensitive: false
  }, [
    {path: `src/${'深层目录/'.repeat(12)}文件.ts`, line: 123, column: 7, text: '\tconst value = "开始字符串但不闭合'},
    {path: 'src/second.ts', line: 9, column: 2, text: '\tconst second = "独立高亮"; ' + '内容'.repeat(30)}
  ]);
  const before = structuredClone(records);
  const width = 28;
  const rendered = renderTranscriptLines(records, width, theme);
  const plain = rendered.map(stripAnsi);

  assert.deepEqual(records, before);
  assertSafeRenderLines(rendered, width);
  assert.ok(rendered.some((line) => /\x1b\[38;2;0;170;0m◆\x1b\[39m Grep/.test(line)));
  assert.equal(/\x1b\[[^m]*mGrep/.test(rendered[0]), false);
  assert.equal(/\x1b\[38;2;(?:1;2;3|4;5;6|7;8;9)m/.test(rendered[0]), false);
  assert.ok(rendered.some((line) => /\x1b\[38;2;4;5;6m/.test(line) && /[├└│]/u.test(stripAnsi(line))));
  assert.ok(rendered.filter((line) => stripAnsi(line).includes('const')).every((line) => /\x1b\[38;2;4;5;6m[^\n]*const/.test(line)));
  assert.equal(rendered.some((line) => /\x1b\[38;2;(?:1;2;3|10;11;12|13;14;15)m/.test(line)), false);
  assert.equal(plain.some((line) => line.includes('\t') || line.includes('\r') || line.includes('\n')), false);
  assert.ok(plain.filter((line) => /\d+:\d+ │/u.test(line)).length <= 4);
  const firstTreeLine = plain.findIndex((line) => /^  [├└]/u.test(line));
  assert.ok(firstTreeLine >= 0);
  assert.ok(plain.slice(firstTreeLine).filter((line) => line !== '').length <= 12);

  const narrow = renderTranscriptLines(createGrepPair('grep-narrow-locator', {pattern: 'x'}, [
    {path: 'a', line: 123456789, column: 123456789, text: 'x'}
  ]), 12);
  assertSafeRenderLines(narrow, 12);
  assert.equal(narrow.map(stripAnsi).some((line) => line.includes('123456789:123456789 │')), false);
});

function createGrepPair(callId, args, matches, options = {}) {
  const text = options.text ?? (matches.length === 0
    ? 'no matches found'
    : matches.map((match) => `${match.path}:${match.line}:${match.column}: ${match.text}`).join('\n'));
  const display = options.display ?? {kind: 'grep', matches};
  return [
    {
      role: 'tool_call',
      text: '',
      toolCallId: callId,
      toolName: 'grep',
      argumentsText: JSON.stringify({
        pattern: args.pattern,
        paths: args.paths ?? null,
        glob: args.glob ?? null,
        literal: args.literal ?? null,
        case_sensitive: args.case_sensitive ?? null
      })
    },
    {
      role: 'tool_result',
      text,
      toolCallId: callId,
      toolName: 'grep',
      ok: options.ok ?? true,
      details: {
        kind: 'grep',
        exitCode: options.ok === false ? 2 : matches.length === 0 ? 1 : 0,
        truncated: options.truncated ?? false,
        ...(options.omitDisplay ? {} : {display})
      }
    }
  ];
}

test('web_search pending preview hides raw arguments and successful pair renders a compact result tree', () => {
  const preview = renderToolCallPreviewLines('web_search', JSON.stringify({
    query: 'Echo TUI GitHub',
    count: 5,
    market: 'en-US'
  }), 80).map((line) => stripAnsi(line));
  assert.deepEqual(preview, ['◆ Web search · “Echo TUI GitHub” · searching']);

  const rendered = renderTranscriptLines(createWebSearchPair('search-success', 'Echo TUI GitHub', [
    {
      title: 'Echo TUI — GitHub',
      url: 'https://github.com/example/echo-tui?q=terminal#readme',
      snippet: 'Terminal-native AI assistant.'
    },
    {
      title: 'Echo TUI Documentation',
      url: 'https://echo-tui.dev/docs/getting-started',
      snippet: 'Installation and configuration.'
    }
  ]), 100);
  const lines = rendered.map((line) => stripAnsi(line));

  assert.deepEqual(lines, [
    '◆ Web search · “Echo TUI GitHub”',
    '  2 results',
    '  ├─ Echo TUI — GitHub',
    '  │  github.com/example/echo-tui?q=terminal#readme · Terminal-native AI assistant.',
    '  └─ Echo TUI Documentation',
    '     echo-tui.dev/docs/getting-started · Installation and configuration.',
    ''
  ]);
  assert.match(rendered[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m/);
  assert.match(rendered[1], /\x1b\[38;2;85;85;85m/);
  assert.match(rendered[2], /\x1b\[38;2;255;255;255m/);
  assert.match(rendered[2], /\x1b\[38;2;85;85;85m  ├─ \x1b\[39m/);
  assert.match(rendered[3], /\x1b\[38;2;85;85;85m  │  \x1b\[39m/);
  assert.equal(lines.some((line) => /results:|url:|snippet:/.test(line)), false);
});

test('web_search result tree displays five complete results and counts omitted results', () => {
  const fiveResults = Array.from({length: 5}, (_value, index) => ({
    title: `Result ${index + 1}`,
    url: `https://example.com/result/${index + 1}`,
    snippet: `Snippet ${index + 1}`
  }));
  const fiveLines = renderTranscriptLines(createWebSearchPair('search-five', 'five results', fiveResults), 80)
    .map((line) => stripAnsi(line));

  assert.equal(fiveLines.includes('  5 results'), true);
  assert.equal(fiveLines.includes('  └─ Result 5'), true);
  assert.equal(fiveLines.some((line) => line.includes('more results')), false);

  const sevenResults = [
    ...fiveResults,
    {title: 'Result 6', url: 'https://example.com/result/6', snippet: 'Snippet 6'},
    {title: 'Result 7', url: 'https://example.com/result/7', snippet: 'Snippet 7'}
  ];
  const sevenLines = renderTranscriptLines(createWebSearchPair('search-seven', 'seven results', sevenResults), 80)
    .map((line) => stripAnsi(line));

  assert.equal(sevenLines.includes('  7 results'), true);
  assert.equal(sevenLines.includes('  ├─ Result 5'), true);
  assert.equal(sevenLines.includes('  └─ … 2 more results'), true);
  assert.equal(sevenLines.some((line) => line.includes('Result 6')), false);
  assert.equal(sevenLines.some((line) => line.includes('example.com/result/6')), false);
});

test('web_search projects partial match diagnostics as muted metadata without warning fields', () => {
  const text = [
    'warning: results may be unrelated or incomplete',
    'missing_query_terms: github.com, repository',
    '',
    formatWebSearchResults([{
      title: 'Echo definition',
      url: 'https://example.com/echo',
      snippet: 'Echo is a reflected sound.'
    }])
  ].join('\n');
  const rendered = renderTranscriptLines(createWebSearchPairFromText('search-partial', 'Echo TUI GitHub', text), 100);
  const lines = rendered.map((line) => stripAnsi(line));
  const metadata = rendered.find((line) => stripAnsi(line).includes('partial match'));

  assert.equal(lines.includes('  1 result · partial match · “github.com”, “repository” not matched'), true);
  assert.equal(lines.some((line) => line.includes('warning:') || line.includes('missing_query_terms:') || line.includes('△')), false);
  assert.match(metadata, /\x1b\[38;2;85;85;85m/);
  assert.doesNotMatch(metadata, /\x1b\[38;2;170;0;0m/);
});

test('web_search renders empty, failed, and timed out states without result protocol noise', () => {
  const emptyLines = renderTranscriptLines(createWebSearchPairFromText(
    'search-empty',
    'nothing here',
    'results:\nno search results'
  ), 80).map((line) => stripAnsi(line));
  assert.deepEqual(emptyLines, [
    '◆ Web search · “nothing here”',
    '  no results',
    ''
  ]);

  const failedRecords = createWebSearchPairFromText(
    'search-failed',
    'slow query',
    'web_search failed.\nReason: search request timed out after 15000ms',
    {ok: false, timedOut: true}
  );
  const renderedFailure = renderTranscriptLines(failedRecords, 80);
  const failureLines = renderedFailure.map((line) => stripAnsi(line));

  assert.deepEqual(failureLines, [
    '◆ Web search · “slow query” · timed out',
    '  ⎿ search request timed out after 15000ms',
    ''
  ]);
  assert.match(renderedFailure[0], /\x1b\[38;2;170;0;0m◆\x1b\[39m/);
  assert.equal(failureLines.some((line) => line.includes('web_search failed') || line.includes('Reason:')), false);
});

test('web_search only projects truncated status from structured result details', () => {
  const resultText = [
    'truncated: true',
    '',
    formatWebSearchResults([{
      title: 'Truncated output guide',
      url: 'https://example.com/truncated',
      snippet: 'The literal truncated: true can appear in ordinary page text.'
    }]),
    '',
    'Output was truncated.'
  ].join('\n');
  const unstructuredLines = renderTranscriptLines(createWebSearchPairFromText(
    'search-literal',
    'truncation docs',
    resultText
  ), 100).map((line) => stripAnsi(line));
  const structuredLines = renderTranscriptLines(createWebSearchPairFromText(
    'search-truncated',
    'truncation docs',
    resultText,
    {truncated: true}
  ), 100).map((line) => stripAnsi(line));

  assert.equal(unstructuredLines.includes('  1 result'), true);
  assert.equal(unstructuredLines.some((line) => line.includes('displayed result')), false);
  assert.equal(structuredLines.includes('  1 displayed result · truncated'), true);
});

test('web_search malformed arguments and result text fall back without inventing result items', () => {
  const malformedPreview = renderToolCallPreviewLines('web_search', '{bad-json', 80).map((line) => stripAnsi(line));
  assert.deepEqual(malformedPreview, ['◆ Web search', '  {bad-json']);

  const malformedText = [
    'results:',
    '1. Unsafe URL',
    '   url: javascript:alert(1)',
    '   snippet: Do not render this as a result tree.'
  ].join('\n');
  const lines = renderTranscriptLines(createWebSearchPairFromText(
    'search-malformed',
    'unsafe result',
    malformedText
  ), 80).map((line) => stripAnsi(line));

  assert.equal(lines.includes('◆ Web search · “unsafe result”'), true);
  assert.equal(lines.includes('  ⎿ results:'), true);
  assert.equal(lines.some((line) => line.includes('└─ Unsafe URL') || line.includes('1 result')), false);
});

test('web_search renderer preserves records and safely wraps long wide-character fields', () => {
  const records = createWebSearchPair('search-width', `很长的\n搜索 ${'查询'.repeat(50)}`, [{
    title: `终端搜索结果 ${'标题'.repeat(20)}`,
    url: `https://example.com/${'long-path/'.repeat(8)}?q=${'值'.repeat(20)}#section`,
    snippet: `这是一个包含宽字符的摘要。${'内容'.repeat(30)}`
  }]);
  const before = structuredClone(records);
  const width = 24;
  const lines = renderTranscriptLines(records, width);

  assert.deepEqual(records, before);
  assertSafeRenderLines(lines, width);
  assert.equal(lines.every((line) => !stripAnsi(line).includes('\n') && !stripAnsi(line).includes('\r')), true);
  assert.equal(lines.some((line) => stripAnsi(line).startsWith('  └─ ')), true);
  assert.equal(lines.some((line) => stripAnsi(line).startsWith('     ')), true);
});

function createWebSearchPair(callId, query, results) {
  return createWebSearchPairFromText(callId, query, formatWebSearchResults(results));
}

function createWebSearchPairFromText(callId, query, text, options = {}) {
  return [
    {
      role: 'tool_call',
      text: '',
      toolCallId: callId,
      toolName: 'web_search',
      argumentsText: JSON.stringify({query, count: null, offset: null, market: null, safe_search: null})
    },
    {
      role: 'tool_result',
      text,
      toolCallId: callId,
      toolName: 'web_search',
      ok: options.ok ?? true,
      details: {
        kind: 'web_search',
        timedOut: options.timedOut ?? false,
        truncated: options.truncated ?? false
      }
    }
  ];
}

function formatWebSearchResults(results) {
  return [
    'results:',
    ...results.flatMap((result, index) => [
      `${index + 1}. ${result.title}`,
      `   url: ${result.url}`,
      `   snippet: ${result.snippet}`
    ])
  ].join('\n');
}

test('web_fetch pending preview hides arguments and successful result renders a document rail', () => {
  const preview = renderToolCallPreviewLines('web_fetch', JSON.stringify({
    url: 'https://example.com/docs',
    offset: 0,
    limit: 20
  }), 100).map((line) => stripAnsi(line));
  assert.deepEqual(preview, ['◆ ▌ Web fetch · example.com/docs · fetching']);

  const rendered = renderTranscriptLines(createWebFetchPair(
    'fetch-success',
    {url: 'https://example.com/docs'},
    formatWebFetchEnvelope({
      firstLine: 'https://example.com/docs',
      headers: ['status: 200 OK'],
      body: 'Documentation\n\nReadable page content.'
    })
  ), 100);
  const lines = rendered.map((line) => stripAnsi(line));

  assert.deepEqual(lines, [
    '◆ ▌ Web fetch · example.com/docs · 200 OK',
    '  ▌ ',
    '  ▌ Documentation',
    '  ▌ ',
    '  ▌ Readable page content.',
    ''
  ]);
  assert.match(rendered[0], /\x1b\[38;2;0;170;0m◆\x1b\[39m/);
  assert.match(rendered[1], /\x1b\[38;2;85;85;85m▌\x1b\[39m/);
  assert.match(rendered[2], /\x1b\[38;2;255;255;255mDocumentation\x1b\[39m/);
  assert.equal(lines.some((line) => /content:|status:|```/.test(line)), false);
});

test('web_fetch renders empty content inline and applies the ten-line document budget', () => {
  const emptyLines = renderTranscriptLines(createWebFetchPair(
    'fetch-empty',
    {url: 'https://example.com/empty'},
    formatWebFetchEnvelope({firstLine: 'https://example.com/empty', headers: ['status: 204 No Content'], body: ''})
  ), 100).map((line) => stripAnsi(line));
  assert.deepEqual(emptyLines, [
    '◆ ▌ Web fetch · example.com/empty · 204 No Content · no readable content',
    ''
  ]);

  const tenBody = Array.from({length: 10}, (_value, index) => `line ${index + 1}`).join('\n');
  const tenLines = renderTranscriptLines(createWebFetchPair(
    'fetch-ten',
    {url: 'https://example.com/ten'},
    formatWebFetchEnvelope({firstLine: 'https://example.com/ten', headers: ['status: 200 OK'], body: tenBody})
  ), 80).map((line) => stripAnsi(line));
  assert.equal(tenLines.includes('  ▌ line 10'), true);
  assert.equal(tenLines.some((line) => line.includes('more lines')), false);

  const elevenBody = `${tenBody}\nline 11`;
  const elevenLines = renderTranscriptLines(createWebFetchPair(
    'fetch-eleven',
    {url: 'https://example.com/eleven'},
    formatWebFetchEnvelope({firstLine: 'https://example.com/eleven', headers: ['status: 200 OK'], body: elevenBody})
  ), 80).map((line) => stripAnsi(line));
  assert.equal(elevenLines.includes('  ▌ line 9'), true);
  assert.equal(elevenLines.includes('  ▌ line 10'), false);
  assert.equal(elevenLines.includes('  ▌ … 2 more lines'), true);
});

test('web_fetch keeps redirect, range, more, and status metadata in the tool title', () => {
  const redirected = formatWebFetchEnvelope({
    firstLine: 'https://example.org/final/article',
    headers: [
      'url: https://example.com/start',
      'final_url: https://example.org/final/article',
      'status: 200 OK',
      'has_more: true'
    ],
    body: 'line forty one\nline forty two'
  });
  const lines = renderTranscriptLines(createWebFetchPair(
    'fetch-redirect',
    {url: 'https://example.com/start', offset: 40, limit: 2},
    redirected
  ), 160).map((line) => stripAnsi(line));

  assert.equal(lines[0], '◆ ▌ Web fetch · example.com/start → example.org/final/article · 200 OK · lines 41–42 · more');
  assert.equal(lines.some((line) => /^  (200 OK|lines 41)/u.test(line)), false);
  assert.equal(lines.some((line) => /url:|final_url:|has_more:/.test(line)), false);

  const longUrl = `https://example.com/${'deep-segment/'.repeat(20)}final-page?query=value`;
  const longLines = renderTranscriptLines(createWebFetchPair(
    'fetch-long-url',
    {url: longUrl},
    formatWebFetchEnvelope({firstLine: longUrl, headers: ['status: 200 OK'], body: 'content'})
  ), 200).map((line) => stripAnsi(line));
  assert.match(longLines[0], /^◆ ▌ Web fetch · example\.com\/….*final-page\?query=value · 200 OK$/u);
});

test('web_fetch renders HTTP error content, timeout, network failure, and unsupported media distinctly', () => {
  const httpRendered = renderTranscriptLines(createWebFetchPair(
    'fetch-404',
    {url: 'https://example.com/missing'},
    formatWebFetchEnvelope({
      firstLine: 'web_fetch failed.',
      headers: ['status: 404 Not Found', 'content_type: text/plain'],
      body: 'The requested page could not be found.'
    }),
    {ok: false}
  ), 100);
  const httpLines = httpRendered.map((line) => stripAnsi(line));
  assert.equal(httpLines[0], '◆ ▌ Web fetch · example.com/missing · 404 Not Found');
  assert.equal(httpLines.includes('  ▌ The requested page could not be found.'), true);
  assert.equal(httpLines[0].includes('failed'), false);
  assert.match(httpRendered[0], /\x1b\[38;2;170;0;0m◆\x1b\[39m/);

  const timeoutLines = renderTranscriptLines(createWebFetchPair(
    'fetch-timeout',
    {url: 'https://example.com/slow'},
    'web_fetch failed.\nReason: request timed out after 20000ms',
    {ok: false, timedOut: true}
  ), 100).map((line) => stripAnsi(line));
  assert.deepEqual(timeoutLines, [
    '◆ ▌ Web fetch · example.com/slow · timed out',
    '  ▌ ',
    '  ▌ request timed out after 20000ms',
    ''
  ]);

  const failureLines = renderTranscriptLines(createWebFetchPair(
    'fetch-failure',
    {url: 'https://example.com/rejected'},
    'web_fetch failed.\nReason: redirect target rejected',
    {ok: false}
  ), 100).map((line) => stripAnsi(line));
  assert.equal(failureLines[0], '◆ ▌ Web fetch · example.com/rejected · failed');
  assert.equal(failureLines[1], '  ▌ ');
  assert.equal(failureLines[2], '  ▌ redirect target rejected');

  const unsupportedText = [
    'web_fetch failed.',
    'url: https://example.com/image.png',
    'status: 200 OK',
    'content_type: image/png',
    'error: unsupported media type',
    'reason: unsupported content type: image/png'
  ].join('\n');
  const unsupportedLines = renderTranscriptLines(createWebFetchPair(
    'fetch-unsupported',
    {url: 'https://example.com/image.png'},
    unsupportedText,
    {ok: false}
  ), 120).map((line) => stripAnsi(line));
  assert.deepEqual(unsupportedLines, [
    '◆ ▌ Web fetch · example.com/image.png · 200 OK · unsupported · image/png',
    '  ▌ ',
    '  ▌ unsupported content type: image/png',
    ''
  ]);
});

test('web_fetch distinguishes response, preview, and offloaded truncation from structured details', () => {
  const responseTruncated = formatWebFetchEnvelope({
    firstLine: 'https://example.com/response-cap',
    headers: ['status: 200 OK', 'body_truncated: true'],
    body: 'bounded response'
  });
  const responseLines = renderTranscriptLines(createWebFetchPair(
    'fetch-response-cap',
    {url: 'https://example.com/response-cap'},
    responseTruncated,
    {truncated: true}
  ), 120).map((line) => stripAnsi(line));
  assert.equal(responseLines[0], '◆ ▌ Web fetch · example.com/response-cap · 200 OK · response truncated');

  const previewText = [
    'https://example.com/preview-cap',
    'status: 200 OK',
    '',
    'content:',
    '```',
    'first preview line',
    'partial second line',
    '',
    'Output was truncated.'
  ].join('\n');
  const previewLines = renderTranscriptLines(createWebFetchPair(
    'fetch-preview-cap',
    {url: 'https://example.com/preview-cap'},
    previewText,
    {truncated: true}
  ), 120).map((line) => stripAnsi(line));
  assert.equal(previewLines[0], '◆ ▌ Web fetch · example.com/preview-cap · 200 OK · preview truncated');
  assert.equal(previewLines.includes('  ▌ first preview line'), true);

  const offloadedText = previewText.replace('Output was truncated.', '[tool result truncated: /tmp/fetch-result.txt]');
  const offloadedLines = renderTranscriptLines(createWebFetchPair(
    'fetch-offloaded',
    {url: 'https://example.com/preview-cap'},
    offloadedText,
    {truncated: true}
  ), 160).map((line) => stripAnsi(line));
  assert.equal(offloadedLines[0], '◆ ▌ Web fetch · example.com/preview-cap · 200 OK · preview truncated · full result saved');
  assert.equal(offloadedLines.some((line) => line.includes('/tmp/fetch-result.txt')), false);
});

test('web_fetch treats internal fences and marker-like body text as content without inventing status', () => {
  const body = [
    'first line',
    '```',
    'body_truncated: true',
    'Output was truncated.',
    '[tool result truncated: /tmp/fake.txt]',
    'last line'
  ].join('\n');
  const lines = renderTranscriptLines(createWebFetchPair(
    'fetch-body-literals',
    {url: 'https://example.com/literals'},
    formatWebFetchEnvelope({firstLine: 'https://example.com/literals', headers: ['status: 200 OK'], body})
  ), 120).map((line) => stripAnsi(line));

  assert.equal(lines[0], '◆ ▌ Web fetch · example.com/literals · 200 OK');
  assert.equal(lines.includes('  ▌ ```'), true);
  assert.equal(lines.includes('  ▌ body_truncated: true'), true);
  assert.equal(lines.includes('  ▌ [tool result truncated: /tmp/fake.txt]'), true);
  assert.equal(lines[0].includes('truncated'), false);
});

test('web_fetch malformed calls and result envelopes use generic fallback', () => {
  const malformedPreview = renderToolCallPreviewLines('web_fetch', '{bad-json', 80).map((line) => stripAnsi(line));
  assert.deepEqual(malformedPreview, ['◆ Web fetch', '  {bad-json']);

  const malformedResult = [
    'https://example.com/malformed',
    'unknown_header: value',
    'status: 200 OK',
    '',
    'content:',
    '```',
    'body',
    '```'
  ].join('\n');
  const lines = renderTranscriptLines(createWebFetchPair(
    'fetch-malformed',
    {url: 'https://example.com/malformed'},
    malformedResult
  ), 100).map((line) => stripAnsi(line));
  assert.equal(lines[0], '◆ ▌ Web fetch · example.com/malformed');
  assert.equal(lines.includes('  ⎿ https://example.com/malformed'), true);
  assert.equal(lines.some((line) => line.startsWith('  ▌')), false);
});

test('web_fetch document rail keeps custom color, safe width, wide characters, and records unchanged', () => {
  const theme = createTuiTheme({
    blocks: {
      colors: {
        text: [9, 8, 7],
        toolOutput: [1, 2, 3]
      }
    }
  });
  const records = createWebFetchPair(
    'fetch-width',
    {url: `https://example.com/${'路径/'.repeat(20)}结尾?q=值`},
    formatWebFetchEnvelope({
      firstLine: `https://example.com/${'路径/'.repeat(20)}结尾?q=值`,
      headers: ['status: 200 OK'],
      body: `很长的网页正文${'内容'.repeat(40)}\n第二行`
    })
  );
  const before = structuredClone(records);
  const width = 24;
  const rendered = renderTranscriptLines(records, width, theme);

  assert.deepEqual(records, before);
  assertSafeRenderLines(rendered, width);
  assert.equal(rendered.every((line) => !stripAnsi(line).includes('\n') && !stripAnsi(line).includes('\r')), true);
  const firstBodyLine = rendered.findIndex((line) => /\x1b\[38;2;9;8;7m/.test(line));
  const bodyRailLines = rendered.slice(firstBodyLine).filter((line) => stripAnsi(line).startsWith('  ▌ '));
  assert.ok(firstBodyLine > 0);
  assert.ok(bodyRailLines.length > 2);
  assert.ok(bodyRailLines.every((line) => /\x1b\[38;2;1;2;3m▌\x1b\[39m/.test(line)));
  assert.ok(bodyRailLines.every((line) => /\x1b\[38;2;9;8;7m/.test(line)));
});

function createWebFetchPair(callId, args, text, options = {}) {
  return [
    {
      role: 'tool_call',
      text: '',
      toolCallId: callId,
      toolName: 'web_fetch',
      argumentsText: JSON.stringify({
        url: args.url,
        offset: args.offset ?? null,
        limit: args.limit ?? null
      })
    },
    {
      role: 'tool_result',
      text,
      toolCallId: callId,
      toolName: 'web_fetch',
      ok: options.ok ?? true,
      details: {
        kind: 'web_fetch',
        timedOut: options.timedOut ?? false,
        truncated: options.truncated ?? false
      }
    }
  ];
}

function formatWebFetchEnvelope(options) {
  return [
    options.firstLine,
    ...options.headers,
    '',
    'content:',
    '```',
    ...options.body.split('\n'),
    '```'
  ].join('\n');
}
