const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');

const {DEFAULT_RENDER_PREFERENCES} = require('../../src/config/app-settings-config');
const {
  createTuiTheme,
  listBuiltinThemes,
  readBuiltinTheme
} = require('../../src/config/theme-config');
const {createComposer} = require('../../src/input/composer');
const {createAppRenderer} = require('../../src/render/app-renderer');
const {
  createCodeExecutionAppendState,
  projectCodeExecutionPending,
  projectCodeExecutionRecords,
  renderRunCodeCallLines,
  pruneCodeExecutionAppendState
} = require('../../src/render/code-mode-renderer');
const {renderPendingAssistantLines} = require('../../src/render/blocks/pending-preview-renderer');
const {blockText} = require('../../src/render/colors');
const {displayWidth, safeRenderWidth, stripAnsi} = require('../../src/render/layout');
const {
  renderToolCallPreviewLines,
  renderToolPairBlock,
  renderToolPairLines,
  renderToolRecordBlock,
  renderToolRecordLines
} = require('../../src/render/tool-message-renderer');
const {
  renderTranscriptBlocks,
  renderTranscriptLines
} = require('../../src/render/transcript-renderer');
const ansi = require('../../src/terminal/ansi');

const EXECUTION_ID = 'ae31dfc8-4fc1-4224-9219-2da27ae40061';
const THEME = createTuiTheme();

function audit(sequence, event, overrides = {}) {
  return {
    role: 'code_execution',
    toolCallId: 'outer-code',
    executionId: EXECUTION_ID,
    sequence,
    event,
    text: '',
    ...overrides
  };
}

function child(sequence, event, ordinal, overrides = {}) {
  return audit(sequence, event, {
    childCallId: `${EXECUTION_ID}:${ordinal}`,
    toolName: ordinal === 1 ? 'glob' : 'read_files',
    ...overrides
  });
}

function outerCall(overrides = {}) {
  return {
    role: 'tool_call',
    toolCallId: 'outer-code',
    toolName: 'run_code',
    argumentsText: '{"code":"SOURCE-BODY-MUST-NOT-EXPAND"}',
    text: '',
    ...overrides
  };
}

function outerResult(value = {}, overrides = {}) {
  return {
    role: 'tool_result',
    toolCallId: 'outer-code',
    toolName: 'run_code',
    ok: true,
    details: {kind: 'generic'},
    text: JSON.stringify({
      status: 'succeeded',
      result: {content: 'RETURNED-VALUE'},
      logs: ['RETURNED-LOG'],
      logs_truncated: false,
      summary: {attempted: 2, completed: 2, failed: 0, cancelled: 0, duration_ms: 12},
      error: null,
      ...value
    }),
    ...overrides
  };
}

function recordsForRun() {
  return [
    audit(0, 'start'),
    child(1, 'call_start', 1),
    child(2, 'call_start', 2, {text: 'FILE-BODY-MUST-NOT-EXPAND'}),
    child(3, 'call_end', 2, {status: 'succeeded', durationMs: 3}),
    child(4, 'call_end', 1, {status: 'succeeded', durationMs: 5}),
    audit(5, 'end', {status: 'succeeded', durationMs: 12, text: 'Run code completed'})
  ];
}

function append(records, state, width = 160, theme = THEME) {
  return renderTranscriptBlocks(
    records,
    width,
    theme,
    DEFAULT_RENDER_PREFERENCES,
    false,
    undefined,
    undefined,
    {state}
  ).join('');
}

function pendingForRun(state, overrides = {}) {
  return projectCodeExecutionPending(
    {
      kind: 'tool_call',
      callId: 'outer-code',
      toolName: 'run_code',
      argumentsText: outerCall().argumentsText,
      ...overrides
    },
    state
  );
}

function pendingText(state, overrides = {}, width = 160) {
  return renderPendingAssistantLines(pendingForRun(state, overrides), width, Infinity, THEME)
    .map(stripAnsi)
    .join('\n');
}

function plainSnapshot(records, options) {
  return renderTranscriptLines(
    records,
    160,
    THEME,
    DEFAULT_RENDER_PREFERENCES,
    true,
    undefined,
    options
  )
    .map(stripAnsi)
    .join('\n');
}

function assertNoExpandedBodies(text) {
  assert.doesNotMatch(
    text,
    /SOURCE-BODY|FILE-BODY|LOG-BODY|ae31dfc8|outer-code|call_start|call_end/
  );
}

function railPrefix(token, marker = false) {
  return (marker ? blockText(THEME, token, '◆') + ' ' : '  ') + blockText(THEME, token, '▌') + ' ';
}

function withoutRail(line) {
  return stripAnsi(line).replace(/^(?:◆ |  )▌ /u, '');
}

function previewSection(lines, heading) {
  const plain = lines.map(withoutRail);
  const start = plain.indexOf(heading);
  assert.notEqual(start, -1, `${heading}: ${plain.join('\n')}`);
  const body = [];
  for (const line of plain.slice(start + 1)) {
    if (/^(?:Result:|Logs:|Error:|Logs: \(none\)|Logs were truncated)/u.test(line)) {
      break;
    }
    body.push(line);
  }
  while (body.at(-1) === '') {
    body.pop();
  }
  return body;
}

function pairLines(value, width = 160, overrides = {}) {
  return renderToolPairLines(outerCall(), outerResult(value, overrides), width, THEME);
}

function assertSafeLines(lines, width) {
  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(width), `${width}: ${stripAnsi(line)}`);
    assert.doesNotMatch(stripAnsi(line), /[\x00-\x1f\x7f-\x9f]/u);
    assert.doesNotMatch(line, /\x1b\[2J|\x1b\[\?1049[hl]|\x1b\]52/u);
  }
}

function harness() {
  const output = {
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
    }
  };
  const renderer = createAppRenderer(output);
  const state = {
    composer: createComposer('draft'),
    commandSurface: null,
    pending: null,
    working: null,
    theme: THEME,
    renderPreferences: DEFAULT_RENDER_PREFERENCES,
    width: 160,
    rows: 24,
    streamingOwner: 'main',
    mainTranscript: {baseRecordIndex: 0, compaction: null},
    statusLine: {projectName: 'project', model: {kind: 'default', label: 'fake'}, mode: 'idle'}
  };
  const bannerContext = {
    cwd: '/tmp/project',
    nodeVersion: 'v20',
    terminalSize: {columns: 160, rows: 24},
    mode: 'current terminal'
  };
  return {output, renderer, state, bannerContext};
}

test('snapshot groups a run once and orders child terminals by call ordinal rather than completion order', () => {
  const records = [outerCall(), ...recordsForRun(), outerResult()];
  const original = structuredClone(records);
  const text = plainSnapshot(records);
  assert.equal((text.match(/◆ ▌ Run code/g) || []).length, 1);
  assert.equal((text.match(/#1 glob · succeeded/g) || []).length, 1);
  assert.equal((text.match(/#2 read_files · succeeded/g) || []).length, 1);
  assert.ok(text.indexOf('#1 glob') < text.indexOf('#2 read_files'));
  assert.match(text, /succeeded · completed 2\/2 · failed 0 · cancelled 0 · 12ms/);
  assertNoExpandedBodies(text);
  assert.deepEqual(records, original);
});

test('run titles use ordinary tool status markers without dimming the title', () => {
  for (const [status, token] of [
    ['succeeded', 'toolSuccess'],
    ['failed', 'toolError'],
    ['cancelled', 'toolError']
  ]) {
    const records = recordsForRun();
    records[5] = {...records[5], status};
    const [title] = append(
      [...records, outerResult({status}, {ok: status === 'succeeded'})],
      createCodeExecutionAppendState()
    ).split('\n');
    assert.equal(
      title,
      railPrefix(token, true) + blockText(THEME, token, `Run code #1 · ${status}`)
    );
    assert.doesNotMatch(title, /\x1b\[2m/);
  }
});

test('child and summary bodies keep normal brightness while durations are dim and success audit diagnostics stay hidden', () => {
  const records = recordsForRun();
  records[5].text = 'Run code completed; attempted 2; completed 2; failed 0';
  const lines = append([...records, outerResult()], createCodeExecutionAppendState()).split('\n');
  const first = lines.find((line) => stripAnsi(line).includes('#1 glob'));
  assert.equal(
    first,
    railPrefix('toolSuccess') +
      blockText(THEME, 'text', '#1 glob · succeeded') +
      ansi.dim(blockText(THEME, 'toolOutput', ' · 5ms'))
  );
  const summary = lines.find((line) => stripAnsi(line).includes('completed 2/2'));
  assert.equal(
    summary,
    railPrefix('toolSuccess') +
      blockText(THEME, 'text', 'succeeded · completed 2/2 · failed 0 · cancelled 0') +
      ansi.dim(blockText(THEME, 'toolOutput', ' · 12ms'))
  );
  assert.doesNotMatch(lines.map(stripAnsi).join('\n'), /Run code completed|attempted 2/);
  assert.doesNotMatch(lines.map(stripAnsi).join('\n'), /[├│]/u);
});

test('failed calls and error diagnostics use the error token without dimming their bodies', () => {
  const records = recordsForRun();
  records[4] = {...records[4], status: 'failed'};
  records[5] = {...records[5], status: 'failed', text: 'runtime: script_error'};
  const lines = append(
    [...records, outerResult({status: 'failed'}, {ok: false})],
    createCodeExecutionAppendState()
  ).split('\n');
  const first = lines.find((line) => stripAnsi(line).includes('#1 glob'));
  assert.equal(
    first,
    railPrefix('toolError') +
      blockText(THEME, 'toolError', '#1 glob · failed') +
      ansi.dim(blockText(THEME, 'toolOutput', ' · 5ms'))
  );
  const diagnostic = lines.find((line) => stripAnsi(line).includes('runtime: script_error'));
  assert.equal(
    diagnostic,
    railPrefix('toolError') + blockText(THEME, 'toolError', 'runtime: script_error')
  );
  assert.doesNotMatch(diagnostic, /\x1b\[2m/);
});

test('completed snapshot groups leave exactly one blank line before the next message', () => {
  const records = [
    outerCall(),
    ...recordsForRun(),
    outerResult(),
    {role: 'assistant', text: 'next message'}
  ];
  const text = plainSnapshot(records);
  assert.match(text, /  ▌ \]\n\n◆ next message/);
  assert.match(text, /Result:/);
  assert.match(text, /Logs:/);
  assert.doesNotMatch(text, /\n{3,}/);
});

test('audit events never append stable output and the outer result emits one complete separated block', () => {
  const state = createCodeExecutionAppendState();
  const records = recordsForRun();
  const updates = records.slice(0, -1).map((record) => append([record], state));
  assert.deepEqual(
    updates,
    records.slice(0, -1).map(() => '')
  );
  const end = append([records.at(-1)], state);
  assert.equal(end, '');
  assert.match(pendingText(state), /Run code #1 · finishing/);
  const lateOuter = append([records.at(-1), outerCall(), outerResult()], state);
  assert.match(stripAnsi(lateOuter), /Result:/);
  assert.match(stripAnsi(lateOuter), /◆ ▌ Run code #1 · succeeded/);
  assert.match(stripAnsi(lateOuter), /#1 glob · succeeded/);
  assert.match(stripAnsi(lateOuter), /#2 read_files · succeeded/);
  assert.equal((stripAnsi(lateOuter).match(/completed 2\/2/g) || []).length, 1);
  assert.ok(lateOuter.endsWith('\n\n'));
  assert.ok(!lateOuter.endsWith('\n\n\n'));
  assert.equal(append([outerCall(), outerResult(), records.at(-1)], state), '');
  const next = append([{role: 'assistant', text: 'next message'}], state);
  const text = stripAnsi(updates.join('') + end + lateOuter + next);
  assert.match(text, /  ▌ \]\n\n◆ next message/);
  assert.doesNotMatch(text, /\n{3,}/);
  assert.equal((text.match(/◆ ▌ Run code/g) || []).length, 1);
  assert.doesNotMatch(text, /Run code #1 · running|Run code completed/);
});

test('resumed interrupted groups separate the next message while active snapshots keep streaming space open', () => {
  const records = recordsForRun().slice(0, 3);
  const interrupted = plainSnapshot([...records, {role: 'assistant', text: 'next message'}]);
  assert.match(interrupted, /unfinished 2/);
  assert.match(interrupted, /[^\n]\n\n◆ next message/);
  const active = plainSnapshot(records, {activeToolCallIds: ['outer-code']});
  assert.equal(active, '');
  const state = createCodeExecutionAppendState();
  plainSnapshot(records, {state, snapshot: true, activeToolCallIds: ['outer-code']});
  assert.match(pendingText(state), /completed 0\/2 · failed 0 · cancelled 0 · pending 2/);
});

test('direct tool pair and result blocks use the same single blank separator as grouped snapshots', () => {
  const call = outerCall();
  const result = outerResult();
  const [group] = renderTranscriptBlocks([call, result], 160, THEME);
  const pair = renderToolPairBlock(call, result, 160, THEME);
  const standalone = renderToolRecordBlock(result, 160, THEME);
  assert.equal(group, pair);
  assert.equal(group, standalone);
  assert.ok(group.endsWith('\n\n'));
  assert.ok(!group.endsWith('\n\n\n'));
});

test('app append preserves the completed block separator before the next streaming response', () => {
  const {output, renderer, state} = harness();
  const records = recordsForRun();
  renderer.renderRecords({...state, records: records.slice(0, -1)});
  output.writes.length = 0;
  renderer.renderRecords({...state, records: [records.at(-1), outerCall(), outerResult()]});
  const completion = stripAnsi(output.writes.at(-1));
  // footer 自有临时留白；稳定块的精确间距由前面的块级回归验证。
  assert.match(completion, /  ▌ \]\n\n/);
  output.writes.length = 0;
  renderer.render({...state, pending: {kind: 'streaming', text: 'next message'}});
  renderer.render(state, {role: 'assistant', text: 'next message'});
  const response = stripAnsi(output.writes.join(''));
  assert.match(response, /next message/);
  assert.doesNotMatch(response, /Run code|completed 2\/2/);
});

test('footer reports actual progress while stable history waits for the complete ordered outer block', () => {
  const state = createCodeExecutionAppendState();
  const records = recordsForRun();
  const start = stripAnsi(append(records.slice(0, 3), state));
  assert.equal(start, '');
  assert.match(pendingText(state), /◆ ▌ Run code #1 · running/);
  assert.match(pendingText(state), /completed 0\/2 · failed 0 · cancelled 0 · pending 2/);
  const second = stripAnsi(append([records[3]], state));
  assert.equal(second, '');
  assert.match(pendingText(state), /completed 1\/2 · failed 0 · cancelled 0 · pending 1/);
  assert.doesNotMatch(pendingText(state), /▌ #2/);
  const first = stripAnsi(append([records[4]], state));
  assert.equal(first, '');
  assert.match(pendingText(state), /completed 2\/2 · failed 0 · cancelled 0/);
  const end = stripAnsi(append([records[5]], state));
  assert.equal(end, '');
  assert.match(pendingText(state), /Run code #1 · finishing/);
  const outer = stripAnsi(append([outerCall(), outerResult()], state));
  assert.match(outer, /Result:/);
  assert.match(outer, /RETURNED-VALUE/);
  assert.match(outer, /RETURNED-LOG/);
  assert.match(outer, /succeeded · completed 2\/2/);
  assert.ok(outer.indexOf('#1 glob') < outer.indexOf('#2 read_files'));
  assert.equal((`${start}${second}${first}${end}${outer}`.match(/◆ ▌ Run code/g) || []).length, 1);
  assert.equal(pendingForRun(state).codeExecution, undefined);
  assertNoExpandedBodies(`${start}${second}${first}${end}${outer}`);
});

test('pending progress is keyed by callId and never borrows the latest unrelated execution', () => {
  const state = createCodeExecutionAppendState();
  const first = recordsForRun().slice(0, 4);
  const second = [
    audit(0, 'start', {toolCallId: 'outer-two', executionId: 'execution-two'}),
    audit(1, 'call_start', {
      toolCallId: 'outer-two',
      executionId: 'execution-two',
      childCallId: 'execution-two:1',
      toolName: 'grep'
    })
  ];
  assert.equal(append([...first, ...second], state), '');
  assert.deepEqual(pendingForRun(state).codeExecution, {
    ordinal: 1,
    status: 'running',
    summary: 'completed 1/2 · failed 0 · cancelled 0 · pending 1'
  });
  assert.deepEqual(pendingForRun(state, {callId: 'outer-two'}).codeExecution, {
    ordinal: 2,
    status: 'running',
    summary: 'completed 0/1 · failed 0 · cancelled 0 · pending 1'
  });
  for (const overrides of [{callId: undefined}, {callId: 'unrelated-call'}, {toolName: 'glob'}]) {
    assert.equal(pendingForRun(state, overrides).codeExecution, undefined);
  }
  const pending = {
    kind: 'tool_calls',
    calls: ['outer-code', 'outer-two', 'unrelated-call'].map((callId) => ({
      callId,
      toolName: 'run_code',
      argumentsText: outerCall().argumentsText
    }))
  };
  const original = structuredClone(pending);
  const projected = projectCodeExecutionPending(pending, state);
  const lines = renderPendingAssistantLines(projected, 200, Infinity, THEME).map(stripAnsi);
  const firstLine = lines.find((line) => line.includes('Run code #1'));
  const secondLine = lines.find((line) => line.includes('Run code #2'));
  assert.match(firstLine, /completed 1\/2 · failed 0 · cancelled 0 · pending 1/);
  assert.match(secondLine, /completed 0\/1 · failed 0 · cancelled 0 · pending 1/);
  assert.equal(projected.calls[2].codeExecution, undefined);
  assert.deepEqual(pending, original);
  assert.equal(append([outerResult()], state).length > 0, true);
  assert.equal(pendingForRun(state).codeExecution, undefined);
  assert.equal(pendingForRun(state, {callId: 'outer-two'}).codeExecution.ordinal, 2);
});

test('zero-child progress has no synthetic zero counts and run-call rendering accepts footer progress', () => {
  const state = createCodeExecutionAppendState();
  for (const record of [outerCall(), audit(0, 'start')]) {
    const projected = projectCodeExecutionRecords([record], 160, THEME, {state});
    assert.equal(projected.join(''), '');
  }
  const pending = pendingForRun(state);
  assert.deepEqual(pending.codeExecution, {ordinal: 1, status: 'running', summary: ''});
  const rendered = renderRunCodeCallLines(160, THEME, undefined, pending.codeExecution);
  assert.equal(rendered.map(stripAnsi).join('\n'), '◆ ▌ Run code #1 · running');
  assert.doesNotMatch(pendingText(state), /0\/0|completed|SOURCE-BODY/);
  assert.equal(append([audit(1, 'end', {status: 'succeeded'})], state), '');
  assert.deepEqual(pendingForRun(state).codeExecution, {
    ordinal: 1,
    status: 'finishing',
    summary: ''
  });
  assert.equal(pendingText(state), '◆ ▌ Run code #1 · finishing');
});

test('pre-result cache retains compact audit facts without call arguments or audit bodies', () => {
  const state = createCodeExecutionAppendState();
  const records = [outerCall(), ...recordsForRun().slice(0, 5)];
  records[1].text = 'AUDIT-START-BODY'.repeat(2000);
  records[2].text = 'AUDIT-CHILD-BODY'.repeat(2000);
  const original = structuredClone(records);
  assert.equal(append(records, state), '');
  assert.match(pendingText(state), /completed 2\/2/);
  function inspect(value) {
    assert.ok(!records.includes(value));
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /SOURCE-BODY|AUDIT-START-BODY|AUDIT-CHILD-BODY/);
    } else if (value instanceof Map || value instanceof Set) {
      for (const item of value.values()) {
        inspect(item);
      }
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        inspect(item);
      }
    }
  }
  inspect(state);
  assert.deepEqual(records, original);
});

test('failure phase, location and completed counts come from machine facts, never from diagnostic text', () => {
  const records = recordsForRun();
  records[5] = audit(5, 'end', {
    status: 'failed',
    text: 'serialize: serialization_error; completed 9999',
    durationMs: 12
  });
  const result = outerResult(
    {
      status: 'failed',
      error: {
        phase: 'serialize',
        code: 'serialization_error',
        message: 'Cannot serialize value',
        line: 4,
        column: 8
      }
    },
    {ok: false}
  );
  const text = plainSnapshot([...records, outerCall(), result]);
  assert.match(text, /failed · completed 2\/2 · failed 0 · cancelled 0/);
  assert.match(text, /serialize · line 4:8 · serialization_error: Cannot serialize value/);
  assert.doesNotMatch(text, /9999/);
  assertNoExpandedBodies(text);

  const state = createCodeExecutionAppendState();
  assert.equal(append(records, state), '');
  const lateOuter = stripAnsi(append([outerCall(), result], state));
  assert.match(lateOuter, /serialize · line 4:8/);
  assert.match(lateOuter, /Error:/);
  assert.match(lateOuter, /completed 2\/2/);
  assert.match(lateOuter, /◆ ▌ Run code #1 · failed/);
  assert.equal(append([structuredClone(result)], state), '');
});

test('interleaved executions and ordinary records preserve distinct identities and ordinary record ordering', () => {
  const first = recordsForRun();
  const second = recordsForRun().map((record) => ({...record, toolCallId: 'outer-two'}));
  const records = [
    first[0],
    {role: 'assistant', text: 'ordinary before'},
    second[0],
    ...first.slice(1, 4),
    ...second.slice(1),
    {role: 'local_notice', text: 'ordinary after'},
    ...first.slice(4),
    outerCall(),
    outerResult(),
    outerCall({toolCallId: 'outer-two'}),
    outerResult({}, {toolCallId: 'outer-two'})
  ];
  const text = plainSnapshot(records);
  assert.equal((text.match(/◆ ▌ Run code #1/g) || []).length, 1);
  assert.equal((text.match(/◆ ▌ Run code #2/g) || []).length, 1);
  assert.equal((text.match(/completed 2\/2/g) || []).length, 2);
  assert.ok(text.indexOf('ordinary before') < text.indexOf('ordinary after'));
  assertNoExpandedBodies(text);

  const state = createCodeExecutionAppendState();
  const written = records.map((record) => stripAnsi(append([record], state))).join('');
  assert.equal((written.match(/◆ ▌ Run code/g) || []).length, 2);
  assert.match(written, /▌ Run code #1/);
  assert.match(written, /▌ Run code #2/);
  assert.ok(written.indexOf('ordinary before') < written.indexOf('ordinary after'));
  assertNoExpandedBodies(written);
});

test('distinct execution IDs under the same parent are not merged', () => {
  const records = [
    audit(0, 'start'),
    audit(0, 'start', {executionId: 'other-execution'}),
    child(1, 'call_end', 1, {status: 'succeeded'}),
    audit(1, 'call_end', {
      executionId: 'other-execution',
      childCallId: 'other-execution:1',
      toolName: 'grep',
      status: 'failed'
    }),
    audit(2, 'end', {status: 'succeeded'}),
    audit(2, 'end', {executionId: 'other-execution', status: 'failed'})
  ];
  const text = plainSnapshot(records);
  assert.equal((text.match(/◆ ▌ Run code/g) || []).length, 2);
  assert.match(text, /#1 glob · succeeded/);
  assert.match(text, /#1 grep · failed/);
  assert.match(text, /succeeded · completed 1\/1/);
  assert.match(text, /failed · completed 0\/1 · failed 1/);
});

test('partial resume marks absent terminals without inventing failed or cancelled calls', () => {
  const records = recordsForRun().slice(0, 4);
  const text = plainSnapshot(records);
  assert.match(text, /◆ ▌ Run code #1 · interrupted/);
  assert.match(text, /#1 glob · interrupted/);
  assert.match(text, /#2 read_files · succeeded/);
  assert.match(
    text,
    /interrupted before completion · completed 1\/2 · failed 0 · cancelled 0 · unfinished 1/
  );
  const active = plainSnapshot(records, {activeToolCallIds: ['outer-code']});
  assert.equal(active, '');
  const state = createCodeExecutionAppendState();
  plainSnapshot(records, {state, snapshot: true, activeToolCallIds: ['outer-code']});
  assert.match(pendingText(state), /Run code #1 · running/);
  assert.match(pendingText(state), /completed 1\/2 · failed 0 · cancelled 0 · pending 1/);
  assert.doesNotMatch(pendingText(state), /interrupted|unfinished/);

  const interrupted = outerResult(
    {},
    {
      ok: false,
      text: 'Tool execution was interrupted by the user before it returned a result.',
      details: {kind: 'generic', interrupted: true}
    }
  );
  const terminal = plainSnapshot([...records, outerCall(), interrupted]);
  assert.match(terminal, /#1 glob · unfinished/);
  assert.match(terminal, /cancelled · completed 1\/2 · failed 0 · cancelled 0 · unfinished 1/);
  assert.match(terminal, /interrupted by user/);
});

test('audit end stays footer-only for active snapshots but resumes with an unavailable result when inactive', () => {
  const records = [outerCall(), ...recordsForRun()];
  for (const activeOptions of [{activeToolCallIds: ['outer-code']}, {active: true}]) {
    const state = createCodeExecutionAppendState();
    assert.equal(plainSnapshot(records, {state, snapshot: true, ...activeOptions}), '');
    assert.deepEqual(pendingForRun(state).codeExecution, {
      ordinal: 1,
      status: 'finishing',
      summary: 'completed 2/2 · failed 0 · cancelled 0'
    });
    assert.equal(pendingForRun(state, {callId: undefined}).codeExecution, undefined);
  }
  const restored = plainSnapshot(records);
  assert.match(restored, /◆ ▌ Run code #1 · succeeded/);
  assert.match(restored, /Result preview unavailable/);
  assert.doesNotMatch(restored, /Run code completed|Result:\n|Logs:/);
});

test('unknown and legacy statuses, missing starts and malformed child identities degrade without trusting them', () => {
  const records = [
    child(0, 'call_end', 3, {status: 'denied'}),
    child(1, 'call_end', 1, {status: 'completed'}),
    child(2, 'call_end', 2, {status: 'cancelled'}),
    child(3, 'call_end', 4, {status: 'succeeded\x1b[2J'}),
    child(4, 'call_start', 5, {childCallId: `${EXECUTION_ID}:01`}),
    child(5, 'call_end', 5, {childCallId: `${EXECUTION_ID}:01`, status: 'rejected'}),
    child(6, 'call_end', 6, {childCallId: 'legacy\r\x1b[?1049h', status: 'surprise'}),
    child(7, 'call_end', 7, {childCallId: `${EXECUTION_ID}:9007199254740992`, status: 'failed'}),
    audit(8, 'end', {status: 'old-status'})
  ];
  const text = plainSnapshot(records);
  assert.match(text, /◆ ▌ Run code #1 · unknown/);
  assert.ok(text.indexOf('#1 glob') < text.indexOf('#2 read_files'));
  assert.match(text, /#\?5 read_files · rejected/);
  assert.match(text, /completed 1\/7 · failed 3 · cancelled 1 · unknown 2/);
  assert.doesNotMatch(text, /legacy|9007199254740992|old-status|\x1b/);
});

test('duplicate callbacks and late events do not duplicate or change terminal counts', () => {
  const state = createCodeExecutionAppendState();
  const records = recordsForRun();
  const written = stripAnsi(append(records, state));
  assert.equal(written, '');
  assert.match(pendingText(state), /completed 2\/2/);
  assert.equal(append(records, state), '');
  assert.equal(append([child(6, 'call_end', 3, {status: 'failed'})], state), '');
  assert.match(pendingText(state), /completed 2\/2 · failed 0/);
  const completed = stripAnsi(append([outerCall(), outerResult()], state));
  assert.equal((completed.match(/◆ ▌ Run code/g) || []).length, 1);
  assert.match(completed, /completed 2\/2 · failed 0/);
  assert.equal(append([...records, outerResult()], state), '');
  assert.match(
    plainSnapshot([...records, ...records, child(6, 'call_end', 3, {status: 'failed'})]),
    /completed 2\/2 · failed 0/
  );
});

test('resize rebuilds pending counts and preserves ordinal gaps until the complete outer result', () => {
  const state = createCodeExecutionAppendState();
  const records = recordsForRun();
  const partial = records.slice(0, 4);
  plainSnapshot(partial, {state, snapshot: true, activeToolCallIds: ['outer-code']});
  assert.match(pendingText(state), /completed 1\/2 · failed 0 · cancelled 0 · pending 1/);
  const first = stripAnsi(append([records[4]], state));
  assert.equal(first, '');
  assert.match(pendingText(state), /completed 2\/2 · failed 0 · cancelled 0/);
  assert.equal(append([child(5, 'call_start', 3, {toolName: 'grep'})], state), '');
  assert.match(pendingText(state), /completed 2\/3 · failed 0 · cancelled 0 · pending 1/);
  const third = stripAnsi(
    append([child(6, 'call_end', 3, {toolName: 'grep', status: 'failed'})], state)
  );
  assert.equal(third, '');
  assert.match(pendingText(state), /completed 2\/3 · failed 1 · cancelled 0/);
  assert.equal(append([audit(7, 'end', {status: 'failed'})], state), '');
  const completed = stripAnsi(append([outerResult({status: 'failed'}, {ok: false})], state));
  assert.match(completed, /#3 grep · failed/);
  assert.match(completed, /completed 2\/3 · failed 1 · cancelled 0/);
  assert.ok(completed.indexOf('#1 glob') < completed.indexOf('#2 read_files'));
  assert.ok(completed.indexOf('#2 read_files') < completed.indexOf('#3 grep'));
});

test('outer-only failures and malformed results stay compact, including tool pending and direct pair rendering', () => {
  const call = outerCall();
  const result = outerResult(
    {
      status: 'failed',
      summary: {attempted: 0, completed: 0, failed: 0, cancelled: 0, duration_ms: 7},
      error: {phase: 'compile', code: 'script_error', message: 'Unexpected token', line: 1}
    },
    {ok: false}
  );
  const text = plainSnapshot([call, result]);
  assert.match(text, /failed · completed 0\/0 · failed 0 · cancelled 0 · 7ms/);
  assert.match(text, /compile · line 1 · script_error/);
  assertNoExpandedBodies(text);
  const pair = renderToolPairLines(call, result, 160, THEME).map(stripAnsi).join('\n');
  assert.equal(pair, text.trimEnd());
  const preview = renderToolCallPreviewLines('run_code', call.argumentsText, 160, THEME)
    .map(stripAnsi)
    .join('\n');
  assert.equal(preview, '◆ ▌ Run code · running');
  assertNoExpandedBodies(preview);
  assertNoExpandedBodies(renderToolRecordLines(result, 160, {}, THEME).join('\n'));
  for (const malformed of [
    'not JSON FILE-BODY',
    '"FILE-BODY"',
    '{"status":"wrong","result":"FILE-BODY"}',
    'x'.repeat(128 * 1024 + 1)
  ]) {
    const unknown = plainSnapshot([call, {...result, text: malformed}]);
    assert.match(unknown, /failed · completed 0\/0/);
    assert.match(
      unknown,
      /(?:output|preview|result).*(?:unavailable|missing|not available|not recorded|malformed|invalid|legacy)/iu
    );
    assert.doesNotMatch(unknown, /Result:|Logs:|Error:/u);
    assertNoExpandedBodies(unknown);
  }
});

test('outer result previews preserve primitive, null and nested JSON values rather than audit bodies', () => {
  for (const result of [
    0,
    false,
    'returned text',
    null,
    {nested: {items: [1, null, true]}, label: '返回值'}
  ]) {
    const records = [outerCall(), ...recordsForRun(), outerResult({result, logs: []})];
    const original = structuredClone(records);
    const lines = renderTranscriptLines(records, 160, THEME);
    assert.equal(previewSection(lines, 'Result:').join('\n'), JSON.stringify(result, null, 2));
    assert.match(lines.map(stripAnsi).join('\n'), /Logs: \(none\)/u);
    assert.doesNotMatch(lines.map(stripAnsi).join('\n'), /Error:|preview truncated for display/u);
    assertNoExpandedBodies(lines.join('\n'));
    assert.deepEqual(records, original);
  }
});

test('logs preview contains the actual returned JSON array and distinguishes no logs from actual truncation', () => {
  for (const logs of [
    [],
    ['returned log', 'second\nentry'],
    [{message: 'structured log'}, 0, false, null]
  ]) {
    const lines = pairLines({result: 3, logs});
    const text = lines.map(stripAnsi).join('\n');
    if (logs.length === 0) {
      assert.match(text, /Logs: \(none\)/u);
      assert.doesNotMatch(text, /Logs:\n/u);
    } else {
      assert.equal(previewSection(lines, 'Logs:').join('\n'), JSON.stringify(logs, null, 2));
      assert.doesNotMatch(text, /Logs: \(none\)/u);
    }
    assert.doesNotMatch(
      text,
      /Logs were truncated before returning to agent\.|preview truncated for display/u
    );
  }
  for (const logs of [[], ['retained']]) {
    const lines = pairLines({result: null, logs, logs_truncated: true});
    if (logs.length > 0) {
      assert.equal(previewSection(lines, 'Logs:').join('\n'), '[\n  "retained"\n]');
    } else {
      assert.match(lines.map(stripAnsi).join('\n'), /Logs: \(none\)/u);
    }
    assert.match(
      lines.map(stripAnsi).join('\n'),
      /Logs were truncated before returning to agent\./u
    );
    assert.doesNotMatch(lines.map(stripAnsi).join('\n'), /preview truncated for display/u);
  }
});

test('error preview retains the complete returned error object alongside compact machine diagnostics', () => {
  const error = {
    phase: 'runtime',
    code: 'script_error',
    message: 'returned failure',
    line: 4,
    column: 8,
    cause: {name: 'TypeError', detail: 'actual returned cause'}
  };
  const lines = pairLines({status: 'failed', result: null, logs: ['before failure'], error}, 160, {
    ok: false
  });
  assert.equal(previewSection(lines, 'Error:').join('\n'), JSON.stringify(error, null, 2));
  assert.equal(previewSection(lines, 'Result:').join('\n'), 'null');
  assert.equal(previewSection(lines, 'Logs:').join('\n'), '[\n  "before failure"\n]');
  assert.match(
    lines.map(stripAnsi).join('\n'),
    /runtime · line 4:8 · script_error: returned failure/u
  );
  const body = lines.find((line) => stripAnsi(line).includes('"message": "returned failure"'));
  assert.ok(body.includes(blockText(THEME, 'toolError', '▌')));
  assert.doesNotMatch(body, /\x1b\[2m/u);
});

test('data has_more and truncated flags remain literal JSON and do not imply UI or log truncation', () => {
  for (const result of [
    {has_more: true, truncated: true, next_offset: 12},
    {has_more: false, truncated: false, nested: {truncated: true}}
  ]) {
    const lines = pairLines({result, logs: []});
    assert.equal(previewSection(lines, 'Result:').join('\n'), JSON.stringify(result, null, 2));
    assert.doesNotMatch(
      lines.map(stripAnsi).join('\n'),
      /preview truncated for display|Logs were truncated/u
    );
  }
});

test('each preview section has its own twelve physical-line budget and independent display notice', () => {
  const value = {
    result: Array.from({length: 30}, (_, index) => `value-${index}`),
    logs: Array.from({length: 30}, (_, index) => `log-${index}`),
    error: {
      phase: 'runtime',
      code: 'script_error',
      message: 'many details',
      ...Object.fromEntries(
        Array.from({length: 30}, (_, index) => [`detail_${index}`, `error-${index}`])
      )
    },
    logs_truncated: false
  };
  const lines = pairLines(value, 160);
  for (const heading of ['Result:', 'Logs:', 'Error:']) {
    const section = previewSection(lines, heading);
    const notice = section.findIndex((line) => line.includes('preview truncated for display'));
    assert.ok(notice > 0 && notice <= 12, `${heading}: ${section.join('\n')}`);
    assert.equal(notice, section.length - 1, `${heading}: 截断提示应独立位于正文之后`);
    const firstTwelve = JSON.stringify(
      value[heading === 'Result:' ? 'result' : heading === 'Logs:' ? 'logs' : 'error'],
      null,
      2
    )
      .split('\n')
      .slice(0, notice);
    assert.deepEqual(section.slice(0, notice), firstTwelve);
  }
  assert.equal(
    (
      lines
        .map(stripAnsi)
        .join('\n')
        .match(/preview truncated for display/gu) || []
    ).length,
    3
  );
  assert.doesNotMatch(
    lines.map(stripAnsi).join('\n'),
    /value-29|log-29|error-29|Logs were truncated/u
  );
});

test('each preview section independently limits JSON to 4096 characters even on an extra-wide terminal', () => {
  const value = {
    result: 'r'.repeat(6000) + 'RESULT-CHARACTER-TAIL',
    logs: ['l'.repeat(6000) + 'LOG-CHARACTER-TAIL'],
    error: {
      phase: 'runtime',
      code: 'script_error',
      message: 'e'.repeat(6000) + 'ERROR-CHARACTER-TAIL'
    }
  };
  const records = [outerCall(), outerResult(value)];
  const original = structuredClone(records);
  const lines = renderTranscriptLines(records, 8192, THEME);
  for (const [heading, field] of [
    ['Result:', 'result'],
    ['Logs:', 'logs'],
    ['Error:', 'error']
  ]) {
    const section = previewSection(lines, heading);
    assert.match(section.at(-1), /preview truncated for display/u);
    const body = section.slice(0, -1).join('\n');
    assert.equal(body.length, 4096);
    assert.equal(body, JSON.stringify(value[field], null, 2).slice(0, 4096));
  }
  assert.doesNotMatch(lines.map(stripAnsi).join('\n'), /(?:RESULT|LOG|ERROR)-CHARACTER-TAIL/u);
  assert.deepEqual(records, original);
});

test('exactly twelve JSON body rows fit without a display-truncation notice', () => {
  const value = {
    result: Array.from({length: 10}, (_, index) => index),
    logs: Array.from({length: 10}, (_, index) => `log-${index}`),
    error: {
      phase: 'runtime',
      code: 'script_error',
      message: 'failure',
      ...Object.fromEntries(Array.from({length: 7}, (_, index) => [`detail_${index}`, index]))
    }
  };
  const lines = pairLines(value, 160);
  for (const [heading, field] of [
    ['Result:', 'result'],
    ['Logs:', 'logs'],
    ['Error:', 'error']
  ]) {
    const body = previewSection(lines, heading);
    assert.equal(body.length, 12);
    assert.equal(body.join('\n'), JSON.stringify(value[field], null, 2));
  }
  assert.doesNotMatch(
    lines.map(stripAnsi).join('\n'),
    /preview truncated for display|Logs were truncated/u
  );
});

test('long single lines consume wrapped physical rows rather than bypassing the preview budget', () => {
  const result = '长中文🧑‍💻'.repeat(10_000) + 'HIDDEN-RETURNED-TAIL';
  const records = [outerCall(), outerResult({result, logs: []})];
  for (const width of [80, 120, 160]) {
    const lines = renderTranscriptLines(records, width, THEME);
    const section = previewSection(lines, 'Result:');
    const notice = section.findIndex((line) => line.includes('preview truncated for display'));
    assert.ok(notice > 0 && notice <= 12, `${width}: ${section.length}`);
    assert.equal(notice, section.length - 1);
    assert.doesNotMatch(section.join('\n'), /HIDDEN-RETURNED-TAIL/u);
    assertSafeLines(lines, width);
    assert.match(lines.map(stripAnsi).join('\n'), /Logs: \(none\)/u);
  }
});

test('JSON preview escapes ANSI, CR, C1 and tabs without modifying returned data or wide graphemes', () => {
  const unsafe = '中文🧑‍💻\x1b[2J\r\n\t\x07\x9b[?1049h\x1b]52;c;evil\x07';
  const result = {value: unsafe};
  const logs = [unsafe];
  const error = {phase: 'runtime', code: 'script_error', message: unsafe};
  const records = [outerCall(), ...recordsForRun(), outerResult({result, logs, error})];
  const original = structuredClone(records);
  const lines = renderTranscriptLines(records, 4096, THEME);
  for (const [heading, value] of [
    ['Result:', result],
    ['Logs:', logs],
    ['Error:', error]
  ]) {
    // JSON 标准会转义 C0，但 C1 需要额外转义，不能删掉返回值中的数据。
    const expected = JSON.stringify(value, null, 2).replace(
      /[\x7f-\x9f]/gu,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
    );
    assert.equal(previewSection(lines, heading).join('\n'), expected);
  }
  assertSafeLines(lines, 4096);
  assert.match(lines.map(stripAnsi).join('\n'), /中文🧑‍💻/u);
  for (const width of [1, 2, 3, 4, 5, 6, 7, 8, 24, 80, 160]) {
    assertSafeLines(renderTranscriptLines(records, width, THEME), width);
  }
  assert.deepEqual(records, original);
});

test('late outer results emit the first complete final block rather than a second preview block', () => {
  const state = createCodeExecutionAppendState();
  const records = recordsForRun();
  const completed = stripAnsi(append(records, state));
  assert.equal(completed, '');
  assert.match(pendingText(state), /Run code #1 · finishing/u);
  const result = outerResult();
  const late = append([result], state);
  const text = stripAnsi(late);
  assert.match(text, /Result:/u);
  assert.match(text, /RETURNED-VALUE/u);
  assert.match(text, /Logs:/u);
  assert.match(text, /RETURNED-LOG/u);
  assert.match(text, /succeeded · completed 2\/2/u);
  assert.equal((text.match(/◆ ▌ Run code/gu) || []).length, 1);
  assert.equal((text.match(/completed 2\/2/gu) || []).length, 1);
  assert.doesNotMatch(text, /Run code completed/u);
  assert.ok(late.endsWith('\n\n'));
  assert.equal(append([structuredClone(result), result, records.at(-1)], state), '');
  const snapshot = plainSnapshot([outerCall(), ...records, result, structuredClone(result)]);
  assert.equal((snapshot.match(/Result:/gu) || []).length, 1);
  assert.equal((snapshot.match(/Logs:/gu) || []).length, 1);
});

test('absent, malformed and legacy outer results have an explicit unavailable preview without invented sections', () => {
  const legacy = {
    status: 'succeeded',
    summary: {attempted: 0, completed: 0, failed: 0, cancelled: 0}
  };
  const alternatives = [
    [],
    [outerResult({}, {text: 'not JSON FILE-BODY'})],
    [outerResult({}, {text: JSON.stringify(legacy)})],
    [outerResult({}, {text: '{"result":"FILE-BODY"}'})]
  ];
  for (const outer of alternatives) {
    const text = plainSnapshot([outerCall(), ...recordsForRun(), ...outer]);
    assert.match(text, /succeeded · completed 2\/2/u);
    assert.match(
      text,
      /(?:output|preview|result).*(?:unavailable|missing|not available|not recorded|malformed|invalid|legacy)/iu
    );
    assert.doesNotMatch(text, /Result:|Logs:|Error:|Logs: \(none\)/u);
    assertNoExpandedBodies(text);
  }
});

test('historical results with excessive JSON depth or nodes fail only their local preview', () => {
  let deep = null;
  for (let index = 0; index < 40; index += 1) {
    deep = {nested: deep};
  }
  for (const result of [deep, Array.from({length: 4200}, (_, index) => index)]) {
    const records = [outerCall(), outerResult({result})];
    const original = structuredClone(records);
    const lines = renderTranscriptLines(records, 160, THEME);
    const text = lines.map(stripAnsi).join('\n');
    assert.match(text, /Result preview unavailable/u);
    assert.doesNotMatch(text, /Result:|Logs:|Error:/u);
    assert.match(text, /succeeded · completed 2\/2/u);
    assert.deepEqual(records, original);
  }
});

test('Bash and Run code share status-colored rails in pending and completed projections', () => {
  const bashCall = {
    ...outerCall(),
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({command: 'printf returned'})
  };
  const pending = renderToolCallPreviewLines('run_code', outerCall().argumentsText, 160, THEME);
  const bashPending = renderToolCallPreviewLines(
    bashCall.toolName,
    bashCall.argumentsText,
    160,
    THEME
  );
  const runningPrefix =
    blockText(THEME, 'toolOutput', '◆') + ' ' + blockText(THEME, 'tool', '▌') + ' ';
  assert.equal(pending[0], runningPrefix + blockText(THEME, 'tool', 'Run code · running'));
  assert.ok(bashPending[0].startsWith(runningPrefix));
  assert.doesNotMatch(pending.join('\n'), /SOURCE-BODY|[├│]|\x1b\[2m/u);
  for (const ok of [true, false]) {
    const token = ok ? 'toolSuccess' : 'toolError';
    const bashResult = {
      ...outerResult(),
      toolName: 'run_bash_command',
      ok,
      text: JSON.stringify({stdout: 'returned', stderr: ok ? '' : 'failure', exit_code: ok ? 0 : 1})
    };
    const bash = renderToolPairLines(bashCall, bashResult, 160, THEME);
    const code = pairLines({status: ok ? 'succeeded' : 'failed'}, 160, {ok});
    for (const lines of [bash, code]) {
      assert.ok(lines[0].startsWith(railPrefix(token, true)));
      assert.doesNotMatch(lines[0], /\x1b\[2m/u);
      assert.doesNotMatch(lines.map(stripAnsi).join('\n'), /[├│]/u);
    }
    const returnedBody = code.find((line) =>
      stripAnsi(line).includes('"content": "RETURNED-VALUE"')
    );
    assert.ok(returnedBody);
    assert.ok(
      returnedBody.includes(blockText(THEME, 'toolOutput', '  "content": "RETURNED-VALUE"'))
    );
    assert.doesNotMatch(returnedBody, /\x1b\[2m/u);
  }
});

test('result and log headings share their JSON output color while errors stay clear without extra dim', () => {
  const error = {phase: 'runtime', code: 'script_error', message: 'failed'};
  const theme = createTuiTheme({
    blocks: {
      colors: {
        text: [11, 22, 33],
        toolOutput: [44, 55, 66],
        toolError: [177, 88, 99]
      }
    }
  });
  const lines = renderToolPairLines(
    outerCall(),
    outerResult({status: 'failed', result: 'value', logs: ['log'], error}, {ok: false}),
    160,
    theme
  );
  for (const [heading, token] of [
    ['Result:', 'toolOutput'],
    ['Logs:', 'toolOutput'],
    ['Error:', 'toolError']
  ]) {
    const line = lines.find((line) => withoutRail(line) === heading);
    assert.ok(line, heading);
    assert.ok(line.includes(blockText(theme, token, heading)), heading);
    assert.doesNotMatch(line, /\x1b\[2m/u);
  }
  for (const body of ['"value"', '  "log"']) {
    const line = lines.find((line) => withoutRail(line) === body);
    assert.ok(line.includes(blockText(theme, 'toolOutput', body)), body);
    assert.doesNotMatch(line, /\x1b\[2m/u);
  }
  const errorBody = lines.find((line) => withoutRail(line) === '  "message": "failed"');
  assert.ok(errorBody.includes(blockText(theme, 'toolError', '  "message": "failed"')));
  assert.doesNotMatch(errorBody, /\x1b\[2m/u);
  assert.doesNotMatch(lines.map(stripAnsi).join('\n'), /→ agent/u);
});

test('Bash and Run code stay within every extremely narrow width from one through eight columns', () => {
  const bashCall = {
    ...outerCall(),
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({command: 'printf 中文🧑‍💻\tvalue\nsecond line'})
  };
  const bashResult = {
    ...outerResult(),
    toolName: 'run_bash_command',
    text: JSON.stringify({stdout: '返回🧑‍💻\tvalue\nsecond line', stderr: '', exit_code: 0})
  };
  const codeResult = outerResult({result: {value: '返回🧑‍💻\tvalue'}, logs: ['实际日志']});
  const records = [outerCall(), ...recordsForRun(), codeResult];
  for (let width = 1; width <= 8; width += 1) {
    const state = createCodeExecutionAppendState();
    const projections = [
      renderToolCallPreviewLines(bashCall.toolName, bashCall.argumentsText, width, THEME),
      renderToolCallPreviewLines('run_code', outerCall().argumentsText, width, THEME),
      renderToolPairLines(bashCall, bashResult, width, THEME),
      renderToolPairLines(bashCall, {...bashResult, ok: false}, width, THEME),
      renderToolPairLines(outerCall(), codeResult, width, THEME),
      renderToolPairLines(outerCall(), outerResult({status: 'failed'}, {ok: false}), width, THEME),
      renderTranscriptLines(records, width, THEME),
      records.flatMap((record) => append([record], state, width).trimEnd().split('\n'))
    ];
    for (const lines of projections) {
      assertSafeLines(lines, width);
      assertNoExpandedBodies(lines.join('\n'));
      assert.doesNotMatch(lines.map(stripAnsi).join('\n'), /[├│]/u);
    }
  }
});

test('preview cache keeps bounded sanitized text only and releases it on resident eviction', () => {
  const value = {
    result: {content: '\x1b[2J\x9b\r\t返回'.repeat(3000), tail: 'RAW-RESULT-TAIL'},
    logs: Array.from({length: 2000}, (_, index) => `log-${index}`),
    error: {
      phase: 'runtime',
      code: 'script_error',
      message: 'error'.repeat(8000),
      tail: 'RAW-ERROR-TAIL'
    }
  };
  const result = outerResult(value);
  const records = [outerCall(), ...recordsForRun(), result];
  const state = createCodeExecutionAppendState();
  const written = stripAnsi(append(records, state));
  assert.match(written, /Result:/u);
  assert.match(written, /preview truncated for display/u);
  const cached = [];
  function visit(value) {
    assert.notEqual(value, result);
    assert.notEqual(value, records);
    if (typeof value === 'string') {
      cached.push(value);
    } else if (value instanceof Map || value instanceof Set) {
      for (const item of value.values()) {
        visit(item);
      }
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        visit(item);
      }
    }
  }
  visit(state);
  const text = cached.join('\n');
  assert.ok(text.length < result.text.length / 2);
  assert.doesNotMatch(text, /RAW-RESULT-TAIL|RAW-ERROR-TAIL|log-1999|SOURCE-BODY|FILE-BODY/u);
  assert.doesNotMatch(text, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/u);
  assert.ok(cached.every((text) => text !== result.text));
  // 原始 JSON 对象不可留在投影状态里，字段遍历也必须看不到被截断的尾部。
  assert.doesNotMatch(JSON.stringify(state), /RAW-RESULT-TAIL|RAW-ERROR-TAIL|log-1999/u);
  pruneCodeExecutionAppendState(state, [{role: 'assistant', text: 'remaining message'}]);
  assert.deepEqual(state.runs, []);
  const replay = stripAnsi(append(records, state));
  assert.match(replay, /◆ ▌ Run code #1 · succeeded/u);
  assert.match(replay, /Result:/u);
});

test('restored snapshots rebuild previews at new widths without execution, mutation or duplicate late output', () => {
  const records = [
    outerCall({
      argumentsText: JSON.stringify({code: 'throw new Error("SOURCE-BODY-MUST-NOT-EXECUTE")'})
    }),
    ...recordsForRun(),
    outerResult({result: 'returned value '.repeat(400), logs: ['restored log']})
  ];
  const original = structuredClone(records);
  const state = createCodeExecutionAppendState();
  for (const width of [80, 160, 120]) {
    const lines = renderTranscriptLines(
      records,
      width,
      THEME,
      DEFAULT_RENDER_PREFERENCES,
      true,
      undefined,
      {state, snapshot: true}
    );
    const text = lines.map(stripAnsi).join('\n');
    assert.equal((text.match(/◆ ▌ Run code #1/gu) || []).length, 1);
    assert.equal((text.match(/Result:/gu) || []).length, 1);
    assert.equal((text.match(/Logs:/gu) || []).length, 1);
    assert.match(text, /restored log/u);
    assertSafeLines(lines, width);
    assertNoExpandedBodies(text);
    assert.equal(append([records.at(-1), ...recordsForRun()], state, width), '');
  }
  assert.deepEqual(records, original);
});

test('all built-in themes and tiny widths safely project forged controls, wide text and non-finite durations', () => {
  const themesDir = path.resolve(__dirname, '../../src/config/themes');
  const themes = listBuiltinThemes({themesDir});
  assert.equal(
    themes.length,
    fs.readdirSync(themesDir).filter((name) => name.endsWith('.json')).length
  );
  const records = [
    audit(0, 'start', {text: '\x1b[?1049h'}),
    child(1, 'call_start', 1, {
      toolName: '中文🧑‍💻\r\n\x1b[2J\x00\x07\x9b[?1049h\t工具',
      text: 'FILE-BODY-MUST-NOT-EXPAND'.repeat(1000)
    }),
    child(2, 'call_end', 1, {status: 'failed\x1b[31m', durationMs: NaN}),
    audit(3, 'end', {
      status: 'failed',
      durationMs: Infinity,
      text: 'runtime: error\r\n\x1b]52;c;evil\x07\x1b[?1049l'
    }),
    outerCall(),
    outerResult({status: 'failed', result: {value: '中文🧑‍💻\x1b[2J\x9b'}, logs: []}, {ok: false})
  ];
  const original = structuredClone(records);
  for (const entry of themes) {
    const theme = readBuiltinTheme(entry.id, {themesDir});
    assert.ok(theme, entry.id);
    for (const width of [1, 2, 3, 4, 5, 6, 7, 8, 24, 80, 160]) {
      const snapshot = renderTranscriptLines(records, width, theme);
      const state = createCodeExecutionAppendState();
      const incremental = records.flatMap((record) =>
        append([record], state, width, theme).trimEnd().split('\n')
      );
      assert.ok(incremental.some((line) => stripAnsi(line).trim() !== ''));
      for (const line of [...snapshot, ...incremental]) {
        assert.ok(
          displayWidth(line) <= safeRenderWidth(width),
          `${entry.id}: ${width}: ${stripAnsi(line)}`
        );
        assert.doesNotMatch(stripAnsi(line), /[\x00-\x1f\x7f-\x9f]/);
        assert.doesNotMatch(line, /\x1b\[2J|\x1b\[\?1049[hl]|\x1b\]52|NaN|Infinity/);
      }
      assertNoExpandedBodies(snapshot.join('\n'));
    }
  }
  assert.deepEqual(records, original);
});

test('app renderer rebuilds footer progress across resize/theme changes and emits one complete terminal block', () => {
  const {output, renderer, state, bannerContext} = harness();
  const records = recordsForRun();
  const pending = {
    kind: 'tool_call',
    callId: 'outer-code',
    toolName: 'run_code',
    argumentsText: outerCall().argumentsText
  };
  renderer.renderRecords({...state, pending, records: records.slice(0, 4)});
  for (const width of [160, 120, 100]) {
    renderer.renderDestructive({
      ...state,
      width,
      theme: createTuiTheme({blocks: {colors: {text: [11, 22, width]}}}),
      pending,
      records: records.slice(0, 4),
      bannerContext
    });
    const frame = output.writes.at(-1);
    const text = stripAnsi(frame);
    assert.equal((text.match(/Run code #1 · running/g) || []).length, 1);
    assert.match(text, /completed 1\/2 · failed 0 · cancelled 0 · pending 1/);
    assert.doesNotMatch(text, /#1 glob|#2 read_files/);
    assert.doesNotMatch(text, /interrupted before completion/);
    assert.ok(frame.includes(ansi.resetScrollRegion()));
    assert.ok(frame.includes(ansi.clearVisibleScreen()));
    assert.ok(frame.includes(ansi.clearScrollback()));
    assert.ok(frame.includes(ansi.showCursor()));
    assert.ok(frame.includes(`\x1b[38;2;11;22;${width}m`));
    assertNoExpandedBodies(text);
    assert.doesNotMatch(frame, /\x1b\[\?1049[hl]/);
  }
  output.writes.length = 0;
  renderer.renderRecords({...state, pending, records: [records[4]]});
  renderer.renderRecords({...state, records: [records[5], outerCall(), outerResult()]});
  const continued = stripAnsi(output.writes.join(''));
  assert.match(continued, /#1 glob · succeeded/);
  assert.match(continued, /◆ ▌ Run code #1 · succeeded/);
  assert.match(continued, /#2 read_files · succeeded/);
  assert.equal((continued.match(/◆ ▌ Run code/g) || []).length, 1);
  assert.match(continued, /completed 2\/2/);
  assertNoExpandedBodies(continued);
});

test('resume and single-tool pending use the same grouped projection without re-executing anything', () => {
  const records = recordsForRun().slice(0, 3);
  const {output, renderer, state, bannerContext} = harness();
  renderer.renderDestructive({...state, records, bannerContext});
  assert.match(stripAnsi(output.writes.at(-1)), /interrupted before completion/);
  renderer.renderDestructive({
    ...state,
    records,
    bannerContext,
    pending: {kind: 'tool_call', toolName: 'run_code', argumentsText: outerCall().argumentsText}
  });
  const text = stripAnsi(output.writes.at(-1));
  assert.doesNotMatch(text, /interrupted before completion/);
  assert.match(text, /Run code · running/);
  assert.doesNotMatch(text, /Run code #1|#1 glob|completed 0\/2/);
  renderer.renderDestructive({
    ...state,
    records,
    bannerContext,
    pending: {
      kind: 'tool_call',
      callId: 'outer-code',
      toolName: 'run_code',
      argumentsText: outerCall().argumentsText
    }
  });
  const identified = stripAnsi(output.writes.at(-1));
  assert.match(identified, /Run code #1 · running/);
  assert.match(identified, /completed 0\/2 · failed 0 · cancelled 0 · pending 2/);
  assert.doesNotMatch(identified, /#1 glob|#2 read_files|interrupted/);
  assertNoExpandedBodies(text);

  const older = audit(0, 'start', {toolCallId: 'older-call', executionId: 'older-execution'});
  const mixed = plainSnapshot([older, ...records], {active: true});
  assert.match(mixed, /◆ ▌ Run code #1 · interrupted/);
  assert.doesNotMatch(mixed, /Run code #2|running/);
});

test('missing child identities cannot collide with forged legacy pairing keys', () => {
  const records = [
    audit(0, 'start'),
    audit(1, 'call_start', {toolName: 'glob'}),
    audit(2, 'call_end', {toolName: 'grep', childCallId: '\u0000event:1', status: 'failed'}),
    audit(3, 'end', {status: 'failed'})
  ];
  const text = plainSnapshot(records);
  assert.match(text, /#\?1 glob · unfinished/);
  assert.match(text, /#\?2 grep · failed/);
  assert.match(text, /completed 0\/2 · failed 1 · cancelled 0 · unfinished 1/);
});

test('resident eviction and window switching release old code facts and keep main/BTW projections isolated', () => {
  const appendState = createCodeExecutionAppendState();
  append(recordsForRun(), appendState);
  pruneCodeExecutionAppendState(appendState, [{role: 'assistant', text: 'resident'}]);
  assert.deepEqual(appendState.runs, []);

  const {output, renderer, state, bannerContext} = harness();
  const records = recordsForRun();
  renderer.renderRecords({...state, records: records.slice(0, 3)});
  renderer.renderDestructive({
    ...state,
    mainTranscript: undefined,
    streamingOwner: 'btw-1',
    records: recordsForRun(),
    bannerContext
  });
  output.writes.length = 0;
  const pending = {
    kind: 'tool_call',
    callId: 'outer-code',
    toolName: 'run_code',
    argumentsText: outerCall().argumentsText
  };
  renderer.renderRecords({...state, pending, records: records.slice(3, 5)});
  const main = stripAnsi(output.writes.join(''));
  assert.match(main, /Run code #1 · running/);
  assert.match(main, /completed 2\/2 · failed 0 · cancelled 0/);
  assert.doesNotMatch(main, /#1 glob|#2 read_files/);
  renderer.syncMainTranscript({records: [], baseRecordIndex: 50, compaction: null}, null);
  output.writes.length = 0;
  renderer.renderRecords({
    ...state,
    pending,
    mainTranscript: {baseRecordIndex: 50, compaction: null},
    records: [audit(0, 'start')]
  });
  // footer 可保留未变化的标题，只写变化后缀；完整快照才应包含全部可见文本。
  assert.doesNotMatch(stripAnsi(output.writes.join('')), /completed 2\/2|#1 glob|#2 read_files/);
  renderer.renderDestructive({
    ...state,
    pending,
    mainTranscript: {baseRecordIndex: 50, compaction: null},
    records: [audit(0, 'start')],
    bannerContext
  });
  const reset = stripAnsi(output.writes.at(-1));
  assert.match(reset, /◆ ▌ Run code #1 · running/);
  assert.doesNotMatch(reset, /completed 2\/2|#1 glob|#2 read_files/);
});
